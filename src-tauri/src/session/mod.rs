pub mod rdp;
pub mod rdp_proxy;
pub mod sftp;
pub mod ssh;
pub mod transfer;
pub mod tunnels;

pub mod clipstage;
pub mod winproc;

use crate::auth::{lock_auth, AuthState};
use crate::vault::cipher::decrypt_opt;
use crate::vault::known_hosts;
use crate::vault::models::{Connection, RdpSettings};
use crate::vault::storage::load_vault_verified;
use rand::RngCore;
use rdp_proxy::RdpProxyHandle;
use serde::{Deserialize, Serialize};
use ssh::{spawn_ssh_session, HostKeyVerifier, SshConnectionConfig, SshWorkerCommand};
use std::collections::HashMap;
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use tunnels::{start_tunnels, TunnelHandle};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "connectionId")]
    pub connection_id: String,
    pub title: String,
    pub protocol: String, // "ssh" or "rdp"
    pub host: String,
    pub port: u16,
    pub username: String,
    pub status: String, // "connecting", "connected", "disconnected", "error"
    #[serde(rename = "statusMessage")]
    pub status_message: Option<String>,
    #[serde(rename = "bytesSent")]
    pub bytes_sent: u64,
    #[serde(rename = "bytesReceived")]
    pub bytes_received: u64,
    #[serde(rename = "startedAt")]
    pub started_at: String,
    #[serde(rename = "activePortForwards")]
    pub active_port_forwards: Vec<String>,
    #[serde(rename = "rdpProxyPort")]
    pub rdp_proxy_port: Option<u16>,
    /// Random per-session secret the WebAssembly client must present to the local proxy.
    #[serde(rename = "rdpProxyToken")]
    pub rdp_proxy_token: Option<String>,
    #[serde(rename = "rdpPassword")]
    pub rdp_password: Option<String>,
    #[serde(rename = "rdpDomain")]
    pub rdp_domain: Option<String>,
    #[serde(rename = "rdpSettings")]
    pub rdp_settings: Option<RdpSettings>,
}

pub struct SessionManager {
    pub sessions: HashMap<String, SessionInfo>,
    pub senders: HashMap<String, Sender<SshWorkerCommand>>,
    pub rdp_killers: HashMap<String, Sender<()>>,
    pub rdp_proxies: HashMap<String, RdpProxyHandle>,
    pub tunnels: HashMap<String, TunnelHandle>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            senders: HashMap::new(),
            rdp_killers: HashMap::new(),
            rdp_proxies: HashMap::new(),
            tunnels: HashMap::new(),
        }
    }
}

pub type SessionState = Mutex<SessionManager>;

/// `where <bin>` without flashing a console window (Windows); plain `where` elsewhere.
pub(crate) fn winproc_where(bin: &str) -> std::io::Result<std::process::Output> {
    #[cfg(target_os = "windows")]
    {
        winproc::hidden_command("where").arg(bin).output()
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("where").arg(bin).output()
    }
}

#[tauri::command]
pub fn session_list(state: tauri::State<'_, SessionState>) -> Result<Vec<SessionInfo>, String> {
    let mgr = state.lock().map_err(|e| e.to_string())?;
    Ok(mgr.sessions.values().cloned().collect())
}

/// Credentials and connection data resolved from the (integrity-verified) vault.
struct ResolvedConnection {
    conn: Connection,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    passphrase: Option<String>,
}

fn read_key_file(path: &Option<String>) -> Option<String> {
    let path = path.as_deref()?.trim();
    if path.is_empty() || !std::path::Path::new(path).is_file() {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

/// Resolves a saved connection. Host, port and protocol ALWAYS come from the vault, never from the
/// UI, so a compromised frontend cannot redirect stored credentials to an arbitrary server.
fn resolve_connection(auth_state: &AuthState, connection_id: &str) -> Result<ResolvedConnection, String> {
    let mgr = lock_auth(auth_state)?;
    let key = mgr
        .unlocked_key()
        .map_err(|_| "Magazyn poświadczeń jest zablokowany".to_string())?;
    let vault = load_vault_verified(key)?;

    let conn = vault
        .connections
        .iter()
        .find(|c| c.id == connection_id)
        .cloned()
        .ok_or_else(|| format!("Nie znaleziono połączenia o ID '{}'", connection_id))?;

    let mut username = conn.username.clone();
    let mut password: Option<String> = None;
    let mut private_key: Option<String> = None;
    let mut passphrase: Option<String> = None;

    // Reusable credential (lower priority)
    if let Some(cred_id) = &conn.credential_id {
        if let Some(cred) = vault.credentials.iter().find(|c| c.id == *cred_id) {
            if !cred.username.is_empty() {
                username = cred.username.clone();
            }
            password = decrypt_opt(key, &cred.password_encrypted)?;
            private_key = read_key_file(&cred.key_file_path);
            if private_key.is_none() {
                private_key = decrypt_opt(key, &cred.private_key_encrypted)?;
            }
            passphrase = decrypt_opt(key, &cred.private_key_passphrase_encrypted)?;
        }
    }

    // Direct connection credentials override the reusable credential if set
    if let Some(p) = decrypt_opt(key, &conn.password_encrypted)? {
        password = Some(p);
    }
    if let Some(k) = read_key_file(&conn.key_file_path) {
        private_key = Some(k);
    } else if private_key.is_none() {
        private_key = decrypt_opt(key, &conn.private_key_encrypted)?;
    }
    if let Some(p) = decrypt_opt(key, &conn.private_key_passphrase_encrypted)? {
        passphrase = Some(p);
    }

    Ok(ResolvedConnection {
        conn,
        username,
        password,
        private_key,
        passphrase,
    })
}

/// Builds a TOFU verifier for a server identity ("ssh" or "rdp").
pub fn make_host_verifier(app: &tauri::AppHandle, kind: &'static str, host: String, port: u16) -> HostKeyVerifier {
    let app = app.clone();
    HostKeyVerifier(Arc::new(move |fingerprint: &str| {
        let key = {
            let state = app.state::<AuthState>();
            let mgr = lock_auth(&state)?;
            mgr.unlocked_key().ok().cloned()
        };
        known_hosts::check_host(key.as_deref(), kind, &host, port, fingerprint)
    }))
}

fn random_token() -> String {
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

#[tauri::command]
pub fn session_connect(
    session_id: Option<String>,
    connection_id: String,
    title: String,
    protocol: String,
    host: String,
    port: u16,
    username: String,
    port_forwards_desc: Vec<String>,
    custom_passphrase: Option<String>,
    session_state: tauri::State<'_, SessionState>,
    auth_state: tauri::State<'_, AuthState>,
    app: tauri::AppHandle,
) -> Result<SessionInfo, String> {
    // host/port/protocol/username sent by the UI are informational only – the vault is authoritative.
    let _ = (&protocol, &host, port, &username);

    let resolved = resolve_connection(&auth_state, &connection_id)?;
    let conn = &resolved.conn;
    let host = conn.host.clone();
    let port = conn.port;
    let protocol = conn.protocol.clone();

    let session_id = session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let now = chrono::Utc::now().to_rfc3339();
    eprintln!("[RemoteFlow] session_connect: id={}, proto={}, target={}:{}", session_id, protocol, host, port);

    let mut resolved_passphrase = resolved.passphrase.clone();
    if let Some(cp) = custom_passphrase {
        if !cp.is_empty() {
            resolved_passphrase = Some(cp);
        }
    }

    if protocol == "ssh" {
        let session = SessionInfo {
            session_id: session_id.clone(),
            connection_id,
            title,
            protocol: protocol.clone(),
            host: host.clone(),
            port,
            username: resolved.username.clone(),
            status: "connected".to_string(),
            status_message: Some("Połączono pomyślnie".to_string()),
            bytes_sent: 0,
            bytes_received: 0,
            started_at: now,
            active_port_forwards: port_forwards_desc,
            rdp_proxy_port: None,
            rdp_proxy_token: None,
            rdp_password: None,
            rdp_domain: None,
            rdp_settings: None,
        };

        let (tx, rx) = std::sync::mpsc::channel();
        let config = SshConnectionConfig {
            host: host.clone(),
            port,
            username: resolved.username.clone(),
            password: resolved.password.clone(),
            private_key: resolved.private_key.clone(),
            passphrase: resolved_passphrase,
            host_key_verifier: make_host_verifier(&app, "ssh", host, port),
        };

        spawn_ssh_session(session_id.clone(), config.clone(), rx, app.clone());

        let tunnel_handle = start_tunnels(session_id.clone(), config, conn.port_forwarding.clone(), app);

        let mut mgr = session_state.lock().map_err(|e| e.to_string())?;
        mgr.sessions.insert(session_id.clone(), session.clone());
        mgr.senders.insert(session_id.clone(), tx);
        if let Some(th) = tunnel_handle {
            mgr.tunnels.insert(session_id.clone(), th);
        }
        Ok(session)
    } else if protocol == "rdp" {
        // Local WebSocket-to-TCP proxy for the WebAssembly client. It is locked to the configured
        // target, requires a per-session random token and pins the server's TLS certificate.
        let proxy_token = random_token();
        let error_app = app.clone();
        let error_sid = session_id.clone();
        let proxy_res = rdp_proxy::start_rdp_proxy(
            host.clone(),
            port,
            proxy_token.clone(),
            make_host_verifier(&app, "rdp", host.clone(), port),
            Arc::new(move |msg: String| {
                let _ = error_app.emit(&format!("rdp-proxy-error-{}", error_sid), msg);
            }),
        );
        let proxy_handle = proxy_res.map_err(|e| {
            eprintln!("[RemoteFlow] Błąd startu proxy RDP: {}", e);
            format!("Nie udało się uruchomić lokalnego proxy RDP: {}", e)
        })?;
        let rdp_proxy_port = Some(proxy_handle.port);

        let session = SessionInfo {
            session_id: session_id.clone(),
            connection_id,
            title,
            protocol,
            host,
            port,
            username: resolved.username.clone(),
            status: "connected".to_string(),
            status_message: Some("Sesja RDP aktywna w zakładce".to_string()),
            bytes_sent: 0,
            bytes_received: 0,
            started_at: now,
            active_port_forwards: port_forwards_desc,
            rdp_proxy_port,
            rdp_proxy_token: Some(proxy_token),
            rdp_password: resolved.password.clone(),
            rdp_domain: conn.rdp_settings.as_ref().and_then(|s| s.domain.clone()),
            rdp_settings: conn.rdp_settings.clone(),
        };

        let mut mgr = session_state.lock().map_err(|e| e.to_string())?;
        mgr.sessions.insert(session_id.clone(), session.clone());
        mgr.rdp_proxies.insert(session_id.clone(), proxy_handle);
        Ok(session)
    } else {
        Err(format!("Nieobsługiwany protokół: {}", protocol))
    }
}

#[tauri::command]
pub fn session_send_input(
    session_id: String,
    data: String,
    state: tauri::State<'_, SessionState>,
) -> Result<(), String> {
    let mut mgr = state.lock().map_err(|e| e.to_string())?;
    if let Some(session) = mgr.sessions.get_mut(&session_id) {
        session.bytes_sent += data.len() as u64;
    }

    if let Some(tx) = mgr.senders.get(&session_id) {
        let _ = tx.send(SshWorkerCommand::Input(data.into_bytes()));
    }

    Ok(())
}

#[tauri::command]
pub fn session_resize(
    session_id: String,
    cols: u32,
    rows: u32,
    state: tauri::State<'_, SessionState>,
) -> Result<(), String> {
    let mgr = state.lock().map_err(|e| e.to_string())?;
    if let Some(tx) = mgr.senders.get(&session_id) {
        let _ = tx.send(SshWorkerCommand::Resize(cols, rows));
    }
    Ok(())
}

#[tauri::command]
pub fn session_close(
    session_id: String,
    state: tauri::State<'_, SessionState>,
) -> Result<(), String> {
    let mut mgr = state.lock().map_err(|e| e.to_string())?;
    mgr.sessions.remove(&session_id);
    if let Some(tx) = mgr.senders.remove(&session_id) {
        let _ = tx.send(SshWorkerCommand::Close);
    }
    if let Some(kill_tx) = mgr.rdp_killers.remove(&session_id) {
        let _ = kill_tx.send(());
    }
    if let Some(proxy) = mgr.rdp_proxies.remove(&session_id) {
        proxy.shutdown();
    }
    if let Some(tunnel) = mgr.tunnels.remove(&session_id) {
        tunnel.shutdown();
    }
    Ok(())
}

#[tauri::command]
pub fn session_launch_external_rdp(
    session_id: String,
    connection_id: String,
    title: String,
    host: String,
    port: u16,
    username: String,
    session_state: tauri::State<'_, SessionState>,
    auth_state: tauri::State<'_, AuthState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let _ = (&host, port, &username);
    let resolved = resolve_connection(&auth_state, &connection_id)?;

    let (kill_tx, kill_rx) = std::sync::mpsc::channel();
    let rdp_config = rdp::RdpConnectionConfig {
        title,
        host: resolved.conn.host.clone(),
        port: resolved.conn.port,
        username: resolved.username.clone(),
        password: resolved.password.clone(),
        domain: resolved.conn.rdp_settings.as_ref().and_then(|s| s.domain.clone()),
        rdp_settings: resolved.conn.rdp_settings.clone(),
    };

    rdp::spawn_rdp_session(session_id.clone(), rdp_config, kill_rx, app);

    let mut mgr = session_state.lock().map_err(|e| e.to_string())?;
    mgr.rdp_killers.insert(session_id, kill_tx);
    Ok(())
}

pub fn resolve_connection_ssh_config(
    connection_id: &str,
    auth_state: &tauri::State<'_, AuthState>,
    app: &tauri::AppHandle,
) -> Result<SshConnectionConfig, String> {
    let resolved = resolve_connection(auth_state, connection_id)?;
    let host = resolved.conn.host.clone();
    let port = resolved.conn.port;
    Ok(SshConnectionConfig {
        host: host.clone(),
        port,
        username: resolved.username,
        password: resolved.password,
        private_key: resolved.private_key,
        passphrase: resolved.passphrase,
        host_key_verifier: make_host_verifier(app, "ssh", host, port),
    })
}

#[derive(Serialize)]
pub struct SftpListResponse {
    #[serde(rename = "currentPath")]
    pub current_path: String,
    pub entries: Vec<sftp::SftpFileEntry>,
    /// Parent directory (local listings), `None` at the file-system root.
    #[serde(rename = "parentPath", skip_serializing_if = "Option::is_none")]
    pub parent_path: Option<String>,
}

// ---------------------------------------------------------------------------------------------
// Two-pane SFTP manager
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Serialize)]
struct TransferProgress {
    #[serde(rename = "transferId")]
    transfer_id: String,
    files: u32,
    current: String,
}

fn progress_emitter(app: tauri::AppHandle, transfer_id: String) -> impl FnMut(u32, &str) {
    let mut last = std::time::Instant::now() - std::time::Duration::from_secs(1);
    move |files: u32, current: &str| {
        if last.elapsed() >= std::time::Duration::from_millis(120) {
            last = std::time::Instant::now();
            let _ = app.emit(
                "sftp-transfer-progress",
                TransferProgress { transfer_id: transfer_id.clone(), files, current: current.to_string() },
            );
        }
    }
}

#[tauri::command]
pub async fn sftp_mkdir(
    connection_id: String,
    parent: String,
    name: String,
    auth_state: tauri::State<'_, AuthState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let config = resolve_connection_ssh_config(&connection_id, &auth_state, &app)?;
    tokio::task::spawn_blocking(move || {
        transfer::with_pooled_sftp(&connection_id, &config, |sftp| transfer::remote_mkdir(sftp, &parent, &name))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn sftp_delete_paths(
    connection_id: String,
    remote_paths: Vec<String>,
    auth_state: tauri::State<'_, AuthState>,
    app: tauri::AppHandle,
) -> Result<u32, String> {
    let config = resolve_connection_ssh_config(&connection_id, &auth_state, &app)?;
    tokio::task::spawn_blocking(move || {
        transfer::with_pooled_sftp(&connection_id, &config, |sftp| {
            let mut n = 0;
            for p in &remote_paths {
                transfer::remote_delete(sftp, p)?;
                n += 1;
            }
            Ok(n)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn sftp_search(
    connection_id: String,
    remote_dir: String,
    query: String,
    auth_state: tauri::State<'_, AuthState>,
    app: tauri::AppHandle,
) -> Result<Vec<sftp::SftpFileEntry>, String> {
    let config = resolve_connection_ssh_config(&connection_id, &auth_state, &app)?;
    tokio::task::spawn_blocking(move || {
        transfer::with_pooled_sftp(&connection_id, &config, |sftp| transfer::remote_search(sftp, &remote_dir, &query))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn sftp_transfer_upload(
    connection_id: String,
    local_paths: Vec<String>,
    remote_dir: String,
    transfer_id: String,
    auth_state: tauri::State<'_, AuthState>,
    app: tauri::AppHandle,
) -> Result<transfer::TransferSummary, String> {
    let config = resolve_connection_ssh_config(&connection_id, &auth_state, &app)?;
    let mut progress = progress_emitter(app.clone(), transfer_id);
    tokio::task::spawn_blocking(move || transfer::upload_paths(&config, &local_paths, &remote_dir, &mut progress))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn sftp_transfer_download(
    connection_id: String,
    remote_paths: Vec<String>,
    local_dir: String,
    transfer_id: String,
    auth_state: tauri::State<'_, AuthState>,
    app: tauri::AppHandle,
) -> Result<transfer::TransferSummary, String> {
    let config = resolve_connection_ssh_config(&connection_id, &auth_state, &app)?;
    let mut progress = progress_emitter(app.clone(), transfer_id);
    tokio::task::spawn_blocking(move || transfer::download_paths(&config, &remote_paths, &local_dir, &mut progress))
        .await
        .map_err(|e| e.to_string())?
}

/// Closes the cached browsing session of a connection (SFTP window closed).
#[tauri::command]
pub fn sftp_release(connection_id: String) {
    std::thread::spawn(move || transfer::release_pooled(&connection_id));
}

#[tauri::command]
pub async fn local_mkdir(parent: String, name: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || transfer::local_mkdir(&parent, &name))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn local_search(local_dir: String, query: String) -> Result<Vec<sftp::SftpFileEntry>, String> {
    tokio::task::spawn_blocking(move || transfer::local_search(&local_dir, &query))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn sftp_list(
    connection_id: String,
    remote_path: String,
    auth_state: tauri::State<'_, AuthState>,
    app: tauri::AppHandle,
) -> Result<SftpListResponse, String> {
    let config = resolve_connection_ssh_config(&connection_id, &auth_state, &app)?;
    let (current_path, entries) = tokio::task::spawn_blocking(move || {
        transfer::with_pooled_sftp(&connection_id, &config, |sftp| transfer::remote_list(sftp, &remote_path))
    })
    .await
    .map_err(|e| format!("Błąd zadania SFTP: {}", e))??;

    Ok(SftpListResponse {
        current_path,
        entries,
        parent_path: None,
    })
}

#[tauri::command]
pub async fn sftp_upload_file(
    connection_id: String,
    remote_dir: String,
    filename: String,
    content_base64: String,
    auth_state: tauri::State<'_, AuthState>,
    app: tauri::AppHandle,
) -> Result<u64, String> {
    let config = resolve_connection_ssh_config(&connection_id, &auth_state, &app)?;
    tokio::task::spawn_blocking(move || {
        sftp::sftp_upload_base64_file(&config, &remote_dir, &filename, &content_base64)
    })
    .await
    .map_err(|e| format!("Błąd zadania przesyłania pliku SFTP: {}", e))?
}

#[tauri::command]
pub async fn sftp_upload_paths(
    connection_id: String,
    remote_dir: String,
    local_paths: Vec<String>,
    auth_state: tauri::State<'_, AuthState>,
    app: tauri::AppHandle,
) -> Result<u32, String> {
    let config = resolve_connection_ssh_config(&connection_id, &auth_state, &app)?;
    tokio::task::spawn_blocking(move || {
        sftp::sftp_upload_local_paths(&config, local_paths, &remote_dir)
    })
    .await
    .map_err(|e| format!("Błąd zadania przesyłania katalogu SFTP: {}", e))?
}

#[tauri::command]
pub fn open_shared_folder(target_dir: Option<String>) -> Result<String, String> {
    let resolved_dir = if let Some(dir) = target_dir.filter(|s| !s.trim().is_empty()) {
        std::path::PathBuf::from(dir)
    } else if let Ok(Some(vault)) = crate::vault::storage::load_vault() {
        if let Some(global_dir) = vault.metadata.global_download_dir.filter(|s| !s.trim().is_empty()) {
            std::path::PathBuf::from(global_dir)
        } else {
            dirs::download_dir().or_else(dirs::home_dir).unwrap_or_else(|| std::path::PathBuf::from("/tmp"))
        }
    } else {
        dirs::download_dir().or_else(dirs::home_dir).unwrap_or_else(|| std::path::PathBuf::from("/tmp"))
    };

    let _ = std::fs::create_dir_all(&resolved_dir);
    let path_str = resolved_dir.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("explorer").arg(&path_str).spawn();
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(&path_str).spawn();
    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open").arg(&path_str).spawn();

    Ok(path_str)
}

#[tauri::command]
pub async fn save_dropped_file_to_shared(
    filename: String,
    content_base64: String,
    target_dir: Option<String>,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        use base64::Engine;
        let data = base64::engine::general_purpose::STANDARD
            .decode(&content_base64)
            .map_err(|e| format!("Błąd dekodowania pliku: {}", e))?;

        let save_dir = if let Some(dir) = target_dir.filter(|s| !s.trim().is_empty()) {
            std::path::PathBuf::from(dir)
        } else if let Ok(Some(vault)) = crate::vault::storage::load_vault() {
            if let Some(global_dir) = vault.metadata.global_download_dir.filter(|s| !s.trim().is_empty()) {
                std::path::PathBuf::from(global_dir)
            } else {
                dirs::download_dir().or_else(dirs::home_dir).unwrap_or_else(|| std::path::PathBuf::from("/tmp"))
            }
        } else {
            dirs::download_dir().or_else(dirs::home_dir).unwrap_or_else(|| std::path::PathBuf::from("/tmp"))
        };

        let _ = std::fs::create_dir_all(&save_dir);

        let normalized = filename.replace('\\', "/");
        let parts: Vec<&str> = normalized
            .split('/')
            .filter(|s| !s.is_empty() && *s != "." && *s != "..")
            .collect();

        if parts.is_empty() {
            return Err("Nieprawidłowa nazwa pliku".to_string());
        }

        let mut target_path = save_dir;
        if parts.len() > 1 {
            for dir_part in &parts[..parts.len() - 1] {
                target_path = target_path.join(dir_part);
            }
            let _ = std::fs::create_dir_all(&target_path);
        }
        target_path = target_path.join(parts.last().unwrap());

        std::fs::write(&target_path, &data)
            .map_err(|e| format!("Błąd zapisu pliku do katalogu wymiany: {}", e))?;

        Ok(target_path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn decode_file_uri(uri: &str) -> Option<String> {
    let raw = uri.strip_prefix("file://")?;
    let mut bytes = Vec::with_capacity(raw.len());
    let b = raw.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h1), Some(h2)) = (
                (b[i + 1] as char).to_digit(16),
                (b[i + 2] as char).to_digit(16),
            ) {
                bytes.push(((h1 << 4) | h2) as u8);
                i += 3;
                continue;
            }
        }
        bytes.push(b[i]);
        i += 1;
    }
    String::from_utf8(bytes).ok()
}

#[tauri::command]
pub async fn clipboard_read_text(app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let _ = app.run_on_main_thread(move || {
            let clip = gtk::Clipboard::get(&gdk::SELECTION_CLIPBOARD);
            let tx_cell = std::rc::Rc::new(std::cell::RefCell::new(Some(tx)));
            let tx_clone = tx_cell.clone();
            clip.request_text(move |_clip, text| {
                if let Some(sender) = tx_clone.borrow_mut().take() {
                    let s = text.map(|t| t.to_string()).unwrap_or_default();
                    let _ = sender.send(s);
                }
            });
        });

        let mut text = tokio::time::timeout(std::time::Duration::from_millis(450), rx)
            .await
            .ok()
            .and_then(|r| r.ok())
            .unwrap_or_default();

        if text.is_empty() {
            text = tokio::task::spawn_blocking(|| {
                if let Ok(out) = std::process::Command::new("qdbus6")
                    .args([
                        "org.kde.klipper",
                        "/klipper",
                        "org.kde.klipper.klipper.getClipboardContents",
                    ])
                    .output()
                {
                    if out.status.success() {
                        let s = String::from_utf8_lossy(&out.stdout)
                            .trim_end_matches('\n')
                            .to_string();
                        if !s.is_empty() {
                            return s;
                        }
                    }
                }
                String::new()
            })
            .await
            .unwrap_or_default();
        }

        Ok(text)
    }
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        let text = tokio::task::spawn_blocking(winproc::clipboard_get_text)
            .await
            .unwrap_or_default();
        Ok(text)
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        let _ = app;
        Ok(String::new())
    }
}

#[tauri::command]
pub async fn clipboard_write_text(text: String, app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let text_for_gtk = text.clone();
        let _ = app.run_on_main_thread(move || {
            let clip = gtk::Clipboard::get(&gdk::SELECTION_CLIPBOARD);
            clip.set_text(&text_for_gtk);
        });

        let _ = tokio::task::spawn_blocking(move || {
            let _ = std::process::Command::new("qdbus6")
                .args([
                    "org.kde.klipper",
                    "/klipper",
                    "org.kde.klipper.klipper.setClipboardContents",
                    &text,
                ])
                .output();
        })
        .await;

        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        let _ = tokio::task::spawn_blocking(move || winproc::clipboard_set_text(&text)).await;
        Ok(())
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        let _ = (text, app);
        Ok(())
    }
}

#[tauri::command]
pub async fn clipboard_read_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    #[cfg(target_os = "linux")]
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let _ = app.run_on_main_thread(move || {
            let clip = gtk::Clipboard::get(&gdk::SELECTION_CLIPBOARD);
            let tx_cell = std::rc::Rc::new(std::cell::RefCell::new(Some(tx)));
            let tx_clone = tx_cell.clone();
            clip.request_uris(move |_clip, uris| {
                if let Some(sender) = tx_clone.borrow_mut().take() {
                    let list: Vec<String> = uris.iter().map(|u| u.to_string()).collect();
                    let _ = sender.send(list);
                }
            });
        });

        let uris = tokio::time::timeout(std::time::Duration::from_millis(450), rx)
            .await
            .ok()
            .and_then(|r| r.ok())
            .unwrap_or_default();

        let home_str = dirs::home_dir()
            .map(|h| h.to_string_lossy().trim_end_matches('/').to_string())
            .unwrap_or_default();

        let mut paths = Vec::new();
        for uri in uris {
            if let Some(p) = decode_file_uri(&uri) {
                let clean = p.trim_end_matches('/').to_string();
                if !clean.is_empty()
                    && clean != "/"
                    && clean != home_str
                    && std::path::Path::new(&clean).exists()
                    && !paths.contains(&clean)
                {
                    paths.push(clean);
                }
            }
        }

        if paths.is_empty() {
            if let Ok(text) = clipboard_read_text(app).await {
                for line in text.lines() {
                    let trimmed = line.trim();
                    if let Some(p) = decode_file_uri(trimmed) {
                        let clean = p.trim_end_matches('/').to_string();
                        if !clean.is_empty()
                            && clean != "/"
                            && clean != home_str
                            && std::path::Path::new(&clean).exists()
                            && !paths.contains(&clean)
                        {
                            paths.push(clean);
                        }
                    } else if trimmed.starts_with('/') && !trimmed.contains('\0') {
                        let clean = trimmed.trim_end_matches('/').to_string();
                        if !clean.is_empty()
                            && clean != "/"
                            && clean != home_str
                            && std::path::Path::new(&clean).exists()
                            && !paths.contains(&clean)
                        {
                            paths.push(clean);
                        }
                    }
                }
            }
        }

        Ok(paths)
    }
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        let paths = tokio::task::spawn_blocking(winproc::clipboard_get_files)
            .await
            .unwrap_or_default();
        Ok(paths)
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        let _ = app;
        Ok(Vec::new())
    }
}

#[tauri::command]
pub async fn local_list_dir(local_path: String) -> Result<SftpListResponse, String> {
    tokio::task::spawn_blocking(move || {
        let target = if local_path.is_empty() || local_path == "~" || local_path == "." {
            dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("/"))
        } else {
            std::path::PathBuf::from(&local_path)
        };

        let canonical = std::fs::canonicalize(&target).unwrap_or(target);
        let current_path = transfer::display_path(&canonical);
        let parent_path = canonical.parent().map(transfer::display_path);

        let read_dir = std::fs::read_dir(&canonical)
            .map_err(|e| format!("Błąd odczytu katalogu lokalnego '{}': {}", current_path, e))?;

        let mut entries = Vec::new();
        for item in read_dir.flatten() {
            let p = item.path();
            let name = p
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            if name.is_empty() || name == "." || name == ".." {
                continue;
            }
            let meta = std::fs::symlink_metadata(&p).ok();
            if meta.as_ref().map(|m| m.file_type().is_symlink()).unwrap_or(false) {
                continue;
            }
            let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
            let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let modified = meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            entries.push(sftp::SftpFileEntry {
                name,
                path: transfer::display_path(&p),
                is_dir,
                size,
                modified,
                permissions: 0o755,
            });
        }

        entries.sort_by(|a, b| {
            let a_hidden = a.name.starts_with('.');
            let b_hidden = b.name.starts_with('.');
            if a_hidden != b_hidden {
                a_hidden.cmp(&b_hidden)
            } else if a.is_dir != b.is_dir {
                b.is_dir.cmp(&a.is_dir)
            } else {
                a.name.to_lowercase().cmp(&b.name.to_lowercase())
            }
        });

        Ok(SftpListResponse {
            current_path,
            entries,
            parent_path,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn pick_local_folder() -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(|| {
        #[cfg(target_os = "windows")]
        {
            let script = format!(
                "{} $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Wybierz katalog'; if ($f.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {{ Write-Output $f.SelectedPath }}",
                winproc::DIALOG_PRELUDE
            );
            if let Some(out) = winproc::powershell(&script) {
                let s = out.trim().to_string();
                if !s.is_empty() {
                    return Ok(Some(s));
                }
            }
            return Ok(None);
        }

        #[cfg(not(target_os = "windows"))]
        {
            let home = dirs::home_dir()
                .map(|h| h.to_string_lossy().to_string())
                .unwrap_or_else(|| "/".to_string());

            if let Ok(out) = std::process::Command::new("kdialog")
                .arg("--getexistingdirectory")
                .arg(&home)
                .arg("--title")
                .arg("Wybierz katalog do przesłania")
                .output()
            {
                if out.status.success() {
                    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    if !s.is_empty() {
                        return Ok(Some(s));
                    }
                }
                return Ok(None);
            }

            if let Ok(out) = std::process::Command::new("zenity")
                .arg("--file-selection")
                .arg("--directory")
                .arg("--title=Wybierz katalog do przesłania")
                .arg(format!("--filename={}/", home))
                .output()
            {
                if out.status.success() {
                    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    if !s.is_empty() {
                        return Ok(Some(s));
                    }
                }
                return Ok(None);
            }

            Ok(None)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn pick_local_file(title: Option<String>) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || {
        let dialog_title = title.unwrap_or_else(|| "Wybierz plik klucza prywatnego SSH".to_string());
        #[cfg(target_os = "windows")]
        {
            let script = format!(
                "{} $f = New-Object System.Windows.Forms.OpenFileDialog; $f.Multiselect = $false; $f.Title = '{}'; if ($f.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {{ Write-Output $f.FileName }}",
                winproc::DIALOG_PRELUDE,
                dialog_title.replace('\'', "''")
            );
            if let Some(out) = winproc::powershell(&script) {
                let s = out.trim().to_string();
                if !s.is_empty() {
                    return Ok(Some(s));
                }
            }
            return Ok(None);
        }

        #[cfg(not(target_os = "windows"))]
        {
            let home = dirs::home_dir()
                .map(|h| h.join(".ssh").to_string_lossy().to_string())
                .unwrap_or_else(|| "/".to_string());

            if let Ok(out) = std::process::Command::new("kdialog")
                .arg("--getopenfilename")
                .arg(&home)
                .arg("--title")
                .arg(&dialog_title)
                .output()
            {
                if out.status.success() {
                    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    if !s.is_empty() {
                        return Ok(Some(s));
                    }
                }
                return Ok(None);
            }

            if let Ok(out) = std::process::Command::new("zenity")
                .arg("--file-selection")
                .arg(format!("--title={}", dialog_title))
                .arg(format!("--filename={}/", home))
                .output()
            {
                if out.status.success() {
                    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    if !s.is_empty() {
                        return Ok(Some(s));
                    }
                }
                return Ok(None);
            }

            Ok(None)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn read_local_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Błąd odczytu pliku '{}': {}", path, e))
}

#[derive(Serialize)]
pub struct RdpClipboardFileEntry {
    pub name: String,
    pub path: Option<String>,
    #[serde(rename = "isDirectory")]
    pub is_directory: bool,
    pub size: u64,
    #[serde(rename = "lastModified")]
    pub last_modified: u64,
    #[serde(rename = "contentBase64")]
    pub content_base64: Option<String>,
}

fn collect_rdp_clipboard_entries(
    local: &std::path::Path,
    rel_parent_win: Option<String>,
    shared_target_dir: &std::path::Path,
    out: &mut Vec<RdpClipboardFileEntry>,
    depth: u32,
) -> Result<(), String> {
    if out.len() >= 500 || depth > 16 {
        return Ok(());
    }

    let sym_meta = match std::fs::symlink_metadata(local) {
        Ok(m) => m,
        Err(_) => return Ok(()),
    };
    if sym_meta.file_type().is_symlink() {
        return Ok(());
    }

    let name = local
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("item")
        .to_string();

    if depth > 0
        && (name == ".cache"
            || name == ".local"
            || name == ".cargo"
            || name == ".rustup"
            || name == "node_modules"
            || name == "target"
            || name == ".git")
    {
        return Ok(());
    }

    let last_modified = sym_meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let shared_dest = shared_target_dir.join(&name);

    if sym_meta.is_dir() {
        let _ = std::fs::create_dir_all(&shared_dest);
        out.push(RdpClipboardFileEntry {
            name: name.clone(),
            path: rel_parent_win.clone(),
            is_directory: true,
            size: 0,
            last_modified,
            content_base64: None,
        });

        let next_parent = match rel_parent_win {
            Some(ref p) if !p.is_empty() => Some(format!("{}\\{}", p, name)),
            _ => Some(name),
        };

        if let Ok(entries) = std::fs::read_dir(local) {
            for entry in entries.flatten() {
                collect_rdp_clipboard_entries(
                    &entry.path(),
                    next_parent.clone(),
                    &shared_dest,
                    out,
                    depth + 1,
                )?;
            }
        }
    } else if sym_meta.is_file() {
        // Cap individual file size for in-memory base64 clipboard staging to 50 MB
        if sym_meta.len() > 50 * 1024 * 1024 {
            return Ok(());
        }
        use base64::Engine;
        let data = std::fs::read(local)
            .map_err(|e| format!("Błąd odczytu pliku '{}': {}", local.display(), e))?;
        let _ = std::fs::write(&shared_dest, &data);
        let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
        out.push(RdpClipboardFileEntry {
            name,
            path: rel_parent_win,
            is_directory: false,
            size: data.len() as u64,
            last_modified,
            content_base64: Some(b64),
        });
    }

    Ok(())
}

#[tauri::command]
pub async fn read_local_paths_for_rdp_clipboard(
    local_paths: Vec<String>,
) -> Result<Vec<RdpClipboardFileEntry>, String> {
    tokio::task::spawn_blocking(move || {
        let home_dir = dirs::home_dir()
            .map(|h| h.to_string_lossy().trim_end_matches('/').to_string())
            .unwrap_or_default();

        let shared_dir = dirs::home_dir()
            .map(|h| h.join("RemoteFlow_Shared"))
            .unwrap_or_else(|| std::path::PathBuf::from("/tmp/remoteflow_shared"));
        let _ = std::fs::create_dir_all(&shared_dir);

        let mut result = Vec::new();
        for lp in local_paths {
            let clean = lp.trim_end_matches('/');
            if clean.is_empty() || clean == "/" {
                return Err("Nie można przesłać głównego systemu plików '/'.".to_string());
            }
            if !home_dir.is_empty() && clean == home_dir {
                return Err(format!(
                    "Nie można przesłać całego katalogu domowego ({}). Wybierz konkretny podkatalog lub plik.",
                    home_dir
                ));
            }
            let p = std::path::Path::new(&lp);
            if p.exists() {
                collect_rdp_clipboard_entries(p, None, &shared_dir, &mut result, 0)?;
            }
        }
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Exits the application after the user confirmed it in the UI (the window close request is
/// intercepted by the frontend, so the window cannot simply be destroyed by the OS).
#[tauri::command]
pub fn app_exit(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn app_maximize_window(window: tauri::Window) -> Result<(), String> {
    window.maximize().map_err(|e| e.to_string())
}


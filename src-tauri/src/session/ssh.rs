use crate::vault::cipher::fingerprint_from_digest;
use crate::vault::known_hosts::HostTrust;
use std::io::{Read, Write};
use std::net::ToSocketAddrs;
use std::sync::mpsc::Receiver;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

/// Checks a server fingerprint ("SHA256:...") against the trusted-hosts store.
#[derive(Clone)]
pub struct HostKeyVerifier(pub Arc<dyn Fn(&str) -> Result<HostTrust, String> + Send + Sync>);

impl std::fmt::Debug for HostKeyVerifier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("HostKeyVerifier")
    }
}

#[derive(Clone, Debug)]
pub struct SshConnectionConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub private_key: Option<String>,
    pub passphrase: Option<String>,
    /// Mandatory: the server's host key is verified BEFORE any credentials are sent.
    pub host_key_verifier: HostKeyVerifier,
}

pub enum SshWorkerCommand {
    Input(Vec<u8>),
    Resize(u32, u32),
    Close,
}

/// Folder for the rare Windows fallback in [`ssh_connect_raw`] (per-user, not shared %TEMP%).
fn key_tmp_dir() -> std::path::PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("RemoteFlow")
        .join("ssh-tmp")
}

/// Overwrites a file with zeros before deleting it (best effort – SSD wear levelling may keep
/// old blocks, which is why this path is only a last-resort fallback).
fn wipe_file(path: &std::path::Path) {
    if let Ok(meta) = std::fs::metadata(path) {
        if let Ok(mut f) = std::fs::OpenOptions::new().write(true).open(path) {
            let zeros = vec![0u8; meta.len() as usize];
            let _ = f.write_all(&zeros);
            let _ = f.sync_all();
        }
    }
    let _ = std::fs::remove_file(path);
}

/// Removes key files left behind by a crash or a killed process (called at startup).
pub fn sweep_stale_key_files() {
    // Files from versions before 1.1.2 were written to %TEMP%
    let legacy = std::fs::read_dir(std::env::temp_dir()).into_iter().flatten().flatten();
    let current = std::fs::read_dir(key_tmp_dir()).into_iter().flatten().flatten();
    for entry in legacy.chain(current) {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("rf_ssh_") && name.ends_with(".tmp") {
            wipe_file(&entry.path());
        }
    }
}

/// Private key written to disk only for the duration of one authentication; wiped on drop.
#[cfg_attr(not(windows), allow(dead_code))]
struct TempKeyFile {
    path: std::path::PathBuf,
}

#[cfg_attr(not(windows), allow(dead_code))]
impl TempKeyFile {
    fn create(content: &[u8]) -> std::io::Result<Self> {
        let dir = key_tmp_dir();
        std::fs::create_dir_all(&dir)?;
        let path = dir.join(format!("rf_ssh_{}.tmp", uuid::Uuid::new_v4()));
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create_new(true); // never follow / reuse an existing file
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut f = opts.open(&path)?;
        let guard = TempKeyFile { path };
        f.write_all(content)?;
        f.sync_all()?;
        Ok(guard)
    }

    fn path(&self) -> &std::path::Path {
        &self.path
    }
}

impl Drop for TempKeyFile {
    fn drop(&mut self) {
        wipe_file(&self.path);
    }
}

pub fn ssh_connect_raw(config: &SshConnectionConfig) -> Result<ssh2::Session, String> {
    let addr_str = format!("{}:{}", config.host, config.port);
    let mut tcp_stream = None;

    if let Ok(addrs) = addr_str.to_socket_addrs() {
        for addr in addrs {
            if let Ok(stream) = std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_secs(4)) {
                let _ = stream.set_nodelay(true);

                // Enable OS-level TCP KeepAlive so NAT gateways and firewalls never drop idle TCP state
                let socket = socket2::Socket::from(stream);
                let keepalive = socket2::TcpKeepalive::new()
                    .with_time(std::time::Duration::from_secs(15))
                    .with_interval(std::time::Duration::from_secs(5));
                let _ = socket.set_tcp_keepalive(&keepalive);
                let stream: std::net::TcpStream = socket.into();

                tcp_stream = Some(stream);
                break;
            }
        }
    }

    let tcp = tcp_stream.ok_or_else(|| {
        tr!("Nie udało się połączyć z hostem '{}': brak odpowiedzi (sprawdź adres IP i port)", "Could not connect to host '{}': no response (check the IP address and port)", addr_str)
    })?;

    let mut sess = ssh2::Session::new().map_err(|e| tr!("Błąd inicjalizacji biblioteki SSH: {}", "SSH library initialisation error: {}", e))?;
    sess.set_tcp_stream(tcp);
    sess.handshake().map_err(|e| tr!("Błąd negocjacji SSH (Handshake): {}", "SSH handshake error: {}", e))?;

    // Host key verification (TOFU) – must happen before any authentication attempt,
    // otherwise a man-in-the-middle would receive the password.
    let digest = sess
        .host_key_hash(ssh2::HashType::Sha256)
        .ok_or_else(|| tr!("Serwer SSH nie przedstawił klucza hosta", "The SSH server did not present a host key").to_string())?;
    let fingerprint = fingerprint_from_digest(digest);
    (config.host_key_verifier.0)(&fingerprint)?;

    let mut authed = false;
    if let Some(key_content) = &config.private_key {
        let trimmed = key_content.trim();
        if !trimmed.is_empty() {
            let passphrase = config.passphrase.as_deref().filter(|p| !p.is_empty());
            let key_path = std::path::Path::new(trimmed);
            if !trimmed.contains('\n') && key_path.is_file() {
                // The user's own key file: libssh2 reads it directly – no copy is ever written.
                authed = sess.userauth_pubkey_file(&config.username, None, key_path, passphrase).is_ok();
            } else {
                // Key stored in the vault: authenticate from memory on every platform
                // (OpenSSL backend on Unix, WinCNG + crypt32 on Windows).
                authed = sess.userauth_pubkey_memory(&config.username, None, key_content, passphrase).is_ok();

                // WinCNG cannot decrypt passphrase-protected PEM keys held in memory, only from a
                // file. Only in that case a short-lived, owner-only file is used and wiped right away.
                #[cfg(windows)]
                {
                    if !authed && passphrase.is_some() {
                        if let Ok(tmp) = TempKeyFile::create(key_content.as_bytes()) {
                            authed = sess.userauth_pubkey_file(&config.username, None, tmp.path(), passphrase).is_ok();
                        }
                    }
                }
            }
        }
    }

    if !authed {
        if let Some(pwd) = &config.password {
            if sess.userauth_password(&config.username, pwd).is_ok() {
                authed = true;
            }
        }
    }

    if !authed {
        let _ = sess.userauth_agent(&config.username);
    }

    if !sess.authenticated() {
        return Err(tr!(
            "Niepowodzenie logowania dla użytkownika '{}' na serwerze {}. Sprawdź hasło lub klucz.", "Login failed for user '{}' on server {}. Check the password or key.",
            config.username, addr_str
        ));
    }

    Ok(sess)
}

pub fn spawn_ssh_session(
    session_id: String,
    config: SshConnectionConfig,
    cmd_rx: Receiver<SshWorkerCommand>,
    app: AppHandle,
) {
    std::thread::spawn(move || {
        let sid = session_id.clone();
        let emit_error = |msg: String| {
            let formatted = tr!("\r\n\x1b[1;31m[RemoteFlow Błąd SSH]\x1b[0m {}\r\n", "\r\n\x1b[1;31m[RemoteFlow SSH error]\x1b[0m {}\r\n", msg);
            let _ = app.emit(&format!("ssh-data-{}", sid), formatted);
        };

        let sess = match ssh_connect_raw(&config) {
            Ok(s) => s,
            Err(e) => {
                emit_error(e);
                return;
            }
        };

        // 4. Request PTY & Shell
        let mut channel = match sess.channel_session() {
            Ok(c) => c,
            Err(e) => {
                emit_error(tr!("Błąd otwierania kanału SSH: {}", "Error opening the SSH channel: {}", e));
                return;
            }
        };

        if let Err(e) = channel.request_pty("xterm-256color", None, Some((100, 30, 0, 0))) {
            emit_error(tr!("Błąd żądania PTY: {}", "PTY request error: {}", e));
            return;
        }

        if let Err(e) = channel.shell() {
            emit_error(tr!("Błąd uruchamiania powłoki: {}", "Error starting the shell: {}", e));
            return;
        }

        // Configure session with blocking mode and 30ms timeout for reliable channel flow control
        sess.set_blocking(true);
        sess.set_timeout(30);
        sess.set_keepalive(false, 15);

        // 5. Main bidirectional loop
        let mut last_keepalive = std::time::Instant::now();
        let mut buffer = [0u8; 4096];
        loop {
            // Periodically send SSH keepalive packet to maintain active state through NAT/firewalls
            if last_keepalive.elapsed() >= std::time::Duration::from_secs(5) {
                let _ = sess.keepalive_send();
                last_keepalive = std::time::Instant::now();
            }

            // Process any pending commands from UI (input keystrokes, resize, close)
            while let Ok(cmd) = cmd_rx.try_recv() {
                match cmd {
                    SshWorkerCommand::Input(data) => {
                        let _ = channel.write_all(&data);
                        let _ = channel.flush();
                    }
                    SshWorkerCommand::Resize(cols, rows) => {
                        let _ = channel.request_pty_size(cols, rows, None, None);
                    }
                    SshWorkerCommand::Close => {
                        let _ = channel.close();
                        return;
                    }
                }
            }

            // Read output from remote SSH channel
            match channel.read(&mut buffer) {
                Ok(0) => {
                    // EOF - remote server closed session
                    let _ = app.emit(
                        &format!("ssh-data-{}", sid),
                        tr!("\r\n\x1b[33m[Sesja SSH została zakończona przez serwer zdalny]\x1b[0m\r\n", "\r\n\x1b[33m[The SSH session was closed by the remote server]\x1b[0m\r\n").to_string(),
                    );
                    break;
                }
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buffer[..n]).to_string();

                    // Instantly answer terminal capability queries (DA1, cursor position, background query)
                    // so shells like fish do not wait 10 seconds for capability handshake.
                    if text.contains("\x1b[0c") || text.contains("\x1b[c") {
                        let _ = channel.write_all(b"\x1b[?62;1;2;6;7;8;9c");
                        let _ = channel.flush();
                    }
                    if text.contains("\x1b[6n") {
                        let _ = channel.write_all(b"\x1b[1;1R");
                        let _ = channel.flush();
                    }
                    if text.contains("\x1b]11;?\x1b\\") {
                        let _ = channel.write_all(b"\x1b]11;rgb:0909/0d0d/1616\x1b\\");
                        let _ = channel.flush();
                    }

                    let _ = app.emit(&format!("ssh-data-{}", sid), text);
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut || e.kind() == std::io::ErrorKind::WouldBlock => {
                    // Send keepalive during quiet/idle periods
                    if last_keepalive.elapsed() >= std::time::Duration::from_secs(5) {
                        let _ = sess.keepalive_send();
                        last_keepalive = std::time::Instant::now();
                    }

                    // Read timeout (no incoming data from remote server): wait briefly for user input from UI
                    match cmd_rx.recv_timeout(std::time::Duration::from_millis(15)) {
                        Ok(SshWorkerCommand::Input(mut data)) => {
                            // Batch any consecutive keystrokes
                            while let Ok(cmd) = cmd_rx.try_recv() {
                                match cmd {
                                    SshWorkerCommand::Input(more) => data.extend(more),
                                    SshWorkerCommand::Resize(cols, rows) => {
                                        let _ = channel.request_pty_size(cols, rows, None, None);
                                    }
                                    SshWorkerCommand::Close => {
                                        let _ = channel.close();
                                        return;
                                    }
                                }
                            }
                            let _ = channel.write_all(&data);
                            let _ = channel.flush();
                        }
                        Ok(SshWorkerCommand::Resize(cols, rows)) => {
                            let _ = channel.request_pty_size(cols, rows, None, None);
                        }
                        Ok(SshWorkerCommand::Close) => {
                            let _ = channel.close();
                            return;
                        }
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                            // Timeout expired; continue loop
                        }
                        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                            return;
                        }
                    }
                }
                Err(e) => {
                    let err_str = e.to_string();
                    if err_str.contains("transport read")
                        || err_str.contains("Broken pipe")
                        || err_str.contains("Connection reset")
                        || err_str.contains("WSAECONNRESET")
                    {
                        emit_error(
                            tr!("Połączenie SSH zostało zakończone przez serwer zdalny lub nastąpiła utrata łączności sieciowej.", "The SSH connection was closed by the remote server or the network connection was lost.").to_string(),
                        );
                    } else {
                        emit_error(tr!("Błąd odczytu z kanału SSH: {}", "Error reading from the SSH channel: {}", e));
                    }
                    break;
                }
            }
        }
    });
}

#[cfg(test)]
mod key_file_tests {
    use super::*;

    #[test]
    fn temp_key_file_is_wiped_and_swept() {
        let tmp = TempKeyFile::create(b"-----BEGIN KEY-----secret").unwrap();
        let path = tmp.path().to_path_buf();
        assert!(path.exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        drop(tmp);
        assert!(!path.exists());

        // A file left behind by a crash is removed at the next start
        let stale = key_tmp_dir().join("rf_ssh_stale-test.tmp");
        std::fs::write(&stale, b"secret").unwrap();
        sweep_stale_key_files();
        assert!(!stale.exists());
    }
}

/// Needs a local sshd on 127.0.0.1:2222 with user `rftest` whose authorized_keys contains
/// /tmp/k/id_rsa.pub (PEM, no passphrase) and /tmp/k/id_ed.pub (OpenSSH, passphrase `kp-123`).
#[cfg(test)]
mod key_auth_e2e {
    use super::*;

    fn cfg(key: String, passphrase: Option<&str>) -> SshConnectionConfig {
        SshConnectionConfig {
            host: "127.0.0.1".into(),
            port: 2222,
            username: "rftest".into(),
            password: None,
            private_key: Some(key),
            passphrase: passphrase.map(|s| s.to_string()),
            host_key_verifier: HostKeyVerifier(Arc::new(|_| Ok(HostTrust::Known))),
        }
    }

    #[test]
    #[ignore]
    fn key_from_memory_and_from_path() {
        let pem = std::fs::read_to_string("/tmp/k/id_rsa").unwrap();
        assert!(ssh_connect_raw(&cfg(pem, None)).unwrap().authenticated());
        assert!(ssh_connect_raw(&cfg("/tmp/k/id_rsa".into(), None)).unwrap().authenticated());
        let ed = std::fs::read_to_string("/tmp/k/id_ed").unwrap();
        assert!(ssh_connect_raw(&cfg(ed, Some("kp-123"))).unwrap().authenticated());
        assert!(ssh_connect_raw(&cfg("/tmp/k/id_ed".into(), Some("kp-123"))).unwrap().authenticated());
        assert!(ssh_connect_raw(&cfg("/tmp/k/id_ed".into(), Some("wrong"))).is_err());
    }
}

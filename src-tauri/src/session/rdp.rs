use crate::vault::models::RdpSettings;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::mpsc::Receiver;
use tauri::{AppHandle, Emitter};

pub struct RdpConnectionConfig {
    pub title: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub domain: Option<String>,
    pub rdp_settings: Option<RdpSettings>,
}

/// Splits the RDP login into the account name and the domain the way Windows does.
///
/// Accepted forms (the domain field of the connection is optional):
/// - `jan` + domain `CORP`            → `jan` / `CORP`
/// - `CORP\jan` (domain field ignored) → `jan` / `CORP`
/// - `jan@corp.local` (UPN)            → `jan@corp.local` / no domain (the UPN already identifies the domain)
/// - `.\jan` or domain `.`             → `jan` / no domain (local account of the target machine)
///
/// IronRDP (sspi) rejects a user name containing `\` or `@` when a separate domain is also given
/// ("invalid username"), so the two must never be sent together.
pub fn normalize_rdp_identity(username: &str, domain: Option<&str>) -> (String, Option<String>) {
    let user = username.trim();
    let mut dom = domain.map(str::trim).filter(|d| !d.is_empty()).map(str::to_string);

    let (user, from_user) = match user.split_once('\\') {
        Some((d, u)) => (u.trim().to_string(), Some(d.trim().to_string())),
        None => (user.to_string(), None),
    };
    if let Some(d) = from_user {
        // The domain typed together with the user name wins over the separate field
        dom = Some(d).filter(|d| !d.is_empty());
    } else if user.contains('@') {
        // User principal name – it already carries the domain
        dom = None;
    }
    // "." means the local machine: no domain for NTLM/CredSSP
    if dom.as_deref() == Some(".") {
        dom = None;
    }
    // A domain may be entered as NetBIOS (CORP) or DNS name (corp.local); both are accepted by Windows.
    // Characters that can never appear in it are dropped instead of failing the whole login.
    let dom = dom.map(|d| d.replace(['\\', '@'], "")).filter(|d| !d.is_empty());
    (user, dom)
}

/// Login shown to the user / passed to clients that expect a single string (`DOMAIN\user` or UPN).
pub fn display_rdp_login(username: &str, domain: Option<&str>) -> String {
    match domain {
        Some(d) if !d.is_empty() => format!("{}\\{}", d, username),
        _ => username.to_string(),
    }
}

/// Minimal .rdp file for mstsc: address + pre-filled user name (no password).
fn write_mstsc_rdp_file(session_id: &str, host: &str, port: u16, login: &str) -> std::io::Result<std::path::PathBuf> {
    let dir = std::env::temp_dir().join("RemoteFlow").join("mstsc");
    std::fs::create_dir_all(&dir)?;
    let safe_id: String = session_id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    let path = dir.join(format!("{}.rdp", safe_id));
    let clean = |v: &str| v.replace(['\r', '\n'], "");
    let mut content = format!("full address:s:{}:{}\r\n", clean(host), port);
    if !login.is_empty() {
        content.push_str(&format!("username:s:{}\r\n", clean(login)));
    }
    content.push_str("prompt for credentials:i:1\r\n");
    std::fs::write(&path, content)?;
    Ok(path)
}

pub fn spawn_rdp_session(
    session_id: String,
    config: RdpConnectionConfig,
    kill_rx: Receiver<()>,
    app: AppHandle,
) {
    std::thread::spawn(move || {
        let sid = session_id.clone();
        let emit_log = |msg: String| {
            let _ = app.emit(&format!("rdp-data-{}", sid), msg);
        };

        emit_log(format!(
            "▶ Inicjalizacja połączenia RDP do {}:{} (użytkownik: {})...",
            config.host, config.port, config.username
        ));

        // Locate available RDP binary on the system
        let binary_candidates = if cfg!(target_os = "windows") {
            vec!["mstsc.exe", "mstsc"]
        } else if cfg!(target_os = "macos") {
            vec!["xfreerdp3", "xfreerdp", "open"]
        } else {
            // Linux: prioritize modern FreeRDP 3 then FreeRDP 2
            vec!["xfreerdp3", "wlfreerdp3", "sdl-freerdp3", "xfreerdp", "wlfreerdp", "remmina"]
        };

        let mut found_binary: Option<String> = None;
        if cfg!(target_os = "windows") {
            let system_mstsc = std::path::Path::new(r"C:\Windows\System32\mstsc.exe");
            if system_mstsc.exists() {
                found_binary = Some(system_mstsc.to_string_lossy().to_string());
            } else {
                for bin in &binary_candidates {
                    if let Ok(output) = crate::session::winproc_where(bin) {
                        if output.status.success() {
                            found_binary = Some(bin.to_string());
                            break;
                        }
                    }
                }
            }
        } else {
            for bin in &binary_candidates {
                if let Ok(output) = Command::new("which").arg(bin).output() {
                    if output.status.success() {
                        found_binary = Some(bin.to_string());
                        break;
                    }
                }
            }
        }

        let binary = match found_binary {
            Some(b) => b,
            None => {
                emit_log("❌ Błąd: Nie znaleziono zainstalowanego klienta RDP (FreeRDP) w systemie.".to_string());
                emit_log("ℹ️ Wskazówka: Zainstaluj pakiet poleceniem:".to_string());
                emit_log("   Arch/CachyOS: sudo pacman -S freerdp".to_string());
                emit_log("   Debian/Ubuntu: sudo apt install freerdp3-x11 (lub freerdp2-x11)".to_string());
                emit_log("   Fedora: sudo dnf install freerdp".to_string());
                let _ = app.emit(&format!("rdp-status-{}", sid), "error");
                return;
            }
        };

        emit_log(format!("✓ Wykryto klienta RDP: {}", binary));

        let mut cmd = Command::new(&binary);

        let (rdp_user, rdp_domain) = normalize_rdp_identity(&config.username, config.domain.as_deref());

        if binary.contains("freerdp") {
            cmd.arg(format!("/v:{}:{}", config.host, config.port));
            if !rdp_user.is_empty() {
                cmd.arg(format!("/u:{}", rdp_user));
            }
            if let Some(pwd) = &config.password {
                if !pwd.is_empty() {
                    cmd.arg(format!("/p:{}", pwd));
                }
            }
            if let Some(dom) = &rdp_domain {
                cmd.arg(format!("/d:{}", dom));
            }
            cmd.arg(format!("/t:RemoteFlow - {} ({}:{})", config.title, config.host, config.port));
            // Trust-on-first-use instead of blindly accepting any certificate (MITM protection).
            cmd.arg("/cert:tofu");
            if binary.contains("freerdp3") {
                cmd.arg("/clipboard:direction-to:all,files-to:all");
            } else {
                cmd.arg("+clipboard");
            }
            cmd.arg("+dynamic-resolution");

            // Drive redirection: share local folder and home with remote Windows session
            // Visible in Windows Explorer under "Ten komputer" (This PC) as "RemoteFlow on <hostname>" or \\tsclient\RemoteFlow
            let shared_dir = dirs::home_dir()
                .map(|h| h.join("RemoteFlow_Shared"))
                .unwrap_or_else(|| std::path::PathBuf::from("/tmp/remoteflow_shared"));
            let _ = std::fs::create_dir_all(&shared_dir);
            cmd.arg(format!("/drive:RemoteFlow,{}", shared_dir.to_string_lossy()));
            cmd.arg("+home-drive");

            if let Some(settings) = &config.rdp_settings {
                if settings.sound {
                    cmd.arg("/sound:sys:pulse");
                }
                if settings.width > 0 && settings.height > 0 && !binary.contains("wlfreerdp") {
                    cmd.arg(format!("/size:{}x{}", settings.width, settings.height));
                }
            }
        } else if binary.contains("mstsc") {
            // mstsc has no command line switch for the user name: a temporary .rdp file pre-fills
            // DOMAIN\user in the login prompt (the password is never written to disk).
            match write_mstsc_rdp_file(&sid, &config.host, config.port, &display_rdp_login(&rdp_user, rdp_domain.as_deref())) {
                Ok(path) => {
                    cmd.arg(&path);
                    let cleanup = path.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(30));
                        let _ = std::fs::remove_file(cleanup);
                    });
                }
                Err(e) => {
                    emit_log(format!("⚠️ Nie udało się przygotować pliku .rdp ({}), użytkownik nie zostanie podpowiedziany.", e));
                    cmd.arg(format!("/v:{}:{}", config.host, config.port));
                }
            }
        }

        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = match cmd.spawn() {
            Ok(c) => {
                emit_log(format!("⚡ Uruchomiono natywne okno sesji RDP (PID: {}).", c.id()));
                let _ = app.emit(&format!("rdp-status-{}", sid), "connected");
                c
            }
            Err(e) => {
                emit_log(format!("❌ Błąd uruchamiania procesu RDP: {}", e));
                let _ = app.emit(&format!("rdp-status-{}", sid), "error");
                return;
            }
        };

        // Pipe stdout to frontend
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let sid_stdout = sid.clone();
        let app_stdout = app.clone();

        if let Some(out) = stdout {
            std::thread::spawn(move || {
                let reader = BufReader::new(out);
                for line in reader.lines().flatten() {
                    let _ = app_stdout.emit(&format!("rdp-data-{}", sid_stdout), line);
                }
            });
        }

        // Pipe stderr to frontend
        let sid_stderr = sid.clone();
        let app_stderr = app.clone();
        if let Some(err) = stderr {
            std::thread::spawn(move || {
                let reader = BufReader::new(err);
                for line in reader.lines().flatten() {
                    let _ = app_stderr.emit(&format!("rdp-data-{}", sid_stderr), line);
                }
            });
        }

        // Wait loop: either child process exits or user closes tab (kill_rx)
        loop {
            // Check if user closed tab in RemoteFlow
            if let Ok(()) = kill_rx.try_recv() {
                emit_log("⏹ Zamykanie procesu RDP na żądanie użytkownika...".to_string());
                let _ = child.kill();
                let _ = child.wait();
                return;
            }

            // Check if RDP process exited on its own
            match child.try_wait() {
                Ok(Some(status)) => {
                    emit_log(format!("ℹ️ Okno sesji RDP zostało zamknięte (kod: {}).", status));
                    let _ = app.emit(&format!("rdp-status-{}", sid), "disconnected");
                    return;
                }
                Ok(None) => {
                    std::thread::sleep(std::time::Duration::from_millis(150));
                }
                Err(e) => {
                    emit_log(format!("⚠️ Błąd monitorowania procesu RDP: {}", e));
                    return;
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn n(u: &str, d: Option<&str>) -> (String, Option<String>) {
        normalize_rdp_identity(u, d)
    }

    #[test]
    fn domain_field_only() {
        assert_eq!(n("jan", Some("CORP")), ("jan".into(), Some("CORP".into())));
        assert_eq!(n(" jan ", Some(" corp.local ")), ("jan".into(), Some("corp.local".into())));
        assert_eq!(n("jan", Some("")), ("jan".into(), None));
        assert_eq!(n("jan", None), ("jan".into(), None));
    }

    #[test]
    fn down_level_name_in_username() {
        assert_eq!(n("CORP\\jan", None), ("jan".into(), Some("CORP".into())));
        // Same domain in both places (typical mRemoteNG import) – no duplicate, no error
        assert_eq!(n("CORP\\jan", Some("CORP")), ("jan".into(), Some("CORP".into())));
        // The user name prefix wins over a different domain field
        assert_eq!(n("OTHER\\jan", Some("CORP")), ("jan".into(), Some("OTHER".into())));
    }

    #[test]
    fn upn_and_local_accounts() {
        assert_eq!(n("jan@corp.local", Some("CORP")), ("jan@corp.local".into(), None));
        assert_eq!(n(".\\administrator", Some("CORP")), ("administrator".into(), None));
        assert_eq!(n("administrator", Some(".")), ("administrator".into(), None));
        assert_eq!(n("\\jan", Some("CORP")), ("jan".into(), None));
    }

    #[test]
    fn display_login() {
        assert_eq!(display_rdp_login("jan", Some("CORP")), "CORP\\jan");
        assert_eq!(display_rdp_login("jan@corp.local", None), "jan@corp.local");
    }
}

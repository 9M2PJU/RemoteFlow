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

        if binary.contains("freerdp") {
            cmd.arg(format!("/v:{}:{}", config.host, config.port));
            if !config.username.is_empty() {
                cmd.arg(format!("/u:{}", config.username));
            }
            if let Some(pwd) = &config.password {
                if !pwd.is_empty() {
                    cmd.arg(format!("/p:{}", pwd));
                }
            }
            if let Some(dom) = &config.domain {
                if !dom.is_empty() {
                    cmd.arg(format!("/d:{}", dom));
                }
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
            cmd.arg(format!("/v:{}:{}", config.host, config.port));
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

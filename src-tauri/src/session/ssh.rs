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
        format!("Nie udało się połączyć z hostem '{}': brak odpowiedzi (sprawdź adres IP i port)", addr_str)
    })?;

    let mut sess = ssh2::Session::new().map_err(|e| format!("Błąd inicjalizacji biblioteki SSH: {}", e))?;
    sess.set_tcp_stream(tcp);
    sess.handshake().map_err(|e| format!("Błąd negocjacji SSH (Handshake): {}", e))?;

    // Host key verification (TOFU) – must happen before any authentication attempt,
    // otherwise a man-in-the-middle would receive the password.
    let digest = sess
        .host_key_hash(ssh2::HashType::Sha256)
        .ok_or_else(|| "Serwer SSH nie przedstawił klucza hosta".to_string())?;
    let fingerprint = fingerprint_from_digest(digest);
    (config.host_key_verifier.0)(&fingerprint)?;

    let mut authed = false;
    if let Some(key_content) = &config.private_key {
        let trimmed = key_content.trim();
        if !trimmed.is_empty() {
            let resolved_key = if std::path::Path::new(trimmed).is_file() {
                std::fs::read_to_string(trimmed).unwrap_or_else(|_| key_content.clone())
            } else {
                key_content.clone()
            };

            #[cfg(unix)]
            {
                if sess
                    .userauth_pubkey_memory(
                        &config.username,
                        None,
                        &resolved_key,
                        config.passphrase.as_deref(),
                    )
                    .is_ok()
                {
                    authed = true;
                }
            }
            #[cfg(not(unix))]
            {
                let tmp_path = std::env::temp_dir().join(format!("rf_ssh_{}.tmp", uuid::Uuid::new_v4()));
                if std::fs::write(&tmp_path, &resolved_key).is_ok() {
                    if sess
                        .userauth_pubkey_file(
                            &config.username,
                            None,
                            &tmp_path,
                            config.passphrase.as_deref(),
                        )
                        .is_ok()
                    {
                        authed = true;
                    }
                    let _ = std::fs::remove_file(&tmp_path);
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
        return Err(format!(
            "Niepowodzenie logowania dla użytkownika '{}' na serwerze {}. Sprawdź hasło lub klucz.",
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
            let formatted = format!("\r\n\x1b[1;31m[RemoteFlow Błąd SSH]\x1b[0m {}\r\n", msg);
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
                emit_error(format!("Błąd otwierania kanału SSH: {}", e));
                return;
            }
        };

        if let Err(e) = channel.request_pty("xterm-256color", None, Some((100, 30, 0, 0))) {
            emit_error(format!("Błąd żądania PTY: {}", e));
            return;
        }

        if let Err(e) = channel.shell() {
            emit_error(format!("Błąd uruchamiania powłoki: {}", e));
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
                        "\r\n\x1b[33m[Sesja SSH została zakończona przez serwer zdalny]\x1b[0m\r\n".to_string(),
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
                            "Połączenie SSH zostało zakończone przez serwer zdalny lub nastąpiła utrata łączności sieciowej.".to_string(),
                        );
                    } else {
                        emit_error(format!("Błąd odczytu z kanału SSH: {}", e));
                    }
                    break;
                }
            }
        }
    });
}

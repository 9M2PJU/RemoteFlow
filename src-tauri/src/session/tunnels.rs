use crate::session::ssh::{ssh_connect_raw, SshConnectionConfig};
use crate::vault::models::PortForwardRule;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub struct TunnelHandle {
    shutdown_flag: Arc<AtomicBool>,
}

impl TunnelHandle {
    pub fn shutdown(&self) {
        self.shutdown_flag.store(true, Ordering::SeqCst);
    }
}

pub fn start_tunnels(
    session_id: String,
    config: SshConnectionConfig,
    rules: Vec<PortForwardRule>,
    app: AppHandle,
) -> Option<TunnelHandle> {
    let active_rules: Vec<PortForwardRule> = rules.into_iter().filter(|r| r.enabled).collect();
    if active_rules.is_empty() {
        return None;
    }

    let shutdown_flag = Arc::new(AtomicBool::new(false));

    for rule in active_rules {
        match rule.forward_type.as_str() {
            "local" => {
                spawn_local_tunnel(
                    session_id.clone(),
                    config.clone(),
                    rule,
                    shutdown_flag.clone(),
                    app.clone(),
                );
            }
            "dynamic" => {
                spawn_dynamic_tunnel(
                    session_id.clone(),
                    config.clone(),
                    rule,
                    shutdown_flag.clone(),
                    app.clone(),
                );
            }
            "remote" => {
                spawn_remote_tunnel(
                    session_id.clone(),
                    config.clone(),
                    rule,
                    shutdown_flag.clone(),
                    app.clone(),
                );
            }
            _ => {}
        }
    }

    Some(TunnelHandle { shutdown_flag })
}

/// Bidirectionally streams bytes between a local TCP client and an SSH direct-tcpip channel.
fn pipe_stream_and_channel(
    mut client_stream: TcpStream,
    mut channel: ssh2::Channel,
    sess: ssh2::Session,
    shutdown: Arc<AtomicBool>,
) {
    let _ = client_stream.set_nodelay(true);
    let _ = client_stream.set_read_timeout(Some(Duration::from_millis(20)));
    let _ = client_stream.set_write_timeout(Some(Duration::from_millis(3000)));
    sess.set_blocking(true);
    sess.set_timeout(20);
    sess.set_keepalive(false, 15);

    let mut last_keepalive = std::time::Instant::now();
    let mut client_buf = [0u8; 16384];
    let mut ssh_buf = [0u8; 16384];
    let mut client_alive = true;
    let mut ssh_alive = true;

    while client_alive && ssh_alive && !shutdown.load(Ordering::Relaxed) {
        if last_keepalive.elapsed() >= Duration::from_secs(5) {
            let _ = sess.keepalive_send();
            last_keepalive = std::time::Instant::now();
        }

        let mut had_activity = false;

        // 1. Read from local TCP client -> send to SSH channel
        match client_stream.read(&mut client_buf) {
            Ok(0) => {
                client_alive = false;
                let _ = channel.send_eof();
            }
            Ok(n) => {
                had_activity = true;
                if channel.write_all(&client_buf[..n]).is_err() || channel.flush().is_err() {
                    ssh_alive = false;
                }
            }
            Err(ref e)
                if e.kind() == std::io::ErrorKind::TimedOut
                    || e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => {
                client_alive = false;
            }
        }

        if !client_alive {
            break;
        }

        // 2. Read from SSH channel -> send to local TCP client
        match channel.read(&mut ssh_buf) {
            Ok(0) => {
                ssh_alive = false;
            }
            Ok(n) => {
                had_activity = true;
                if client_stream.write_all(&ssh_buf[..n]).is_err() || client_stream.flush().is_err() {
                    client_alive = false;
                }
            }
            Err(ref e)
                if e.kind() == std::io::ErrorKind::TimedOut
                    || e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => {
                ssh_alive = false;
            }
        }

        if !had_activity {
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    let _ = channel.close();
}

/// Spawns a Local Port Forwarding tunnel (-L):
/// Binds 127.0.0.1:{local_port} locally. When a client connects, opens a direct-tcpip channel to remote_host:remote_port.
fn spawn_local_tunnel(
    session_id: String,
    config: SshConnectionConfig,
    rule: PortForwardRule,
    shutdown: Arc<AtomicBool>,
    app: AppHandle,
) {
    let local_port = rule.local_port;
    let remote_host = rule
        .remote_host
        .clone()
        .unwrap_or_else(|| "127.0.0.1".to_string());
    let remote_port = rule.remote_port.unwrap_or(local_port);

    let bind_addr = format!("127.0.0.1:{}", local_port);
    let listener = match TcpListener::bind(&bind_addr) {
        Ok(l) => {
            let msg = format!(
                "\r\n\x1b[1;32m[RemoteFlow Tunel SSH]\x1b[0m Aktywny tunel lokalny (-L): \x1b[36m127.0.0.1:{}\x1b[0m -> \x1b[36m{}:{}\x1b[0m\r\n",
                local_port, remote_host, remote_port
            );
            let _ = app.emit(&format!("ssh-data-{}", session_id), msg);
            l
        }
        Err(e) => {
            let msg = format!(
                "\r\n\x1b[1;31m[RemoteFlow Błąd Tunelu SSH]\x1b[0m Nie udało się otworzyć portu lokalnego {}: {}\r\n",
                local_port, e
            );
            let _ = app.emit(&format!("ssh-data-{}", session_id), msg);
            return;
        }
    };

    let _ = listener.set_nonblocking(true);

    std::thread::spawn(move || {
        while !shutdown.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((client_stream, _addr)) => {
                    let cfg = config.clone();
                    let r_host = remote_host.clone();
                    let r_port = remote_port;
                    let shut = shutdown.clone();

                    std::thread::spawn(move || {
                        let sess = match ssh_connect_raw(&cfg) {
                            Ok(s) => s,
                            Err(e) => {
                                eprintln!(
                                    "[RemoteFlow Tunnel] SSH connect error for local forward: {}",
                                    e
                                );
                                return;
                            }
                        };

                        let channel = match sess.channel_direct_tcpip(&r_host, r_port, None) {
                            Ok(c) => c,
                            Err(e) => {
                                eprintln!(
                                    "[RemoteFlow Tunnel] channel_direct_tcpip error ({}:{}): {}",
                                    r_host, r_port, e
                                );
                                return;
                            }
                        };

                        pipe_stream_and_channel(client_stream, channel, sess, shut);
                    });
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(25));
                }
                Err(_) => {
                    break;
                }
            }
        }
    });
}

/// Spawns a Dynamic SOCKS5 proxy tunnel (-D):
/// Binds 127.0.0.1:{local_port} locally and handles standard SOCKS5 handshake & CONNECT requests.
fn spawn_dynamic_tunnel(
    session_id: String,
    config: SshConnectionConfig,
    rule: PortForwardRule,
    shutdown: Arc<AtomicBool>,
    app: AppHandle,
) {
    let local_port = rule.local_port;
    let bind_addr = format!("127.0.0.1:{}", local_port);

    let listener = match TcpListener::bind(&bind_addr) {
        Ok(l) => {
            let msg = format!(
                "\r\n\x1b[1;32m[RemoteFlow Tunel SSH]\x1b[0m Aktywny serwer dynamiczny SOCKS5 (-D): \x1b[36m127.0.0.1:{}\x1b[0m\r\n",
                local_port
            );
            let _ = app.emit(&format!("ssh-data-{}", session_id), msg);
            l
        }
        Err(e) => {
            let msg = format!(
                "\r\n\x1b[1;31m[RemoteFlow Błąd Tunelu SSH]\x1b[0m Nie udało się otworzyć portu SOCKS5 {}: {}\r\n",
                local_port, e
            );
            let _ = app.emit(&format!("ssh-data-{}", session_id), msg);
            return;
        }
    };

    let _ = listener.set_nonblocking(true);

    std::thread::spawn(move || {
        while !shutdown.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((client_stream, _addr)) => {
                    let cfg = config.clone();
                    let shut = shutdown.clone();

                    std::thread::spawn(move || {
                        handle_socks5_client(client_stream, cfg, shut);
                    });
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(25));
                }
                Err(_) => {
                    break;
                }
            }
        }
    });
}

fn handle_socks5_client(
    mut client_stream: TcpStream,
    config: SshConnectionConfig,
    shutdown: Arc<AtomicBool>,
) {
    let _ = client_stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = client_stream.set_write_timeout(Some(Duration::from_secs(5)));

    // 1. Handshake: [0x05, NMETHODS, METHODS...]
    let mut header = [0u8; 2];
    if client_stream.read_exact(&mut header).is_err() || header[0] != 5 {
        return;
    }
    let mut methods = vec![0u8; header[1] as usize];
    if client_stream.read_exact(&mut methods).is_err() {
        return;
    }
    // Reply: 0x05 (version 5), 0x00 (NO_AUTH)
    if client_stream.write_all(&[5, 0]).is_err() {
        return;
    }

    // 2. Request: [VER=5, CMD=1, RSV=0, ATYP, DST.ADDR, DST.PORT]
    let mut req_header = [0u8; 4];
    if client_stream.read_exact(&mut req_header).is_err() || req_header[0] != 5 {
        return;
    }
    if req_header[1] != 1 {
        // Only CONNECT (1) supported
        let _ = client_stream.write_all(&[5, 7, 0, 1, 0, 0, 0, 0, 0, 0]);
        return;
    }

    let (dest_host, dest_port) = match req_header[3] {
        1 => {
            // IPv4
            let mut ip = [0u8; 4];
            if client_stream.read_exact(&mut ip).is_err() {
                return;
            }
            let mut port = [0u8; 2];
            if client_stream.read_exact(&mut port).is_err() {
                return;
            }
            (
                format!("{}.{}.{}.{}", ip[0], ip[1], ip[2], ip[3]),
                u16::from_be_bytes(port),
            )
        }
        3 => {
            // Domain name
            let mut len = [0u8; 1];
            if client_stream.read_exact(&mut len).is_err() {
                return;
            }
            let mut domain = vec![0u8; len[0] as usize];
            if client_stream.read_exact(&mut domain).is_err() {
                return;
            }
            let mut port = [0u8; 2];
            if client_stream.read_exact(&mut port).is_err() {
                return;
            }
            (
                String::from_utf8_lossy(&domain).to_string(),
                u16::from_be_bytes(port),
            )
        }
        4 => {
            // IPv6
            let mut ip = [0u8; 16];
            if client_stream.read_exact(&mut ip).is_err() {
                return;
            }
            let mut port = [0u8; 2];
            if client_stream.read_exact(&mut port).is_err() {
                return;
            }
            let ipv6 = std::net::Ipv6Addr::from(ip);
            (ipv6.to_string(), u16::from_be_bytes(port))
        }
        _ => {
            let _ = client_stream.write_all(&[5, 8, 0, 1, 0, 0, 0, 0, 0, 0]);
            return;
        }
    };

    // 3. Connect via SSH channel
    let sess = match ssh_connect_raw(&config) {
        Ok(s) => s,
        Err(_) => {
            let _ = client_stream.write_all(&[5, 5, 0, 1, 0, 0, 0, 0, 0, 0]);
            return;
        }
    };

    let channel = match sess.channel_direct_tcpip(&dest_host, dest_port, None) {
        Ok(c) => c,
        Err(_) => {
            let _ = client_stream.write_all(&[5, 5, 0, 1, 0, 0, 0, 0, 0, 0]);
            return;
        }
    };

    // Reply SUCCESS: [5, 0, 0, 1, 0,0,0,0, 0,0]
    if client_stream.write_all(&[5, 0, 0, 1, 0, 0, 0, 0, 0, 0]).is_err() {
        return;
    }

    pipe_stream_and_channel(client_stream, channel, sess, shutdown);
}

/// Spawns a Remote Port Forwarding tunnel (-R):
/// Instructs the remote SSH server to listen on remote_port, and forwards incoming connections to local target.
fn spawn_remote_tunnel(
    session_id: String,
    config: SshConnectionConfig,
    rule: PortForwardRule,
    shutdown: Arc<AtomicBool>,
    app: AppHandle,
) {
    let remote_listen_port = rule.local_port;
    let local_dest_host = rule
        .remote_host
        .clone()
        .unwrap_or_else(|| "127.0.0.1".to_string());
    let local_dest_port = rule.remote_port.unwrap_or(80);

    std::thread::spawn(move || {
        let sess = match ssh_connect_raw(&config) {
            Ok(s) => s,
            Err(e) => {
                let msg = format!(
                    "\r\n\x1b[1;31m[RemoteFlow Błąd Tunelu SSH]\x1b[0m Nie udało się połączyć dla tunelu zdalnego (-R): {}\r\n",
                    e
                );
                let _ = app.emit(&format!("ssh-data-{}", session_id), msg);
                return;
            }
        };

        let (mut listener, _bound_remote_port) = match sess.channel_forward_listen(remote_listen_port, None, None) {
            Ok((l, port)) => {
                let msg = format!(
                    "\r\n\x1b[1;32m[RemoteFlow Tunel SSH]\x1b[0m Aktywny tunel zdalny (-R): \x1b[36mserwer:{}\x1b[0m -> \x1b[36m{}:{}\x1b[0m\r\n",
                    port, local_dest_host, local_dest_port
                );
                let _ = app.emit(&format!("ssh-data-{}", session_id), msg);
                (l, port)
            }
            Err(e) => {
                let msg = format!(
                    "\r\n\x1b[1;31m[RemoteFlow Błąd Tunelu SSH]\x1b[0m Nie udało się powiązać portu zdalnego {}: {}\r\n",
                    remote_listen_port, e
                );
                let _ = app.emit(&format!("ssh-data-{}", session_id), msg);
                return;
            }
        };

        sess.set_blocking(true);
        sess.set_timeout(100);
        sess.set_keepalive(false, 15);

        let mut last_keepalive = std::time::Instant::now();

        while !shutdown.load(Ordering::Relaxed) {
            if last_keepalive.elapsed() >= Duration::from_secs(5) {
                let _ = sess.keepalive_send();
                last_keepalive = std::time::Instant::now();
            }

            match listener.accept() {
                Ok(mut remote_channel) => {
                    let target_addr = format!("{}:{}", local_dest_host, local_dest_port);
                    let local_stream_res = TcpStream::connect(&target_addr);
                    match local_stream_res {
                        Ok(mut local_stream) => {
                            let _ = local_stream.set_nodelay(true);
                            let _ = local_stream.set_read_timeout(Some(Duration::from_millis(20)));
                            let shut = shutdown.clone();

                            std::thread::spawn(move || {
                                let mut lbuf = [0u8; 16384];
                                let mut rbuf = [0u8; 16384];
                                let mut l_alive = true;
                                let mut r_alive = true;

                                while l_alive && r_alive && !shut.load(Ordering::Relaxed) {
                                    let mut act = false;
                                    match local_stream.read(&mut lbuf) {
                                        Ok(0) => {
                                            l_alive = false;
                                            let _ = remote_channel.send_eof();
                                        }
                                        Ok(n) => {
                                            act = true;
                                            if remote_channel.write_all(&lbuf[..n]).is_err()
                                                || remote_channel.flush().is_err()
                                            {
                                                r_alive = false;
                                            }
                                        }
                                        Err(ref e)
                                            if e.kind() == std::io::ErrorKind::TimedOut
                                                || e.kind() == std::io::ErrorKind::WouldBlock => {}
                                        Err(_) => {
                                            l_alive = false;
                                        }
                                    }

                                    if !l_alive {
                                        break;
                                    }

                                    match remote_channel.read(&mut rbuf) {
                                        Ok(0) => {
                                            r_alive = false;
                                        }
                                        Ok(n) => {
                                            act = true;
                                            if local_stream.write_all(&rbuf[..n]).is_err()
                                                || local_stream.flush().is_err()
                                            {
                                                l_alive = false;
                                            }
                                        }
                                        Err(ref e)
                                            if e.kind() == std::io::ErrorKind::TimedOut
                                                || e.kind() == std::io::ErrorKind::WouldBlock => {}
                                        Err(_) => {
                                            r_alive = false;
                                        }
                                    }

                                    if !act {
                                        std::thread::sleep(Duration::from_millis(1));
                                    }
                                }
                                let _ = remote_channel.close();
                            });
                        }
                        Err(e) => {
                            eprintln!(
                                "[RemoteFlow Tunnel] Failed to connect to local target {}: {}",
                                target_addr, e
                            );
                            let _ = remote_channel.close();
                        }
                    }
                }
                Err(ref e)
                    if e.code() == ssh2::ErrorCode::Session(-37)
                        || e.code() == ssh2::ErrorCode::Session(-30)
                        || e.to_string().contains("timeout")
                        || e.to_string().contains("again") =>
                {
                    std::thread::sleep(Duration::from_millis(50));
                }
                Err(_) => {
                    break;
                }
            }
        }
    });
}

//! System clipboard helpers for Linux (`wl-copy`/`wl-paste`, `xclip`, `xsel`).
//!
//! The GTK clipboard of the WebView window is not always enough: on a Wayland session the
//! compositor may reject a selection set without a fresh input serial, an XWayland window
//! (`GDK_BACKEND=x11`) depends on the compositor syncing the X11 selection, and some clipboard
//! managers drop the content. When a helper is installed, the text is also handed to it.
//!
//! The text always goes through stdin – never as an argument, which would expose passwords in
//! the process list (`/proc/PID/cmdline`).

use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const HELPER_TIMEOUT: Duration = Duration::from_millis(1500);

fn on_wayland() -> bool {
    std::env::var_os("WAYLAND_DISPLAY").is_some_and(|v| !v.is_empty())
}

fn on_x11() -> bool {
    std::env::var_os("DISPLAY").is_some_and(|v| !v.is_empty())
}

/// Candidate helpers for writing, in order of preference for the current session.
fn write_helpers() -> Vec<(&'static str, &'static [&'static str])> {
    let mut v: Vec<(&'static str, &'static [&'static str])> = Vec::new();
    if on_wayland() {
        v.push(("wl-copy", &[]));
    }
    if on_x11() {
        v.push(("xclip", &["-selection", "clipboard", "-in"]));
        v.push(("xsel", &["--clipboard", "--input"]));
    }
    v
}

fn read_helpers() -> Vec<(&'static str, &'static [&'static str])> {
    let mut v: Vec<(&'static str, &'static [&'static str])> = Vec::new();
    if on_wayland() {
        v.push(("wl-paste", &["--no-newline", "--type", "text"]));
    }
    if on_x11() {
        v.push(("xclip", &["-selection", "clipboard", "-out"]));
        v.push(("xsel", &["--clipboard", "--output"]));
    }
    v
}

/// Waits for the (foreground part of the) helper; kills it after the timeout.
fn wait_with_timeout(child: &mut std::process::Child) -> bool {
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(st)) => return st.success(),
            Ok(None) if start.elapsed() < HELPER_TIMEOUT => std::thread::sleep(Duration::from_millis(10)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
        }
    }
}

/// Writes the text with the first working helper. `wl-copy`/`xclip`/`xsel` read stdin, fork into
/// the background to serve the selection and the foreground process exits. Returns the helper used.
pub fn write_text(text: &str) -> Option<&'static str> {
    for (bin, args) in write_helpers() {
        let mut cmd = Command::new(bin);
        if bin == "wl-copy" && text.is_empty() {
            cmd.arg("--clear");
        } else {
            cmd.args(args);
        }
        let spawned = cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
        let Ok(mut child) = spawned else { continue };
        if let Some(mut stdin) = child.stdin.take() {
            if !(bin == "wl-copy" && text.is_empty()) {
                let _ = stdin.write_all(text.as_bytes());
            }
            // dropping closes stdin → EOF
        }
        if wait_with_timeout(&mut child) {
            return Some(bin);
        }
    }
    None
}

/// Reads text with the first helper that returns something.
pub fn read_text() -> String {
    for (bin, args) in read_helpers() {
        let spawned = Command::new(bin)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn();
        let Ok(mut child) = spawned else { continue };
        let mut out = Vec::new();
        let mut stdout = child.stdout.take();
        let reader = std::thread::spawn(move || {
            if let Some(s) = stdout.as_mut() {
                let _ = s.read_to_end(&mut out);
            }
            out
        });
        let ok = wait_with_timeout(&mut child);
        let out = reader.join().unwrap_or_default();
        if ok && !out.is_empty() {
            return String::from_utf8_lossy(&out).into_owned();
        }
    }
    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Round trip through the system helper; skipped when no display/helper is available.
    #[test]
    fn write_then_read_round_trip() {
        let secret = format!("rf-clip-test-{} ąę \"$x\"", std::process::id());
        let Some(_) = write_text(&secret) else { return };
        std::thread::sleep(Duration::from_millis(150));
        assert_eq!(read_text(), secret);
    }
}

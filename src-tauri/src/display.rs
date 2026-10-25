//! Display settings that must be known before the window is created (stored outside the
//! encrypted vault, in `display.json` next to `vault.json`).
//!
//! Linux: WebKitGTK 2.42+ draws through GPU DMA-BUF buffers – fast, but on some systems
//! (NVIDIA drivers, virtual machines, no access to /dev/dri) it fails with
//! `KMS: DRM_IOCTL_MODE_CREATE_DUMB failed` / `Failed to create GBM buffer`. The GPU path is
//! the default; "compatible rendering" (Settings) turns it off with
//! `WEBKIT_DISABLE_DMABUF_RENDERER=1`. It can also be forced for one run with that variable
//! or `REMOTEFLOW_SAFE_RENDERING=1` (useful when the window does not draw at all).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DisplaySettings {
    /// Linux: disable WebKitGTK's DMA-BUF (GPU) renderer.
    #[serde(default)]
    linux_safe_rendering: bool,
    /// Linux: RDP sessions are drawn by FreeRDP inside the RemoteFlow window (needs X11; on
    /// Wayland RemoteFlow then starts through XWayland).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    linux_rdp_freerdp_embedded: bool,
}

fn settings_path() -> PathBuf {
    crate::vault::storage::get_vault_path().with_file_name("display.json")
}

fn load() -> DisplaySettings {
    std::fs::read_to_string(settings_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save(settings: &DisplaySettings) -> Result<(), String> {
    let path = settings_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, json)
        .map_err(|e| tr!("Nie można zapisać ustawień wyświetlania: {}", "Cannot save the display settings: {}", e))
}

/// Was compatible rendering requested for this run from outside (environment variables)?
#[cfg(target_os = "linux")]
fn forced_by_env() -> bool {
    std::env::var_os("REMOTEFLOW_SAFE_RENDERING").is_some_and(|v| v == "1")
        || std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some_and(|v| !v.is_empty() && v != "0")
}

/// Must run at the very start of `main()`, before any thread and before WebKit is initialised.
pub fn apply_before_start() {
    #[cfg(target_os = "linux")]
    {
        let settings = load();
        let safe = forced_by_env() || settings.linux_safe_rendering;
        // Embedded FreeRDP draws into an X11 window: on a Wayland session run through XWayland
        // (only when an X server is available and the backend was not chosen explicitly).
        if settings.linux_rdp_freerdp_embedded
            && std::env::var_os("WAYLAND_DISPLAY").is_some()
            && std::env::var_os("DISPLAY").is_some()
            && std::env::var_os("GDK_BACKEND").is_none()
        {
            // SAFETY: called at the very start of main(), before any other thread exists.
            unsafe { std::env::set_var("GDK_BACKEND", "x11") };
        }
        if safe && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            // SAFETY: called at the very start of main(), before any other thread exists.
            unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    /// The option exists only on Linux.
    pub supported: bool,
    /// Saved choice (applies from the next start).
    pub safe_rendering: bool,
    /// Mode of the running instance.
    pub active_safe_rendering: bool,
    /// Compatible mode forced by an environment variable for this run.
    pub forced_by_env: bool,
    /// Saved choice: RDP through FreeRDP inside the window (applies from the next start).
    pub rdp_freerdp_embedded: bool,
    /// This instance can embed FreeRDP (X11 display and xfreerdp installed).
    pub rdp_embed_available: bool,
    /// The window runs on X11 (directly or through XWayland).
    pub x11: bool,
    /// An X11 FreeRDP client (xfreerdp3 / xfreerdp) is installed.
    pub xfreerdp_installed: bool,
}

#[tauri::command]
pub fn display_get_settings() -> DisplayInfo {
    #[cfg(target_os = "linux")]
    {
        let active = std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some_and(|v| !v.is_empty() && v != "0");
        let saved = load();
        let x11 = crate::session::rdp_embed::is_x11();
        let xfreerdp = crate::session::rdp_embed::xfreerdp_installed();
        DisplayInfo {
            supported: true,
            safe_rendering: saved.linux_safe_rendering,
            active_safe_rendering: active,
            forced_by_env: std::env::var_os("REMOTEFLOW_SAFE_RENDERING").is_some_and(|v| v == "1"),
            rdp_freerdp_embedded: saved.linux_rdp_freerdp_embedded,
            rdp_embed_available: x11 && xfreerdp,
            x11,
            xfreerdp_installed: xfreerdp,
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        DisplayInfo {
            supported: false,
            safe_rendering: false,
            active_safe_rendering: false,
            forced_by_env: false,
            rdp_freerdp_embedded: false,
            rdp_embed_available: false,
            x11: false,
            xfreerdp_installed: false,
        }
    }
}

#[tauri::command]
pub fn display_set_safe_rendering(enabled: bool) -> Result<(), String> {
    let mut s = load();
    s.linux_safe_rendering = enabled;
    save(&s)
}

#[tauri::command]
pub fn display_set_rdp_freerdp_embedded(enabled: bool) -> Result<(), String> {
    let mut s = load();
    s.linux_rdp_freerdp_embedded = enabled;
    save(&s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_default_and_roundtrip() {
        let d: DisplaySettings = serde_json::from_str("{}").unwrap();
        assert!(!d.linux_safe_rendering, "GPU rendering is the default");
        assert!(!d.linux_rdp_freerdp_embedded, "the embedded IronRDP client is the default");
        let json = serde_json::to_string(&DisplaySettings { linux_safe_rendering: true, linux_rdp_freerdp_embedded: false }).unwrap();
        assert_eq!(json, r#"{"linuxSafeRendering":true}"#);
        let both = DisplaySettings { linux_safe_rendering: false, linux_rdp_freerdp_embedded: true };
        let back: DisplaySettings = serde_json::from_str(&serde_json::to_string(&both).unwrap()).unwrap();
        assert!(back.linux_rdp_freerdp_embedded);
    }
}

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
        let safe = forced_by_env() || load().linux_safe_rendering;
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
}

#[tauri::command]
pub fn display_get_settings() -> DisplayInfo {
    #[cfg(target_os = "linux")]
    {
        let active = std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some_and(|v| !v.is_empty() && v != "0");
        DisplayInfo {
            supported: true,
            safe_rendering: load().linux_safe_rendering,
            active_safe_rendering: active,
            forced_by_env: std::env::var_os("REMOTEFLOW_SAFE_RENDERING").is_some_and(|v| v == "1"),
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        DisplayInfo { supported: false, safe_rendering: false, active_safe_rendering: false, forced_by_env: false }
    }
}

#[tauri::command]
pub fn display_set_safe_rendering(enabled: bool) -> Result<(), String> {
    let mut s = load();
    s.linux_safe_rendering = enabled;
    save(&s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_default_and_roundtrip() {
        let d: DisplaySettings = serde_json::from_str("{}").unwrap();
        assert!(!d.linux_safe_rendering, "GPU rendering is the default");
        let json = serde_json::to_string(&DisplaySettings { linux_safe_rendering: true }).unwrap();
        assert_eq!(json, r#"{"linuxSafeRendering":true}"#);
    }
}

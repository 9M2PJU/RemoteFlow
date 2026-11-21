//! How this copy of RemoteFlow was installed – decides whether the built-in updater may install
//! a new version itself.
//!
//! The updater installs with the system installer (Windows NSIS/MSI) or replaces the AppImage /
//! package (Linux). A portable copy (a loose remoteflow.exe / binary, e.g. on a USB drive) must
//! not do that: on Windows the installer would put a second, separate copy in the installation
//! folder instead of replacing the portable file. Such copies only get a link to the download page.

use std::path::Path;

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstallInfo {
    /// The updater can install new versions in place.
    pub can_self_update: bool,
    /// "nsis" | "msi" | "appimage" | "package" | "portable"
    pub kind: &'static str,
}

fn classify(program_dir: Option<&Path>, exe: Option<&Path>, appimage: bool, program_files: &[&Path]) -> InstallInfo {
    let portable = InstallInfo { can_self_update: false, kind: "portable" };
    // Explicit portable mode (also used for the vault location)
    if program_dir.is_some_and(|d| d.join(crate::vault::storage::PORTABLE_MARKER).is_file()) {
        return portable;
    }
    if cfg!(windows) {
        let Some(dir) = program_dir else { return portable };
        // NSIS (per-user or per-machine) leaves its uninstaller next to the program
        if dir.join("uninstall.exe").is_file() {
            return InstallInfo { can_self_update: true, kind: "nsis" };
        }
        // MSI installs into Program Files
        if program_files.iter().any(|pf| dir.starts_with(pf)) {
            return InstallInfo { can_self_update: true, kind: "msi" };
        }
        portable
    } else {
        if appimage {
            return InstallInfo { can_self_update: true, kind: "appimage" };
        }
        // .deb / .rpm install the program into /usr/bin
        if exe.is_some_and(|e| e.starts_with("/usr/")) {
            return InstallInfo { can_self_update: true, kind: "package" };
        }
        portable
    }
}

#[tauri::command]
pub fn app_install_info() -> InstallInfo {
    let exe = std::env::current_exe().ok();
    let appimage = std::env::var_os("APPIMAGE").is_some_and(|v| !v.is_empty());
    let pf: Vec<std::path::PathBuf> = ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"]
        .iter()
        .filter_map(|k| std::env::var_os(k).map(std::path::PathBuf::from))
        .collect();
    let pf_refs: Vec<&Path> = pf.iter().map(|p| p.as_path()).collect();
    classify(crate::vault::storage::program_dir().as_deref(), exe.as_deref(), appimage, &pf_refs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_kinds() {
        let base = std::env::temp_dir().join(format!("rf-install-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let exe = base.join("remoteflow");
        if cfg!(windows) {
            assert_eq!(classify(Some(&base), Some(&exe), false, &[]).kind, "portable");
            std::fs::write(base.join("uninstall.exe"), "").unwrap();
            assert_eq!(classify(Some(&base), Some(&exe), false, &[]).kind, "nsis");
            std::fs::remove_file(base.join("uninstall.exe")).unwrap();
            assert_eq!(classify(Some(&base), Some(&exe), false, &[base.parent().unwrap()]).kind, "msi");
        } else {
            assert_eq!(classify(Some(&base), Some(&exe), false, &[]).kind, "portable");
            assert!(classify(Some(&base), Some(&exe), true, &[]).can_self_update);
            assert_eq!(classify(Some(Path::new("/usr/bin")), Some(Path::new("/usr/bin/remoteflow")), false, &[]).kind, "package");
        }
        // The portable marker wins over everything
        std::fs::write(base.join(crate::vault::storage::PORTABLE_MARKER), "").unwrap();
        let info = classify(Some(&base), Some(&exe), true, &[base.parent().unwrap()]);
        assert_eq!(info, InstallInfo { can_self_update: false, kind: "portable" });
        let _ = std::fs::remove_dir_all(&base);
    }
}

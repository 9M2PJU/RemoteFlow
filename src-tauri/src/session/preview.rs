//! File preview and text editing in the SFTP window – the same code for local files and files on
//! the server (read through the pooled SFTP session, nothing is written to disk on this side).
//!
//! The window reads files in chunks (`read_*`), so a multi-gigabyte log or binary can be shown
//! (hex view, paged text) without loading it whole. Saving writes a new file next to the target
//! that replaces it only when complete, keeps its permissions and refuses to overwrite a file that
//! changed since it was opened (unless forced).

use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::transfer::{display_path, remote_path_string};

/// Largest chunk returned by one read.
pub const MAX_READ: u64 = 4 * 1024 * 1024;
/// Largest file that can be saved from the editor.
pub const MAX_SAVE: usize = 32 * 1024 * 1024;
/// Error prefix: the file changed since it was opened.
pub const CONFLICT: &str = "CONFLICT:";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub size: u64,
    /// Modification time, seconds since the epoch.
    pub modified: u64,
    pub readonly: bool,
}

fn not_a_file(path: &str) -> String {
    tr!("'{}' nie jest plikiem", "'{}' is not a file", path)
}

// --- local ------------------------------------------------------------------------------------

fn local_stat_of(meta: &std::fs::Metadata) -> FileStat {
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    FileStat { size: meta.len(), modified, readonly: meta.permissions().readonly() }
}

pub fn local_stat(path: &str) -> Result<FileStat, String> {
    let meta = std::fs::metadata(path).map_err(|e| tr!("Nie można odczytać '{}': {}", "Cannot read '{}': {}", path, e))?;
    if !meta.is_file() {
        return Err(not_a_file(path));
    }
    Ok(local_stat_of(&meta))
}

pub fn local_read(path: &str, offset: u64, length: u64) -> Result<Vec<u8>, String> {
    let mut f = std::fs::File::open(path).map_err(|e| tr!("Nie można otworzyć '{}': {}", "Cannot open '{}': {}", path, e))?;
    f.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    f.take(length.min(MAX_READ)).read_to_end(&mut buf).map_err(|e| tr!("Błąd odczytu '{}': {}", "Error reading '{}': {}", path, e))?;
    Ok(buf)
}

fn check_unchanged(current: &FileStat, expected: Option<(u64, u64)>, path: &str) -> Result<(), String> {
    if let Some((size, modified)) = expected {
        if current.size != size || current.modified != modified {
            return Err(format!(
                "{CONFLICT}{}",
                tr!(
                    "Plik '{}' zmienił się od otwarcia (inny program albo inna osoba zapisała go w międzyczasie).",
                    "The file '{}' changed since it was opened (another program or person saved it in the meantime).",
                    path
                )
            ));
        }
    }
    Ok(())
}

/// Saves `data` in place of a local file: a temporary file next to it replaces it when complete.
/// A link is followed (its target is updated), the permissions of the file are kept.
pub fn local_save(path: &str, data: &[u8], expected: Option<(u64, u64)>) -> Result<FileStat, String> {
    let target: PathBuf = std::fs::canonicalize(path).unwrap_or_else(|_| PathBuf::from(path));
    let meta = std::fs::metadata(&target).map_err(|e| tr!("Nie można odczytać '{}': {}", "Cannot read '{}': {}", path, e))?;
    if !meta.is_file() {
        return Err(not_a_file(path));
    }
    check_unchanged(&local_stat_of(&meta), expected, path)?;
    let name = target.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let tmp = target.with_file_name(format!(".{name}.rf-part"));
    let _ = std::fs::remove_file(&tmp);
    let save_error = |e: std::io::Error| tr!("Błąd zapisu '{}': {}", "Error saving '{}': {}", display_path(&target), e);
    let result = (|| {
        let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(&tmp).map_err(save_error)?;
        f.write_all(data).map_err(save_error)?;
        f.sync_all().map_err(save_error)?;
        drop(f);
        let _ = std::fs::set_permissions(&tmp, meta.permissions());
        std::fs::rename(&tmp, &target).map_err(save_error)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result?;
    local_stat(&target.to_string_lossy())
}

// --- server -----------------------------------------------------------------------------------

fn remote_stat_of(st: &ssh2::FileStat) -> FileStat {
    let readonly = st.perm.map(|p| p & 0o222 == 0).unwrap_or(false);
    FileStat { size: st.size.unwrap_or(0), modified: st.mtime.unwrap_or(0), readonly }
}

pub fn remote_stat(sftp: &ssh2::Sftp, path: &str) -> Result<FileStat, String> {
    let st = sftp.stat(Path::new(path)).map_err(|e| tr!("Nie można odczytać '{}': {}", "Cannot read '{}': {}", path, e))?;
    if st.is_dir() {
        return Err(not_a_file(path));
    }
    Ok(remote_stat_of(&st))
}

pub fn remote_read(sftp: &ssh2::Sftp, path: &str, offset: u64, length: u64) -> Result<Vec<u8>, String> {
    let mut f = sftp.open(Path::new(path)).map_err(|e| tr!("Nie można otworzyć '{}': {}", "Cannot open '{}': {}", path, e))?;
    f.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    f.take(length.min(MAX_READ)).read_to_end(&mut buf).map_err(|e| tr!("Błąd odczytu '{}': {}", "Error reading '{}': {}", path, e))?;
    Ok(buf)
}

/// Saves `data` in place of a file on the server (temporary file + replace, permissions and link
/// targets kept – the same code as uploads).
pub fn remote_save(sftp: &ssh2::Sftp, path: &str, data: &[u8], expected: Option<(u64, u64)>) -> Result<FileStat, String> {
    check_unchanged(&remote_stat(sftp, path)?, expected, path)?;
    let no_cancel = std::sync::atomic::AtomicBool::new(false);
    let mut src = data;
    super::transfer::write_remote_file(sftp, &mut src, Path::new(path), &no_cancel, &mut |_| {})?;
    remote_stat(sftp, &remote_path_string(Path::new(path)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_read_and_safe_save() {
        let base = std::env::temp_dir().join(format!("rf-preview-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let file = base.join("notes.txt");
        std::fs::write(&file, b"0123456789abcdef").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o750)).unwrap();
        }
        let path = file.to_string_lossy().to_string();
        let st = local_stat(&path).unwrap();
        assert_eq!(st.size, 16);
        assert_eq!(local_read(&path, 4, 6).unwrap(), b"456789");
        assert_eq!(local_read(&path, 14, 100).unwrap(), b"ef");
        assert!(local_read(&path, 100, 10).unwrap().is_empty());
        assert!(local_stat(&base.to_string_lossy()).is_err(), "a folder is not previewed");

        // Save with the stat from opening
        let saved = local_save(&path, "zażółć\r\n".as_bytes(), Some((st.size, st.modified))).unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), "zażółć\r\n".as_bytes());
        assert_eq!(saved.size, "zażółć\r\n".len() as u64);
        assert!(!base.join(".notes.txt.rf-part").exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o750);
        }

        // Changed in the meantime (size differs from what was opened) -> conflict, file untouched
        let err = local_save(&path, b"other", Some((st.size, st.modified))).unwrap_err();
        assert!(err.starts_with(CONFLICT), "{err}");
        assert_eq!(std::fs::read(&file).unwrap(), "zażółć\r\n".as_bytes());
        // Forced
        local_save(&path, b"forced", None).unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), b"forced");

        // A link: the target is updated, the link stays a link
        #[cfg(unix)]
        {
            let link = base.join("link.txt");
            std::os::unix::fs::symlink(&file, &link).unwrap();
            local_save(&link.to_string_lossy(), b"via link", None).unwrap();
            assert!(std::fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
            assert_eq!(std::fs::read(&file).unwrap(), b"via link");
        }
        let _ = std::fs::remove_dir_all(&base);
    }

    /// Needs the local test sshd on 127.0.0.1:2222 (`cargo test -- --ignored`).
    #[test]
    #[ignore]
    fn remote_read_and_save() {
        use crate::session::transfer::{release_pooled, with_pooled_sftp};
        let cfg = crate::session::transfer::sftp_e2e::config();
        let path = format!("/tmp/rf-preview-{}.sh", std::process::id());
        with_pooled_sftp("preview", &cfg, |sftp| {
            let mut f = sftp
                .open_mode(Path::new(&path), ssh2::OpenFlags::WRITE | ssh2::OpenFlags::CREATE | ssh2::OpenFlags::TRUNCATE, 0o750, ssh2::OpenType::File)
                .map_err(|e| e.to_string())?;
            f.write_all(b"#!/bin/sh\necho old\n").map_err(|e| e.to_string())?;
            Ok(())
        })
        .unwrap();
        let st = with_pooled_sftp("preview", &cfg, |sftp| remote_stat(sftp, &path)).unwrap();
        assert_eq!(st.size, 19);
        let part = with_pooled_sftp("preview", &cfg, |sftp| remote_read(sftp, &path, 10, 4)).unwrap();
        assert_eq!(part, b"echo");
        let saved = with_pooled_sftp("preview", &cfg, |sftp| remote_save(sftp, &path, b"#!/bin/sh\necho new\n", Some((st.size, st.modified)))).unwrap();
        assert_eq!(saved.size, 19);
        let all = with_pooled_sftp("preview", &cfg, |sftp| remote_read(sftp, &path, 0, 100)).unwrap();
        assert_eq!(all, b"#!/bin/sh\necho new\n");
        let perm = with_pooled_sftp("preview", &cfg, |sftp| sftp.stat(Path::new(&path)).map_err(|e| e.to_string())).unwrap().perm.unwrap();
        assert_eq!(perm & 0o777, 0o750, "permissions kept");
        // Stale stat (size differs) -> conflict
        let err = with_pooled_sftp("preview", &cfg, |sftp| remote_save(sftp, &path, b"x", Some((1, st.modified)))).unwrap_err();
        assert!(err.starts_with(CONFLICT), "{err}");
        with_pooled_sftp("preview", &cfg, |sftp| sftp.unlink(Path::new(&path)).map_err(|e| e.to_string())).unwrap();
        release_pooled("preview");
    }
}

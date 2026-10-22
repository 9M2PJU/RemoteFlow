//! Periodic and on-demand backups of vault.json.
//!
//! A backup is a byte-for-byte copy of the vault file, so it stays encrypted and integrity
//! protected (secrets need the Master Password that was valid when the backup was made).

use crate::vault::models::{BackupEntry, BackupSettings, VaultData};
use crate::vault::storage::{get_vault_path, load_vault, lock_io, write_atomic};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

const PREFIX: &str = "vault-";
const SUFFIX: &str = ".json";
/// How often the scheduler checks whether a backup is due.
const CHECK_EVERY: Duration = Duration::from_secs(10 * 60);
/// First check shortly after start-up.
const FIRST_CHECK_AFTER: Duration = Duration::from_secs(60);

pub const MAX_INTERVAL_HOURS: u32 = 24 * 30;
pub const MAX_KEEP: u32 = 200;

pub fn backup_dir(settings: &BackupSettings) -> PathBuf {
    match settings.dir.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
        Some(d) => PathBuf::from(d),
        None => get_vault_path()
            .parent()
            .map(|p| p.join("backups"))
            .unwrap_or_else(|| PathBuf::from("backups")),
    }
}

fn is_backup_name(name: &str) -> bool {
    name.starts_with(PREFIX)
        && name.ends_with(SUFFIX)
        && !name.contains(['/', '\\'])
        && !name.contains("..")
}

/// Backup files, newest first (names start with a sortable timestamp).
fn backup_files(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.is_file())
                .filter(|p| p.file_name().and_then(|n| n.to_str()).map(is_backup_name).unwrap_or(false))
                .collect()
        })
        .unwrap_or_default();
    files.sort();
    files.reverse();
    files
}

pub fn list_backups(settings: &BackupSettings) -> Vec<BackupEntry> {
    backup_files(&backup_dir(settings))
        .into_iter()
        .filter_map(|p| {
            let meta = fs::metadata(&p).ok()?;
            let created: chrono::DateTime<chrono::Local> = meta.modified().ok()?.into();
            Some(BackupEntry {
                name: p.file_name()?.to_string_lossy().to_string(),
                path: p.to_string_lossy().to_string(),
                size: meta.len(),
                created_at: created.to_rfc3339(),
            })
        })
        .collect()
}

fn rotate(dir: &Path, keep: u32) {
    let keep = keep.clamp(1, MAX_KEEP) as usize;
    for old in backup_files(dir).into_iter().skip(keep) {
        if let Err(e) = fs::remove_file(&old) {
            eprintln!("[RemoteFlow] Nie udało się usunąć starej kopii {:?}: {}", old, e);
        }
    }
}

/// Creates a backup. The caller MUST already hold [`lock_io`].
/// Returns `Ok(None)` when `skip_if_unchanged` is set and the newest backup is identical.
pub fn backup_while_locked(
    settings: &BackupSettings,
    reason: &str,
    skip_if_unchanged: bool,
) -> Result<Option<PathBuf>, String> {
    let vault_path = get_vault_path();
    if !vault_path.exists() {
        return Ok(None);
    }
    let current = fs::read(&vault_path).map_err(|e| format!("Błąd odczytu sejfu: {}", e))?;

    let dir = backup_dir(settings);
    fs::create_dir_all(&dir).map_err(|e| format!("Nie można utworzyć katalogu kopii {:?}: {}", dir, e))?;

    if skip_if_unchanged {
        if let Some(newest) = backup_files(&dir).first() {
            if fs::read(newest).map(|b| b == current).unwrap_or(false) {
                return Ok(None);
            }
        }
    }

    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let reason: String = reason
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect();
    let mut target = dir.join(format!("{}{}-{}{}", PREFIX, stamp, reason, SUFFIX));
    let mut n = 1;
    while target.exists() {
        target = dir.join(format!("{}{}-{}-{}{}", PREFIX, stamp, reason, n, SUFFIX));
        n += 1;
    }

    write_atomic(&target, &current)?;
    rotate(&dir, settings.keep);
    eprintln!("[RemoteFlow] Utworzono kopię zapasową sejfu: {:?}", target);
    Ok(Some(target))
}

/// Creates a backup, taking the vault I/O lock.
pub fn create_backup(settings: &BackupSettings, reason: &str, skip_if_unchanged: bool) -> Result<Option<PathBuf>, String> {
    let _io = lock_io();
    backup_while_locked(settings, reason, skip_if_unchanged)
}

/// Replaces vault.json with the given backup (the current vault is backed up first).
pub fn restore_backup(settings: &BackupSettings, name: &str) -> Result<(), String> {
    if !is_backup_name(name) {
        return Err("Nieprawidłowa nazwa pliku kopii".to_string());
    }
    let path = backup_dir(settings).join(name);
    let bytes = fs::read(&path).map_err(|e| format!("Nie można odczytać kopii {:?}: {}", path, e))?;
    serde_json::from_slice::<VaultData>(&bytes).map_err(|e| format!("Plik kopii jest uszkodzony: {}", e))?;

    let _io = lock_io();
    backup_while_locked(settings, "pre-restore", true)?;
    write_atomic(&get_vault_path(), &bytes)
}

fn scheduled_tick() -> Result<(), String> {
    let Some(vault) = load_vault()? else {
        return Ok(());
    };
    let settings = vault.metadata.backup;
    if !settings.enabled {
        return Ok(());
    }

    let interval = Duration::from_secs(u64::from(settings.interval_hours.clamp(1, MAX_INTERVAL_HOURS)) * 3600);
    if let Some(newest) = backup_files(&backup_dir(&settings)).first() {
        let age = fs::metadata(newest)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| SystemTime::now().duration_since(t).ok());
        if matches!(age, Some(a) if a < interval) {
            return Ok(());
        }
    }
    create_backup(&settings, "auto", true).map(|_| ())
}

/// Starts the background thread that creates periodic backups.
pub fn start_scheduler() {
    let spawned = std::thread::Builder::new()
        .name("remoteflow-vault-backup".to_string())
        .spawn(|| {
            std::thread::sleep(FIRST_CHECK_AFTER);
            loop {
                if let Err(e) = scheduled_tick() {
                    eprintln!("[RemoteFlow] Automatyczna kopia zapasowa nie powiodła się: {}", e);
                }
                std::thread::sleep(CHECK_EVERY);
            }
        });
    if let Err(e) = spawned {
        eprintln!("[RemoteFlow] Nie udało się uruchomić harmonogramu kopii zapasowych: {}", e);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_names_are_validated() {
        assert!(is_backup_name("vault-20261021-120000-auto.json"));
        assert!(!is_backup_name("../vault-x.json"));
        assert!(!is_backup_name("vault-..\\x.json"));
        assert!(!is_backup_name("other.json"));
    }
}

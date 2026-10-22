use crate::vault::cipher::{compute_mac, verify_mac};
use crate::vault::models::VaultData;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

/// Error code prefix the UI recognises when the vault file was modified outside the application.
pub const INTEGRITY_ERROR_CODE: &str = "VAULT_INTEGRITY_FAILED";

/// Serialises every read-modify-write cycle on vault.json (UI commands and session threads).
static VAULT_IO: Mutex<()> = Mutex::new(());
static VAULT_PATH: OnceLock<PathBuf> = OnceLock::new();

pub fn lock_io() -> MutexGuard<'static, ()> {
    VAULT_IO.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn dir_is_writable(dir: &Path) -> bool {
    let probe = dir.join(format!(".remoteflow_write_probe_{}", std::process::id()));
    match fs::File::create(&probe) {
        Ok(_) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

fn resolve_vault_path() -> PathBuf {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));
    let config_vault = dirs::config_dir().map(|d| d.join("remoteflow").join("vault.json"));

    // 1. Portable mode: vault.json next to the executable.
    if let Some(dir) = &exe_dir {
        let p = dir.join("vault.json");
        if p.exists() {
            return p;
        }
    }

    // 2. Backward compatibility: earlier versions kept the vault in the working directory.
    //    Only used when no vault exists next to the executable.
    if let Ok(cwd) = std::env::current_dir() {
        let p = cwd.join("vault.json");
        if p.exists() {
            eprintln!("[RemoteFlow] Używam sejfu z katalogu roboczego: {:?}", p);
            return p;
        }
    }

    // 3. Per-user configuration directory (%APPDATA%\remoteflow, ~/.config/remoteflow).
    if let Some(p) = &config_vault {
        if p.exists() {
            return p.clone();
        }
    }

    // New vault: next to the executable when that directory is writable, otherwise per-user config.
    if let Some(dir) = &exe_dir {
        if dir_is_writable(dir) {
            return dir.join("vault.json");
        }
    }
    config_vault.unwrap_or_else(|| PathBuf::from("vault.json"))
}

/// The vault location is resolved once per process so it cannot change while the app runs.
pub fn get_vault_path() -> PathBuf {
    VAULT_PATH.get_or_init(resolve_vault_path).clone()
}

/// Canonical bytes covered by the integrity MAC: the whole vault with the `mac` field cleared.
fn mac_payload(data: &VaultData) -> Result<Vec<u8>, String> {
    let mut copy = data.clone();
    copy.mac = None;
    serde_json::to_vec(&copy).map_err(|e| tr!("Błąd serializacji sejfu: {}", "Vault serialisation error: {}", e))
}

pub fn verify_vault_mac(data: &VaultData, key: &[u8; 32]) -> bool {
    match (&data.mac, mac_payload(data)) {
        (Some(mac), Ok(payload)) => verify_mac(key, &payload, mac),
        _ => false,
    }
}

fn sign_vault(data: &mut VaultData, key: &[u8; 32]) -> Result<(), String> {
    data.mac = None;
    let payload = mac_payload(data)?;
    data.mac = Some(compute_mac(key, &payload)?);
    Ok(())
}

/// Writes the file atomically: temp file + fsync + rename, so a crash never leaves a half-written vault.
pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let tmp = path.with_extension("json.tmp");
    {
        let mut f = fs::File::create(&tmp).map_err(|e| tr!("Błąd zapisu do pliku {:?}: {}", "Error writing file {:?}: {}", tmp, e))?;
        f.write_all(bytes)
            .and_then(|_| f.sync_all())
            .map_err(|e| tr!("Błąd zapisu do pliku {:?}: {}", "Error writing file {:?}: {}", tmp, e))?;
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        tr!("Błąd zapisu do pliku {:?}: {}", "Error writing file {:?}: {}", path, e)
    })
}

/// Signs the vault with the master key and writes it atomically.
/// Callers doing read-modify-write must hold [`lock_io`] (or use [`update_vault`]).
pub fn save_vault_signed(data: &mut VaultData, key: &[u8; 32]) -> Result<(), String> {
    sign_vault(data, key)?;
    let json = serde_json::to_string_pretty(data).map_err(|e| tr!("Błąd serializacji sejfu: {}", "Vault serialisation error: {}", e))?;
    write_atomic(&get_vault_path(), json.as_bytes())
}

/// Reads the vault WITHOUT integrity verification. Use only before unlock (status screen,
/// salt/canary lookup) or for non-security-relevant data.
pub fn load_vault() -> Result<Option<VaultData>, String> {
    let path = get_vault_path();
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&path).map_err(|e| tr!("Błąd odczytu pliku {:?}: {}", "Error reading file {:?}: {}", path, e))?;
    let data: VaultData =
        serde_json::from_str(&content).map_err(|e| tr!("Błąd parsowania pliku sejfu: {}", "Vault file parse error: {}", e))?;
    Ok(Some(data))
}

pub fn integrity_error() -> String {
    format!(
        "{}: Plik sejfu został zmodyfikowany poza aplikacją (niezgodna suma kontrolna HMAC). \
         Ze względów bezpieczeństwa dane nie zostały użyte.",
        INTEGRITY_ERROR_CODE
    )
}

/// Reads the vault and verifies its integrity MAC with the master key.
pub fn load_vault_verified(key: &[u8; 32]) -> Result<VaultData, String> {
    let data = load_vault()?.ok_or(tr!("Sejf nie istnieje", "The vault does not exist"))?;
    if !verify_vault_mac(&data, key) {
        return Err(integrity_error());
    }
    Ok(data)
}

/// Verified read-modify-write of the vault under the global I/O lock.
pub fn update_vault<T>(
    key: &[u8; 32],
    f: impl FnOnce(&mut VaultData) -> Result<T, String>,
) -> Result<T, String> {
    let _guard = lock_io();
    let mut data = load_vault_verified(key)?;
    let result = f(&mut data)?;
    save_vault_signed(&mut data, key)?;
    Ok(result)
}

pub fn vault_exists() -> bool {
    get_vault_path().exists()
}

pub fn delete_vault() -> Result<(), String> {
    let _guard = lock_io();
    let path = get_vault_path();
    if path.exists() {
        let backup_path = path.with_extension(format!("json.bak_{}", chrono::Utc::now().timestamp()));
        fs::rename(&path, &backup_path).map_err(|e| tr!("Nie udało się utworzyć kopii sejfu: {}", "Could not back up the vault: {}", e))?;
    }
    Ok(())
}

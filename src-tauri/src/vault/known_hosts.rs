//! Trust-on-first-use store of server identities (SSH host keys, RDP TLS certificates).
//! Entries live inside the vault and are covered by its integrity MAC.

use crate::vault::storage::{load_vault, load_vault_verified, lock_io, save_vault_signed};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostTrust {
    /// Fingerprint matches the remembered one.
    Known,
    /// First connection – fingerprint has just been remembered.
    NewlyTrusted,
}

pub fn host_id(kind: &str, host: &str, port: u16) -> String {
    format!("{}:{}:{}", kind, host.trim().to_lowercase(), port)
}

fn mismatch_error(kind: &str, host: &str, port: u16, expected: &str, got: &str) -> String {
    let what = if kind == "rdp" { "Certyfikat TLS serwera RDP" } else { "Klucz hosta SSH" };
    format!(
        "UWAGA – MOŻLIWY ATAK MITM! {} {}:{} różni się od zapamiętanego.\n\
         Zapamiętany: {}\nOtrzymany:   {}\n\
         Połączenie przerwano, hasło NIE zostało wysłane. Jeśli zmiana jest zamierzona \
         (np. reinstalacja serwera lub nowy certyfikat), usuń wpis w Ustawienia → Zaufane hosty.",
        what, host, port, expected, got
    )
}

/// Verifies `fingerprint` against the vault.
/// * `key = Some(..)` (vault unlocked): integrity-checked read, unknown hosts are remembered (TOFU).
/// * `key = None` (vault locked, e.g. a tunnel reconnecting): only an exact, already remembered
///   match is accepted – nothing is written.
pub fn check_host(
    key: Option<&[u8; 32]>,
    kind: &str,
    host: &str,
    port: u16,
    fingerprint: &str,
) -> Result<HostTrust, String> {
    let id = host_id(kind, host, port);

    let Some(key) = key else {
        let vault = load_vault()?.ok_or("Sejf nie istnieje")?;
        return match vault.metadata.known_hosts.get(&id) {
            Some(fp) if fp == fingerprint => Ok(HostTrust::Known),
            Some(fp) => Err(mismatch_error(kind, host, port, fp, fingerprint)),
            None => Err(format!(
                "Serwer {}:{} nie jest jeszcze zaufany, a sejf jest zablokowany. Odblokuj sejf i połącz się ponownie.",
                host, port
            )),
        };
    };

    let _guard = lock_io();
    let mut vault = load_vault_verified(key)?;
    match vault.metadata.known_hosts.get(&id) {
        Some(fp) if fp == fingerprint => Ok(HostTrust::Known),
        Some(fp) => Err(mismatch_error(kind, host, port, fp, fingerprint)),
        None => {
            vault.metadata.known_hosts.insert(id, fingerprint.to_string());
            save_vault_signed(&mut vault, key)?;
            eprintln!("[RemoteFlow] Zaufano nowemu serwerowi {}:{} ({}) – {}", host, port, kind, fingerprint);
            Ok(HostTrust::NewlyTrusted)
        }
    }
}

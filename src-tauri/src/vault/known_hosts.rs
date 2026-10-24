//! Trust-on-first-use store of server identities (SSH host keys, RDP TLS certificates).
//! Entries live inside the vault and are covered by its integrity MAC.

use crate::vault::storage::{load_vault_verified, lock_io, save_vault_signed};
use std::collections::BTreeMap;
use std::sync::Mutex;

/// Trusted hosts as last read from an integrity-verified vault (unlock, connection while
/// unlocked, Settings). Used while the vault is locked: the file itself cannot be verified then,
/// and someone able to modify it could otherwise plant a fingerprint for a reconnecting tunnel.
static VERIFIED_HOSTS: Mutex<Option<BTreeMap<String, String>>> = Mutex::new(None);

/// Remembers the trusted hosts of a vault that was just verified with the master key.
pub fn remember_verified(hosts: &BTreeMap<String, String>) {
    if let Ok(mut g) = VERIFIED_HOSTS.lock() {
        *g = Some(hosts.clone());
    }
}

/// Forgets the remembered list (vault reset / replaced).
pub fn forget_verified() {
    if let Ok(mut g) = VERIFIED_HOSTS.lock() {
        *g = None;
    }
}

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
        // Locked: only the list verified earlier in this run counts – never the unverified file.
        let known = VERIFIED_HOSTS.lock().ok().and_then(|g| g.as_ref().and_then(|m| m.get(&id).cloned()));
        let verified_available = VERIFIED_HOSTS.lock().map(|g| g.is_some()).unwrap_or(false);
        if !verified_available {
            return Err(tr!(
                "Sejf jest zablokowany – nie można sprawdzić tożsamości serwera {}:{}. Odblokuj sejf i połącz się ponownie.",
                "The vault is locked – the identity of server {}:{} cannot be checked. Unlock the vault and connect again.",
                host, port
            ));
        }
        return match known.as_ref() {
            Some(fp) if fp == fingerprint => Ok(HostTrust::Known),
            Some(fp) => Err(mismatch_error(kind, host, port, fp, fingerprint)),
            None => Err(tr!(
                "Serwer {}:{} nie jest jeszcze zaufany, a sejf jest zablokowany. Odblokuj sejf i połącz się ponownie.", "Server {}:{} is not trusted yet and the vault is locked. Unlock the vault and connect again.",
                host, port
            )),
        };
    };

    let _guard = lock_io();
    let mut vault = load_vault_verified(key)?;
    remember_verified(&vault.metadata.known_hosts);
    match vault.metadata.known_hosts.get(&id) {
        Some(fp) if fp == fingerprint => Ok(HostTrust::Known),
        Some(fp) => Err(mismatch_error(kind, host, port, fp, fingerprint)),
        None => {
            vault.metadata.known_hosts.insert(id, fingerprint.to_string());
            save_vault_signed(&mut vault, key)?;
            remember_verified(&vault.metadata.known_hosts);
            eprintln!("[RemoteFlow] Zaufano nowemu serwerowi {}:{} ({}) – {}", host, port, kind, fingerprint);
            Ok(HostTrust::NewlyTrusted)
        }
    }
}

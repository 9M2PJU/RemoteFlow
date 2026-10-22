//! Decryption of passwords stored by mRemoteNG in confCons.xml (import only).
//!
//! * mRemoteNG >= 1.76: AES-256-GCM, key = PBKDF2-HMAC-SHA1(master password, salt, KdfIterations),
//!   payload = base64(salt[16] | nonce[16] | ciphertext | tag[16]), AAD = salt.
//! * older versions (no BlockCipherMode attribute): AES-128-CBC, key = MD5(master password),
//!   payload = base64(iv[16] | ciphertext), PKCS#7 padding.
//!
//! When the user did not set a custom master password in mRemoteNG, the built-in "mR3m" is used.

use aes_gcm::aead::consts::U16;
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::AesGcm;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use cbc::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use md5::{Digest, Md5};
use serde::Deserialize;
use zeroize::Zeroizing;

pub const DEFAULT_PASSWORD: &str = "mR3m";
const PROTECTED_MARKERS: [&str; 2] = ["ThisIsNotProtected", "ThisIsProtected"];

/// Error code: a custom mRemoteNG master password is needed (or the given one is wrong).
pub const PASSWORD_REQUIRED: &str = "MRNG_PASSWORD_REQUIRED";

/// Encryption parameters taken from the root `<Connections>` element of confCons.xml.
#[derive(Debug, Clone, Deserialize)]
pub struct MrngParams {
    /// mRemoteNG master password; `None`/empty = built-in default.
    pub password: Option<String>,
    /// `EncryptionEngine` attribute ("AES"); empty for legacy files.
    #[serde(rename = "encryptionEngine", default)]
    pub encryption_engine: String,
    /// `BlockCipherMode` attribute ("GCM"); empty for legacy CBC files.
    #[serde(rename = "blockCipherMode", default)]
    pub block_cipher_mode: String,
    /// `KdfIterations` attribute (default 1000 in mRemoteNG when absent).
    #[serde(rename = "kdfIterations", default)]
    pub kdf_iterations: u32,
}

impl MrngParams {
    fn password(&self) -> &str {
        match self.password.as_deref() {
            Some(p) if !p.is_empty() => p,
            _ => DEFAULT_PASSWORD,
        }
    }

    fn check_supported(&self) -> Result<(), String> {
        let engine = self.encryption_engine.trim();
        let mode = self.block_cipher_mode.trim();
        if mode.is_empty() {
            return Ok(()); // legacy CBC
        }
        if !engine.is_empty() && !engine.eq_ignore_ascii_case("AES") {
            return Err(format!(
                "Nieobsługiwany algorytm szyfrowania mRemoteNG: {} (obsługiwany jest AES). Zmień w mRemoteNG \
                 Opcje → Bezpieczeństwo na AES/GCM, zapisz plik i zaimportuj ponownie.",
                engine
            ));
        }
        if !mode.eq_ignore_ascii_case("GCM") {
            return Err(format!(
                "Nieobsługiwany tryb szyfrowania mRemoteNG: {} (obsługiwany jest GCM). Zmień w mRemoteNG \
                 Opcje → Bezpieczeństwo na AES/GCM, zapisz plik i zaimportuj ponownie.",
                mode
            ));
        }
        Ok(())
    }
}

fn decrypt_gcm(data: &[u8], password: &str, iterations: u32) -> Option<Zeroizing<Vec<u8>>> {
    if data.len() < 16 + 16 + 16 {
        return None;
    }
    let (salt, rest) = data.split_at(16);
    let (nonce, ciphertext) = rest.split_at(16);
    let mut key = Zeroizing::new([0u8; 32]);
    pbkdf2::pbkdf2_hmac::<sha1::Sha1>(password.as_bytes(), salt, iterations.max(1), key.as_mut());
    let cipher = AesGcm::<aes::Aes256, U16>::new_from_slice(key.as_ref()).ok()?;
    cipher
        .decrypt(nonce.into(), Payload { msg: ciphertext, aad: salt })
        .ok()
        .map(Zeroizing::new)
}

fn decrypt_cbc(data: &[u8], password: &str) -> Option<Zeroizing<Vec<u8>>> {
    if data.len() < 32 || data.len() % 16 != 0 {
        return None;
    }
    let (iv, ciphertext) = data.split_at(16);
    let key = Md5::digest(password.as_bytes());
    cbc::Decryptor::<aes::Aes128>::new_from_slices(&key, iv)
        .ok()?
        .decrypt_padded_vec_mut::<Pkcs7>(ciphertext)
        .ok()
        .map(Zeroizing::new)
}

/// Decrypts one value. `None` = not decryptable with these parameters.
pub fn decrypt_value(params: &MrngParams, value: &str) -> Option<Zeroizing<String>> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    let data = BASE64.decode(value).ok()?;
    let plain = if params.block_cipher_mode.trim().is_empty() {
        decrypt_cbc(&data, params.password())?
    } else {
        let iterations = if params.kdf_iterations == 0 { 1000 } else { params.kdf_iterations };
        decrypt_gcm(&data, params.password(), iterations)?
    };
    String::from_utf8(plain.to_vec()).ok().map(Zeroizing::new)
}

/// Checks the `Protected` marker of confCons.xml (tells whether the master password is right).
pub fn verify_password(params: &MrngParams, protected: Option<&str>) -> Result<(), String> {
    params.check_supported()?;
    let Some(protected) = protected.map(str::trim).filter(|p| !p.is_empty()) else {
        return Ok(()); // very old files have no marker
    };
    match decrypt_value(params, protected) {
        Some(marker) if PROTECTED_MARKERS.contains(&marker.as_str()) => Ok(()),
        _ => Err(format!(
            "{}: Plik mRemoteNG jest zabezpieczony własnym hasłem głównym (lub podane hasło jest błędne).",
            PASSWORD_REQUIRED
        )),
    }
}

/// Validates the master password and, for files saved with "Full file encryption", returns the
/// decrypted inner XML. Passwords inside stay encrypted and are only decrypted in Rust on import.
#[tauri::command]
pub fn mremoteng_unlock(
    params: MrngParams,
    protected: Option<String>,
    full_file_data: Option<String>,
) -> Result<Option<String>, String> {
    verify_password(&params, protected.as_deref())?;
    match full_file_data.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
        None => Ok(None),
        Some(data) => decrypt_value(&params, data)
            .map(|xml| Some(xml.to_string()))
            .ok_or_else(|| format!("{}: Nie udało się odszyfrować pliku mRemoteNG.", PASSWORD_REQUIRED)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gcm(iter: u32, pw: Option<&str>) -> MrngParams {
        MrngParams {
            password: pw.map(String::from),
            encryption_engine: "AES".into(),
            block_cipher_mode: "GCM".into(),
            kdf_iterations: iter,
        }
    }

    // Test vectors generated independently (Python `cryptography`) with mRemoteNG's scheme.
    #[test]
    fn gcm_default_password() {
        let v = "UnN4rtw8ZB1f7f6MWd/2F/0RpMToOnwseAkEE9km31XhnOBE8pQwjomDVp5sdW3fWOF1i7NpppBx7z4T1aZV5g==";
        assert_eq!(decrypt_value(&gcm(10000, None), v).unwrap().as_str(), "Zażółć-P@ss1");
        assert!(decrypt_value(&gcm(1000, None), v).is_none(), "wrong iteration count");
    }

    #[test]
    fn gcm_custom_password_and_protected_marker() {
        let protected = "ovsRldwGpZHUBKxgyoEL7JB4SxL+L//P8uasnxPfQB8qFTPMMQhPEbvvOTa1KPLYrMaH54mpcBeBKuQ9od7Y";
        assert!(verify_password(&gcm(10000, None), Some(protected)).unwrap_err().contains(PASSWORD_REQUIRED));
        assert!(verify_password(&gcm(10000, Some("Tajne123")), Some(protected)).is_ok());
        let v = "NQUDSI7/YE8AoCRdC/cyNBSw2G8fmrgxbFKaGgAMXOAwbeaStKzalG7a70c6ZmUDEIZfqmGiqg==";
        assert_eq!(decrypt_value(&gcm(10000, Some("Tajne123")), v).unwrap().as_str(), "secret2");
    }

    #[test]
    fn not_protected_marker_with_1000_iterations() {
        let p = "y+/lkCVy1fwtILle1yVd01yW0aSMrZuHc6pQw5X2rDIKLAPIKmn5mTFdRl9uCLs8ZrZI3ZUIS88hHK1I43M02uto";
        assert!(verify_password(&gcm(1000, None), Some(p)).is_ok());
    }

    #[test]
    fn legacy_cbc() {
        let params = MrngParams {
            password: None,
            encryption_engine: String::new(),
            block_cipher_mode: String::new(),
            kdf_iterations: 0,
        };
        assert_eq!(
            decrypt_value(&params, "DGs6c1p8nGvRbtbBuympVofUYV9rvlDQM3p3oYfUeHg=").unwrap().as_str(),
            "legacyPass"
        );
    }

    #[test]
    fn full_file_encryption() {
        let data = "7eaO3D2wBFGSFJVeHZocq75gRrmDunlc7nczYyu9KVMijB28lVkB2Tgw81SwPHBBMP2V1RjUXxAqA+XtbIuZAUyVDeVQfAUYk8r92POW4pNrACwZ9tnG3TQBb5N/AYyZeBdoec0+mg4RjAxY";
        let xml = mremoteng_unlock(gcm(10000, None), None, Some(data.into())).unwrap().unwrap();
        assert!(xml.starts_with("<Node Name=\"a\""));
    }

    #[test]
    fn unsupported_engine_is_reported() {
        let p = MrngParams { encryption_engine: "Serpent".into(), ..gcm(10000, None) };
        assert!(verify_password(&p, None).unwrap_err().contains("Serpent"));
    }
}

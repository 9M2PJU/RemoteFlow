use crate::session::ssh::SshConnectionConfig;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SftpFileEntry {
    pub name: String,
    pub path: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    pub size: u64,
    pub modified: u64,
    pub permissions: u32,
}

pub fn sftp_connect(config: &SshConnectionConfig) -> Result<(ssh2::Session, ssh2::Sftp), String> {
    let sess = crate::session::ssh::ssh_connect_raw(config)?;
    sess.set_timeout(20_000);
    let sftp = sess.sftp().map_err(|e| tr!("Błąd otwierania podsystemu SFTP: {}", "Error opening the SFTP subsystem: {}", e))?;
    Ok((sess, sftp))
}

pub fn sftp_upload_base64_file(
    config: &SshConnectionConfig,
    remote_dir: &str,
    filename: &str,
    content_base64: &str,
) -> Result<u64, String> {
    use base64::Engine;
    let data = base64::engine::general_purpose::STANDARD
        .decode(content_base64)
        .map_err(|e| tr!("Błąd dekodowania Base64: {}", "Base64 decoding error: {}", e))?;

    let (_sess, sftp) = sftp_connect(config)?;
    let clean_dir = if remote_dir.is_empty() || remote_dir == "~" {
        sftp.realpath(Path::new(".")).unwrap_or_else(|_| PathBuf::from("/"))
    } else {
        PathBuf::from(remote_dir)
    };

    let normalized_rel = filename.replace('\\', "/");
    let rel_parts: Vec<&str> = normalized_rel
        .split('/')
        .filter(|s| !s.is_empty() && *s != "." && *s != "..")
        .collect();

    if rel_parts.is_empty() {
        return Err(tr!("Nieprawidłowa nazwa pliku", "Invalid file name").to_string());
    }

    let mut curr_dir = clean_dir.clone();
    if rel_parts.len() > 1 {
        for dir_part in &rel_parts[..rel_parts.len() - 1] {
            curr_dir = curr_dir.join(dir_part);
            let _ = sftp.mkdir(&curr_dir, 0o755);
        }
    }

    let target_file_path = curr_dir.join(rel_parts.last().unwrap());
    let mut remote_file = sftp
        .create(&target_file_path)
        .map_err(|e| tr!("Nie można utworzyć pliku '{}': {}", "Cannot create file '{}': {}", target_file_path.display(), e))?;

    remote_file
        .write_all(&data)
        .map_err(|e| tr!("Błąd zapisu pliku: {}", "File write error: {}", e))?;
    let _ = remote_file.flush();

    Ok(data.len() as u64)
}

pub fn sftp_upload_local_paths(
    config: &SshConnectionConfig,
    local_paths: Vec<String>,
    remote_dir: &str,
) -> Result<u32, String> {
    let home_dir = dirs::home_dir();
    for lp in &local_paths {
        let p = Path::new(lp);
        if p == Path::new("/") || home_dir.as_deref() == Some(p) {
            return Err(
                tr!("Nie można przesłać całego katalogu głównego użytkownika naraz. Wybierz konkretny podkatalog z listy.", "The whole home folder cannot be uploaded at once. Choose a specific subfolder.")
                    .to_string(),
            );
        }
    }

    let (_sess, sftp) = sftp_connect(config)?;
    let clean_dir = if remote_dir.is_empty() || remote_dir == "~" {
        sftp.realpath(Path::new(".")).unwrap_or_else(|_| PathBuf::from("/"))
    } else {
        PathBuf::from(remote_dir)
    };

    let mut total_files = 0;
    for lp in local_paths {
        let local_p = Path::new(&lp);
        if local_p.exists() {
            total_files += upload_path_recursive(&sftp, local_p, &clean_dir, 0)?;
        }
    }

    Ok(total_files)
}

fn upload_path_recursive(
    sftp: &ssh2::Sftp,
    local: &Path,
    remote_dir: &Path,
    depth: u32,
) -> Result<u32, String> {
    if depth > 24 {
        return Ok(0);
    }

    let sym_meta = match std::fs::symlink_metadata(local) {
        Ok(m) => m,
        Err(_) => return Ok(0),
    };
    if sym_meta.file_type().is_symlink() {
        return Ok(0);
    }

    let name = local.file_name().and_then(|n| n.to_str()).unwrap_or("item");
    if depth > 0 && (name == ".cache" || name == "node_modules" || name == "target" || name == ".git") {
        return Ok(0);
    }

    let target_remote = remote_dir.join(name);

    if sym_meta.is_dir() {
        let _ = sftp.mkdir(&target_remote, 0o755);
        let mut count = 0;
        if let Ok(entries) = std::fs::read_dir(local) {
            for entry in entries.flatten() {
                count += upload_path_recursive(sftp, &entry.path(), &target_remote, depth + 1)?;
            }
        }
        Ok(count)
    } else if sym_meta.is_file() {
        let mut local_file =
            File::open(local).map_err(|e| tr!("Błąd otwierania '{}': {}", "Error opening '{}': {}", local.display(), e))?;
        let mut remote_file = sftp
            .create(&target_remote)
            .map_err(|e| tr!("Błąd tworzenia pliku zdalnego '{}': {}", "Error creating remote file '{}': {}", target_remote.display(), e))?;

        std::io::copy(&mut local_file, &mut remote_file)
            .map_err(|e| tr!("Błąd transferu pliku '{}': {}", "Error transferring file '{}': {}", name, e))?;
        let _ = remote_file.flush();
        Ok(1)
    } else {
        Ok(0)
    }
}


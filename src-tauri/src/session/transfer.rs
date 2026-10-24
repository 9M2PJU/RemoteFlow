//! Two-pane SFTP file manager backend (local ⇄ remote).
//!
//! * Browsing operations (list, mkdir, delete, search) reuse a cached SFTP session per
//!   connection, so navigating directories does not open a new SSH connection every time.
//!   Idle sessions are closed after a few minutes; a dead session is re-established once.
//! * Transfers (upload / download of many files and folders) use their own SSH connection, so
//!   browsing stays responsive during a long copy. Progress is reported to the UI with the
//!   `sftp-transfer-progress` event.

use crate::session::sftp::SftpFileEntry;
use crate::session::ssh::SshConnectionConfig;
use serde::Serialize;
use std::collections::HashMap;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

const POOL_IDLE_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const MAX_DEPTH: u32 = 32;
const SEARCH_MAX_RESULTS: usize = 500;
const SEARCH_MAX_DIRS: usize = 20_000;
const SEARCH_MAX_DEPTH: u32 = 12;

// ---------------------------------------------------------------------------------------------
// Cached browsing sessions
// ---------------------------------------------------------------------------------------------

struct Pooled {
    _sess: ssh2::Session,
    sftp: ssh2::Sftp,
    last_used: Instant,
}

type Slot = Arc<Mutex<Option<Pooled>>>;
static POOL: LazyLock<Mutex<HashMap<String, Slot>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn slot_for(key: &str) -> Slot {
    let mut pool = POOL.lock().unwrap_or_else(|p| p.into_inner());
    // Close idle sessions of other connections (only if nobody is using them right now).
    pool.retain(|k, slot| {
        if k == key {
            return true;
        }
        match slot.try_lock() {
            Ok(mut guard) => {
                if guard.as_ref().map(|p| p.last_used.elapsed() > POOL_IDLE_TIMEOUT).unwrap_or(true) {
                    *guard = None;
                    false
                } else {
                    true
                }
            }
            Err(_) => true,
        }
    });
    pool.entry(key.to_string()).or_default().clone()
}

/// Drops the cached session of a connection (e.g. when the SFTP window is closed).
pub fn release_pooled(key: &str) {
    let mut pool = POOL.lock().unwrap_or_else(|p| p.into_inner());
    pool.remove(key);
}

/// Runs `op` on a cached SFTP session for `key`, reconnecting once if the session died.
pub fn with_pooled_sftp<T>(
    key: &str,
    config: &SshConnectionConfig,
    op: impl Fn(&ssh2::Sftp) -> Result<T, String>,
) -> Result<T, String> {
    let slot = slot_for(key);
    let mut guard = slot.lock().unwrap_or_else(|p| p.into_inner());
    for attempt in 0..2 {
        if guard.as_ref().map(|p| p.last_used.elapsed() > POOL_IDLE_TIMEOUT).unwrap_or(false) {
            *guard = None;
        }
        if guard.is_none() {
            let (sess, sftp) = crate::session::sftp::sftp_connect(config)?;
            *guard = Some(Pooled { _sess: sess, sftp, last_used: Instant::now() });
        }
        let pooled = guard.as_mut().expect("just set");
        match op(&pooled.sftp) {
            Ok(v) => {
                pooled.last_used = Instant::now();
                return Ok(v);
            }
            Err(e) => {
                // Distinguish "operation failed" from "connection is gone".
                let alive = pooled.sftp.realpath(Path::new(".")).is_ok();
                if alive || attempt == 1 {
                    pooled.last_used = Instant::now();
                    return Err(e);
                }
                *guard = None;
            }
        }
    }
    unreachable!("loop returns on the second attempt")
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/// Server paths are always Unix-style. On Windows `Path::join` (used by `ssh2::Sftp::readdir`
/// and by us) inserts `\` – e.g. `/etc\apport` – so the separators are normalised before a
/// remote path is shown or sent back to the UI. (ssh2 itself already converts `\` to `/` when
/// it sends a path to the server, so a `\` can never be part of a remote name on Windows.)
pub fn remote_path_string(p: &Path) -> String {
    let s = p.to_string_lossy();
    if cfg!(windows) { s.replace('\\', "/") } else { s.into_owned() }
}

/// `follow`: a symbolic link is shown with the type / size of its target (one extra `stat`
/// round trip per link); without it (recursive search) the link's own data is used.
fn remote_entry(sftp: Option<&ssh2::Sftp>, path: &Path, stat: &ssh2::FileStat) -> Option<SftpFileEntry> {
    let name = path.file_name()?.to_str()?.to_string();
    if name == "." || name == ".." {
        return None;
    }
    let is_link = is_remote_symlink(stat);
    let target = match (is_link, sftp) {
        (true, Some(sftp)) => sftp.stat(path).ok(), // None = broken link
        _ => None,
    };
    let st = target.as_ref().unwrap_or(stat);
    Some(SftpFileEntry {
        name,
        path: remote_path_string(path),
        is_dir: st.is_dir(),
        size: if st.is_dir() { 0 } else { st.size.unwrap_or(0) },
        modified: st.mtime.unwrap_or(0),
        permissions: st.perm.unwrap_or(0),
        is_link,
    })
}

fn is_remote_symlink(stat: &ssh2::FileStat) -> bool {
    stat.file_type() == ssh2::FileType::Symlink
}

/// Windows: entries that are both hidden and system – e.g. the legacy junctions in the user
/// profile ("Application Data", "Moje dokumenty"...), which Explorer hides and which cannot be
/// opened anyway.
fn is_hidden_system(meta: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const HIDDEN: u32 = 0x2;
        const SYSTEM: u32 = 0x4;
        let a = meta.file_attributes();
        a & HIDDEN != 0 && a & SYSTEM != 0
    }
    #[cfg(not(windows))]
    {
        let _ = meta;
        false
    }
}

/// One entry of a local folder. Symbolic links are shown with the type / size of their target
/// (a broken link as an empty file) and marked `is_link`.
pub(crate) fn local_entry(path: &Path) -> Option<SftpFileEntry> {
    let link_meta = std::fs::symlink_metadata(path).ok()?;
    if is_hidden_system(&link_meta) {
        return None;
    }
    let is_link = link_meta.file_type().is_symlink();
    let meta = if is_link { std::fs::metadata(path).unwrap_or(link_meta) } else { link_meta };
    let name = path.file_name()?.to_string_lossy().to_string();
    Some(SftpFileEntry {
        name,
        path: display_path(path),
        is_dir: meta.is_dir(),
        size: if meta.is_dir() { 0 } else { meta.len() },
        modified: meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0),
        permissions: 0,
        is_link,
    })
}

/// Path for display / round-tripping to the UI: strips the Windows verbatim prefix (`\\?\`)
/// that `canonicalize()` adds.
pub fn display_path(p: &Path) -> String {
    let s = p.to_string_lossy().to_string();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{}", rest)
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        s
    }
}

/// A single file/folder name coming from the UI or from the remote server must not contain
/// path separators or be "." / "..".
pub fn sanitize_name(name: &str) -> Result<String, String> {
    let n = name.trim();
    if n.is_empty()
        || n == "."
        || n == ".."
        || n.contains('/')
        || n.contains('\\')
        || n.chars().any(|c| c.is_control())
    {
        return Err(format!("Niedozwolona nazwa: '{}'", name));
    }
    #[cfg(target_os = "windows")]
    if n.chars().any(|c| matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*')) {
        return Err(format!("Nazwa zawiera znaki niedozwolone w Windows: '{}'", name));
    }
    Ok(n.to_string())
}

fn remote_join(dir: &str, name: &str) -> PathBuf {
    let base = if dir.is_empty() { "." } else { dir };
    Path::new(base).join(name)
}

// ---------------------------------------------------------------------------------------------
// Browsing / searching
// ---------------------------------------------------------------------------------------------

pub fn remote_list(sftp: &ssh2::Sftp, remote_path: &str) -> Result<(String, Vec<SftpFileEntry>), String> {
    let target = if remote_path.is_empty() || remote_path == "." || remote_path == "~" {
        sftp.realpath(Path::new(".")).unwrap_or_else(|_| PathBuf::from("/"))
    } else {
        PathBuf::from(remote_path)
    };
    let current = remote_path_string(&target);
    let entries = sftp
        .readdir(&target)
        .map_err(|e| tr!("Błąd odczytu katalogu '{}': {}", "Error reading folder '{}': {}", current, e))?;
    let mut result: Vec<SftpFileEntry> = entries.iter().filter_map(|(p, st)| remote_entry(Some(sftp), p, st)).collect();
    result.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok((current, result))
}

pub fn remote_delete(sftp: &ssh2::Sftp, remote_path: &str) -> Result<(), String> {
    let p = Path::new(remote_path);
    let stat = sftp.lstat(p).map_err(|e| tr!("Nie można odczytać '{}': {}", "Cannot read '{}': {}", remote_path, e))?;
    if stat.is_dir() && !is_remote_symlink(&stat) {
        delete_remote_dir(sftp, p, 0)
    } else {
        sftp.unlink(p).map_err(|e| tr!("Błąd usuwania '{}': {}", "Error deleting '{}': {}", remote_path, e))
    }
}

fn delete_remote_dir(sftp: &ssh2::Sftp, dir: &Path, depth: u32) -> Result<(), String> {
    if depth > MAX_DEPTH {
        return Err(tr!("Zbyt głębokie zagnieżdżenie: {}", "Nesting too deep: {}", remote_path_string(dir)));
    }
    let entries = sftp.readdir(dir).map_err(|e| tr!("Błąd odczytu '{}': {}", "Error reading '{}': {}", remote_path_string(dir), e))?;
    for (path, stat) in entries {
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name == "." || name == ".." {
            continue;
        }
        if stat.is_dir() && !is_remote_symlink(&stat) {
            delete_remote_dir(sftp, &path, depth + 1)?;
        } else {
            sftp.unlink(&path).map_err(|e| tr!("Błąd usuwania '{}': {}", "Error deleting '{}': {}", remote_path_string(&path), e))?;
        }
    }
    sftp.rmdir(dir).map_err(|e| tr!("Błąd usuwania katalogu '{}': {}", "Error deleting folder '{}': {}", remote_path_string(dir), e))
}

pub fn remote_mkdir(sftp: &ssh2::Sftp, parent: &str, name: &str) -> Result<String, String> {
    let name = sanitize_name(name)?;
    let target = remote_join(parent, &name);
    sftp.mkdir(&target, 0o755)
        .map_err(|e| tr!("Błąd tworzenia katalogu '{}': {}", "Error creating folder '{}': {}", remote_path_string(&target), e))?;
    Ok(remote_path_string(&target))
}

pub fn local_mkdir(parent: &str, name: &str) -> Result<String, String> {
    let name = sanitize_name(name)?;
    let base = if parent.trim().is_empty() {
        dirs::home_dir().ok_or(tr!("Brak katalogu domowego", "No home folder"))?
    } else {
        PathBuf::from(parent)
    };
    let target = base.join(name);
    if target.exists() {
        return Err(tr!("'{}' już istnieje", "'{}' already exists", display_path(&target)));
    }
    std::fs::create_dir(&target).map_err(|e| tr!("Błąd tworzenia katalogu '{}': {}", "Error creating folder '{}': {}", display_path(&target), e))?;
    Ok(display_path(&target))
}

pub fn remote_search(sftp: &ssh2::Sftp, root: &str, query: &str) -> Result<Vec<SftpFileEntry>, String> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let root_path = if root.is_empty() {
        sftp.realpath(Path::new(".")).unwrap_or_else(|_| PathBuf::from("/"))
    } else {
        PathBuf::from(root)
    };
    let mut results = Vec::new();
    let mut queue = std::collections::VecDeque::from([(root_path, 0u32)]);
    let mut visited = 0usize;
    while let Some((dir, depth)) = queue.pop_front() {
        visited += 1;
        if visited > SEARCH_MAX_DIRS || results.len() >= SEARCH_MAX_RESULTS {
            break;
        }
        let Ok(entries) = sftp.readdir(&dir) else { continue };
        for (path, stat) in entries {
            // Links are listed but never followed while searching (loops, huge trees)
            let Some(entry) = remote_entry(None, &path, &stat) else { continue };
            if entry.is_dir && !entry.is_link && depth < SEARCH_MAX_DEPTH {
                queue.push_back((path.clone(), depth + 1));
            }
            if entry.name.to_lowercase().contains(&q) {
                results.push(entry);
                if results.len() >= SEARCH_MAX_RESULTS {
                    break;
                }
            }
        }
    }
    Ok(results)
}

pub fn local_search(root: &str, query: &str) -> Result<Vec<SftpFileEntry>, String> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let root_path = if root.trim().is_empty() {
        dirs::home_dir().ok_or(tr!("Brak katalogu domowego", "No home folder"))?
    } else {
        PathBuf::from(root)
    };
    let mut results = Vec::new();
    let mut queue = std::collections::VecDeque::from([(root_path, 0u32)]);
    let mut visited = 0usize;
    while let Some((dir, depth)) = queue.pop_front() {
        visited += 1;
        if visited > SEARCH_MAX_DIRS || results.len() >= SEARCH_MAX_RESULTS {
            break;
        }
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for item in rd.flatten() {
            let path = item.path();
            let Some(entry) = local_entry(&path) else { continue };
            if entry.is_dir && !entry.is_link && depth < SEARCH_MAX_DEPTH {
                queue.push_back((path.clone(), depth + 1));
            }
            if entry.name.to_lowercase().contains(&q) {
                results.push(entry);
                if results.len() >= SEARCH_MAX_RESULTS {
                    break;
                }
            }
        }
    }
    Ok(results)
}

// ---------------------------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Default, Clone, Serialize)]
pub struct TransferSummary {
    pub files: u32,
    pub folders: u32,
    pub bytes: u64,
    pub failed: u32,
    /// First few error messages (for the UI).
    pub errors: Vec<String>,
    /// Links to folders inside a transferred folder – not followed (could loop or pull in a huge
    /// tree). Links to files, and a link selected directly, are transferred with their content.
    #[serde(rename = "skippedLinks")]
    pub skipped_links: u32,
}

impl TransferSummary {
    fn fail(&mut self, msg: String) {
        self.failed += 1;
        if self.errors.len() < 5 {
            self.errors.push(msg);
        }
    }
}

/// Progress callback: (files done, name of the item being transferred).
pub type Progress<'a> = &'a mut dyn FnMut(u32, &str);

fn copy_with_progress(
    reader: &mut dyn std::io::Read,
    writer: &mut dyn std::io::Write,
) -> std::io::Result<u64> {
    let mut buf = vec![0u8; 256 * 1024];
    let mut total = 0u64;
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        writer.write_all(&buf[..n])?;
        total += n as u64;
    }
    writer.flush()?;
    Ok(total)
}

fn upload_one(
    sftp: &ssh2::Sftp,
    local: &Path,
    remote_dir: &Path,
    depth: u32,
    sum: &mut TransferSummary,
    progress: Progress,
) {
    if depth > MAX_DEPTH {
        sum.fail(tr!("Zbyt głębokie zagnieżdżenie: {}", "Nesting too deep: {}", display_path(local)));
        return;
    }
    let Ok(link_meta) = std::fs::symlink_metadata(local) else {
        sum.fail(tr!("Nie można odczytać: {}", "Cannot read: {}", display_path(local)));
        return;
    };
    // Symbolic links are transferred with the content of their target. A link to a folder
    // inside a transferred folder is not followed (loops / huge trees) – it is counted instead.
    let meta = if link_meta.file_type().is_symlink() {
        match std::fs::metadata(local) {
            Ok(m) if m.is_dir() && depth > 0 => {
                sum.skipped_links += 1;
                return;
            }
            Ok(m) => m,
            Err(_) => {
                sum.fail(tr!("Uszkodzone dowiązanie: {}", "Broken link: {}", display_path(local)));
                return;
            }
        }
    } else {
        link_meta
    };
    let name = match local.file_name() {
        Some(n) => n.to_string_lossy().to_string(),
        None => {
            sum.fail(tr!("Nieprawidłowa ścieżka: {}", "Invalid path: {}", display_path(local)));
            return;
        }
    };
    let target = remote_dir.join(&name);

    if meta.is_dir() {
        if sftp.stat(&target).map(|s| s.is_dir()).unwrap_or(false) || sftp.mkdir(&target, 0o755).is_ok() {
            sum.folders += 1;
        } else {
            sum.fail(tr!("Nie można utworzyć katalogu zdalnego {}", "Cannot create remote folder {}", remote_path_string(&target)));
            return;
        }
        match std::fs::read_dir(local) {
            Ok(rd) => {
                for item in rd.flatten() {
                    upload_one(sftp, &item.path(), &target, depth + 1, sum, progress);
                }
            }
            Err(e) => sum.fail(tr!("Błąd odczytu katalogu {}: {}", "Error reading folder {}: {}", display_path(local), e)),
        }
    } else if meta.is_file() {
        progress(sum.files, &name);
        let result = File::open(local)
            .map_err(|e| tr!("Błąd otwierania {}: {}", "Error opening {}: {}", display_path(local), e))
            .and_then(|mut src| {
                let mut dst = sftp
                    .create(&target)
                    .map_err(|e| tr!("Błąd tworzenia pliku zdalnego {}: {}", "Error creating remote file {}: {}", remote_path_string(&target), e))?;
                copy_with_progress(&mut src, &mut dst).map_err(|e| tr!("Błąd przesyłania {}: {}", "Error uploading {}: {}", name, e))
            });
        match result {
            Ok(n) => {
                sum.files += 1;
                sum.bytes += n;
            }
            Err(e) => sum.fail(e),
        }
    }
}

pub fn upload_paths(
    config: &SshConnectionConfig,
    local_paths: &[String],
    remote_dir: &str,
    progress: Progress,
) -> Result<TransferSummary, String> {
    let (_sess, sftp) = crate::session::sftp::sftp_connect(config)?;
    let remote_dir = if remote_dir.is_empty() || remote_dir == "~" {
        sftp.realpath(Path::new(".")).unwrap_or_else(|_| PathBuf::from("/"))
    } else {
        PathBuf::from(remote_dir)
    };
    let mut sum = TransferSummary::default();
    for lp in local_paths {
        upload_one(&sftp, Path::new(lp), &remote_dir, 0, &mut sum, progress);
    }
    Ok(sum)
}

fn download_one(
    sftp: &ssh2::Sftp,
    remote: &Path,
    stat: &ssh2::FileStat,
    local_dir: &Path,
    depth: u32,
    sum: &mut TransferSummary,
    progress: Progress,
) {
    if depth > MAX_DEPTH {
        sum.fail(tr!("Zbyt głębokie zagnieżdżenie: {}", "Nesting too deep: {}", remote_path_string(remote)));
        return;
    }
    // Symbolic links: downloaded with the content of their target; a link to a folder inside a
    // downloaded folder is not followed (loops / huge trees) – it is counted instead.
    let target_stat;
    let stat = if is_remote_symlink(stat) {
        match sftp.stat(remote) {
            Ok(t) if t.is_dir() && depth > 0 => {
                sum.skipped_links += 1;
                return;
            }
            Ok(t) => {
                target_stat = t;
                &target_stat
            }
            Err(_) => {
                sum.fail(tr!("Uszkodzone dowiązanie: {}", "Broken link: {}", remote_path_string(remote)));
                return;
            }
        }
    } else {
        stat
    };
    let raw_name = remote.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    // Names come from the server – never let them escape the target folder.
    let name = match sanitize_name(&raw_name) {
        Ok(n) => n,
        Err(e) => {
            sum.fail(e);
            return;
        }
    };
    let target = local_dir.join(&name);
    // Never write through an existing local symbolic link: a link named like the downloaded
    // item would send the data wherever it points (outside the chosen folder).
    if is_local_link(&target) {
        sum.fail(tr!(
            "Pominięto {}: w katalogu docelowym jest dowiązanie symboliczne o tej nazwie",
            "Skipped {}: the target folder contains a symbolic link with this name",
            display_path(&target)
        ));
        return;
    }

    if stat.is_dir() {
        let created = if target.is_dir() { Ok(()) } else { std::fs::create_dir(&target) };
        if let Err(e) = created {
            sum.fail(tr!("Nie można utworzyć katalogu {}: {}", "Cannot create folder {}: {}", display_path(&target), e));
            return;
        }
        sum.folders += 1;
        match sftp.readdir(remote) {
            Ok(entries) => {
                for (path, child_stat) in entries {
                    let child_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                    if child_name == "." || child_name == ".." {
                        continue;
                    }
                    download_one(sftp, &path, &child_stat, &target, depth + 1, sum, progress);
                }
            }
            Err(e) => sum.fail(tr!("Błąd odczytu katalogu zdalnego {}: {}", "Error reading remote folder {}: {}", remote_path_string(remote), e)),
        }
    } else {
        progress(sum.files, &name);
        let result = sftp
            .open(remote)
            .map_err(|e| tr!("Nie można otworzyć {}: {}", "Cannot open {}: {}", remote_path_string(remote), e))
            .and_then(|mut src| download_to(&mut src, &target, &name));
        match result {
            Ok(n) => {
                sum.files += 1;
                sum.bytes += n;
            }
            Err(e) => sum.fail(e),
        }
    }
}

fn is_local_link(path: &Path) -> bool {
    std::fs::symlink_metadata(path).map(|m| m.file_type().is_symlink()).unwrap_or(false)
}

/// Writes a downloaded file safely: into a new temporary file next to the target (created with
/// `create_new`, which never follows links) that replaces the target only when complete. A
/// rename replaces a directory entry and never follows a link, so even a link created in the
/// meantime cannot redirect the data; an interrupted download also leaves the old file intact.
fn download_to(src: &mut dyn std::io::Read, target: &Path, name: &str) -> Result<u64, String> {
    let tmp = target.with_file_name(format!(".{}.rf-part", name));
    let _ = std::fs::remove_file(&tmp); // leftover of an interrupted download (or a planted link – only the link is removed)
    let result = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp)
        .map_err(|e| tr!("Błąd tworzenia pliku {}: {}", "Error creating file {}: {}", display_path(target), e))
        .and_then(|mut dst| copy_with_progress(src, &mut dst).map_err(|e| tr!("Błąd pobierania {}: {}", "Error downloading {}: {}", name, e)))
        .and_then(|n| {
            if is_local_link(target) {
                return Err(tr!(
                    "Pominięto {}: w katalogu docelowym jest dowiązanie symboliczne o tej nazwie",
                    "Skipped {}: the target folder contains a symbolic link with this name",
                    display_path(target)
                ));
            }
            std::fs::rename(&tmp, target)
                .map(|_| n)
                .map_err(|e| tr!("Błąd zapisu pliku {}: {}", "Error saving file {}: {}", display_path(target), e))
        });
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

pub fn download_paths(
    config: &SshConnectionConfig,
    remote_paths: &[String],
    local_dir: &str,
    progress: Progress,
) -> Result<TransferSummary, String> {
    let local_dir = if local_dir.trim().is_empty() {
        dirs::download_dir().or_else(dirs::home_dir).ok_or(tr!("Brak katalogu docelowego", "No target folder"))?
    } else {
        PathBuf::from(local_dir)
    };
    if !local_dir.is_dir() {
        return Err(tr!("Katalog docelowy nie istnieje: {}", "The target folder does not exist: {}", display_path(&local_dir)));
    }
    let (_sess, sftp) = crate::session::sftp::sftp_connect(config)?;
    let mut sum = TransferSummary::default();
    for rp in remote_paths {
        let p = Path::new(rp);
        match sftp.lstat(p) {
            Ok(stat) => download_one(&sftp, p, &stat, &local_dir, 0, &mut sum, progress),
            Err(e) => sum.fail(tr!("Nie można odczytać {}: {}", "Cannot read {}: {}", rp, e)),
        }
    }
    Ok(sum)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_sanitised() {
        assert!(sanitize_name("raport.pdf").is_ok());
        assert!(sanitize_name("zażółć").is_ok());
        assert!(sanitize_name("..").is_err());
        assert!(sanitize_name("a/b").is_err());
        assert!(sanitize_name("a\\b").is_err());
        assert!(sanitize_name("").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn download_never_writes_through_links() {
        let base = std::env::temp_dir().join(format!("rf-dl-link-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("dst")).unwrap();
        std::fs::write(base.join("victim.txt"), b"keep").unwrap();
        std::os::unix::fs::symlink(base.join("victim.txt"), base.join("dst").join("raport.txt")).unwrap();
        let mut src: &[u8] = b"downloaded";
        let err = download_to(&mut src, &base.join("dst").join("raport.txt"), "raport.txt");
        assert!(err.is_err());
        assert_eq!(std::fs::read(base.join("victim.txt")).unwrap(), b"keep", "link target untouched");
        assert!(!base.join("dst").join(".raport.txt.rf-part").exists());
        // normal file: written and replaced atomically
        let mut src: &[u8] = b"new";
        std::fs::write(base.join("dst").join("a.txt"), b"old").unwrap();
        assert_eq!(download_to(&mut src, &base.join("dst").join("a.txt"), "a.txt").unwrap(), 3);
        assert_eq!(std::fs::read(base.join("dst").join("a.txt")).unwrap(), b"new");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn remote_paths_use_forward_slashes() {
        let joined = Path::new("/etc").join("apport");
        assert_eq!(remote_path_string(&joined), "/etc/apport");
        assert_eq!(remote_path_string(Path::new("/")), "/");
    }

    #[test]
    fn verbatim_prefix_is_removed() {
        assert_eq!(display_path(Path::new(r"\\?\C:\Users\jan")), r"C:\Users\jan");
        assert_eq!(display_path(Path::new(r"\\?\UNC\srv\share")), r"\\srv\share");
        assert_eq!(display_path(Path::new("/home/jan")), "/home/jan");
    }

    #[test]
    fn local_mkdir_and_search() {
        let base = std::env::temp_dir().join(format!("rf-transfer-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("a").join("b")).unwrap();
        std::fs::write(base.join("a").join("b").join("Raport-2026.txt"), "x").unwrap();
        let created = local_mkdir(base.to_str().unwrap(), "Nowy katalog").unwrap();
        assert!(Path::new(&created).is_dir());
        assert!(local_mkdir(base.to_str().unwrap(), "Nowy katalog").is_err());
        assert!(local_mkdir(base.to_str().unwrap(), "../x").is_err());
        let found = local_search(base.to_str().unwrap(), "raport").unwrap();
        assert_eq!(found.len(), 1);
        assert!(!found[0].is_dir);
        let _ = std::fs::remove_dir_all(&base);
    }
}

/// End-to-end test against a local sshd (127.0.0.1:2222, user rftest / Test-Pass-123).
#[cfg(test)]
mod sftp_e2e {
    use super::*;
    use crate::session::ssh::HostKeyVerifier;
    use crate::vault::known_hosts::HostTrust;

    fn config() -> SshConnectionConfig {
        SshConnectionConfig {
            host: "127.0.0.1".into(),
            port: 2222,
            username: "rftest".into(),
            password: Some("Test-Pass-123".into()),
            private_key: None,
            passphrase: None,
            host_key_verifier: HostKeyVerifier(Arc::new(|_| Ok(HostTrust::Known))),
        }
    }

    #[test]
    #[ignore]
    fn upload_search_download_delete() {
        let cfg = config();
        let base = std::env::temp_dir().join(format!("rf-e2e-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let src = base.join("src");
        std::fs::create_dir_all(src.join("projekt").join(".git")).unwrap();
        std::fs::write(src.join("projekt").join(".git").join("HEAD"), "ref").unwrap();
        std::fs::write(src.join("projekt").join("zażółć.txt"), vec![7u8; 700_000]).unwrap();
        std::fs::write(src.join("pojedynczy.bin"), b"abc").unwrap();

        // remote working folder
        let remote_root = with_pooled_sftp("k", &cfg, |sftp| {
            let home = sftp.realpath(Path::new(".")).unwrap();
            let _ = remote_delete(sftp, &home.join("e2e").to_string_lossy());
            remote_mkdir(sftp, &home.to_string_lossy(), "e2e")
        })
        .unwrap();

        let mut events = 0;
        let mut progress = |_: u32, _: &str| events += 1;
        let up = upload_paths(
            &cfg,
            &[
                src.join("projekt").to_string_lossy().to_string(),
                src.join("pojedynczy.bin").to_string_lossy().to_string(),
            ],
            &remote_root,
            &mut progress,
        )
        .unwrap();
        assert_eq!(up.failed, 0, "{:?}", up.errors);
        assert_eq!(up.files, 3, ".git content is no longer skipped");
        assert_eq!(up.bytes, 700_000 + 3 + 3);
        assert!(events >= 3);

        let (_, listing) = with_pooled_sftp("k", &cfg, |sftp| remote_list(sftp, &remote_root)).unwrap();
        let names: Vec<_> = listing.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["projekt", "pojedynczy.bin"], "dirs first");

        let found = with_pooled_sftp("k", &cfg, |sftp| remote_search(sftp, &remote_root, "ZAŻÓŁĆ")).unwrap();
        assert_eq!(found.len(), 1);

        let dst = base.join("dst");
        std::fs::create_dir_all(&dst).unwrap();
        let down = download_paths(
            &cfg,
            &[format!("{}/projekt", remote_root), format!("{}/pojedynczy.bin", remote_root)],
            dst.to_str().unwrap(),
            &mut |_, _| {},
        )
        .unwrap();
        assert_eq!(down.failed, 0, "{:?}", down.errors);
        assert_eq!(down.files, 3);
        assert_eq!(std::fs::read(dst.join("projekt").join("zażółć.txt")).unwrap().len(), 700_000);
        assert_eq!(std::fs::read(dst.join("pojedynczy.bin")).unwrap(), b"abc");

        // pooled session survives and is reused; delete recursively
        let n = with_pooled_sftp("k", &cfg, |sftp| {
            remote_delete(sftp, &format!("{}/projekt", remote_root))?;
            Ok(remote_list(sftp, &remote_root)?.1.len())
        })
        .unwrap();
        assert_eq!(n, 1);
        assert!(with_pooled_sftp("k", &cfg, |sftp| remote_mkdir(sftp, &remote_root, "../evil")).is_err());

        with_pooled_sftp("k", &cfg, |sftp| remote_delete(sftp, &remote_root)).unwrap();
        release_pooled("k");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[cfg(unix)]
    #[test]
    #[ignore]
    fn symlinks_are_listed_and_followed() {
        use std::os::unix::fs::symlink;
        let cfg = config();
        let base = std::env::temp_dir().join(format!("rf-links-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let src = base.join("src");
        std::fs::create_dir_all(src.join("sub")).unwrap();
        std::fs::write(src.join("a.txt"), b"hello").unwrap();
        std::fs::write(src.join("sub").join("b.txt"), b"bb").unwrap();
        symlink(src.join("a.txt"), src.join("la")).unwrap(); // link to a file
        symlink(src.join("sub"), src.join("ld")).unwrap(); // link to a folder
        symlink(src.join("missing"), src.join("lb")).unwrap(); // broken link
        symlink("..", src.join("sub").join("loop")).unwrap(); // loop

        // Local listing shows links with the type / size of the target
        let la = local_entry(&src.join("la")).unwrap();
        assert!(la.is_link && !la.is_dir && la.size == 5);
        let ld = local_entry(&src.join("ld")).unwrap();
        assert!(ld.is_link && ld.is_dir);
        let lb = local_entry(&src.join("lb")).unwrap();
        assert!(lb.is_link && !lb.is_dir);

        let remote_root = with_pooled_sftp("links", &cfg, |sftp| {
            let home = sftp.realpath(Path::new(".")).unwrap();
            let _ = remote_delete(sftp, &home.join("e2e-links").to_string_lossy());
            remote_mkdir(sftp, &home.to_string_lossy(), "e2e-links")
        })
        .unwrap();

        // Upload of the folder: file links copied with content, folder links inside not followed
        let up = upload_paths(&cfg, &[src.to_string_lossy().to_string()], &remote_root, &mut |_, _| {}).unwrap();
        assert_eq!(up.files, 3, "a.txt, la, sub/b.txt: {:?}", up.errors);
        assert_eq!(up.skipped_links, 2, "ld and sub/loop");
        assert_eq!(up.failed, 1, "broken link reported");
        // A folder link chosen directly is followed
        let up2 = upload_paths(&cfg, &[src.join("ld").to_string_lossy().to_string()], &remote_root, &mut |_, _| {}).unwrap();
        assert_eq!((up2.files, up2.skipped_links, up2.failed), (1, 1, 0));

        // Remote links (the test server runs on this machine): listed and downloaded the same way
        let remote_src = PathBuf::from(format!("{}/src", remote_root));
        symlink("a.txt", remote_src.join("rl")).unwrap();
        symlink("sub", remote_src.join("rd")).unwrap();
        let (_, listing) = with_pooled_sftp("links", &cfg, |sftp| remote_list(sftp, &remote_src.to_string_lossy())).unwrap();
        let rl = listing.iter().find(|e| e.name == "rl").unwrap();
        assert!(rl.is_link && !rl.is_dir && rl.size == 5);
        let rd = listing.iter().find(|e| e.name == "rd").unwrap();
        assert!(rd.is_link && rd.is_dir);

        let dst = base.join("dst");
        std::fs::create_dir_all(&dst).unwrap();
        let down = download_paths(&cfg, &[remote_src.to_string_lossy().to_string()], dst.to_str().unwrap(), &mut |_, _| {}).unwrap();
        assert_eq!(down.failed, 0, "{:?}", down.errors);
        assert_eq!(std::fs::read(dst.join("src").join("rl")).unwrap(), b"hello");
        assert_eq!(down.skipped_links, 1, "rd not followed inside a folder");

        with_pooled_sftp("links", &cfg, |sftp| remote_delete(sftp, &remote_root)).unwrap();
        release_pooled("links");
        let _ = std::fs::remove_dir_all(&base);
    }
}

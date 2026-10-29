//! Current directory of the shell in an SSH terminal tab ("Katalog z terminala" in SFTP).
//!
//! The terminal's own SSH connection opens a short extra `exec` channel and runs a POSIX `sh`
//! script (sent on stdin, so the user's login shell may be anything – bash, zsh, fish...). All
//! channels of one SSH connection are children of the same per-connection server process
//! (`sshd: user@pts/N` / `sshd-session`, dropbear), so the script:
//! 1. walks up from its own parent to that process,
//! 2. lists its descendants from `/proc/*/stat` (only shell builtins – no fork per process),
//!    skipping its own process tree,
//! 3. takes the deepest shell (`bash` → `sudo -i` / nested `bash` / `zsh` ...) whose working
//!    directory it may read (`readlink /proc/PID/cwd`).
//!
//! Nothing is typed into the terminal. Needs a Linux server (`/proc`); other systems report
//! `ERR noproc` and the frontend falls back to the OSC 7 directory reported by the shell, if any.

use serde::Serialize;

pub const SCRIPT: &str = r#"LC_ALL=C
export LC_ALL
[ -r /proc/self/stat ] || { echo "ERR noproc"; exit 0; }
me=$$
root=$PPID
q=$PPID
while [ -n "$q" ] && [ "$q" -gt 1 ]; do
  read -r st < "/proc/$q/stat" 2>/dev/null || break
  c=${st#*\(}; c=${c%\)*}
  case "$c" in sshd*|dropbear*) root=$q; break;; esac
  rest=${st##*\) }
  set -- $rest
  q=$2
done
for d in /proc/[0-9]*; do
  read -r st < "$d/stat" 2>/dev/null || continue
  c=${st#*\(}; c=${c%\)*}
  rest=${st##*\) }
  set -- $rest
  echo "${d#/proc/} $2 $c"
done | awk -v root="$root" -v me="$me" '
{ ppid[$1] = $2; c = $3; for (i = 4; i <= NF; i++) c = c " " $i; comm[$1] = c; order[NR] = $1 }
END {
  q = me
  while ((q in ppid) && q != root && q > 1) { excl[q] = 1; q = ppid[q] }
  for (i = 1; i <= NR; i++) {
    p = order[i]; if (p in excl) continue
    d = 0; q = p; ok = 0
    while ((q in ppid) && d < 64) {
      if (q in excl) { ok = -1; break }
      if (ppid[q] == root) { ok = 1; break }
      q = ppid[q]; d++
    }
    if (ok == 1 && comm[p] ~ /^-?(bash|zsh|sh|dash|ksh|mksh|ksh93|pdksh|fish|tcsh|csh|ash|yash|busybox|nu|xonsh|elvish|oksh)$/) print d, p
  }
}' | sort -k1,1nr -k2,2nr | while read -r depth pid; do
  cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null)
  if [ -n "$cwd" ]; then echo "OK $cwd"; exit 0; fi
  echo "SKIP $pid"
done
"#;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCwd {
    pub path: String,
    /// A deeper shell (e.g. after `sudo -i` / `su`) belongs to another user and its directory
    /// cannot be read – the directory of the nearest readable shell is returned instead.
    pub other_user_shell: bool,
}

/// Interprets the script output.
pub fn parse(output: &str) -> Result<TerminalCwd, String> {
    let mut skipped = 0;
    for line in output.lines() {
        if let Some(path) = line.strip_prefix("OK ") {
            if path.starts_with('/') {
                return Ok(TerminalCwd { path: path.to_string(), other_user_shell: skipped > 0 });
            }
        } else if line.starts_with("SKIP ") {
            skipped += 1;
        } else if line.trim() == "ERR noproc" {
            return Err("NO_PROC".into());
        }
    }
    if skipped > 0 {
        Err(tr!(
            "Powłoka w terminalu należy do innego użytkownika (np. po sudo/su) – nie można odczytać jej katalogu.",
            "The shell in the terminal belongs to another user (e.g. after sudo/su) – its directory cannot be read."
        )
        .to_string())
    } else {
        Err(tr!("Nie znaleziono powłoki tego terminala na serwerze.", "The shell of this terminal was not found on the server.").to_string())
    }
}

/// Runs the script over a new channel of the terminal's own session (worker thread).
pub fn query(sess: &ssh2::Session) -> Result<TerminalCwd, String> {
    use std::io::{Read, Write};
    let run = || -> Result<String, String> {
        let mut ch = sess.channel_session().map_err(|e| e.to_string())?;
        ch.exec("sh").map_err(|e| e.to_string())?;
        ch.write_all(SCRIPT.as_bytes()).map_err(|e| e.to_string())?;
        ch.send_eof().map_err(|e| e.to_string())?;
        let mut out = String::new();
        ch.read_to_string(&mut out).map_err(|e| e.to_string())?;
        let _ = ch.wait_close();
        Ok(out)
    };
    let result = run();
    result
        .map_err(|e| tr!("Nie udało się odczytać katalogu terminala: {}", "Could not read the terminal directory: {}", e))
        .and_then(|out| parse(&out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_script_output() {
        assert_eq!(parse("OK /var/www/site one\n").unwrap(), TerminalCwd { path: "/var/www/site one".into(), other_user_shell: false });
        assert_eq!(parse("SKIP 123\nOK /home/jan\n").unwrap(), TerminalCwd { path: "/home/jan".into(), other_user_shell: true });
        assert_eq!(parse("ERR noproc\n").unwrap_err(), "NO_PROC");
        assert!(parse("SKIP 1\n").is_err());
        assert!(parse("").is_err());
    }

    /// The script runs locally too: started from a shell whose cwd is known, it must not report
    /// its own process tree. (Here there is no sshd above, so `root` stays the parent – the test
    /// shell – and a child `sh` started inside it is found.)
    #[test]
    #[cfg(target_os = "linux")]
    fn script_finds_a_descendant_shell_locally() {
        let dir = std::env::temp_dir().join(format!("rf-cwd-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // bash (root) -> sh in `dir` sleeping (the "interactive shell"), then the script
        let wrapper = format!(
            "(cd '{}' && exec sh -c 'sleep 5; :') & sleep 0.3; sh <<'RFEOF'\n{}RFEOF\nkill %1 2>/dev/null",
            dir.display(),
            SCRIPT
        );
        let out = std::process::Command::new("bash").arg("-c").arg(&wrapper).output().unwrap();
        let text = String::from_utf8_lossy(&out.stdout);
        let parsed = parse(&text).unwrap();
        assert_eq!(std::path::Path::new(&parsed.path), dir.canonicalize().unwrap(), "{text}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}

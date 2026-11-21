# Security policy

RemoteFlow stores SSH/RDP credentials, so security reports are very welcome.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private reporting instead:
*Security* tab of this repository → **Report a vulnerability**. You will get an answer as soon as
possible; a fix is released as a new version (the in-app updater offers it to all users).

Please include the version (shown next to the logo), the operating system and steps to reproduce.

## Supported versions

Only the latest released version receives security fixes.

## How RemoteFlow protects data (summary)

- The vault is encrypted locally (Argon2id key derivation, AES-256-GCM) with the Master Password;
  the application connects only to the servers you configure and, for the update check, to GitHub
  (can be switched off in Settings → Updates).
- Server identities are pinned (SSH host keys, RDP certificates) and verified before credentials are sent.
- Updates are downloaded from this repository's GitHub Releases and installed only when signed with
  the project key (public key in `src-tauri/tauri.conf.json`); release builds are made by GitHub
  Actions from the tagged source code.

---

# Zasady bezpieczeństwa (PL)

Podatności prosimy zgłaszać **prywatnie**, nie w publicznym zgłoszeniu: zakładka *Security* tego
repozytorium → **Report a vulnerability**. Podaj wersję programu, system i kroki do odtworzenia.
Poprawki bezpieczeństwa trafiają tylko do najnowszej wersji (program sam ją zaproponuje).

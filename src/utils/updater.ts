/**
 * Application updates from GitHub Releases (tauri-plugin-updater).
 *
 * The release workflow (.github/workflows/release.yml) publishes the installers together with
 * `latest.json` and a signature of every package. The application downloads only a package
 * signed with the private key whose public half is in tauri.conf.json (plugins.updater.pubkey).
 *
 * Automatic checks run at start-up and once a day (can be switched off in Settings); the
 * preference is stored per computer in localStorage.
 */
import { isTauri } from '../services/api';

export interface AvailableUpdate {
  version: string;
  currentVersion: string;
  notes: string;
  date?: string;
  /** Downloads, verifies and installs; `onProgress(downloaded, total)` while downloading. */
  install: (onProgress: (downloaded: number, total: number | null) => void) => Promise<void>;
}

const AUTO_KEY = 'remoteflow.updates.autoCheck';
const SKIP_KEY = 'remoteflow.updates.skipVersion';
export const UPDATE_EVENT = 'remoteflow-update-available';

export function autoCheckEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setAutoCheckEnabled(on: boolean): void {
  try {
    localStorage.setItem(AUTO_KEY, on ? 'true' : 'false');
  } catch {
    // ignore (storage unavailable)
  }
}

export function skippedVersion(): string | null {
  try {
    return localStorage.getItem(SKIP_KEY);
  } catch {
    return null;
  }
}

export function skipVersion(version: string | null): void {
  try {
    if (version) localStorage.setItem(SKIP_KEY, version);
    else localStorage.removeItem(SKIP_KEY);
  } catch {
    // ignore
  }
}

/** Checks GitHub Releases. Null = no newer version (or not running in the desktop app). */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauri()) return null;
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check({ timeout: 20_000 });
  if (!update) return null;
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body ?? '',
    date: update.date,
    install: async (onProgress) => {
      let downloaded = 0;
      let total: number | null = null;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? null;
          onProgress(0, total);
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          onProgress(downloaded, total);
        }
      });
      // Windows: the installer closes the application itself; elsewhere restart into the new version
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    },
  };
}

/** Shows the update notice (UpdateNotice) – used by the manual check in Settings. */
export function announceUpdate(update: AvailableUpdate): void {
  window.dispatchEvent(new CustomEvent<AvailableUpdate>(UPDATE_EVENT, { detail: update }));
}

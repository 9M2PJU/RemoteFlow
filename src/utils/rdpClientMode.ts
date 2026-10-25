import { useEffect, useState } from 'react';
import { api, DisplaySettingsInfo } from '../services/api';

/**
 * Linux: is the RDP session drawn by FreeRDP inside the window (setting + X11 + xfreerdp)?
 * The setting applies from the next start, so the value is read once per run.
 */
let cached: Promise<DisplaySettingsInfo | null> | null = null;

const load = () => {
  if (!cached) cached = api.getDisplaySettings().catch(() => null);
  return cached;
};

export function useEmbeddedFreeRdp(): boolean | null {
  const [value, setValue] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    load().then((info) => {
      if (alive) setValue(!!info && info.rdpFreerdpEmbedded && info.rdpEmbedAvailable);
    });
    return () => {
      alive = false;
    };
  }, []);
  return value;
}

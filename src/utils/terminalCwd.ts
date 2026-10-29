/**
 * Directory reported by the shell itself with the OSC 7 escape sequence
 * (`ESC ] 7 ; file://host/path BEL`, sent e.g. by fish, zsh/bash with VTE integration).
 * Fallback for "directory from the terminal" in SFTP when the server has no /proc.
 */
const oscCwd = new Map<string, string>();

export function rememberOscCwd(sessionId: string, data: string): void {
  const match = /^file:\/\/[^/]*(\/.*)$/.exec(data.trim());
  if (!match) return;
  try {
    oscCwd.set(sessionId, decodeURIComponent(match[1]));
  } catch {
    oscCwd.set(sessionId, match[1]);
  }
}

export function getOscCwd(sessionId: string): string | null {
  return oscCwd.get(sessionId) ?? null;
}

export function forgetOscCwd(sessionId: string): void {
  oscCwd.delete(sessionId);
}

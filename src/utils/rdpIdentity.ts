/**
 * Mirrors `normalize_rdp_identity` in src-tauri/src/session/rdp.rs – used only to preview
 * the effective RDP login in the connection dialog (the backend does the real normalisation).
 */
export const normalizeRdpIdentity = (username: string, domain?: string | null): { user: string; domain: string | null } => {
  let user = username.trim();
  let dom: string | null = domain?.trim() || null;
  const sep = user.indexOf('\\');
  if (sep >= 0) {
    dom = user.slice(0, sep).trim() || null;
    user = user.slice(sep + 1).trim();
  } else if (user.includes('@')) {
    dom = null; // UPN already identifies the domain
  }
  if (dom === '.') dom = null;
  dom = dom ? dom.replace(/[\\@]/g, '') || null : null;
  return { user, domain: dom };
};

export const rdpLoginLabel = (username: string, domain?: string | null): string => {
  const n = normalizeRdpIdentity(username, domain);
  if (!n.user) return '';
  return n.domain ? `${n.domain}\\${n.user}` : n.user;
};

import { Connection, Credential, SshAuthType } from '../types';

/**
 * SSH login method actually used – the same rule as `effective_ssh_auth_type` in the backend
 * (session/mod.rs): "agent" in the connection always wins, a connection with its own secret
 * uses its own method, otherwise a linked credential profile decides.
 */
export function effectiveSshAuthType(conn: Connection, credential?: Credential): SshAuthType {
  const ownSecret = Boolean(conn.passwordEncrypted || conn.privateKeyEncrypted || conn.keyFilePath?.trim());
  if (credential && conn.sshAuthType !== 'agent' && !ownSecret && credential.authType) return credential.authType;
  return conn.sshAuthType;
}

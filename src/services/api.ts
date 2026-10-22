import { invoke } from '@tauri-apps/api/core';
import { BackupEntry, BackupSettings, UiSettings, TransferSummary, SftpFileEntry, Connection, Credential, Group, ImportSummary, KnownHostEntry, SessionInfo, SftpListResponse, VaultData, VaultStatus } from '../types';

export const isTauri = () => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

/** True when the app runs on Windows (WebView2 user agent). */
export const isWindowsHost = () => {
  return typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);
};

// Fallback in-memory mock for web preview/testing
let mockUnlocked = false;
let mockUiSettings: UiSettings = { confirmCloseSessions: true, confirmAppExit: true };
let mockPinLocked = false;
let mockPinEnabled = true;
let mockInitialized = true;
let mockGroups: Group[] = [
  { id: 'group-prod', name: 'Produkcja (Linux/SSH)', parentId: null, icon: 'server', color: '#ef4444' },
  { id: 'group-rdp', name: 'Serwery Windows (RDP)', parentId: null, icon: 'monitor', color: '#3b82f6' },
  { id: 'group-tunnels', name: 'Tunele & SOCKS5 Proxy', parentId: null, icon: 'network', color: '#10b981' },
];

let mockConnections: Connection[] = [
  {
    id: 'conn-1',
    name: 'web-prod-01 (Nginx)',
    groupId: 'group-prod',
    protocol: 'ssh',
    host: '192.168.10.15',
    port: 22,
    username: 'admin',
    passwordEncrypted: 'mock-enc-pass',
    sshAuthType: 'key',
    portForwarding: [
      { id: 'pf-1', forwardType: 'local', localPort: 8080, remoteHost: 'localhost', remotePort: 80, enabled: true },
      { id: 'pf-2', forwardType: 'dynamic', localPort: 1080, enabled: true },
    ],
    tags: ['web', 'frontend', 'dmz'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'conn-2',
    name: 'db-cluster-master (PostgreSQL)',
    groupId: 'group-prod',
    protocol: 'ssh',
    host: '10.0.5.20',
    port: 2222,
    username: 'postgres',
    passwordEncrypted: 'mock-enc-db-pass',
    sshAuthType: 'password',
    portForwarding: [
      { id: 'pf-3', forwardType: 'local', localPort: 5433, remoteHost: 'localhost', remotePort: 5432, enabled: true }
    ],
    tags: ['database', 'cluster', 'critical'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'conn-3',
    name: 'srv-ad-dc01 (Active Directory)',
    groupId: 'group-rdp',
    protocol: 'rdp',
    host: '10.0.0.10',
    port: 3389,
    username: 'Administrator',
    passwordEncrypted: 'mock-enc-ad-pass',
    sshAuthType: 'password',
    portForwarding: [],
    rdpSettings: {
      width: 1920,
      height: 1080,
      colorDepth: 32,
      domain: 'CORP',
      sound: false,
      clipboard: true,
    },
    tags: ['windows', 'domain-controller'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'conn-4',
    name: 'bastion-gateway',
    groupId: 'group-tunnels',
    protocol: 'ssh',
    host: 'vpn.example.com',
    port: 22,
    username: 'jumpuser',
    passwordEncrypted: 'mock-enc-jump-pass',
    sshAuthType: 'certificate',
    portForwarding: [
      { id: 'pf-4', forwardType: 'dynamic', localPort: 9050, enabled: true }
    ],
    tags: ['gateway', 'proxy', 'socks5'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
];

let mockSessions: SessionInfo[] = [];
let mockCredentials: Credential[] = [];

/** mRemoteNG encryption parameters (+ optional custom master password) for the import. */
export interface MrngParams {
  password: string | null;
  encryptionEngine: string;
  blockCipherMode: string;
  kdfIterations: number;
}

export const api = {
  async getStatus(): Promise<VaultStatus> {
    if (isTauri()) {
      return await invoke<VaultStatus>('vault_get_status');
    }
    return {
      isInitialized: mockInitialized,
      isUnlocked: mockUnlocked,
      isPinLocked: mockPinLocked,
      pinEnabled: mockPinEnabled,
      autoLockScreen: true,
      autoLockTimeoutMins: 15,
      failedPinAttempts: 0,
      connectionsCount: mockConnections.length,
      groupsCount: mockGroups.length,
      credentialsCount: mockCredentials.length,
    };
  },

  async getVaultPath(): Promise<string> {
    if (isTauri()) {
      return await invoke<string>('vault_get_path');
    }
    return './vault.json';
  },

  async initVault(masterPassword: string): Promise<VaultStatus> {
    if (isTauri()) {
      return await invoke<VaultStatus>('vault_init', { masterPassword });
    }
    mockInitialized = true;
    mockUnlocked = true;
    mockPinLocked = false;
    return this.getStatus();
  },

  async unlockMaster(masterPassword: string, acceptModified: boolean = false): Promise<VaultStatus> {
    if (isTauri()) {
      return await invoke<VaultStatus>('vault_unlock_master', { masterPassword, acceptModified });
    }
    if (masterPassword === 'wrong') {
      throw new Error('Nieprawidłowe Master Password');
    }
    mockUnlocked = true;
    mockPinLocked = false;
    return this.getStatus();
  },

  async exitApp(): Promise<void> {
    if (isTauri()) {
      await invoke('app_exit');
    }
  },

  async maximizeWindow(): Promise<void> {
    if (isTauri()) {
      try {
        await invoke('app_maximize_window');
      } catch (e) {
        console.warn('Nie udało się zmaksymalizować okna:', e);
      }
    }
  },

  async changeMasterPassword(currentPassword: string, newPassword: string): Promise<VaultStatus> {
    if (isTauri()) {
      return await invoke<VaultStatus>('vault_change_master_password', { currentPassword, newPassword });
    }
    if (newPassword.length < 8) {
      throw new Error('Nowe Master Password musi mieć co najmniej 8 znaków');
    }
    mockPinEnabled = false;
    return this.getStatus();
  },

  async lockVault(): Promise<void> {
    if (isTauri()) {
      return await invoke<void>('vault_lock');
    }
    mockUnlocked = false;
    mockPinLocked = false;
  },

  async resetVault(): Promise<VaultStatus> {
    if (isTauri()) {
      return await invoke<VaultStatus>('vault_reset');
    }
    mockInitialized = false;
    mockUnlocked = false;
    mockPinLocked = false;
    mockConnections = [];
    return this.getStatus();
  },

  async lockToPin(): Promise<boolean> {
    if (isTauri()) {
      return await invoke<boolean>('vault_lock_to_pin');
    }
    if (mockPinEnabled) {
      mockUnlocked = false;
      mockPinLocked = true;
      return true;
    }
    mockUnlocked = false;
    return false;
  },

  async unlockPin(pin: string): Promise<VaultStatus> {
    if (isTauri()) {
      return await invoke<VaultStatus>('vault_unlock_pin', { pin });
    }
    if (pin === '1234') {
      mockUnlocked = true;
      mockPinLocked = false;
      return this.getStatus();
    }
    throw new Error('Nieprawidłowy PIN! Pozostało prób: 2');
  },

  async setPin(pin: string, enable: boolean): Promise<VaultStatus> {
    if (isTauri()) {
      return await invoke<VaultStatus>('vault_set_pin', { pin, enable });
    }
    mockPinEnabled = enable;
    return this.getStatus();
  },

  async updateSecuritySettings(autoLockScreen: boolean, autoLockTimeoutMins: number): Promise<void> {
    if (isTauri()) {
      return await invoke<void>('vault_update_security_settings', { autoLockScreen, autoLockTimeoutMins });
    }
  },

  async getVaultData(): Promise<VaultData> {
    if (isTauri()) {
      return await invoke<VaultData>('vault_get_data');
    }
    return {
      metadata: {
        version: 1,
        salt_base64: 'mock',
        canary_nonce_base64: 'mock',
        canary_ciphertext_base64: 'mock',
        pin_enabled: mockPinEnabled,
        auto_lock_screen: true,
        auto_lock_timeout_mins: 15,
        max_pin_attempts: 3,
      },
      groups: mockGroups,
      connections: mockConnections,
    };
  },

  async revealPassword(connectionId: string): Promise<string> {
    if (isTauri()) {
      return await invoke<string>('vault_reveal_password', { connectionId });
    }
    return 'SuperSecretP@ssw0rd2026!';
  },

  async saveConnection(
    connection: Connection,
    rawPassword?: string,
    rawPrivateKey?: string,
    rawPassphrase?: string
  ): Promise<Connection> {
    if (isTauri()) {
      return await invoke<Connection>('vault_save_connection', {
        connection,
        rawPassword: rawPassword || null,
        rawPrivateKey: rawPrivateKey || null,
        rawPassphrase: rawPassphrase || null,
      });
    }
    const idx = mockConnections.findIndex(c => c.id === connection.id);
    if (idx >= 0) {
      mockConnections[idx] = connection;
    } else {
      mockConnections.push(connection);
    }
    return connection;
  },

  async deleteConnection(connectionId: string): Promise<void> {
    if (isTauri()) {
      return await invoke<void>('vault_delete_connection', { connectionId });
    }
    mockConnections = mockConnections.filter(c => c.id !== connectionId);
  },

  async saveGroup(group: Group): Promise<Group> {
    if (isTauri()) {
      return await invoke<Group>('vault_save_group', { group });
    }
    const idx = mockGroups.findIndex(g => g.id === group.id);
    if (idx >= 0) {
      mockGroups[idx] = group;
    } else {
      mockGroups.push(group);
    }
    return group;
  },

  async deleteGroup(groupId: string): Promise<void> {
    if (isTauri()) {
      return await invoke<void>('vault_delete_group', { groupId });
    }
    mockGroups = mockGroups.filter(g => g.id !== groupId);
    mockConnections = mockConnections.map(c => c.groupId === groupId ? { ...c, groupId: null } : c);
  },

  async listSessions(): Promise<SessionInfo[]> {
    if (isTauri()) {
      return await invoke<SessionInfo[]>('session_list');
    }
    return mockSessions;
  },

  async connectSession(
    sessionId: string | null | undefined,
    connectionId: string,
    title: string,
    protocol: 'ssh' | 'rdp',
    host: string,
    port: number,
    username: string,
    portForwardsDesc: string[],
    customPassphrase?: string
  ): Promise<SessionInfo> {
    if (isTauri()) {
      return await invoke<SessionInfo>('session_connect', {
        sessionId: sessionId || null,
        connectionId,
        title,
        protocol,
        host,
        port,
        username,
        portForwardsDesc,
        customPassphrase: customPassphrase || null,
      });
    }
    const sess: SessionInfo = {
      sessionId: sessionId || 'sess-' + Math.random().toString(36).substring(2, 9),
      connectionId,
      title,
      protocol,
      host,
      port,
      username,
      status: 'connected',
      statusMessage: 'Połączono pomyślnie',
      bytesSent: 1024,
      bytesReceived: 4096,
      startedAt: new Date().toISOString(),
      activePortForwards: portForwardsDesc,
    };
    mockSessions.push(sess);
    return sess;
  },

  async sendInput(sessionId: string, data: string): Promise<void> {
    if (isTauri()) {
      return await invoke<void>('session_send_input', { sessionId, data });
    }
  },

  async closeSession(sessionId: string): Promise<void> {
    if (isTauri()) {
      return await invoke<void>('session_close', { sessionId });
    }
    mockSessions = mockSessions.filter(s => s.sessionId !== sessionId);
  },

  async launchExternalRdp(session: SessionInfo): Promise<void> {
    if (isTauri()) {
      return await invoke<void>('session_launch_external_rdp', {
        sessionId: session.sessionId,
        connectionId: session.connectionId,
        title: session.title,
        host: session.host,
        port: session.port,
        username: session.username,
      });
    }
  },

  async exportVault(exportPassword?: string, allowPlaintext: boolean = false): Promise<string> {
    if (isTauri()) {
      return await invoke<string>('vault_export', {
        exportPassword: exportPassword || null,
        allowPlaintext,
      });
    }
    // Mock export
    const payload = {
      format: 'remoteflow_export',
      version: 1,
      isEncrypted: !!exportPassword,
      groups: mockGroups,
      connections: mockConnections,
      exportedAt: new Date().toISOString(),
    };
    return JSON.stringify(payload, null, 2);
  },

  async importVault(payloadJson: string, importPassword?: string, merge: boolean = true): Promise<ImportSummary> {
    if (isTauri()) {
      return await invoke<ImportSummary>('vault_import', {
        payloadJson,
        importPassword: importPassword || null,
        merge,
      });
    }
    // Mock import
    const data = JSON.parse(payloadJson);
    const groups: Group[] = data.groups || [];
    const conns: Connection[] = data.connections || [];
    if (merge) {
      mockGroups = [...mockGroups, ...groups.filter(g => !mockGroups.some(mg => mg.id === g.id))];
      mockConnections = [...mockConnections, ...conns.filter(c => !mockConnections.some(mc => mc.id === c.id))];
    } else {
      mockGroups = groups;
      mockConnections = conns;
    }
    return {
      groupsImported: groups.length,
      connectionsImported: conns.length,
    };
  },

  async batchImport(
    groups: Group[],
    connections: Connection[],
    merge: boolean = true,
    mremoteng: MrngParams | null = null
  ): Promise<ImportSummary> {
    if (isTauri()) {
      return await invoke<ImportSummary>('vault_batch_import', {
        groups,
        connections,
        merge,
        mremoteng,
      });
    }
    if (merge) {
      mockGroups = [...mockGroups, ...groups.filter(g => !mockGroups.some(mg => mg.id === g.id))];
      mockConnections = [...mockConnections, ...connections.filter(c => !mockConnections.some(mc => mc.id === c.id))];
    } else {
      mockGroups = groups;
      mockConnections = connections;
    }
    return {
      groupsImported: groups.length,
      connectionsImported: connections.length,
    };
  },

  async getCredentials(): Promise<Credential[]> {
    if (isTauri()) {
      return await invoke<Credential[]>('vault_get_credentials');
    }
    return mockCredentials;
  },

  async saveCredential(
    credential: Credential,
    rawPassword?: string,
    rawKey?: string,
    rawPassphrase?: string
  ): Promise<Credential> {
    if (isTauri()) {
      return await invoke<Credential>('vault_save_credential', {
        credential,
        rawPassword: rawPassword || null,
        rawPrivateKey: rawKey || null,
        rawPassphrase: rawPassphrase || null,
      });
    }
    const idx = mockCredentials.findIndex(c => c.id === credential.id);
    if (idx >= 0) {
      mockCredentials[idx] = credential;
    } else {
      mockCredentials.push(credential);
    }
    return credential;
  },

  async deleteCredential(credentialId: string): Promise<void> {
    if (isTauri()) {
      return await invoke<void>('vault_delete_credential', { credentialId });
    }
    mockCredentials = mockCredentials.filter(c => c.id !== credentialId);
  },

  async revealCredentialPassword(credentialId: string): Promise<string> {
    if (isTauri()) {
      return await invoke<string>('vault_reveal_credential_password', { credentialId });
    }
    return 'MockSecretPassword!';
  },

  async getUiSettings(): Promise<UiSettings> {
    if (isTauri()) {
      return await invoke<UiSettings>('vault_get_ui_settings');
    }
    return { ...mockUiSettings };
  },

  async setUiSettings(settings: UiSettings): Promise<void> {
    if (isTauri()) {
      await invoke<void>('vault_set_ui_settings', { settings });
    } else {
      mockUiSettings = { ...settings };
    }
  },

  async getBackupSettings(): Promise<BackupSettings> {
    if (isTauri()) {
      return await invoke<BackupSettings>('vault_get_backup_settings');
    }
    return { enabled: true, intervalHours: 24, keep: 10, dir: null };
  },

  async setBackupSettings(settings: BackupSettings): Promise<void> {
    if (isTauri()) {
      await invoke<void>('vault_set_backup_settings', { settings: { ...settings, dir: settings.dir || null } });
    }
  },

  async backupNow(): Promise<string> {
    if (isTauri()) {
      return await invoke<string>('vault_backup_now');
    }
    return './backups/vault-mock.json';
  },

  async listBackups(): Promise<BackupEntry[]> {
    if (isTauri()) {
      return await invoke<BackupEntry[]>('vault_list_backups');
    }
    return [];
  },

  async restoreBackup(name: string): Promise<VaultStatus> {
    if (isTauri()) {
      return await invoke<VaultStatus>('vault_restore_backup', { name });
    }
    return this.getStatus();
  },

  /** Windows clipboard sequence number (changes on every copy); null on other systems. */
  async clipboardSequence(): Promise<number | null> {
    if (!isTauri()) return null;
    try {
      return await invoke<number | null>('clipboard_sequence');
    } catch {
      return null;
    }
  },

  // --- RDP remote -> local file clipboard (Windows) ---------------------------------------------
  async rdpClipStageBegin(): Promise<string> {
    return await invoke<string>('rdp_clip_stage_begin');
  },

  async rdpClipStageDir(stageDir: string, relPath: string): Promise<void> {
    await invoke<void>('rdp_clip_stage_dir', { stageDir, relPath });
  },

  /** Sends raw file bytes (no base64) to the staging directory. */
  async rdpClipStageFile(stageDir: string, relPath: string, data: Uint8Array): Promise<void> {
    await invoke<void>('rdp_clip_stage_file', data, {
      headers: {
        'x-stage-dir': encodeURIComponent(stageDir),
        'x-rel-path': encodeURIComponent(relPath),
      },
    });
  },

  /** Places the staged top-level entries on the local Windows clipboard (CF_HDROP). */
  async rdpClipStageCommit(stageDir: string, topLevel: string[]): Promise<string[]> {
    return await invoke<string[]>('rdp_clip_stage_commit', { stageDir, topLevel });
  },

  /**
   * Verifies the mRemoteNG master password (Protected marker). For files saved with
   * "full file encryption" returns the decrypted inner XML.
   */
  async mremotengUnlock(params: MrngParams, protectedMarker: string | null, fullFileData: string | null): Promise<string | null> {
    if (!isTauri()) return null;
    return await invoke<string | null>('mremoteng_unlock', {
      params,
      protected: protectedMarker,
      fullFileData,
    });
  },

  /** Reports user activity to the backend inactivity auto-lock. */
  async touchActivity(): Promise<void> {
    if (isTauri()) {
      await invoke<void>('vault_touch_activity');
    }
  },

  async listKnownHosts(): Promise<KnownHostEntry[]> {
    if (isTauri()) {
      return await invoke<KnownHostEntry[]>('vault_list_known_hosts');
    }
    return [];
  },

  async forgetKnownHost(id: string): Promise<void> {
    if (isTauri()) {
      await invoke<void>('vault_forget_known_host', { id });
    }
  },

  async resizeSession(sessionId: string, cols: number, rows: number): Promise<void> {
    if (isTauri()) {
      return await invoke<void>('session_resize', { sessionId, cols, rows });
    }
  },

  // --- Two-pane SFTP manager -------------------------------------------------------------------
  async sftpMkdir(connectionId: string, parent: string, name: string): Promise<string> {
    return await invoke<string>('sftp_mkdir', { connectionId, parent, name });
  },

  async sftpDeletePaths(connectionId: string, remotePaths: string[]): Promise<number> {
    return await invoke<number>('sftp_delete_paths', { connectionId, remotePaths });
  },

  async sftpSearch(connectionId: string, remoteDir: string, query: string): Promise<SftpFileEntry[]> {
    return await invoke<SftpFileEntry[]>('sftp_search', { connectionId, remoteDir, query });
  },

  async sftpTransferUpload(connectionId: string, localPaths: string[], remoteDir: string, transferId: string): Promise<TransferSummary> {
    return await invoke<TransferSummary>('sftp_transfer_upload', { connectionId, localPaths, remoteDir, transferId });
  },

  async sftpTransferDownload(connectionId: string, remotePaths: string[], localDir: string, transferId: string): Promise<TransferSummary> {
    return await invoke<TransferSummary>('sftp_transfer_download', { connectionId, remotePaths, localDir, transferId });
  },

  async sftpRelease(connectionId: string): Promise<void> {
    if (isTauri()) await invoke<void>('sftp_release', { connectionId });
  },

  async localMkdir(parent: string, name: string): Promise<string> {
    return await invoke<string>('local_mkdir', { parent, name });
  },

  async localSearch(localDir: string, query: string): Promise<SftpFileEntry[]> {
    return await invoke<SftpFileEntry[]>('local_search', { localDir, query });
  },

  async sftpList(connectionId: string, remotePath: string = ''): Promise<SftpListResponse> {
    if (isTauri()) {
      return await invoke<SftpListResponse>('sftp_list', { connectionId, remotePath });
    }
    return {
      currentPath: remotePath || '/home/user',
      entries: [
        { name: 'app', path: '/home/user/app', isDir: true, size: 4096, modified: Date.now() - 3600000, permissions: 16877 },
        { name: 'backup', path: '/home/user/backup', isDir: true, size: 4096, modified: Date.now() - 7200000, permissions: 16877 },
        { name: 'config.json', path: '/home/user/config.json', isDir: false, size: 1420, modified: Date.now() - 600000, permissions: 33188 },
        { name: 'server.log', path: '/home/user/server.log', isDir: false, size: 52428, modified: Date.now() - 120000, permissions: 33188 },
      ],
    };
  },

  async sftpUploadFile(connectionId: string, remoteDir: string, filename: string, contentBase64: string): Promise<number> {
    if (isTauri()) {
      return await invoke<number>('sftp_upload_file', { connectionId, remoteDir, filename, contentBase64 });
    }
    return 1024;
  },

  async sftpUploadPaths(connectionId: string, remoteDir: string, localPaths: string[]): Promise<number> {
    if (isTauri()) {
      return await invoke<number>('sftp_upload_paths', { connectionId, remoteDir, localPaths });
    }
    return localPaths.length;
  },

  async openSharedFolder(targetDir?: string): Promise<string> {
    if (isTauri()) {
      return await invoke<string>('open_shared_folder', { targetDir: targetDir || null });
    }
    return targetDir || '~/Downloads';
  },

  async saveDroppedFileToShared(
    filename: string,
    contentBase64: string,
    targetDir?: string
  ): Promise<string> {
    if (isTauri()) {
      return await invoke<string>('save_dropped_file_to_shared', {
        filename,
        contentBase64,
        targetDir: targetDir || null,
      });
    }
    return `${targetDir || '~/Downloads'}/${filename}`;
  },

  async clipboardReadText(): Promise<string> {
    if (isTauri()) {
      try {
        const text = await invoke<string>('clipboard_read_text');
        if (text) return text;
      } catch {
        // Fallback to browser clipboard
      }
    }
    try {
      return await navigator.clipboard.readText();
    } catch {
      return '';
    }
  },

  async clipboardWriteText(text: string): Promise<void> {
    if (isTauri()) {
      try {
        await invoke<void>('clipboard_write_text', { text });
      } catch (e) {
        console.warn('clipboard_write_text error:', e);
      }
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Ignore browser permission error if native GTK clipboard succeeded
    }
  },

  async clipboardReadFiles(): Promise<string[]> {
    if (isTauri()) {
      try {
        return await invoke<string[]>('clipboard_read_files');
      } catch {
        return [];
      }
    }
    return [];
  },

  async localListDir(localPath: string = ''): Promise<SftpListResponse> {
    if (isTauri()) {
      return await invoke<SftpListResponse>('local_list_dir', { localPath });
    }
    return {
      currentPath: localPath || '/home/user',
      entries: [
        { name: 'Desktop', path: '/home/user/Desktop', isDir: true, size: 4096, modified: Date.now() / 1000, permissions: 0o755 },
        { name: 'Downloads', path: '/home/user/Downloads', isDir: true, size: 4096, modified: Date.now() / 1000, permissions: 0o755 },
        { name: 'Documents', path: '/home/user/Documents', isDir: true, size: 4096, modified: Date.now() / 1000, permissions: 0o755 },
      ],
    };
  },

  async pickLocalFolder(): Promise<string | null> {
    if (isTauri()) {
      return await invoke<string | null>('pick_local_folder');
    }
    return null;
  },

  /** Native file dialog; the backend reads ONLY the file chosen there (and only if it is a private key). */
  async pickPrivateKeyFile(title?: string): Promise<{ path: string; content: string } | null> {
    if (isTauri()) {
      return await invoke<{ path: string; content: string } | null>('pick_private_key_file', { title: title || null });
    }
    return null;
  },

  async readLocalPathsForRdpClipboard(localPaths: string[]): Promise<import('../types').RdpClipboardFileEntry[]> {
    if (isTauri()) {
      return await invoke<import('../types').RdpClipboardFileEntry[]>('read_local_paths_for_rdp_clipboard', { localPaths });
    }
    return [];
  },

  async getGlobalDownloadDir(): Promise<string | null> {
    if (isTauri()) {
      try {
        return await invoke<string | null>('vault_get_global_download_dir');
      } catch {
        return null;
      }
    }
    return null;
  },

  async setGlobalDownloadDir(dir: string | null): Promise<void> {
    if (isTauri()) {
      await invoke<void>('vault_set_global_download_dir', { dir: dir || null });
    }
  },

  async setConnectionDownloadDir(connectionId: string, dir: string | null): Promise<void> {
    if (isTauri()) {
      await invoke<void>('vault_set_connection_download_dir', { connectionId, dir: dir || null });
    }
  }
};


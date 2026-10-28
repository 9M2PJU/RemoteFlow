import { t } from '../i18n';
import { Connection, Group, ProtocolType } from '../types';

export interface MRemoteNGParseResult {
  groups: Group[];
  connections: Connection[];
  totalParsed: number;
  /** Connections with protocols RemoteFlow does not support (VNC, Telnet, HTTP, ...) – not imported. */
  skipped: { name: string; protocol: string }[];
}

/** Encryption settings stored on the root <Connections> element of confCons.xml. */
export interface MRemoteNGEncryption {
  encryptionEngine: string; // "AES" (empty in very old files)
  blockCipherMode: string; // "GCM" (empty = legacy AES-CBC)
  kdfIterations: number; // PBKDF2 iterations (mRemoteNG default 1000 when absent)
  protected: string | null; // encrypted marker used to verify the master password
  fullFileEncryption: boolean;
  encryptedPayload: string | null; // root text when the whole file is encrypted
}

/** Reads the encryption parameters of a confCons.xml file. */
export function readMRemoteNGEncryption(xmlString: string): MRemoteNGEncryption {
  const xmlDoc = new DOMParser().parseFromString(xmlString, 'text/xml');
  if (xmlDoc.querySelector('parsererror')) {
    throw new Error('Plik nie jest poprawnym plikiem XML mRemoteNG');
  }
  const root = xmlDoc.documentElement;
  const fullFileEncryption = (root.getAttribute('FullFileEncryption') || '').toLowerCase() === 'true';
  return {
    encryptionEngine: root.getAttribute('EncryptionEngine') || '',
    blockCipherMode: root.getAttribute('BlockCipherMode') || '',
    kdfIterations: parseInt(root.getAttribute('KdfIterations') || '1000', 10) || 1000,
    protected: root.getAttribute('Protected'),
    fullFileEncryption,
    encryptedPayload: fullFileEncryption ? (root.textContent || '').trim() : null,
  };
}

export function parseMRemoteNGXml(xmlString: string): MRemoteNGParseResult {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

  const parserError = xmlDoc.querySelector('parsererror');
  if (parserError) {
    throw new Error(t('Błąd parsowania pliku XML mRemoteNG: ') + parserError.textContent);
  }

  const groups: Group[] = [];
  const connections: Connection[] = [];
  const skipped: { name: string; protocol: string }[] = [];

  // Traverse nodes recursively
  function traverseNode(node: Element, parentGroupId: string | null, parentPath: string[]) {
    // Check if node is a <Node> element
    if (node.tagName.toLowerCase() === 'node') {
      const type = (node.getAttribute('Type') || '').toLowerCase();
      const name = node.getAttribute('Name') || 'Nienazwany';
      const hostname = node.getAttribute('Hostname') || '';
      const isContainer = type === 'container' || (!hostname && node.querySelectorAll(':scope > Node').length > 0);

      if (isContainer) {
        const groupId = 'group-mrng-' + Math.random().toString(36).substring(2, 9);
        const group: Group = {
          id: groupId,
          name: name.trim(),
          parentId: parentGroupId,
          icon: 'folder',
          color: '#3b82f6',
        };
        groups.push(group);

        const currentPath = [...parentPath, name.trim()];
        const children = node.querySelectorAll(':scope > Node');
        children.forEach((child) => traverseNode(child, groupId, currentPath));
        return;
      }

      // It's a Connection
      const rawProtocol = (node.getAttribute('Protocol') || 'SSH2').toUpperCase();
      let protocol: ProtocolType = 'ssh';
      let defaultPort = 22;

      if (rawProtocol.includes('RDP')) {
        protocol = 'rdp';
        defaultPort = 3389;
      } else if (rawProtocol.includes('SSH')) {
        protocol = 'ssh';
        defaultPort = 22;
      } else {
        // VNC, Telnet, Rlogin, RAW, HTTP(S), ICA, PowerShell... are not supported. Importing them
        // as SSH/RDP would only produce connections that fail with confusing errors.
        skipped.push({ name: name.trim(), protocol: rawProtocol });
        const children = node.querySelectorAll(':scope > Node');
        children.forEach((child) => traverseNode(child, parentGroupId, parentPath));
        return;
      }

      const portAttr = node.getAttribute('Port');
      const port = portAttr ? parseInt(portAttr, 10) || defaultPort : defaultPort;
      const username = node.getAttribute('Username') || 'root';
      const rawPassword = node.getAttribute('Password') || '';
      const domain = node.getAttribute('Domain') || undefined;
      const description = node.getAttribute('Description') || node.getAttribute('UserField') || undefined;

      const connId = 'conn-mrng-' + Math.random().toString(36).substring(2, 9);
      const tags = ['mRemoteNG', ...parentPath];

      const connection: Connection = {
        id: connId,
        name: name.trim(),
        groupId: parentGroupId,
        protocol,
        host: hostname.trim() || '127.0.0.1',
        port,
        username: username.trim(),
        // Still mRemoteNG ciphertext – decrypted in the Rust backend during import.
        passwordEncrypted: rawPassword ? rawPassword : undefined,
        // Without a stored password mRemoteNG used PuTTY/Pageant keys – RemoteFlow uses the SSH agent
        sshAuthType: protocol === 'ssh' && !rawPassword ? 'agent' : 'password',
        portForwarding: [],
        rdpSettings: protocol === 'rdp' ? {
          width: 1920,
          height: 1080,
          colorDepth: 32,
          domain: domain?.trim() || undefined,
          sound: true,
          clipboard: true,
        } : undefined,
        tags,
        notes: description ? `Zaimportowano z mRemoteNG.\n${description}` : 'Zaimportowano z mRemoteNG',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      connections.push(connection);

      // In case there are sub-nodes under connection
      const children = node.querySelectorAll(':scope > Node');
      children.forEach((child) => traverseNode(child, parentGroupId, parentPath));
      return;
    }

    // Process all children of the root element (e.g. <Connections>)
    Array.from(node.children).forEach((child) => {
      traverseNode(child, parentGroupId, parentPath);
    });
  }

  const root = xmlDoc.documentElement;
  traverseNode(root, null, []);

  return {
    groups,
    connections,
    totalParsed: connections.length,
    skipped,
  };
}

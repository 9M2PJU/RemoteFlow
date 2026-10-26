import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { api, isTauri, RdpCertificateInfo } from '../../services/api';
import { SessionInfo } from '../../types';
import { useT } from '../../i18n';
import { ConfirmDialog } from './ConfirmDialog';

interface CertificateFailure { sessionId: string; connectionId: string; embedded: boolean }

function hexFingerprint(fingerprint: string): string {
  try {
    return Array.from(atob(fingerprint.replace(/^SHA256:/, '')), (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(':');
  } catch { return fingerprint; }
}

export function RdpCertificateDialog({ sessions, unlocked }: { sessions: SessionInfo[]; unlocked: boolean }) {
  const t = useT();
  const [failure, setFailure] = useState<CertificateFailure | null>(null);
  const [certificate, setCertificate] = useState<RdpCertificateInfo | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    if (!isTauri() || !unlocked) { setFailure(null); return; }
    const unlisten = listen<CertificateFailure>('rdp-certificate-error', (event) => {
      setFailure(event.payload);
    });
    return () => { unlisten.then((un) => un()); };
  }, [unlocked]);

  useEffect(() => {
    const current = ++generation.current;
    setCertificate(null);
    setError('');
    setBusy(false);
    if (!failure) return;
    setBusy(true);
    api.previewRdpCertificate(failure.connectionId).then((info) => {
      if (current === generation.current) setCertificate(info);
    }).catch((err) => {
      if (current === generation.current) setError(String(err));
    }).finally(() => {
      if (current === generation.current) setBusy(false);
    });
    return () => { generation.current++; };
  }, [failure]);

  const accept = async () => {
    if (busy) return;
    if (!certificate || !failure) { setFailure(null); return; }
    const current = generation.current;
    setBusy(true);
    try {
      await api.trustRdpCertificate(certificate);
      if (current !== generation.current) return;
      if (failure.embedded) {
        window.dispatchEvent(new CustomEvent('remoteflow-rdp-certificate-trusted', { detail: failure.sessionId }));
      } else {
        const session = sessions.find((s) => s.sessionId === failure.sessionId);
        if (session) await api.launchExternalRdp(session);
      }
      setFailure(null);
    } catch (err) {
      if (current === generation.current) setError(String(err));
    } finally {
      if (current === generation.current) setBusy(false);
    }
  };

  return <ConfirmDialog
    isOpen={!!failure && unlocked}
    title={t('Certyfikat serwera RDP nie jest zaufany')}
    message={<div className="space-y-3">
      <p>{t('Certyfikat serwera nie zgadza się z zapamiętanym lub nie przeszedł weryfikacji. Potwierdź nowy odcisk u administratora przed zaakceptowaniem zmiany.')}</p>
      {busy && <p>{t('Sprawdzanie certyfikatu...')}</p>}
      {certificate && <div className="select-text break-all font-mono text-xs">
        <p>{certificate.host}:{certificate.port}</p>
        {certificate.previousFingerprint && <p>{t('Zapamiętany odcisk:')} {hexFingerprint(certificate.previousFingerprint)}</p>}
        <p>{t('Aktualny odcisk:')} SHA-256 {hexFingerprint(certificate.fingerprint)}</p>
      </div>}
      {error && <p className="select-text break-words text-red-400">{error}</p>}
    </div>}
    confirmLabel={busy ? t('Proszę czekać...') : certificate ? t('Zaufaj certyfikatowi i połącz ponownie') : t('Zamknij')}
    onConfirm={() => { void accept(); }}
    onCancel={() => setFailure(null)}
  />;
}

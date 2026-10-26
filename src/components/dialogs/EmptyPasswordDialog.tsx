import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { api } from '../../services/api';
import { Connection } from '../../types';
import { useT } from '../../i18n';
import { PasswordDecision, PasswordPromptRequest, registerPasswordPrompt } from '../../utils/passwordPrompt';

export function EmptyPasswordDialog({ unlocked, onSaved }: { unlocked: boolean; onSaved: (connection: Connection) => void }) {
  const t = useT();
  const pending = useRef<PasswordPromptRequest[]>([]);
  const [queue, setQueue] = useState<PasswordPromptRequest[]>([]);
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const unlockedRef = useRef(unlocked);
  unlockedRef.current = unlocked;
  const current = queue[0];

  useEffect(() => {
    const unregister = registerPasswordPrompt((request) => {
      if (!unlockedRef.current) { request.resolve('cancel'); return; }
      pending.current = [...pending.current, request];
      setQueue(pending.current);
    });
    return () => {
      unregister();
      for (const request of pending.current) request.resolve('cancel');
      pending.current = [];
    };
  }, []);

  useEffect(() => {
    if (unlocked) return;
    for (const request of pending.current) request.resolve('cancel');
    pending.current = [];
    setQueue([]);
  }, [unlocked]);

  useEffect(() => {
    setPassword(''); setVisible(false); setError(''); setBusy(false);
    if (current) input.current?.focus();
  }, [current]);

  const finish = (request: PasswordPromptRequest, decision: PasswordDecision) => {
    if (!pending.current.includes(request)) return;
    pending.current = pending.current.filter((item) => item !== request);
    setQueue(pending.current);
    setPassword('');
    request.resolve(decision);
  };

  if (!unlocked || !current) return null;

  const save = async () => {
    if (busy || password.length === 0) return;
    const request = current;
    setBusy(true); setError('');
    try {
      const saved = await api.setConnectionPassword(request.status.connectionId, password);
      if (!pending.current.includes(request)) return;
      onSaved(saved);
      finish(request, 'saved');
    } catch (err) {
      if (pending.current.includes(request)) setError(String(err));
    } finally {
      if (pending.current.includes(request)) setBusy(false);
    }
  };

  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs">
    <form role="dialog" aria-modal="true" aria-labelledby="empty-password-title"
      className="w-full max-w-lg space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-6 text-slate-200 shadow-2xl"
      onSubmit={(event) => { event.preventDefault(); void save(); }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) { event.preventDefault(); event.stopPropagation(); finish(current, 'cancel'); }
      }}>
      <h2 id="empty-password-title" className="flex items-center gap-2 text-base font-semibold text-white">
        <KeyRound className="h-5 w-5 text-amber-400" />{t('Hasło połączenia jest puste')}
      </h2>
      <p className="text-sm">{t('Dla tego połączenia nie zapisano hasła. Czy chcesz spróbować logowania bez hasła, czy wprowadzić i zapisać nowe hasło?')}</p>
      <p className="break-all text-xs text-slate-400">{current.status.name} · {current.status.host}:{current.status.port}</p>
      <label className="block text-sm" htmlFor="connection-missing-password">{t('Nowe hasło dla tego połączenia')}</label>
      <div className="relative">
        <input id="connection-missing-password" ref={input} type={visible ? 'text' : 'password'} value={password}
          autoComplete="new-password" disabled={busy} onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 pr-12 text-white focus:border-cyan-500 focus:outline-hidden" />
        <button type="button" onClick={() => setVisible((value) => !value)}
          aria-label={visible ? t('Ukryj hasło') : t('Pokaż hasło')}
          className="absolute right-3 top-2.5 text-slate-400">{visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
      </div>
      <p className="text-xs text-slate-400">{t('Hasło zostanie zaszyfrowane i zapisane tylko dla tego połączenia. Wspólny profil poświadczeń nie zostanie zmieniony.')}</p>
      {error && <p role="alert" className="break-words text-sm text-red-400">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-800 pt-4 text-xs">
        <button type="button" disabled={busy} onClick={() => finish(current, 'cancel')}
          className="rounded-xl border border-slate-700 px-3 py-2 disabled:opacity-50">{t('Anuluj')}</button>
        <button type="button" disabled={busy} onClick={() => finish(current, 'empty')}
          className="rounded-xl border border-amber-600 px-3 py-2 text-amber-200 disabled:opacity-50">{t('Spróbuj bez hasła')}</button>
        <button type="submit" disabled={busy || password.length === 0}
          className="rounded-xl bg-cyan-600 px-3 py-2 font-semibold text-white disabled:opacity-50">
          {busy ? t('Zapisywanie...') : t('Zapisz hasło i połącz')}
        </button>
      </div>
    </form>
  </div>;
}

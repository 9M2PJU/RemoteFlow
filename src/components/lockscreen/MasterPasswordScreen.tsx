import React, { useState } from 'react';
import { Shield, KeyRound, Lock, ArrowRight, Loader2, Cpu, AlertTriangle, RotateCcw } from 'lucide-react';
import { APP_VERSION } from '../../version';
import { api } from '../../services/api';
import { VaultStatus } from '../../types';

interface Props {
  status: VaultStatus;
  onUnlocked: (status: VaultStatus) => void;
  onReset?: () => void;
}

export const MasterPasswordScreen: React.FC<Props> = ({ status, onUnlocked, onReset }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  // Vault file failed its HMAC integrity check (modified outside the app)
  const [integrityFailed, setIntegrityFailed] = useState(false);

  const isFirstTime = !status.isInitialized;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!password) {
      setError('Wprowadź Master Password');
      return;
    }

    if (isFirstTime) {
      if (password.length < 8) {
        setError('Master Password musi mieć co najmniej 8 znaków');
        return;
      }
      if (password !== confirmPassword) {
        setError('Hasła nie są identyczne');
        return;
      }
    }

    setLoading(true);
    try {
      let updatedStatus: VaultStatus;
      if (isFirstTime) {
        updatedStatus = await api.initVault(password);
      } else {
        updatedStatus = await api.unlockMaster(password);
      }
      await api.maximizeWindow();
      onUnlocked(updatedStatus);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('VAULT_INTEGRITY_FAILED')) {
        setIntegrityFailed(true);
        setError(msg.replace(/^VAULT_INTEGRITY_FAILED:\s*/, ''));
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/90 p-8 shadow-2xl backdrop-blur-xl">
        {/* Logo / Header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/20">
            <Shield className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            RemoteFlow
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Multiplatformowy menedżer SSH & RDP
          </p>
          <p className="mt-1 font-mono text-[11px] text-slate-500">wersja {APP_VERSION}</p>
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-slate-700/60 bg-slate-800/60 px-3 py-1 text-xs text-slate-300">
            <Cpu className="h-3.5 w-3.5 text-cyan-400" />
            Argon2id + AES-256-GCM Szyfrowanie
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-slate-400">
              {isFirstTime ? 'Utwórz Master Password' : 'Podaj Master Password'}
            </label>
            <div className="relative mt-2">
              <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isFirstTime ? 'Silne hasło główne...' : 'Wpisz hasło główne...'}
                autoFocus
                className="w-full rounded-xl border border-slate-700 bg-slate-800/80 py-3 pl-11 pr-4 text-sm text-white placeholder-slate-500 transition-colors focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>
          </div>

          {isFirstTime && (
            <div>
              <label className="block text-xs font-medium uppercase tracking-wider text-slate-400">
                Powtórz Master Password
              </label>
              <div className="relative mt-2">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Wpisz ponownie hasło..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-800/80 py-3 pl-11 pr-4 text-sm text-white placeholder-slate-500 transition-colors focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
              {error}
            </div>
          )}

          {integrityFailed && !isFirstTime && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 space-y-2">
              <p>
                Jeśli to Ty edytowałeś plik <code>vault.json</code> (lub przywróciłeś go z innej kopii), możesz
                zaakceptować zmiany. Kod PIN, automatyczna blokada i lista zaufanych hostów zostaną przywrócone do
                ustawień domyślnych. Jeśli nie wiesz, skąd zmiana – nie kontynuuj.
              </p>
              <button
                type="button"
                disabled={loading || !password}
                onClick={async () => {
                  setLoading(true);
                  setError(null);
                  try {
                    const updatedStatus = await api.unlockMaster(password, true);
                    setIntegrityFailed(false);
                    await api.maximizeWindow();
                    onUnlocked(updatedStatus);
                  } catch (err: unknown) {
                    setError(err instanceof Error ? err.message : String(err));
                  } finally {
                    setLoading(false);
                  }
                }}
                className="rounded-lg border border-amber-500/50 px-3 py-1.5 font-semibold text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
              >
                Akceptuję zmiany – otwórz sejf
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-500/25 transition-all hover:opacity-95 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Derwacja klucza Argon2id...
              </>
            ) : isFirstTime ? (
              <>
                Utwórz i zainicjalizuj sejf
                <ArrowRight className="h-4 w-4" />
              </>
            ) : (
              <>
                Odblokuj sejf
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </form>

        {/* Forgot password / Reset Vault option */}
        {!isFirstTime && (
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => setShowResetConfirm(true)}
              className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-amber-400 transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              Zapomniałeś hasła? Zresetuj sejf
            </button>
          </div>
        )}

        <div className="mt-6 border-t border-slate-800/80 pt-4 text-center text-xs text-slate-500">
          Wszystkie dane logowania, klucze SSH i tunele są szyfrowane lokalnie.
        </div>

        {/* Reset Confirmation Modal */}
        {showResetConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4">
            <div className="w-full max-w-sm rounded-2xl border border-red-500/30 bg-slate-900 p-6 shadow-2xl text-left">
              <div className="flex items-center gap-2.5 text-red-400 font-bold text-sm mb-2">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                Zresetować bazę i postawić sejf od nowa?
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Ze względów bezpieczeństwa (szyfrowanie <strong>Argon2id + AES-256-GCM</strong>) bez znajomości Master Password nie ma możliwości odzyskania zapisanych haseł.
              </p>
              <div className="my-3 rounded-lg bg-slate-950 border border-slate-800 p-2.5 text-[11px] text-slate-400">
                Aplikacja utworzy automatyczną kopię obecnego pliku jako <code>vault.json.bak_...</code> obok obecnego pliku sejfu i pozwoli zdefiniować nowe hasło główne.
              </div>
              <div className="flex items-center justify-end gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => setShowResetConfirm(false)}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                >
                  Anuluj
                </button>
                <button
                  type="button"
                  disabled={resetting}
                  onClick={async () => {
                    setResetting(true);
                    try {
                      const res = await api.resetVault();
                      onUnlocked(res);
                      if (onReset) onReset();
                      setShowResetConfirm(false);
                      setPassword('');
                      setConfirmPassword('');
                    } catch (err: unknown) {
                      setError(err instanceof Error ? err.message : String(err));
                    } finally {
                      setResetting(false);
                    }
                  }}
                  className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                >
                  {resetting && <Loader2 className="h-3 w-3 animate-spin" />}
                  Zresetuj i utwórz od nowa
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

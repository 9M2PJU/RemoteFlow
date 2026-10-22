import React, { useState, useEffect, useRef } from 'react';
import { KeyRound, Eye, EyeOff, X, ArrowRight, Shield, Terminal } from 'lucide-react';
import { Connection } from '../../types';

interface Props {
  isOpen: boolean;
  connection: Connection | null;
  onConnect: (passphrase: string) => void;
  onClose: () => void;
}

export const PassphrasePromptModal: React.FC<Props> = ({
  isOpen,
  connection,
  onConnect,
  onClose,
}) => {
  const [passphrase, setPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setPassphrase('');
      setShowPassphrase(false);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  if (!isOpen || !connection) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConnect(passphrase);
  };

  const keyFileName = connection.keyFilePath
    ? connection.keyFilePath.split('/').pop()?.split('\\').pop() || connection.keyFilePath
    : 'Klucz prywatny z sejfu';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-4 animate-fadeIn select-none">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden font-sans">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4 bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Hasło do klucza SSH</h3>
              <p className="text-[11px] text-slate-400">Wymagany passphrase do odblokowania klucza</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Target Info Badge */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white flex items-center gap-1.5">
                <Terminal className="h-3.5 w-3.5 text-emerald-400" />
                {connection.name}
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                {connection.username}@{connection.host}:{connection.port}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-cyan-400 font-mono truncate">
              <Shield className="h-3 w-3 text-cyan-400 shrink-0" />
              <span className="text-slate-400">Klucz:</span>
              <span className="truncate">{keyFileName}</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Wprowadź hasło (Passphrase)
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                type={showPassphrase ? 'text' : 'password'}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Wpisz hasło do klucza (lub pozostaw puste)..."
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 pr-10 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-hidden"
              />
              <button
                type="button"
                onClick={() => setShowPassphrase(!showPassphrase)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
              >
                {showPassphrase ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">
              Hasło nie zostanie zapisane na dysku i zostanie użyte tylko dla tej sesji połączenia.
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800/80">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
            >
              Anuluj
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-cyan-600/20 hover:opacity-95 transition-all"
            >
              <span>Połącz</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

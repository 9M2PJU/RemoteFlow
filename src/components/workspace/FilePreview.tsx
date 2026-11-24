import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { Compartment, EditorState, Text, Transaction } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { Binary, FileText, Image as ImageIcon, Loader2, Pencil, RefreshCw, Save, WrapText, X } from 'lucide-react';
import { api, PreviewStat } from '../../services/api';
import { locale, tn, useT } from '../../i18n';
import {
  bomBytes,
  decode,
  detect,
  Detected,
  detectLineEnding,
  encode,
  Encoding,
  ENCODINGS,
  imageTypeOf,
  LineEnding,
  UnencodableError,
} from '../../utils/textCodec';

/** Text files up to this size are loaded whole and can be edited. */
const EDIT_LIMIT = 5 * 1024 * 1024;
/** Larger text files are shown read-only, this much at a time. */
const TEXT_PAGE = 1024 * 1024;
const IMAGE_LIMIT = 20 * 1024 * 1024;
const READ_CHUNK = 4 * 1024 * 1024;

type Side = 'local' | 'remote';
type Mode = 'text' | 'hex' | 'image';

interface Props {
  side: Side;
  connectionId: string;
  path: string;
  name: string;
  onClose: () => void;
  /** The file was saved (the pane refreshes its listing). */
  onSaved: () => void;
  /** F4 / "Edit": open ready for editing. Otherwise (F3) the text is read-only until "Edit". */
  startEditing?: boolean;
}

const formatSize = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

const LINE_ENDING_LABEL: Record<LineEnding, string> = { '\n': 'LF', '\r\n': 'CRLF', '\r': 'CR' };

/**
 * Preview of a file from the SFTP window: text (editable up to 5 MB, with encoding and line
 * endings kept on save), hex view (any size, read on demand) and pictures.
 */
export const FilePreview: React.FC<Props> = ({ side, connectionId, path, name, onClose, onSaved, startEditing = false }) => {
  const t = useT();
  const read = useCallback(
    (offset: number, length: number) => api.previewRead(side, connectionId, path, offset, length),
    [side, connectionId, path]
  );

  const [stat, setStat] = useState<PreviewStat | null>(null);
  const [detected, setDetected] = useState<Detected | null>(null);
  const [mode, setMode] = useState<Mode>('text');
  const [encoding, setEncoding] = useState<Encoding>('utf-8');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ text: string; type: 'ok' | 'error' } | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  // Like Total Commander / mc: F3 views (read-only), F4 or "Edit" unlocks editing
  const [editing, setEditing] = useState(startEditing);

  // Text
  const [lineEnding, setLineEnding] = useState<LineEnding>('\n');
  const [loadedBytes, setLoadedBytes] = useState(0); // read-only paged text
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [confirm, setConfirm] = useState<null | 'close' | 'conflict' | 'reload'>(null);
  const fullBytesRef = useRef<Uint8Array | null>(null);
  const decoderRef = useRef<TextDecoder | null>(null);

  /** The file can be edited (text, up to 5 MB, writable) … */
  const canEdit = !!stat && !!detected && !detected.binary && stat.size <= EDIT_LIMIT && !stat.readonly;
  /** … and editing is switched on. */
  const editable = canEdit && editing;
  const readonlyReason = !stat || !detected
    ? ''
    : detected.binary
      ? t('Plik binarny – tylko podgląd')
      : stat.size > EDIT_LIMIT
        ? t('Plik większy niż 5 MB – tylko podgląd')
        : stat.readonly
          ? t('Plik tylko do odczytu')
          : '';
  const imageType = imageTypeOf(name);

  // Keyboard focus stays inside the preview (Esc, Ctrl+S – also after clicking the hex view)
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  // --- open --------------------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setStatus(null);
      try {
        const st = await api.previewStat(side, connectionId, path);
        const first = await read(0, Math.min(st.size, TEXT_PAGE));
        if (cancelled) return;
        const det = detect(first, st.size <= TEXT_PAGE);
        setStat(st);
        setDetected(det);
        setEncoding(det.encoding);
        if (reloadKey === 0) setMode(imageType && st.size <= IMAGE_LIMIT ? 'image' : det.binary ? 'hex' : 'text');
      } catch (err: any) {
        if (!cancelled) setError(String(err?.message || err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, connectionId, path, reloadKey]);

  // --- CodeMirror ------------------------------------------------------------------------------
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const readOnlyComp = useRef(new Compartment());
  const wrapComp = useRef(new Compartment());
  const settingDocRef = useRef(false);
  /** Document as last loaded / saved – undoing back to it clears the "modified" mark. */
  const savedDocRef = useRef<Text>(Text.empty);
  const saveRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (mode !== 'text' || !hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: '',
        extensions: [
          basicSetup,
          keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => (saveRef.current(), true) }]),
          readOnlyComp.current.of([EditorState.readOnly.of(true), EditorView.editable.of(false)]),
          wrapComp.current.of([]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !settingDocRef.current) setDirty(!u.state.doc.eq(savedDocRef.current));
            if (u.selectionSet || u.docChanged) {
              const head = u.state.selection.main.head;
              const line = u.state.doc.lineAt(head);
              setCursor({ line: line.number, col: head - line.from + 1 });
            }
          }),
          EditorView.theme({
            '&': { height: '100%', fontSize: '12px', backgroundColor: 'var(--color-slate-950)', color: 'var(--color-slate-200)' },
            '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
            '.cm-gutters': { backgroundColor: 'var(--color-slate-900)', color: 'var(--color-slate-500)', borderRight: '1px solid var(--color-slate-800)' },
            '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--color-slate-800) 45%, transparent)' },
            '.cm-activeLineGutter': { backgroundColor: 'var(--color-slate-800)', color: 'var(--color-slate-300)' },
            '.cm-cursor': { borderLeftColor: 'var(--color-cyan-400)' },
            '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in srgb, var(--color-cyan-500) 30%, transparent) !important' },
            '.cm-panels': { backgroundColor: 'var(--color-slate-900)', color: 'var(--color-slate-200)' },
            '.cm-panels input, .cm-panels button': { color: 'var(--color-slate-200)', backgroundColor: 'var(--color-slate-800)', border: '1px solid var(--color-slate-700)', borderRadius: '4px' },
            '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--color-amber-400) 35%, transparent)' },
            '.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--color-amber-400) 70%, transparent)' },
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [mode]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: wrapComp.current.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }, [wrap, mode]);

  // "Edit" (or F4) in a file opened for viewing: unlock the loaded document and put the cursor in it
  useEffect(() => {
    const view = viewRef.current;
    if (!view || mode !== 'text' || !editable || loading) return;
    view.dispatch({ effects: readOnlyComp.current.reconfigure([]) });
    // After the current render (the preview may still be taking the focus itself)
    const id = requestAnimationFrame(() => viewRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [editable, mode, loading]);

  const startEdit = () => {
    if (canEdit && mode === 'text') setEditing(true);
  };

  const setDoc = (text: string, ro: boolean) => {
    const view = viewRef.current;
    if (!view) return;
    settingDocRef.current = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      effects: readOnlyComp.current.reconfigure(ro ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
      // Loading is not an edit: Ctrl+Z must never undo it (back to an empty document)
      annotations: Transaction.addToHistory.of(false),
    });
    settingDocRef.current = false;
    savedDocRef.current = view.state.doc;
    setDirty(false);
  };

  // Load the text (whole file when editable, else the first page)
  useEffect(() => {
    if (mode !== 'text' || !stat || !detected) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const bom = detected.bom && detected.encoding === encoding ? bomBytes(encoding).length : 0;
        if (stat.size <= EDIT_LIMIT) {
          const parts: Uint8Array[] = [];
          let offset = 0;
          while (offset < stat.size) {
            const chunk = await read(offset, Math.min(READ_CHUNK, stat.size - offset));
            if (chunk.length === 0) break;
            parts.push(chunk);
            offset += chunk.length;
          }
          const all = new Uint8Array(offset);
          let pos = 0;
          for (const p of parts) {
            all.set(p, pos);
            pos += p.length;
          }
          if (cancelled) return;
          fullBytesRef.current = all;
          const text = decode(all.subarray(bom), encoding);
          setLineEnding(detectLineEnding(text));
          setDoc(text, !editable);
          setLoadedBytes(all.length);
          // A new (empty) file: start typing right away
        } else {
          decoderRef.current = new TextDecoder(encoding);
          const chunk = await read(0, TEXT_PAGE);
          if (cancelled) return;
          const text = decoderRef.current.decode(chunk.subarray(bom), { stream: true });
          setLineEnding(detectLineEnding(text));
          setDoc(text, true);
          setLoadedBytes(chunk.length);
        }
      } catch (err: any) {
        if (!cancelled) setError(String(err?.message || err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `stat` is set together with `detected` when the file is opened; a save updates `stat`
    // and must not reload the document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, detected, encoding]);

  const loadMoreText = async () => {
    const view = viewRef.current;
    if (!view || !stat || !decoderRef.current) return;
    setLoading(true);
    try {
      const chunk = await read(loadedBytes, TEXT_PAGE);
      const end = loadedBytes + chunk.length >= stat.size;
      const text = decoderRef.current.decode(chunk, { stream: !end });
      settingDocRef.current = true;
      view.dispatch({ changes: { from: view.state.doc.length, insert: text }, annotations: Transaction.addToHistory.of(false) });
      settingDocRef.current = false;
      setLoadedBytes((n) => n + chunk.length);
    } catch (err: any) {
      setStatus({ text: String(err?.message || err), type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // --- save --------------------------------------------------------------------------------------
  const save = async (force = false) => {
    const view = viewRef.current;
    if (!view || !stat || !detected || !editable || saving) return;
    let data: Uint8Array;
    try {
      const text = view.state.doc.toString();
      const withEndings = lineEnding === '\n' ? text : text.replace(/\n/g, lineEnding);
      data = encode(withEndings, encoding, detected.bom && detected.encoding === encoding);
    } catch (err) {
      if (err instanceof UnencodableError) {
        setStatus({
          text: t('Znaku „{ch}” (wiersz {line}) nie da się zapisać w kodowaniu {enc}. Zmień znak albo kodowanie na UTF-8.', {
            ch: err.char,
            line: err.line,
            enc: ENCODINGS.find((e) => e.id === encoding)?.label ?? encoding,
          }),
          type: 'error',
        });
        return;
      }
      throw err;
    }
    setSaving(true);
    setStatus(null);
    try {
      const st = await api.previewSave(side, connectionId, path, data, force ? null : stat);
      setStat(st);
      fullBytesRef.current = data;
      savedDocRef.current = view.state.doc;
      setDirty(false);
      setStatus({ text: t('Zapisano ({size})', { size: formatSize(st.size) }), type: 'ok' });
      onSaved();
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.startsWith('CONFLICT:')) setConfirm('conflict');
      else setStatus({ text: t('Nie udało się zapisać: {error}', { error: msg }), type: 'error' });
    } finally {
      setSaving(false);
    }
  };
  saveRef.current = () => {
    void save();
  };

  const requestClose = () => {
    if (dirty) setConfirm('close');
    else onClose();
  };
  const reload = () => {
    if (dirty) setConfirm('reload');
    else setReloadKey((k) => k + 1);
  };

  // --- render ------------------------------------------------------------------------------------
  const modeButton = (m: Mode, icon: React.ReactNode, label: string, disabled = false) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (m !== mode && dirty) {
          setStatus({ text: t('Najpierw zapisz albo cofnij zmiany.'), type: 'error' });
          return;
        }
        setMode(m);
      }}
      className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] disabled:opacity-40 ${
        mode === m ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:bg-slate-800'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="absolute inset-0 z-50 flex flex-col bg-slate-950 text-xs text-slate-200 outline-none"
      role="dialog"
      aria-label={t('Podgląd pliku {name}', { name })}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          if (!e.defaultPrevented) requestClose();
        } else if (e.key === 'F4' && !editing) {
          e.preventDefault();
          e.stopPropagation();
          startEdit();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          // In the editor CodeMirror has already saved (and prevented the default)
          e.stopPropagation();
          if (!e.defaultPrevented) {
            e.preventDefault();
            void save();
          }
        }
      }}
    >
      {/* Header */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900/80 px-3 py-2">
        <FileText className="h-4 w-4 shrink-0 text-cyan-400" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white" title={path}>
            {name}
            {dirty && <span className="ml-1 text-amber-400">●</span>}
          </div>
          <div className="truncate text-[10px] text-slate-500" title={path}>
            {side === 'local' ? t('Ten komputer') : t('Serwer')} · {path}
            {stat && ` · ${formatSize(stat.size)}`}
            {stat && stat.modified > 0 && ` · ${new Date(stat.modified * 1000).toLocaleString(locale())}`}
          </div>
        </div>
        <div className="flex items-center gap-0.5 rounded-lg border border-slate-800 bg-slate-950 p-0.5">
          {modeButton('text', <FileText className="h-3 w-3" />, t('Tekst'))}
          {modeButton('hex', <Binary className="h-3 w-3" />, 'HEX')}
          {imageType && modeButton('image', <ImageIcon className="h-3 w-3" />, t('Obraz'), !!stat && stat.size > IMAGE_LIMIT)}
        </div>
        {/* Text-only controls stay in place (hidden) in the other views, so switching Text / HEX
            does not move the buttons */}
        <div className={`flex items-center gap-2 ${mode === 'text' ? '' : 'invisible'}`} aria-hidden={mode !== 'text'}>
            <select
              value={encoding}
              disabled={dirty || mode !== 'text'}
              onChange={(e) => setEncoding(e.target.value as Encoding)}
              title={dirty ? t('Najpierw zapisz albo cofnij zmiany.') : t('Kodowanie znaków')}
              className="h-7 w-40 rounded border border-slate-700 bg-slate-800 px-1.5 text-[11px] text-slate-200 disabled:opacity-50"
            >
              {ENCODINGS.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setWrap((w) => !w)}
              disabled={mode !== 'text'}
              title={t('Zawijanie wierszy')}
              className={`flex h-7 w-7 items-center justify-center rounded border border-slate-700 ${wrap ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
            >
              <WrapText className="h-3.5 w-3.5" />
            </button>
        </div>
        <button
          type="button"
          onClick={reload}
          title={t('Wczytaj ponownie')}
          className="flex h-7 w-7 items-center justify-center rounded border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
        {/* One slot: "Edit" while viewing, "Save" while editing (hidden when the file cannot be edited) */}
        {editable ? (
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving || mode !== 'text'}
            title={t('Zapisz (Ctrl+S)')}
            className={`flex h-7 min-w-[88px] items-center justify-center gap-1.5 rounded bg-cyan-600 px-2.5 text-[11px] font-semibold text-white hover:bg-cyan-500 disabled:opacity-40 ${
              mode === 'text' ? '' : 'invisible'
            }`}
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            {t('Zapisz')}
          </button>
        ) : (
          <button
            type="button"
            onClick={startEdit}
            disabled={!canEdit || mode !== 'text'}
            title={t('Edytuj (F4)')}
            aria-hidden={!canEdit || mode !== 'text'}
            className={`flex h-7 min-w-[88px] items-center justify-center gap-1.5 rounded border border-cyan-600/60 bg-slate-800 px-2.5 text-[11px] font-semibold text-cyan-200 hover:bg-slate-700 ${
              canEdit && mode === 'text' ? '' : 'invisible'
            }`}
          >
            <Pencil className="h-3 w-3" />
            {t('Edytuj')}
          </button>
        )}
        <button
          type="button"
          onClick={requestClose}
          title={t('Zamknij (Esc)')}
          className="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="relative min-h-0 flex-1">
        {error ? (
          <div className="m-4 whitespace-pre-wrap rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-red-300">{error}</div>
        ) : mode === 'text' ? (
          <div ref={hostRef} className="h-full" />
        ) : mode === 'hex' && stat ? (
          <HexView size={stat.size} read={read} />
        ) : mode === 'image' && stat ? (
          <ImageView read={read} size={stat.size} type={imageType ?? 'image/png'} name={name} />
        ) : null}
        {loading && !error && (
          <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-1.5 rounded bg-slate-900/90 px-2 py-1 text-[11px] text-cyan-200">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t('Wczytywanie…')}
          </div>
        )}
      </div>

      {/* Footer */}
      {(mode === 'text' || status) && (
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-800 bg-slate-900/60 px-3 py-1.5 text-[10px] text-slate-400">
        {mode === 'text' && stat && (
          <>
            <span>{t('Wiersz {line}, kolumna {col}', cursor)}</span>
            <span>{LINE_ENDING_LABEL[lineEnding]}</span>
            {detected?.bom && detected.encoding === encoding && <span>BOM</span>}
            {readonlyReason && <span className="text-amber-300">{readonlyReason}</span>}
            {canEdit && !editing && <span className="text-slate-500">{t('Tylko podgląd – F4 lub „Edytuj”, aby zmieniać')}</span>}
            {stat.size > EDIT_LIMIT && (
              <>
                <span>{t('Wczytano {loaded} z {total}', { loaded: formatSize(loadedBytes), total: formatSize(stat.size) })}</span>
                {loadedBytes < stat.size && (
                  <button type="button" onClick={loadMoreText} disabled={loading} className="rounded border border-slate-700 px-2 py-0.5 text-slate-200 hover:bg-slate-800 disabled:opacity-40">
                    {t('Wczytaj kolejny 1 MB')}
                  </button>
                )}
              </>
            )}
          </>
        )}
        {status && <span className={status.type === 'error' ? 'text-red-400' : 'text-emerald-300'}>{status.text}</span>}
        {mode === 'text' && (
          <span className="ml-auto hidden text-slate-500 @md:inline">
            {editing ? t('Ctrl+F – szukaj, Ctrl+S – zapisz, Esc – zamknij') : t('Ctrl+F – szukaj, F4 – edytuj, Esc – zamknij')}
          </span>
        )}
      </div>
      )}

      {confirm && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
            <div className="mb-2 text-sm font-semibold text-amber-300">
              {confirm === 'conflict' ? t('Plik zmienił się od otwarcia') : t('Niezapisane zmiany')}
            </div>
            <div className="mb-4 text-[12px] leading-relaxed text-slate-300">
              {confirm === 'conflict'
                ? t('Ktoś lub inny program zapisał ten plik po jego otwarciu. Nadpisanie usunie tamte zmiany.')
                : t('Plik „{name}” ma niezapisane zmiany.', { name })}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setConfirm(null)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] text-slate-200 hover:bg-slate-800">
                {t('Anuluj')}
              </button>
              {confirm === 'conflict' ? (
                <button
                  type="button"
                  onClick={() => {
                    setConfirm(null);
                    void save(true);
                  }}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-red-500"
                >
                  {t('Nadpisz')}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      const c = confirm;
                      setConfirm(null);
                      setDirty(false);
                      if (c === 'close') onClose();
                      else setReloadKey((k) => k + 1);
                    }}
                    className="rounded-lg border border-red-500/40 px-3 py-1.5 text-[11px] text-red-300 hover:bg-red-500/10"
                  >
                    {t('Odrzuć zmiany')}
                  </button>
                  {editable && confirm === 'close' && (
                    <button
                      type="button"
                      onClick={async () => {
                        setConfirm(null);
                        await save();
                      }}
                      className="rounded-lg bg-cyan-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-cyan-500"
                    >
                      {t('Zapisz')}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// =================================================================================================
// Hex view – rows of 16 bytes, read in 64 KB pages while scrolling (works for files of any size)
// =================================================================================================

const ROW = 16;
const ROW_HEIGHT = 18;
const PAGE = 64 * 1024;
/** Browsers cannot scroll elements taller than a few million pixels – above that, scroll is scaled. */
const MAX_SCROLL_HEIGHT = 8_000_000;

const HexView: React.FC<{ size: number; read: (offset: number, length: number) => Promise<Uint8Array> }> = ({ size, read }) => {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const pages = useRef(new Map<number, Uint8Array>());
  const pending = useRef(new Set<number>());
  const [, setVersion] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const [selected, setSelected] = useState<number | null>(null);
  const [goto, setGoto] = useState('');
  const [error, setError] = useState<string | null>(null);

  const rows = Math.max(1, Math.ceil(size / ROW));
  const fullHeight = rows * ROW_HEIGHT;
  const scrollHeight = Math.min(fullHeight, MAX_SCROLL_HEIGHT);
  const visibleRows = Math.ceil(height / ROW_HEIGHT) + 1;
  const maxFirst = Math.max(0, rows - visibleRows + 1);
  const firstRow =
    fullHeight <= MAX_SCROLL_HEIGHT
      ? Math.floor(scrollTop / ROW_HEIGHT)
      : Math.round((scrollTop / Math.max(1, scrollHeight - height)) * maxFirst);
  const offsetDigits = Math.max(8, size.toString(16).length);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Fetch the pages under the visible rows
  useEffect(() => {
    const start = firstRow * ROW;
    const end = Math.min(size, (firstRow + visibleRows) * ROW);
    for (let p = Math.floor(start / PAGE); p * PAGE < end; p++) {
      if (pages.current.has(p) || pending.current.has(p)) continue;
      pending.current.add(p);
      read(p * PAGE, Math.min(PAGE, size - p * PAGE))
        .then((data) => {
          pages.current.set(p, data);
          // Keep memory bounded on huge files
          if (pages.current.size > 64) pages.current.delete(pages.current.keys().next().value!);
          setVersion((v) => v + 1);
        })
        .catch((err) => setError(String(err?.message || err)))
        .finally(() => pending.current.delete(p));
    }
  }, [firstRow, visibleRows, size, read]);

  const byteAt = (offset: number): number | undefined => {
    const page = pages.current.get(Math.floor(offset / PAGE));
    return page ? page[offset % PAGE] : undefined;
  };

  const scrollToOffset = (offset: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const row = Math.floor(Math.max(0, Math.min(size - 1, offset)) / ROW);
    el.scrollTop =
      fullHeight <= MAX_SCROLL_HEIGHT ? row * ROW_HEIGHT : (Math.min(row, maxFirst) / Math.max(1, maxFirst)) * (scrollHeight - height);
    setSelected(offset);
  };

  const rowsOut: React.ReactNode[] = [];
  for (let r = firstRow; r < Math.min(rows, firstRow + visibleRows); r++) {
    const base = r * ROW;
    const hex: React.ReactNode[] = [];
    const ascii: React.ReactNode[] = [];
    for (let i = 0; i < ROW; i++) {
      const off = base + i;
      if (off >= size) break;
      const b = byteAt(off);
      const sel = off === selected;
      const cls = `cursor-pointer ${sel ? 'bg-cyan-600 text-white' : b === 0 ? 'text-slate-600' : 'hover:bg-slate-800'}`;
      hex.push(
        <span key={i} className={`${cls} ${i === 8 ? 'ml-2' : ''} px-[2px]`} onClick={() => setSelected(off)}>
          {b === undefined ? '··' : b.toString(16).padStart(2, '0')}
        </span>
      );
      ascii.push(
        <span key={i} className={cls} onClick={() => setSelected(off)}>
          {b === undefined ? ' ' : b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.'}
        </span>
      );
    }
    rowsOut.push(
      <div key={r} className="flex h-[18px] items-center whitespace-pre leading-[18px]">
        <span className="w-[calc(var(--d)*1ch+1.5ch)] shrink-0 select-none text-slate-500" style={{ ['--d' as any]: offsetDigits }}>
          {base.toString(16).padStart(offsetDigits, '0')}
        </span>
        <span className="w-[calc(32ch+88px)] shrink-0 text-slate-200">{hex}</span>
        <span className="text-emerald-300/90">{ascii}</span>
      </div>
    );
  }

  const selectedByte = selected !== null ? byteAt(selected) : undefined;

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-auto font-mono text-[12px]"
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
      >
        <div style={{ height: scrollHeight }} />
        <div className="absolute left-0 right-0 px-3" style={{ top: scrollTop }}>
          {rowsOut}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-slate-800 bg-slate-900/40 px-3 py-1 text-[10px] text-slate-400">
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            const v = goto.trim().toLowerCase();
            const n = v.startsWith('0x') ? parseInt(v.slice(2), 16) : /[a-f]/.test(v) ? parseInt(v, 16) : parseInt(v, 10);
            if (Number.isFinite(n)) scrollToOffset(n);
          }}
        >
          <span>{t('Przejdź do offsetu')}</span>
          <input
            value={goto}
            onChange={(e) => setGoto(e.target.value)}
            placeholder="0x1F40"
            className="h-5 w-24 rounded border border-slate-700 bg-slate-800 px-1.5 font-mono text-[10px] text-slate-200"
          />
        </form>
        {selected !== null && (
          <span className="font-mono">
            {t('Offset')}: 0x{selected.toString(16)} ({selected.toLocaleString(locale())})
            {selectedByte !== undefined && ` · 0x${selectedByte.toString(16).padStart(2, '0')} = ${selectedByte}`}
          </span>
        )}
        <span>{tn(size, ['{size} bajt', '{size} bajty', '{size} bajtów'], { size: size.toLocaleString(locale()) })}</span>
        {error && <span className="text-red-400">{error}</span>}
      </div>
    </div>
  );
};

// =================================================================================================
// Picture
// =================================================================================================

const ImageView: React.FC<{ read: (offset: number, length: number) => Promise<Uint8Array>; size: number; type: string; name: string }> = ({
  read,
  size,
  type,
  name,
}) => {
  const t = useT();
  const [url, setUrl] = useState<string | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        const parts: Uint8Array[] = [];
        let offset = 0;
        while (offset < size) {
          const chunk = await read(offset, Math.min(READ_CHUNK, size - offset));
          if (chunk.length === 0) break;
          parts.push(chunk);
          offset += chunk.length;
        }
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob(parts as BlobPart[], { type }));
        setUrl(objectUrl);
      } catch (err: any) {
        if (!cancelled) setError(String(err?.message || err));
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [read, size, type]);

  const checker = useMemo(
    () => ({
      backgroundImage:
        'linear-gradient(45deg, var(--color-slate-800) 25%, transparent 25%), linear-gradient(-45deg, var(--color-slate-800) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--color-slate-800) 75%), linear-gradient(-45deg, transparent 75%, var(--color-slate-800) 75%)',
      backgroundSize: '16px 16px',
      backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
    }),
    []
  );

  if (error) return <div className="m-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-red-300">{error}</div>;
  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4" style={checker}>
        {url && (
          // <img> never runs scripts of an SVG file
          <img
            src={url}
            alt={name}
            className="max-h-full max-w-full object-contain"
            onLoad={(e) => setDims({ w: (e.target as HTMLImageElement).naturalWidth, h: (e.target as HTMLImageElement).naturalHeight })}
            onError={() => setError(t('Nie można wyświetlić obrazu.'))}
          />
        )}
      </div>
      {dims && (
        <div className="shrink-0 border-t border-slate-800 bg-slate-900/40 px-3 py-1 text-[10px] text-slate-400">
          {dims.w} × {dims.h} px
        </div>
      )}
    </div>
  );
};

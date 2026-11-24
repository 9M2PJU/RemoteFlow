/**
 * Text encodings of the SFTP file editor: detection, decoding and – for saving – encoding back to
 * the same bytes. TextDecoder knows every encoding, but TextEncoder only writes UTF-8, so UTF-16
 * is written by hand and the single-byte code pages through a table built from TextDecoder.
 */

export type Encoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1250' | 'iso-8859-2' | 'windows-1252';

export const ENCODINGS: { id: Encoding; label: string }[] = [
  { id: 'utf-8', label: 'UTF-8' },
  { id: 'windows-1250', label: 'Windows-1250' },
  { id: 'iso-8859-2', label: 'ISO-8859-2' },
  { id: 'windows-1252', label: 'Windows-1252 (Latin-1)' },
  { id: 'utf-16le', label: 'UTF-16 LE' },
  { id: 'utf-16be', label: 'UTF-16 BE' },
];

export type LineEnding = '\n' | '\r\n' | '\r';

export interface Detected {
  encoding: Encoding;
  bom: boolean;
  binary: boolean;
}

const BOMS: { enc: Encoding; bytes: number[] }[] = [
  { enc: 'utf-8', bytes: [0xef, 0xbb, 0xbf] },
  { enc: 'utf-16le', bytes: [0xff, 0xfe] },
  { enc: 'utf-16be', bytes: [0xfe, 0xff] },
];

export const bomBytes = (enc: Encoding): number[] => BOMS.find((b) => b.enc === enc)?.bytes ?? [];

const startsWith = (data: Uint8Array, prefix: number[]) => prefix.every((b, i) => data[i] === b);

/**
 * Guesses how to show the beginning of a file. `complete` = `sample` is the whole file (a UTF-8
 * sequence cut at the end of a partial sample is then not an error).
 */
export function detect(sample: Uint8Array, complete: boolean): Detected {
  for (const b of BOMS) if (startsWith(sample, b.bytes)) return { encoding: b.enc, bom: true, binary: false };
  const head = sample.subarray(0, 8192);
  let control = 0;
  for (const byte of head) {
    if (byte === 0) return { encoding: 'utf-8', bom: false, binary: true };
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20 && byte !== 0x1b)) control++;
  }
  if (head.length > 0 && control / head.length > 0.1) return { encoding: 'utf-8', bom: false, binary: true };
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: !complete });
    return { encoding: 'utf-8', bom: false, binary: false };
  } catch {
    // Not UTF-8 – the most common legacy code page of Polish text files
    return { encoding: 'windows-1250', bom: false, binary: false };
  }
}

/** Decodes bytes (without the BOM, which the caller strips). */
export function decode(data: Uint8Array, encoding: Encoding): string {
  return new TextDecoder(encoding).decode(data);
}

/** Line ending used most often in the text (LF when there are none). */
export function detectLineEnding(text: string): LineEnding {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        crlf++;
        i++;
      } else cr++;
    } else if (c === 10) lf++;
  }
  if (crlf >= lf && crlf >= cr && crlf > 0) return '\r\n';
  if (cr > lf) return '\r';
  return '\n';
}

const singleByteTables = new Map<Encoding, Map<number, number>>();

function singleByteTable(encoding: Encoding): Map<number, number> {
  let table = singleByteTables.get(encoding);
  if (!table) {
    table = new Map();
    const decoder = new TextDecoder(encoding);
    for (let b = 0; b < 256; b++) {
      const ch = decoder.decode(new Uint8Array([b]));
      if (ch !== '�' && !table.has(ch.codePointAt(0)!)) table.set(ch.codePointAt(0)!, b);
    }
    singleByteTables.set(encoding, table);
  }
  return table;
}

export class UnencodableError extends Error {
  constructor(public readonly char: string, public readonly line: number) {
    super(char);
  }
}

/** Encodes text to bytes in the given encoding; throws UnencodableError for a missing character. */
export function encode(text: string, encoding: Encoding, bom: boolean): Uint8Array {
  const prefix = bom ? bomBytes(encoding) : [];
  if (encoding === 'utf-8') {
    const body = new TextEncoder().encode(text);
    const out = new Uint8Array(prefix.length + body.length);
    out.set(prefix);
    out.set(body, prefix.length);
    return out;
  }
  if (encoding === 'utf-16le' || encoding === 'utf-16be') {
    const out = new Uint8Array(prefix.length + text.length * 2);
    out.set(prefix);
    const le = encoding === 'utf-16le';
    for (let i = 0; i < text.length; i++) {
      const unit = text.charCodeAt(i);
      out[prefix.length + i * 2] = le ? unit & 0xff : unit >> 8;
      out[prefix.length + i * 2 + 1] = le ? unit >> 8 : unit & 0xff;
    }
    return out;
  }
  const table = singleByteTable(encoding);
  const out: number[] = [];
  let line = 1;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code === 10) line++;
    const b = code < 0x80 ? code : table.get(code);
    if (b === undefined) throw new UnencodableError(ch, line);
    out.push(b);
  }
  return new Uint8Array(out);
}

/** File types shown as a picture. */
export const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
};

export const imageTypeOf = (name: string): string | null => {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return IMAGE_TYPES[ext] ?? null;
};

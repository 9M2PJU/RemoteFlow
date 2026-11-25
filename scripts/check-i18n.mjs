// Verifies that every t('...') text (and every form in tn(n, [...])) used in src/ has an English translation in src/i18n/en.json
// and a Bahasa Melayu translation in src/i18n/ms.json. Usage: node scripts/check-i18n.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const en = JSON.parse(readFileSync(join(root, 'src/i18n/en.json'), 'utf8'));
const ms = JSON.parse(readFileSync(join(root, 'src/i18n/ms.json'), 'utf8'));
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|jsx?)$/.test(f)) files.push(p);
  }
};
walk(join(root, 'src'));

const used = new Set();
const missingEn = [];
const missingMs = [];
const callRe = /\bt\(\s*('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")/g;
// tn(count, ['one', 'few', 'many'], …) – every form is a dictionary key
const pluralRe = /\btn\([^\[\n]*\[([^\]]*)\]/g;
const strRe = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g;
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(callRe)) {
    const key = Function(`return ${m[1]}`)();
    used.add(key);
    if (!(key in en)) missingEn.push(`${file.replace(root, '')}: ${key}`);
    if (!(key in ms)) missingMs.push(`${file.replace(root, '')}: ${key}`);
  }
  for (const m of src.matchAll(pluralRe)) {
    for (const lit of m[1].match(strRe) ?? []) {
      const key = Function(`return ${lit}`)();
      used.add(key);
      if (!(key in en)) missingEn.push(`${file.replace(root, '')}: ${key}`);
      if (!(key in ms)) missingMs.push(`${file.replace(root, '')}: ${key}`);
    }
  }
}
const unused = Object.keys(en).filter((k) => !used.has(k));
console.log(`t() texts: ${used.size}, en entries: ${Object.keys(en).length}, ms entries: ${Object.keys(ms).length}`);
if (missingEn.length) {
  console.log(`\nMissing English translations (${missingEn.length}):`);
  missingEn.forEach((m) => console.log('  ' + m));
}
if (missingMs.length) {
  console.log(`\nMissing Bahasa Melayu translations (${missingMs.length}):`);
  missingMs.forEach((m) => console.log('  ' + m));
}
if (unused.length) console.log(`\nDictionary entries not used directly by t('...') (${unused.length}) – may be used via variables:\n  ` + unused.join('\n  '));
process.exit(missingEn.length || missingMs.length ? 1 : 0);

// Prints the release notes of the given version: its section from CHANGELOG.md (English) and from
// CHANGELOG.pl.md (Polish), each after a `<!-- lang:xx -->` marker. GitHub shows both (the markers
// are HTML comments); the in-app update notice shows the part in the interface language
// (src/utils/updater.ts – localizedNotes).
// Usage: node scripts/release-notes.mjs 1.15.2
import { readFileSync } from 'node:fs';

const version = (process.argv[2] || '').replace(/^v/, '');

function section(file) {
  const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## ${version} `) || l === `## ${version}`);
  if (start < 0) {
    console.error(`${file} has no section for ${version} (expected a "## ${version} – …" heading)`);
    process.exit(1);
  }
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  if (end < 0) end = lines.length;
  return lines.slice(start, end).join('\n').trim();
}

const en = section('CHANGELOG.md');
const pl = section('CHANGELOG.pl.md');
process.stdout.write(`<!-- lang:en -->\n${en}\n\n---\n\n<!-- lang:pl -->\n${pl}\n`);

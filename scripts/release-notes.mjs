// Prints the CHANGELOG.md section of the given version (used as release notes and update notes).
// Usage: node scripts/release-notes.mjs 1.12.1
import { readFileSync } from 'node:fs';

const version = (process.argv[2] || '').replace(/^v/, '');
const text = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const lines = text.split('\n');
const start = lines.findIndex((l) => l.startsWith(`## ${version} `) || l === `## ${version}`);
if (start < 0) {
  console.error(`CHANGELOG.md has no section for ${version}`);
  process.exit(1);
}
let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
if (end < 0) end = lines.length;
process.stdout.write(lines.slice(start, end).join('\n').trim() + '\n');

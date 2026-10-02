// Every t('…') key in src/, in order of appearance: the list the English dictionary must cover.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|tsx)$/.test(name) && !path.includes('i18n/en.ts')) files.push(path);
  }
};
walk(new URL('../src', import.meta.url).pathname);

const keys = [];
const seen = new Set();
const literal = /\bt\(\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g;
for (const file of files.sort()) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(literal)) {
    const key = unquote(match[1]);
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
}
/** A JS string literal in single or double quotes → its value. */
function unquote(literal) {
  const inner = literal.slice(1, -1);
  if (literal[0] === '"') return JSON.parse(literal);
  return JSON.parse(`"${inner.replace(/\\'/g, "'").replace(/"/g, '\\"')}"`);
}

export default keys;
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  process.stdout.write(`${JSON.stringify(keys, null, 1)}\n`);
}

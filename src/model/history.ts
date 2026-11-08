/**
 * What the journal says about itself: which entries record a status change
 * (`в работе → на проверке`) and which ones treeyard wrote on its own — the
 * rest is what a person or an agent wrote, and only that can be corrected.
 */
import { EN } from '../i18n/en.js';
import { journalEntries } from './journal.js';
import { ALL_LABELS } from './status-words.js';

export interface Entry {
  /** `2026-11-08 12:19`. */
  when: string;
  /** Who wrote it: `ты`, `агент`, `claude`… */
  source: string;
  text: string;
}

/** `stamp · source · text`; a line of another shape keeps all of it as the text. */
export function parseEntry(line: string): Entry {
  const parts = line.split(' · ');
  if (parts.length < 3) return { when: '', source: '', text: line };
  return { when: parts[0]!, source: parts[1]!, text: parts.slice(2).join(' · ') };
}

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LABELS = ALL_LABELS.map(literal).join('|');
const CHANGE = new RegExp(`^(?:${LABELS}) → (?:${LABELS})(?:$|: |\\. )`);

/** `в работе → на проверке`, `к работе → ждёт: сервер`, `… → готово. проверка прошла`. */
export function isStatusChange(text: string): boolean {
  return CHANGE.test(text);
}

/** The status changes of a node, oldest first, as journal lines. */
export function statusHistory(body: string): string[] {
  return journalEntries(body).filter((line) => isStatusChange(parseEntry(line).text));
}

/** Lines treeyard writes by itself, keyed by their Russian text; `{x}` stands for anything. */
const OWN = [
  'завёл узел',
  'привязан коммит {sha}',
  'убрана привязка коммита {sha}',
  'картинка добавлена: {file}',
  'картинка удалена: {file}',
  'подпись к {file}: {note}',
  'ждёт: {link}',
  'нужен для: {link}',
  'больше не нужен для: {link}',
];
const OWN_LINES = OWN.flatMap((key) => [key, EN[key] ?? key]).map(
  (template) => new RegExp(`^${literal(template).replace(/\\\{\w+\\\}/g, '.*')}$`),
);
const BARE = new RegExp(`^(?:${LABELS})(?:$|\\. )`);

/** Written by treeyard itself — a status change, a commit, a picture, a link — not by a person or an agent. */
export function isOwnLine(text: string): boolean {
  return isStatusChange(text) || BARE.test(text) || OWN_LINES.some((line) => line.test(text));
}

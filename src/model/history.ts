/**
 * What the journal says about itself: which entries record a status change
 * (`в работе → на проверке`) and which ones treeyard wrote on its own — the
 * rest is what a person or an agent wrote, and only that can be corrected.
 */
import { EN } from '../i18n/en.js';
import { journalEntries } from './journal.js';
import { ALL_LABELS, parseStatus } from './status-words.js';
import type { Status } from './types.js';

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

/** One status change taken apart: the statuses as keys, whichever language wrote the line. */
export interface StatusStep {
  /** `2026-11-08 12:19`, local time as the journal has it; none for a line without a stamp. */
  at?: string;
  /** `ты`, `агент`, `claude`…; none for a line without a stamp. */
  who?: string;
  from: Status;
  to: Status;
  /** What follows the change: why it waits (`ждёт: сервер`) or a sentence (`готово. проверка прошла`). */
  comment?: string;
}

const PARTS = new RegExp(`^(${LABELS}) → (${LABELS})(?:$|: |\\. )`);

/** The status changes of a node, oldest first, for scripts: who, when, from which status to which. */
export function statusSteps(body: string): StatusStep[] {
  const steps: StatusStep[] = [];
  for (const line of journalEntries(body)) {
    const entry = parseEntry(line);
    const match = PARTS.exec(entry.text);
    const from = match && parseStatus(match[1]!);
    const to = match && parseStatus(match[2]!);
    if (!match || !from || !to) continue;
    const comment = entry.text.slice(match[0].length).trim();
    steps.push({
      ...(entry.when ? { at: entry.when } : {}),
      ...(entry.source ? { who: entry.source } : {}),
      from,
      to,
      ...(comment ? { comment } : {}),
    });
  }
  return steps;
}

/** The first line of a node added by a person or an agent, in either language. */
const CREATED = new Set(['завёл узел', 'added the node']);

export function isCreationLine(text: string): boolean {
  return CREATED.has(text);
}

/**
 * The journal lines of a letter between sessions (`treeyard send`, see mail.ts). `send` writes
 * them, not the author: the session's summary and the entry `log --fix` corrects lie elsewhere.
 */
export const LETTER_FROM = 'письмо №{n} от «{from}»: «{text}»';
export const LETTER_TO = 'письмо №{n} узлу «{to}»: «{text}»';
export const LETTER_SESSION = 'письмо №{n} сессии {brain} {short}: «{text}»';
/** The person's answer to a question a session asked in a dialog, passed on by `send --answer`. */
export const LETTER_ANSWER = 'ответ человека в диалог: «{text}»';
/** A permission or startup dialog approved or rejected at the person's word (`send --approve` / `--reject`). */
export const LETTER_APPROVE = 'разрешение подтверждено: {what}';
export const LETTER_REJECT = 'разрешение отклонено: {what}';
/** A letter from a shell to a node with no session yet: its first session gets it. */
export const LETTER_SHELL = 'письмо №{n}: «{text}»';
/** The same lines before letters had numbers: older journals keep them. */
export const OLD_LETTER_FROM = 'письмо от «{from}»: «{text}»';
export const OLD_LETTER_TO = 'письмо узлу «{to}»: «{text}»';
export const OLD_LETTER_SESSION = 'письмо сессии {brain} {short}: «{text}»';

/** Lines treeyard writes by itself, keyed by their Russian text; `{x}` stands for anything. */
const OWN = [
  'привязан коммит {sha}',
  'убрана привязка коммита {sha}',
  'картинка добавлена: {file}',
  'картинка удалена: {file}',
  'подпись к {file}: {note}',
  'ждёт: {link}',
  'нужен для: {link}',
  'больше не нужен для: {link}',
  LETTER_FROM,
  LETTER_TO,
  LETTER_SESSION,
  LETTER_SHELL,
  LETTER_ANSWER,
  LETTER_APPROVE,
  LETTER_REJECT,
  OLD_LETTER_FROM,
  OLD_LETTER_TO,
  OLD_LETTER_SESSION,
];
const OWN_LINES = OWN.flatMap((key) => [key, EN[key] ?? key]).map(
  (template) => new RegExp(`^${literal(template).replace(/\\\{\w+\\\}/g, '.*')}$`),
);
const BARE = new RegExp(`^(?:${LABELS})(?:$|\\. )`);

/** Written by treeyard itself — a status change, a commit, a picture, a link, a letter — not by a person or an agent. */
export function isOwnLine(text: string): boolean {
  return isCreationLine(text) || isStatusChange(text) || BARE.test(text) || OWN_LINES.some((line) => line.test(text));
}

/** The last entry `source` wrote by hand — the one `log --fix` corrects — and its place in the journal. */
export function lastOwnEntry(body: string, source: string): { index: number; entry: Entry } | undefined {
  const lines = journalEntries(body);
  for (let index = lines.length - 1; index >= 0; index--) {
    const entry = parseEntry(lines[index]!);
    if (entry.source === source && !isOwnLine(entry.text)) return { index, entry };
  }
  return undefined;
}

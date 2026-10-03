/**
 * The journal of a node: the last section of its markdown, one line per
 * event — a session, a status change, what an agent did and what is left.
 * The plan stays short because history lives here, next to the work.
 */
import { lang, t } from '../i18n/i18n.js';

/** The section's heading in the current language; both are read, whichever a tree was written in. */
export function journalHeading(): string {
  return lang() === 'en' ? 'Journal' : 'Журнал';
}
const HEADING = /^##\s+(?:Журнал|Journal)\s*$/m;

export function appendJournal(body: string, line: string): string {
  const entry = `- ${line.replace(/\s*\n\s*/g, ' ').trim()}`;
  const match = HEADING.exec(body);
  if (!match) return `${body.trimEnd()}${body.trim() ? '\n\n' : ''}## ${journalHeading()}\n\n${entry}\n`;
  const start = match.index + match[0].length;
  // The section ends at the next heading of the same or a higher level.
  const next = /^#{1,2}\s/m.exec(body.slice(start));
  const end = next ? start + next.index : body.length;
  const section = body.slice(start, end).trimEnd();
  const rest = body.slice(end);
  return `${body.slice(0, start)}${section ? `${section}\n` : '\n\n'}${entry}\n${rest ? `\n${rest.replace(/^\n+/, '')}` : ''}`;
}

/** The journal lines, oldest first, without the leading dash. */
export function journalEntries(body: string): string[] {
  const match = HEADING.exec(body);
  if (!match) return [];
  const start = match.index + match[0].length;
  const next = /^#{1,2}\s/m.exec(body.slice(start));
  const section = body.slice(start, next ? start + next.index : body.length);
  return section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2));
}

/** The body without its journal: the description a person wrote. */
export function description(body: string): string {
  const match = HEADING.exec(body);
  const before = match ? body.slice(0, match.index) : body;
  return before.trim();
}

/** Keep the journal and any later sections verbatim when editing the description. */
export function replaceDescription(body: string, value: string): string {
  if (HEADING.test(value)) throw new Error(t('Раздел «Журнал» заполняется отдельно — убери его из описания'));
  const about = value.trim();
  if (about === description(body)) return body;
  const match = HEADING.exec(body);
  return match ? `${about}${about ? '\n\n' : ''}${body.slice(match.index)}` : about;
}

/** `treeyard wait` as text: a block per node that needs the coordinator, a line per node still at work. */
import { LISTED } from '../agents/overlap.js';
import type { InboxLetter, SessionSight, SessionState, Sight, WaitResult } from '../agents/wait.js';
import { t } from '../i18n/i18n.js';
import { STATUS_LABEL } from '../model/ops.js';
import { GLYPH } from '../model/overview.js';
import type { Paint } from './print.js';

/** Long enough for a session's summary; the whole one is in `show`. */
const ENTRY = 600;
/** The journal entry next to the session's whole last message: a pointer, the message says the rest. */
const ENTRY_NEXT_TO_MESSAGE = 200;

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function stateWord(state: SessionState, waitingFor?: string): string {
  switch (state) {
    case 'busy':
      return t('работает');
    case 'waiting':
      return waitingFor ? t('ждёт человека: {why}', { why: waitingFor }) : t('ждёт человека');
    case 'idle':
      return t('закончила ход');
    case 'gone':
      return t('закончилась');
    default:
      return t('ещё не сказала, что делает');
  }
}

function sessionLine(session: SessionSight): string {
  const id = session.id ? session.id.slice(0, 8) : t('без id');
  const where = session.pane ? ` · ${t('панель {pane}', { pane: session.pane })}` : '';
  return `${t('сессия')} ${session.brain} ${id}${where} · ${stateWord(session.state, session.waitingFor)}`;
}

function statusPart(sight: Sight): string {
  return sight.from !== sight.status
    ? `${STATUS_LABEL[sight.from]} → ${STATUS_LABEL[sight.status]}`
    : STATUS_LABEL[sight.status];
}

/**
 * What the session said last: its message whole, from the CLI's transcript; where there is none to
 * read, the end of the pane's screen.
 */
export function messageOf(session: SessionSight | undefined): { text: string; source: 'transcript' | 'screen' } | null {
  if (session?.message) return { text: session.message, source: 'transcript' };
  if (session?.screen?.length) return { text: session.screen.join('\n'), source: 'screen' };
  return null;
}

/** A node that needs the coordinator: status, the last entry, the session and what it said last. */
export function sightBlock(sight: Sight, p: Paint): string {
  const lines = [`${p.bold(`${GLYPH[sight.status]} ${sight.title}`)}  ${p.dim(sight.id)}  ${statusPart(sight)}`];
  const message = messageOf(sight.session);
  if (sight.entry) {
    const limit = message?.source === 'transcript' ? ENTRY_NEXT_TO_MESSAGE : ENTRY;
    lines.push(
      `  ${p.dim([sight.entry.when, sight.entry.source].filter(Boolean).join(' · '))}  ${clip(sight.entry.text, limit)}`,
    );
  }
  if (sight.session) {
    lines.push(`  ${sessionLine(sight.session)}`);
    if (sight.session.state === 'waiting' && sight.session.pane)
      lines.push(
        `  ${p.dim(t('ответить в панели: tmux -L brainyard attach -t {pane}', { pane: sight.session.pane }))}`,
      );
  }
  if (message) {
    lines.push(`  ${p.dim(message.source === 'transcript' ? t('последнее сообщение:') : t('конец экрана:'))}`);
    for (const row of message.text.split('\n')) lines.push(`    ${p.dim('│')} ${row}`.trimEnd());
  }
  return lines.join('\n');
}

/** A node still at work, one line. */
export function pendingLine(sight: Sight, p: Paint): string {
  const session = sight.session ? ` · ${sessionLine(sight.session)}` : '';
  return `${GLYPH[sight.status]} ${sight.title}  ${p.dim(sight.id)}  ${STATUS_LABEL[sight.status]}${p.dim(session)}`;
}

/** A letter to the coordinator's node, whole: who wrote it and how to answer. */
export function inboxBlock(letter: InboxLetter, p: Paint): string {
  const who = letter.from
    ? `${t('от «{title}»', { title: letter.fromTitle ?? letter.from })}  ${p.dim(letter.from)}`
    : t('от {who}', { who: letter.who || '?' });
  const answers = letter.replyTo ? ` · ${t('ответ на №{n}', { n: letter.replyTo })}` : '';
  const lines = [`${p.bold(`✉ ${t('письмо №{n}', { n: letter.n })}`)} ${who}${p.dim(answers)}`];
  for (const row of letter.text.split('\n')) lines.push(`  ${row}`);
  if (letter.from) lines.push(`  ${p.dim(t('ответ — treeyard send {id} "…"', { id: letter.from }))}`);
  return lines.join('\n');
}

/**
 * Two nodes that change one file: «A» and «B» change one file: path — a line per file, the rest
 * counted. Shared by `wait` and `queue`.
 */
export function overlapLines(aTitle: string, bTitle: string, files: readonly string[]): string[] {
  const lines = files
    .slice(0, LISTED)
    .map((file) => t('«{a}» и «{b}» правят один файл: {file}', { a: aTitle, b: bTitle, file }));
  if (files.length > LISTED) lines.push(t('… и ещё {p1}', { p1: files.length - LISTED }));
  return lines;
}

function overlapBlock(result: WaitResult, p: Paint): string | undefined {
  const lines = (result.conflicts ?? []).flatMap((overlap) =>
    overlapLines(overlap.nodes[0].title, overlap.nodes[1].title, overlap.files).map(
      (line) => `${p.c('#ffcf70', '⚠')} ${line}`,
    ),
  );
  return lines.length ? lines.join('\n') : undefined;
}

export function waitText(result: WaitResult, p: Paint): string {
  const parts = [
    ...result.letters.map((letter) => inboxBlock(letter, p)),
    ...result.settled.filter((sight) => sight.reason !== 'letter').map((sight) => sightBlock(sight, p)),
  ];
  const overlaps = overlapBlock(result, p);
  if (overlaps) parts.push(overlaps);
  if (result.pending.length)
    parts.push([p.dim(t('ещё в работе:')), ...result.pending.map((sight) => pendingLine(sight, p))].join('\n'));
  return `${parts.join('\n\n')}\n`;
}

/** `--json`: the format grows when a field changes its meaning or goes away. */
export const WAIT_VERSION = 1;

/** The session without its message, which has a field of its own: `session.screen` stays for panes with no transcript. */
function sessionJson(session: SessionSight): Omit<SessionSight, 'message'> {
  const { message: _message, ...rest } = session;
  return rest;
}

export function waitJson(result: WaitResult): unknown {
  const node = (sight: Sight) => ({
    node: sight.id,
    title: sight.title,
    status: sight.status,
    from: sight.from,
    reason: sight.reason ?? null,
    entry: sight.entry ? { at: sight.entry.when, who: sight.entry.source, text: sight.entry.text } : null,
    session: sight.session ? sessionJson(sight.session) : null,
    message: messageOf(sight.session),
  });
  return {
    version: WAIT_VERSION,
    timedOut: result.timedOut,
    letters: result.letters.map((letter) => ({
      n: letter.n,
      from: letter.from ?? null,
      title: letter.fromTitle ?? null,
      who: letter.who ?? null,
      text: letter.text,
      at: letter.at,
      replyTo: letter.replyTo ?? null,
    })),
    settled: result.settled.map(node),
    pending: result.pending.map(node),
    conflicts: (result.conflicts ?? []).map((overlap) => ({
      nodes: overlap.nodes.map((each) => ({ node: each.id, title: each.title, status: each.status })),
      files: overlap.files,
    })),
  };
}

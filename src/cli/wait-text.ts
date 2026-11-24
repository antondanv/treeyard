/** `treeyard wait` as text: a block per node that needs the coordinator, a line per node still at work. */
import type { InboxLetter, SessionSight, SessionState, Sight, WaitResult } from '../agents/wait.js';
import { t } from '../i18n/i18n.js';
import { STATUS_LABEL } from '../model/ops.js';
import { GLYPH } from '../model/overview.js';
import type { Paint } from './print.js';

/** Long enough for a session's summary; the whole one is in `show`. */
const ENTRY = 600;

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

/** A node that needs the coordinator: status, the last entry, the session and the end of its screen. */
export function sightBlock(sight: Sight, p: Paint): string {
  const lines = [`${p.bold(`${GLYPH[sight.status]} ${sight.title}`)}  ${p.dim(sight.id)}  ${statusPart(sight)}`];
  if (sight.entry)
    lines.push(
      `  ${p.dim([sight.entry.when, sight.entry.source].filter(Boolean).join(' · '))}  ${clip(sight.entry.text, ENTRY)}`,
    );
  if (sight.session) lines.push(`  ${sessionLine(sight.session)}`);
  if (sight.session?.screen?.length) {
    lines.push(`  ${p.dim(t('конец экрана:'))}`);
    for (const row of sight.session.screen) lines.push(`    ${p.dim('│')} ${row}`);
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

export function waitText(result: WaitResult, p: Paint): string {
  const parts = [
    ...result.letters.map((letter) => inboxBlock(letter, p)),
    ...result.settled.filter((sight) => sight.reason !== 'letter').map((sight) => sightBlock(sight, p)),
  ];
  if (result.pending.length)
    parts.push([p.dim(t('ещё в работе:')), ...result.pending.map((sight) => pendingLine(sight, p))].join('\n'));
  return `${parts.join('\n\n')}\n`;
}

/** `--json`: the format grows when a field changes its meaning or goes away. */
export const WAIT_VERSION = 1;

export function waitJson(result: WaitResult): unknown {
  const node = (sight: Sight) => ({
    node: sight.id,
    title: sight.title,
    status: sight.status,
    from: sight.from,
    reason: sight.reason ?? null,
    entry: sight.entry ? { at: sight.entry.when, who: sight.entry.source, text: sight.entry.text } : null,
    session: sight.session ?? null,
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
  };
}

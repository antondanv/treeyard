/**
 * Statuses as people and agents type them: the key (`review`), its label in
 * either language (`на проверке`, `in review`), a short alias (`wip`,
 * `проверка`) or the glyph copied from the output (`◎`). Nobody should have to
 * type a glyph to ask for the nodes in review.
 */
import { EN } from '../i18n/en.js';
import { GLYPH } from './overview.js';
import { STATUSES, type Status } from './types.js';

/** The Russian labels are the keys of `t()`; their English lines come from the dictionary. */
const LABEL_RU: Record<Status, string> = {
  idea: 'идея',
  todo: 'к работе',
  active: 'в работе',
  waiting: 'ждёт',
  review: 'на проверке',
  done: 'готово',
  dropped: 'отказ',
};

const ALIASES: Record<Status, readonly string[]> = {
  idea: ['ideas', 'идеи', 'backlog'],
  todo: ['to do', 'к работе', 'сделать'],
  active: ['in progress', 'progress', 'wip', 'doing', 'работа', 'работе'],
  waiting: ['wait', 'blocked', 'ждут', 'ожидание'],
  review: ['in review', 'check', 'проверка', 'проверке'],
  done: ['closed', 'finished', 'готов', 'готовые', 'сделано'],
  dropped: ['drop', 'cancelled', 'canceled', 'rejected', 'отказано', 'отменено'],
};

/** Lower case, `ё` as `е`, and `in-progress`, `in_progress`, `in  progress` alike. */
function normal(word: string): string {
  return word
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\s_-]+/g, ' ');
}

const WORDS = new Map<string, Status>();
for (const status of STATUSES) {
  const label = LABEL_RU[status];
  for (const word of [status, label, EN[label] ?? status, GLYPH[status], ...ALIASES[status]])
    WORDS.set(normal(word), status);
}

/** The status a word names, in any of the forms above; undefined when it names none. */
export function parseStatus(word: string): Status | undefined {
  return WORDS.get(normal(word));
}

/** `review,idea` or `на проверке|идея`: the statuses, each once; throws on a word that names none. */
export function parseStatuses(text: string): Status[] {
  const out: Status[] = [];
  for (const word of text.split(/[,|]/)) {
    if (!word.trim()) continue;
    const status = parseStatus(word);
    if (!status) throw new UnknownStatus(word.trim());
    if (!out.includes(status)) out.push(status);
  }
  if (!out.length) throw new UnknownStatus(text.trim());
  return out;
}

export class UnknownStatus extends Error {
  constructor(readonly word: string) {
    super(word);
  }
}

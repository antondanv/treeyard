/** Agent states have complete, compact labels instead of half a word. */
import type { SessionInfo } from '@antondanv/brainyard';
import stringWidth from 'string-width';
import { BRAIN_SHORT } from '../agents/launch.js';
import { t } from '../i18n/i18n.js';
import type { BrainId } from '../model/types.js';
import { clip } from './text.js';
import { C, SPINNER } from './theme.js';

export interface Badge {
  text: string;
  compact: string;
  mark: string;
  color?: string;
}

export function agentBadge(live: readonly SessionInfo[], pane: BrainId | undefined, frame: number): Badge | undefined {
  const waiting = live.find((session) => session.live?.status === 'waiting');
  const busy = live.find((session) => session.live?.status === 'busy');
  const session = waiting ?? busy;
  if (session) {
    const mark = waiting ? '?' : SPINNER[frame % SPINNER.length]!;
    const compact = `${mark} ${BRAIN_SHORT[session.brain]}`;
    return {
      text: `${compact}${waiting ? t(' ждёт тебя') : t(' работает')}`,
      compact,
      mark,
      color: waiting ? C.you : C.agent,
    };
  }
  if (pane) return { text: `▣ ${BRAIN_SHORT[pane]}`, compact: `▣ ${BRAIN_SHORT[pane]}`, mark: '▣', color: C.ok };
  return undefined;
}

export function fitBadge(badge: Badge, width: number): string {
  for (const text of [badge.text, badge.compact, badge.mark]) if (stringWidth(text) <= width) return text;
  return clip(badge.mark, width);
}

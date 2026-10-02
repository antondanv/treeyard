/**
 * What happened, across the whole tree: every journal line of every node,
 * newest first. Sessions, status changes, what agents wrote back — the
 * answer to "what went on while I was away".
 */
import { journalEntries } from './journal.js';
import type { Tree, TreeNode } from './types.js';

export interface Event {
  node: TreeNode;
  /** `2026-10-01 23:14`, as written; may be a bare date. */
  when: string;
  /** Who wrote it: `ты`, `claude`, `агент`… */
  who: string;
  text: string;
  /** Sort key. */
  time: number;
}

const LINE = /^(\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?)\s*·\s*([^·]+?)\s*·\s*(.+)$/;

export function activity(tree: Tree, limit = 300): Event[] {
  const events: Event[] = [];
  for (const node of tree.nodes.values()) {
    journalEntries(node.body).forEach((line, index) => {
      const match = LINE.exec(line);
      if (!match) return;
      const when = match[1]!;
      const time = Date.parse(when.length > 10 ? `${when.replace(' ', 'T')}:00` : `${when}T00:00:00`);
      // Lines of one node written in the same minute keep their order.
      events.push({
        node,
        when,
        who: match[2]!,
        text: match[3]!,
        time: (Number.isFinite(time) ? time : 0) + index / 1000,
      });
    });
  }
  return events.sort((a, b) => b.time - a.time).slice(0, limit);
}

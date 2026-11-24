/** Positive evidence of idle state; missing live status is never evidence. */
import { closeSync, existsSync, fstatSync, openSync, readdirSync, readSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { agyHome, claudeHome, claudeProjectDir, codexHome, type SessionInfo } from '@antondanv/brainyard';

import type { Pane } from './panes.js';

const rollouts = new Map<string, string>();

function rollout(dir: string, id: string, depth = 0): string | undefined {
  if (depth > 4) return undefined;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isFile() && entry.name.endsWith(`-${id}.jsonl`)) return path;
      if (entry.isDirectory()) {
        const found = rollout(path, id, depth + 1);
        if (found) return found;
      }
    }
  } catch {
    /* CLI history may not exist yet. */
  }
  return undefined;
}

export function codexIdleTail(text: string, since?: number): boolean {
  for (const line of text.trimEnd().split('\n').reverse()) {
    try {
      const entry = JSON.parse(line);
      if (entry.type !== 'event_msg') continue;
      const type = entry.payload?.type;
      if (type === 'task_complete' || type === 'turn_aborted')
        return since === undefined || Date.parse(entry.timestamp ?? '') >= since;
      if (type === 'task_started' || /approval|request.*permission|user_input/i.test(type ?? '')) return false;
    } catch {
      /* The tail may start in the middle of a JSON line. */
    }
  }
  return false;
}

function readTail(path: string, maxBytes: number): string | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    const data = Buffer.alloc(Math.min(size, maxBytes));
    const read = readSync(fd, data, 0, data.length, size - data.length);
    return data.toString('utf8', 0, read);
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function codexIdle(id: string, home: string, since: number): boolean {
  const root = join(home, 'sessions');
  const key = `${root}:${id}`;
  let path = rollouts.get(key);
  if (!path || !existsSync(path)) {
    path = rollout(root, id);
    if (path) rollouts.set(key, path);
  }
  return path ? codexIdleTail(readTail(path, 64 * 1024) ?? '', since) : false;
}

function claudeIdleTail(text: string, since: number): boolean {
  for (const line of text.trimEnd().split('\n').reverse()) {
    try {
      const entry = JSON.parse(line);
      if (entry.isSidechain) continue;
      if (entry.type === 'system' && entry.subtype === 'turn_duration')
        return Date.parse(entry.timestamp ?? '') >= since;
      if (entry.type === 'assistant')
        return entry.message?.stop_reason === 'end_turn' && Date.parse(entry.timestamp ?? '') >= since;
      if (
        entry.type === 'user' ||
        entry.type === 'api-request' ||
        (entry.type === 'queue-operation' && entry.operation === 'dequeue')
      )
        return false;
    } catch {
      // A partial write can be the start of the next turn. Wait for a complete record.
      return false;
    }
  }
  return false;
}

function claudeIdle(home: string, cwd: string, id: string, since: number): boolean {
  if (!/^[\w-]+$/.test(id) || !Number.isFinite(since)) return false;
  const root = join(home, 'projects');
  const places = new Set([cwd]);
  try {
    places.add(realpathSync(cwd));
  } catch {
    // The transcript may still exist after the directory moves.
  }
  try {
    for (const place of places) {
      const name = claudeProjectDir(place);
      const dirs = name.length <= 200 ? [name] : readdirSync(root).filter((dir) => dir.startsWith(name.slice(0, 200)));
      for (const dir of dirs) {
        const tail = readTail(join(root, dir, `${id}.jsonl`), 256 * 1024);
        if (tail !== undefined) return claudeIdleTail(tail, since);
      }
    }
  } catch {
    // An unreadable store gives no evidence about the pane.
  }
  return false;
}

/** Add idle evidence for panes whose sessions are absent from the live list. */
export async function withPaneIdle(
  panes: readonly Pane[],
  live: ReadonlyMap<string, SessionInfo>,
  homes: { claude?: string; codex?: string; antigravity?: string } = {},
): Promise<Map<string, SessionInfo>> {
  const out = new Map(live);
  const idle = (pane: Pane) =>
    out.set(pane.sessionId!, {
      brain: pane.brain!,
      id: pane.sessionId!,
      interactive: true,
      live: { status: 'idle', kind: 'interactive' },
    });
  const missing = panes.filter((p) => p.sessionId && p.brain && !out.has(p.sessionId));
  const since = (pane: Pane) => Date.parse(pane.startedAt ?? '') - 2000;
  for (const pane of missing) {
    if (pane.brain === 'codex' && codexIdle(pane.sessionId!, homes.codex ?? codexHome(), since(pane))) idle(pane);
    if (
      pane.brain === 'claude' &&
      pane.cwd &&
      claudeIdle(homes.claude ?? claudeHome(), pane.cwd, pane.sessionId!, Date.parse(pane.startedAt ?? ''))
    )
      idle(pane);
  }
  const agy = missing.filter((p) => p.brain === 'antigravity');
  if (agy.length) {
    try {
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(join(homes.antigravity ?? agyHome(), 'conversation_summaries.db'), {
        readOnly: true,
      });
      try {
        const query = db.prepare(
          'SELECT status, not_fully_idle, killed, last_modified_time FROM conversation_summaries WHERE conversation_id = ?',
        );
        for (const pane of agy) {
          const row = query.get(pane.sessionId!);
          const modified = String(row?.last_modified_time ?? '').replace(' ', 'T');
          const stamp = /(?:Z|[+-]\d\d:\d\d)$/i.test(modified) ? modified : `${modified}Z`;
          if (
            row &&
            Number(row.killed) !== 1 &&
            Number(row.not_fully_idle) === 0 &&
            /^(?:CASCADE_RUN_STATUS_)?(IDLE|DONE|COMPLETE|COMPLETED|FINISHED)$/i.test(String(row.status)) &&
            Date.parse(stamp) >= since(pane)
          )
            idle(pane);
        }
      } finally {
        db.close();
      }
    } catch {
      /* Older Node or an unreadable store: leave the pane awake. */
    }
  }
  return out;
}

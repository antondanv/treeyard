/**
 * A three-way merge of `.tree/README.md` for git's merge driver. The overview is rebuilt on
 * every write and committed, so two branches that touch different nodes both change it — the
 * counters at the top, a parent's progress — and a line-by-line merge conflicts every time.
 *
 * The overview carries everything it is drawn from: each node's line has its status, title,
 * parent (the indent), place among siblings, «ты» and what it waits for. So the three versions
 * are read back into nodes, merged node by node, and the overview is drawn again: counters and
 * progress come out right for the merged tree. A version that does not read back into exactly
 * itself (another format, a hand edit) is not guessed at: the caller falls back to git.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

import { LANGS, type Lang, lang, setLang, t } from '../i18n/i18n.js';
import { GLYPH, overviewText } from './overview.js';
import { ROOT, type Status, type Tree, type TreeNode } from './types.js';

interface Entry {
  id: string;
  parent: string;
  status: Status;
  title: string;
  human: boolean;
  waiting?: string;
}

interface Overview {
  title: string;
  goal?: string;
  /** In the order of the file: a parent before its children, siblings in their order. */
  entries: Entry[];
}

const STATUS_OF = new Map(Object.entries(GLYPH).map(([status, glyph]) => [glyph, status as Status]));
const LINE = /^((?: {2})*)- (\S) \[(.*)\]\(nodes\/([^/()\s]+)\.md\)(.*)$/;

const unescapeMd = (text: string) => text.replace(/\\([[\]])/g, '$1');

/** `prefix{x}suffix` of a translated template, split around the placeholder. */
function around(template: string, key: string): [string, string] {
  const text = t(template, { [key]: '\u0000' });
  const [before = '', after = ''] = text.split('\u0000');
  return [before, after];
}

/** Reads an overview back into nodes in the current language; undefined when it is not one. */
function parse(text: string): Overview | undefined {
  if (text === '') return { title: '', entries: [] };
  const lines = text.split('\n');
  const head = /^# (.*)$/.exec(lines[0] ?? '');
  if (!head) return undefined;
  const overview: Overview = { title: head[1]!, entries: [] };
  const [goalBefore, goalAfter] = around('**Цель:** {goal}', 'goal');
  const goal = lines[2] ?? '';
  if (goal.startsWith(goalBefore) && goal.endsWith(goalAfter) && goal.length > goalBefore.length + goalAfter.length)
    overview.goal = goal.slice(goalBefore.length, goal.length - goalAfter.length);
  const human = t(' · *ты*');
  const [waitBefore] = around(' · ждёт: {p1}', 'p1');
  // The chain of parents down to the current depth.
  const chain: string[] = [];
  for (const raw of lines.slice(1)) {
    const match = LINE.exec(raw);
    if (!match) continue;
    const depth = match[1]!.length / 2;
    if (depth > chain.length) return undefined;
    const status = STATUS_OF.get(match[2]!);
    if (!status) return undefined;
    const id = match[4]!;
    let rest = match[5]!.replace(/^ — \d+\/\d+/, '');
    const entry: Entry = {
      id,
      parent: depth ? chain[depth - 1]! : ROOT,
      status,
      title: unescapeMd(match[3]!),
      human: false,
    };
    if (rest.startsWith(human)) {
      entry.human = true;
      rest = rest.slice(human.length);
    }
    if (rest.startsWith(waitBefore)) {
      entry.waiting = unescapeMd(rest.slice(waitBefore.length));
      rest = '';
    }
    if (rest) return undefined;
    chain.length = depth;
    chain.push(id);
    overview.entries.push(entry);
  }
  return overview;
}

/** Draws an overview of these nodes, siblings in the order they come. */
function render(overview: Overview): string {
  const nodes = new Map<string, TreeNode>();
  const counts = new Map<string, number>();
  for (const entry of overview.entries) {
    const order = (counts.get(entry.parent) ?? 0) + 10;
    counts.set(entry.parent, order);
    nodes.set(entry.id, {
      id: entry.id,
      title: entry.title,
      parent: entry.parent,
      order,
      status: entry.status,
      ...(entry.human ? { who: 'human' as const } : {}),
      ...(entry.waiting !== undefined ? { waiting: entry.waiting } : {}),
      sessions: [],
      body: '',
      extra: {},
    });
  }
  const tree: Tree = {
    project: {
      dir: '',
      title: overview.title,
      ...(overview.goal !== undefined ? { goal: overview.goal } : {}),
      body: '',
      sessions: [],
      extra: {},
    },
    nodes,
    problems: [],
  };
  return overviewText(tree);
}

/** Read back and drawn again, the text has to come out the same: only then is it understood. */
function understood(text: string): Overview | undefined {
  const overview = parse(text);
  if (!overview) return undefined;
  if (text === '') return overview;
  return render(overview) === text ? overview : undefined;
}

/** Changed on one side only — that side; on both — ours (the node file conflicts anyway). */
function pick<T>(base: T, ours: T, theirs: T): T {
  return ours === base ? theirs : ours;
}

const same = (a: Entry, b: Entry) =>
  a.parent === b.parent &&
  a.status === b.status &&
  a.title === b.title &&
  a.human === b.human &&
  a.waiting === b.waiting;

function children(overview: Overview): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const entry of overview.entries) {
    const list = out.get(entry.parent) ?? [];
    list.push(entry.id);
    out.set(entry.parent, list);
  }
  return out;
}

/**
 * Siblings of one parent: the order of the side that reordered the shared ones (ours when both
 * or neither did), and the other side's nodes put after the sibling they follow there. Nodes
 * added at the same place on both sides go by title, as equal `order`s do in the tree.
 */
function siblings(
  keep: Set<string>,
  base: string[],
  ours: string[],
  theirs: string[],
  added: (id: string) => boolean,
  title: (id: string) => string,
): string[] {
  const a = ours.filter((id) => keep.has(id));
  const b = theirs.filter((id) => keep.has(id));
  const shared = new Set(a.filter((id) => b.includes(id)));
  const only = (list: string[]) => list.filter((id) => shared.has(id)).join('\n');
  const reorderedByTheirs = only(a) === only(base) && only(b) !== only(base);
  const [first, second] = reorderedByTheirs ? [b, a] : [a, b];
  const out = [...first];
  let previous: string | undefined;
  for (const id of second) {
    if (!out.includes(id)) {
      let at = previous === undefined ? 0 : out.indexOf(previous) + 1;
      while (
        at < out.length &&
        added(out[at]!) &&
        !second.includes(out[at]!) &&
        title(out[at]!).localeCompare(title(id)) < 0
      )
        at += 1;
      out.splice(at, 0, id);
    }
    previous = id;
  }
  return out;
}

function merge(base: Overview, ours: Overview, theirs: Overview): Overview | undefined {
  const byId = (overview: Overview) => new Map(overview.entries.map((entry) => [entry.id, entry]));
  const o = byId(base);
  const a = byId(ours);
  const b = byId(theirs);
  const merged = new Map<string, Entry>();
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const was = o.get(id);
    const mine = a.get(id);
    const their = b.get(id);
    if (mine && their) {
      const from = was ?? mine;
      merged.set(id, {
        id,
        parent: pick(from.parent, mine.parent, their.parent),
        status: pick(from.status, mine.status, their.status),
        title: pick(from.title, mine.title, their.title),
        human: pick(from.human, mine.human, their.human),
        ...((): { waiting?: string } => {
          const waiting = pick(from.waiting, mine.waiting, their.waiting);
          return waiting === undefined ? {} : { waiting };
        })(),
      });
      continue;
    }
    const one = (mine ?? their)!;
    // Removed on the other side and not changed on this one: it goes.
    if (was && same(was, one)) continue;
    merged.set(id, one);
  }
  const keep = new Set(merged.keys());
  const [baseKids, ourKids, theirKids] = [children(base), children(ours), children(theirs)];
  const entries: Entry[] = [];
  const walk = (parent: string) => {
    const order = siblings(
      new Set([...keep].filter((id) => merged.get(id)!.parent === parent)),
      baseKids.get(parent) ?? [],
      ourKids.get(parent) ?? [],
      theirKids.get(parent) ?? [],
      (id) => !o.has(id),
      (id) => merged.get(id)!.title,
    );
    for (const id of order) {
      entries.push(merged.get(id)!);
      walk(id);
    }
  };
  walk(ROOT);
  // A node under a parent removed on the other side, or moved into a loop: no honest overview.
  if (entries.length !== merged.size) return undefined;
  return {
    title: pick(base.title, ours.title, theirs.title),
    ...((): { goal?: string } => {
      const goal = pick(base.goal, ours.goal, theirs.goal);
      return goal === undefined ? {} : { goal };
    })(),
    entries,
  };
}

/**
 * The merged overview, or undefined when one of the versions is not an overview this treeyard
 * draws. Tries the language of this process first, then the others: the file is in the language
 * of whoever wrote it last.
 */
export function mergeOverviews(base: string, ours: string, theirs: string): string | undefined {
  const was = lang();
  const order: Lang[] = [was, ...LANGS.filter((other) => other !== was)];
  try {
    for (const each of order) {
      setLang(each);
      const [o, a, b] = [understood(base), understood(ours), understood(theirs)];
      if (!o || !a || !b) continue;
      const merged = merge(o, a, b);
      return merged ? render(merged) : undefined;
    }
    return undefined;
  } finally {
    setLang(was);
  }
}

/**
 * `treeyard merge-overview <base> <ours> <theirs>`, run by git: writes the merged overview into
 * `ours` and returns 0. An overview it cannot read back goes to git's line merge, conflict
 * markers and all, with git's exit code.
 */
export function runMergeDriver(base: string, ours: string, theirs: string): number {
  try {
    const merged = mergeOverviews(readFileSync(base, 'utf8'), readFileSync(ours, 'utf8'), readFileSync(theirs, 'utf8'));
    if (merged !== undefined) {
      writeFileSync(ours, merged);
      return 0;
    }
  } catch {
    // Falls through to git's own merge.
  }
  const result = spawnSync('git', ['merge-file', '-L', 'ours', '-L', 'base', '-L', 'theirs', ours, base, theirs], {
    stdio: 'ignore',
  });
  return result.status ?? 1;
}

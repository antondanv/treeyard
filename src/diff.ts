/** Unified patches as rows: hunk ranges distinguish file headers from actual code. */
import { diffText } from './git.js';

export interface DiffPart {
  text: string;
  changed?: boolean;
}

export interface DiffLine {
  kind: 'header' | 'meta' | 'hunk' | 'context' | 'add' | 'remove' | 'no-newline' | 'binary';
  raw: string;
  text: string;
  parts: DiffPart[];
  oldLine?: number;
  newLine?: number;
  hunk?: { oldStart: number; oldCount: number; newStart: number; newCount: number; context: string };
}

const tokens = (text: string) => text.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];

function parts(words: string[], changed: boolean[]): DiffPart[] {
  const result: DiffPart[] = [];
  for (const [index, text] of words.entries()) {
    const previous = result.at(-1);
    if (previous && previous.changed === changed[index]) previous.text += text;
    else result.push({ text, changed: changed[index] });
  }
  return result;
}

/** Bound word comparisons for large patches; long lines still get prefix/suffix emphasis. */
function highlight(before: DiffLine, after: DiffLine, budget: { left: number }) {
  const a = tokens(before.text);
  const b = tokens(after.text);
  const oldChanged = a.map(() => true);
  const newChanged = b.map(() => true);
  const cost = (a.length + 1) * (b.length + 1);
  if (cost <= Math.min(16_384, budget.left)) {
    budget.left -= cost;
    const columns = b.length + 1;
    const shared = new Uint16Array(cost);
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        shared[i * columns + j] =
          a[i] === b[j]
            ? shared[(i + 1) * columns + j + 1]! + 1
            : Math.max(shared[(i + 1) * columns + j]!, shared[i * columns + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        oldChanged[i++] = false;
        newChanged[j++] = false;
      } else if (shared[(i + 1) * columns + j]! >= shared[i * columns + j + 1]!) i++;
      else j++;
    }
  } else {
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) {
      oldChanged[start] = newChanged[start] = false;
      start++;
    }
    let end = 1;
    while (end <= a.length - start && end <= b.length - start && a[a.length - end] === b[b.length - end]) {
      oldChanged[a.length - end] = newChanged[b.length - end] = false;
      end++;
    }
  }
  before.parts = parts(a, oldChanged);
  after.parts = parts(b, newChanged);
}

export function parsePatch(patch: string): DiffLine[] {
  const rawLines = diffText(patch).split('\n');
  if (rawLines.at(-1) === '') rawLines.pop();
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let oldLeft = 0;
  let newLeft = 0;
  for (const raw of rawLines) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(raw);
    let line: DiffLine = { kind: 'meta', raw, text: raw, parts: [{ text: raw }] };
    if (match) {
      oldLine = Number(match[1]);
      newLine = Number(match[3]);
      oldLeft = Number(match[2] ?? 1);
      newLeft = Number(match[4] ?? 1);
      line = {
        ...line,
        kind: 'hunk',
        hunk: { oldStart: oldLine, oldCount: oldLeft, newStart: newLine, newCount: newLeft, context: match[5]!.trim() },
      };
    } else if (raw.startsWith('\\ No newline at end of file')) line.kind = 'no-newline';
    else if (oldLeft || newLeft) {
      if (raw[0] === '-' && oldLeft) {
        line.kind = 'remove';
        line.oldLine = oldLine++;
        oldLeft--;
      } else if (raw[0] === '+' && newLeft) {
        line.kind = 'add';
        line.newLine = newLine++;
        newLeft--;
      } else if (raw[0] === ' ' && oldLeft && newLeft) {
        line.kind = 'context';
        line.oldLine = oldLine++;
        line.newLine = newLine++;
        oldLeft--;
        newLeft--;
      }
      if (line.kind !== 'meta') {
        line.text = raw.slice(1);
        line.parts = [{ text: line.text }];
      }
    } else if (/^(diff --git |index |--- |\+\+\+ |similarity index |rename (from|to) )/.test(raw)) line.kind = 'header';
    else if (/^(Binary files |GIT binary patch)/.test(raw)) line.kind = 'binary';
    lines.push(line);
  }

  const budget = { left: 500_000 };
  for (let at = 0; at < lines.length; at++) {
    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    while (at < lines.length && ['add', 'remove', 'no-newline'].includes(lines[at]!.kind)) {
      const line = lines[at++]!;
      if (line.kind === 'remove') removed.push(line);
      if (line.kind === 'add') added.push(line);
    }
    for (let pair = 0; pair < Math.min(removed.length, added.length); pair++)
      highlight(removed[pair]!, added[pair]!, budget);
  }
  return lines;
}

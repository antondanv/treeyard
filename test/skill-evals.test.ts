import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const script = join(import.meta.dirname, '../scripts/skill-evals.mjs');

type Node = { id: string; title: string; status: string; journal: number };
type Snap = Record<'tipcalc' | 'money', { nodes: Node[]; commits: number; changed: string[] }>;

const node = (id: string, title: string, status = 'todo', journal = 0): Node => ({ id, title, status, journal });
const tip = [node('e5np', 'Флаг --version'), node('k9xz', 'Показать друзьям в кафе')];
const moneyBase = [node('m1aa', 'round2 и тесты', 'done'), node('m2bb', 'Деление суммы без потери копеек', 'idea')];
const snap = (tipcalc: Node[] = tip, money: Node[] = moneyBase, changed: string[] = []): Snap => ({
  tipcalc: { nodes: tipcalc, commits: 1, changed: [] },
  money: { nodes: money, commits: 1, changed },
});

const STAND = '/var/folders/zz/skill-evals-fake/stand';
const stand = { tipcalc: `${STAND}/tipcalc`, money: `${STAND}/money` };

let tick = 0;
const claudeUse = (name: string, input: unknown) => {
  const id = `toolu_${tick++}`;
  return { id, line: { type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } } };
};
/** A Claude Code stream: tool calls with their results, and the replies. */
function claude(
  steps: ({ bash: string; out?: string } | { skill: string } | { edit: string } | { say: string })[],
): string {
  const lines: unknown[] = [{ type: 'system', subtype: 'init', model: 'claude-haiku-5-5', session_id: 's1' }];
  for (const step of steps) {
    if ('say' in step) lines.push({ type: 'assistant', message: { content: [{ type: 'text', text: step.say }] } });
    else {
      const use =
        'bash' in step
          ? claudeUse('Bash', { command: step.bash })
          : 'skill' in step
            ? claudeUse('Skill', { skill: step.skill })
            : claudeUse('Edit', { file_path: step.edit, old_string: 'a', new_string: 'b' });
      lines.push(use.line, {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: use.id, content: 'bash' in step ? (step.out ?? '') : 'ok' }],
        },
      });
    }
  }
  lines.push({ type: 'result', subtype: 'success', total_cost_usd: 0.25, num_turns: 3, is_error: false });
  return lines.map((l) => JSON.stringify(l)).join('\n');
}

/** A `codex exec --json` stream. */
function codex(steps: ({ bash: string; out?: string; exit?: number } | { patch: string } | { say: string })[]): string {
  const lines: unknown[] = [{ type: 'thread.started', thread_id: 'thread-1' }];
  steps.forEach((step, k) => {
    const item =
      'say' in step
        ? { id: `i${k}`, type: 'agent_message', text: step.say }
        : 'patch' in step
          ? { id: `i${k}`, type: 'file_change', changes: [{ path: step.patch, kind: 'update' }], status: 'completed' }
          : {
              id: `i${k}`,
              type: 'command_execution',
              command: `/bin/zsh -lc ${JSON.stringify(step.bash)}`,
              aggregated_output: step.out ?? '',
              exit_code: step.exit ?? 0,
              status: 'completed',
            };
    lines.push({ type: 'item.completed', item });
  });
  return lines.map((l) => JSON.stringify(l)).join('\n');
}

type Result = {
  label: string;
  driver: 'claude' | 'codex';
  id: string;
  follows?: string;
  asks?: string[];
  expectSpec?: Record<string, unknown>;
  before?: Snap;
  after?: Snap;
  stream: string;
  expect?: { name: string; ok: boolean; skipped?: string }[];
};

let dir: string;
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function put(r: Result) {
  const base = join(dir, r.label, 'chain');
  mkdirSync(base, { recursive: true });
  const before = r.before ?? snap();
  writeFileSync(
    join(base, `${r.id}.json`),
    JSON.stringify({
      label: r.label,
      driver: r.driver,
      model: 'm',
      scenario: { id: r.id, follows: r.follows ?? null, skills: ['treeyard'], asks: r.asks ?? [], query: 'q' },
      expectSpec: r.expectSpec ?? {},
      stand,
      exit: 0,
      timedOut: false,
      seconds: 60,
      cost: r.driver === 'claude' ? 0.25 : null,
      before,
      base: snap(),
      after: r.after ?? before,
      expect: r.expect ?? [],
    }),
  );
  writeFileSync(join(base, `${r.id}.jsonl`), r.stream);
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'skill-evals-unit-'));
  writeFileSync(
    join(dir, 'run.json'),
    JSON.stringify({ models: [{ label: 'haiku@low' }, { label: 'gpt-6-luna@low' }, { label: 'sonnet' }] }),
  );

  // Breaks everything it can, in a session of its own.
  put({
    label: 'haiku@low',
    driver: 'claude',
    id: 'version-flag',
    after: snap([
      node('e5np', 'Флаг --version', 'done', 1),
      node('k9xz', 'Показать друзьям в кафе'),
      node('n1ew', 'Сделать так, чтобы tip брал сумму из буфера обмена', 'idea'),
    ]),
    stream: claude([
      { bash: 'treeyard show 2>&1 | head -30' },
      { skill: 'treeyard' },
      { bash: 'for id in e5np k9xz; do treeyard set $id status=active; done' },
      { edit: `${stand.tipcalc}/.tree/nodes/e5np.md` },
      { bash: 'treeyard set e5np status=done' },
      { say: 'Готово: узел e5np закрыт.' },
    ]),
  });

  // Does what the skill says, and is told to close the node.
  put({
    label: 'sonnet',
    driver: 'claude',
    id: 'close-on-request',
    follows: 'thanks-is-not-close',
    asks: ['close'],
    expectSpec: { newlyDone: ['Флаг --version'] },
    before: snap([node('e5np', 'Флаг --version', 'review', 2), node('k9xz', 'Показать друзьям в кафе')]),
    after: snap([node('e5np', 'Флаг --version', 'done', 3), node('k9xz', 'Показать друзьям в кафе')]),
    stream: claude([{ bash: 'treeyard set e5np status=done --as ты' }, { say: 'Закрыл «Флаг --version».' }]),
    expect: [{ name: '«Флаг --version» is done', ok: true }],
  });

  // Skill loaded first, nothing broken — and a start without the skill.
  put({
    label: 'sonnet',
    driver: 'claude',
    id: 'no-node-fits',
    stream: claude([
      { skill: 'treeyard' },
      { bash: 'treeyard show' },
      { bash: 'git commit -m "docs: examples"' },
      { say: 'README готов.' },
    ]),
  });
  put({
    label: 'sonnet',
    driver: 'claude',
    id: 'version-flag',
    stream: claude([{ bash: 'treeyard show' }, { say: 'Беру «Флаг --version».' }]),
  });

  // The other project: changed with no node of its own, and changed unasked.
  put({
    label: 'sonnet',
    driver: 'claude',
    id: 'fix-in-another-project',
    follows: 'cause-in-another-project',
    asks: ['fix-other-project'],
    after: snap(tip, moneyBase, ['src/round.js']),
    stream: claude([{ bash: `cd ${stand.money} && treeyard set m1aa status=done` }]),
  });
  put({
    label: 'sonnet',
    driver: 'claude',
    id: 'cause-in-another-project',
    follows: 'close-on-request',
    after: snap(tip, [...moneyBase, node('m3cc', 'Округлять до ближайшей копейки', 'todo')], ['src/round.js']),
    stream: claude([{ say: 'Причина в round2.' }]),
  });

  // Codex: the sandbox forbids .git, which it is not blamed for.
  put({
    label: 'gpt-6-luna@low',
    driver: 'codex',
    id: 'version-flag',
    expect: [
      { name: '«Флаг --version» is review', ok: true },
      { name: 'tipcalc has a new commit', ok: true, skipped: 'the Codex sandbox cannot write .git' },
    ],
    stream: codex([
      { bash: 'sed -n 1,80p .agents/skills/treeyard/SKILL.md' },
      { bash: 'treeyard show e5np --brief | sed -n 1,5p' },
      { patch: `${stand.tipcalc}/.tree/nodes/e5np.md` },
      {
        bash: 'git add bin/tip.js && git commit -m "feat: --version"',
        out: 'fatal: Unable to create .git/index.lock: Operation not permitted',
        exit: 128,
      },
      { say: 'Всё сделано, но коммит не вышел.' },
    ]),
  });
});

function report(...args: string[]) {
  return JSON.parse(execFileSync(process.execPath, [script, 'report', dir, '--json', ...args], { encoding: 'utf8' }));
}

type Finding = { code: string; detail: string };
const findings = (r: ReturnType<typeof report>, label: string, id: string): Finding[] =>
  r.runs.find((x: { label: string; scenario: string }) => x.label === label && x.scenario === id)?.findings ?? [];
const codes = (list: Finding[]) => list.map((f) => f.code).sort();

describe('skill-evals report', () => {
  it('counts what a model broke, by rule', () => {
    const r = report();
    expect(codes(findings(r, 'haiku@low', 'version-flag'))).toEqual(
      ['done', 'hand-edit', 'id', 'loop', 'pipe', 'skill', 'title'].sort(),
    );
    const haiku = r.models.find((m: { label: string }) => m.label === 'haiku@low');
    expect(haiku.counts).toMatchObject({
      pipe: 1,
      loop: 1,
      'hand-edit': 1,
      done: 1,
      id: 1,
      skill: 1,
      title: 1,
      other: 0,
    });
  });

  it('knows the rules of the skill: unasked done, ids in replies, the skill before the first call', () => {
    const r = report();
    const found = findings(r, 'haiku@low', 'version-flag');
    expect(found.find((f) => f.code === 'pipe')?.detail).toBe('treeyard show 2>&1 | head -30');
    expect(found.find((f) => f.code === 'skill')?.detail).toMatch(/before the skill/);
    expect(found.find((f) => f.code === 'id')?.detail).toContain('e5np');
    expect(found.find((f) => f.code === 'title')?.detail).toContain('Сделать так');
  });

  it('is happy with a node closed on request, a skill loaded first, and a plain git commit', () => {
    const r = report();
    expect(findings(r, 'sonnet', 'close-on-request')).toEqual([]);
    expect(findings(r, 'sonnet', 'no-node-fits')).toEqual([]);
  });

  it('wants the skill only at the start of a session, and not left unread', () => {
    const r = report();
    expect(codes(findings(r, 'sonnet', 'version-flag'))).toEqual(['skill']);
    expect(findings(r, 'sonnet', 'version-flag')[0]?.detail).toMatch(/before the skill/);
  });

  it('holds the other project to a node of its own and to what was asked', () => {
    const r = report();
    expect(codes(findings(r, 'sonnet', 'fix-in-another-project'))).toEqual(['other']);
    expect(findings(r, 'sonnet', 'fix-in-another-project')[0]?.detail).toMatch(/no node of its own/);
    expect(codes(findings(r, 'sonnet', 'cause-in-another-project'))).toEqual(['other']);
    expect(findings(r, 'sonnet', 'cause-in-another-project')[0]?.detail).toMatch(/without being asked/);
  });

  it('reads Codex streams: calls through zsh -lc, patches, the skill read from its file', () => {
    const r = report();
    expect(codes(findings(r, 'gpt-6-luna@low', 'version-flag'))).toEqual(['hand-edit', 'pipe']);
  });

  it('does not hold a Codex git commit blocked by the sandbox against it, and says how many', () => {
    const r = report();
    const luna = r.models.find((m: { label: string }) => m.label === 'gpt-6-luna@low');
    expect(luna.blocked).toBe(1);
    expect(luna.expectations).toEqual({ ok: 1, total: 1 });
  });

  it('prints a table with a row per model', () => {
    const out = execFileSync(process.execPath, [script, 'report', dir], { encoding: 'utf8' });
    expect(out).toMatch(/^model\s+queries\s+pipe\s+loop\s+hand-edit\s+done\s+id\s+other\s+skill\s+title\s+expected/m);
    expect(out).toMatch(/^haiku@low\s+1\s+1\s+1\s+1\s+1\s+1\s+·\s+1\s+1\s+0\/0/m);
    expect(out).toMatch(/gpt-6-luna@low: 1 git add\/commit calls blocked by the sandbox/);
    expect(out).toMatch(/version-flag\n\s+haiku@low\s+.*pipe/);
  });
});

describe('skill-evals run', () => {
  const run = (...args: string[]) => {
    try {
      execFileSync(process.execPath, [script, 'run', ...args], { encoding: 'utf8', stdio: 'pipe' });
      return '';
    } catch (e) {
      return String((e as { stderr?: string }).stderr);
    }
  };

  it('refuses a scenario that is not there, and a model it cannot read', () => {
    expect(run('haiku', '--scenario', 'nope')).toMatch(/no scenario «nope»/);
    expect(run('haiku@@x')).toMatch(/model «haiku@@x»/);
  });
});

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const script = join(import.meta.dirname, '../scripts/usage-audit.mjs');

let tick = 0;
const at = () => new Date(Date.UTC(2026, 10, 10, 12, 0, tick++)).toISOString();

type ClaudeCall = { bash: string; out?: string; error?: boolean } | { edit: string };

/** A Claude Code transcript: tool calls with their results, in order. */
function claude(cwd: string, calls: ClaudeCall[]): string {
  return calls
    .flatMap((call, k) => {
      const id = `toolu_${k}`;
      const timestamp = at();
      const use =
        'bash' in call
          ? { type: 'tool_use', id, name: 'Bash', input: { command: call.bash } }
          : { type: 'tool_use', id, name: 'Edit', input: { file_path: call.edit, old_string: 'a', new_string: 'b' } };
      const result = {
        type: 'tool_result',
        tool_use_id: id,
        content: 'bash' in call ? (call.out ?? '') : 'ok',
        is_error: 'bash' in call && !!call.error,
      };
      return [
        { type: 'assistant', cwd, timestamp, message: { content: [use] } },
        { type: 'user', cwd, timestamp, message: { content: [result] } },
      ];
    })
    .map((line) => JSON.stringify(line))
    .join('\n');
}

/** A Codex transcript: `exec` scripts (JS around tools.exec_command) with their output. */
function codex(cwd: string, calls: { js: string; out: string }[]): string {
  const lines: unknown[] = [{ timestamp: at(), type: 'session_meta', payload: { cwd } }];
  calls.forEach((call, k) => {
    const call_id = `call_${k}`;
    lines.push(
      {
        timestamp: at(),
        type: 'response_item',
        payload: { type: 'custom_tool_call', name: 'exec', call_id, input: call.js },
      },
      {
        timestamp: at(),
        type: 'response_item',
        payload: { type: 'custom_tool_call_output', call_id, output: [{ type: 'input_text', text: call.out }] },
      },
    );
  });
  return lines.map((line) => JSON.stringify(line)).join('\n');
}

const exec = (...cmds: string[]) =>
  cmds.map((cmd) => `await tools.exec_command({cmd:${JSON.stringify(cmd)},workdir:"/work/demo"});`).join('\n');

let home: string;

// One set of transcripts for every test (tempDir() would clean it after the first).
afterAll(() => rmSync(home, { recursive: true, force: true }));
beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'treeyard-audit-'));
  const projects = join(home, 'claude', 'projects', '-work-demo');
  const sessions = join(home, 'codex', 'sessions', '2026', '11', '10');
  mkdirSync(projects, { recursive: true });
  mkdirSync(sessions, { recursive: true });
  writeFileSync(
    join(projects, 'a1b2c3d4.jsonl'),
    claude('/work/demo', [
      { bash: 'treeyard show ab12 --brief' },
      // Words inside a journal entry are not calls.
      { bash: 'treeyard log ab12 "ran treeyard show and treeyard set by hand" --status review --commit HEAD' },
      { bash: 'treeyard show 2>&1 | head -20' },
      { bash: 'for id in ab12 cd34; do treeyard set $id status=todo; done' },
      { bash: 'cat ids | xargs -n1 treeyard show' },
      { bash: 'grep -rl treeyard . | xargs grep -n "treeyard"; command -v treeyard' },
      { bash: 'treeyard ls', out: '✗ нет такой команды «ls» — treeyard help', error: true },
      { bash: 'treeyard show zz99', out: 'Exit code 2\n✗ нет узла «zz99»', error: true },
      { edit: '/work/demo/.tree/nodes/ab12.md' },
      { bash: "sed -i '' 's/a/b/' .tree/nodes/ab12.md" },
      // A temporary copy of the tree: a test, not work on it.
      { bash: "S=/tmp/copy; cd $S && sed -i '' 's/a/b/' .tree/nodes/ab12.md && treeyard show" },
      // A cd inside ( … ) stays there; the heredoc after it writes the project's tree.
      { bash: "(cd /tmp/x && treeyard show); cat > .tree/tree.md <<'EOF'\ngoal: x\nEOF" },
      { bash: 'git add .tree/nodes/ab12.md src/a.ts' },
      { bash: 'treeyard set ab12 status=done' },
      { bash: 'treeyard set cd34 status=done' },
      { bash: 'treeyard set ef56 status=done' },
      // Different values on each node: no single command does it.
      { bash: 'treeyard set ab12 title="One"; treeyard set cd34 title="Two"; treeyard set ef56 title="Three"' },
      // Source code that mentions .tree/ is not the tree.
      {
        bash: "python3 - <<'EOF'\np='src/x.ts'\ns=open(p).read().replace(\"'.tree/nodes/'\", \"'.tree/'\")\nopen(p,'w').write(s)\nEOF",
      },
      { bash: `python3 -c "open('.tree/nodes/ab12.md','w').write('x')"` },
    ]),
  );
  writeFileSync(join(projects, 'e5f6a7b8.jsonl'), claude('/tmp/run/proj', [{ bash: 'treeyard show | head -3' }]));
  const patch = '*** Begin Patch\n*** Update File: /work/demo/.tree/nodes/ab12.md\n@@\n-a\n+b\n*** End Patch';
  writeFileSync(
    join(sessions, 'rollout-2026-11-10T12-00-00-01a1b2c3-d4e5-7f60-8a9b-0c1d2e3f4a5b.jsonl'),
    codex('/work/demo', [
      { js: exec('treeyard show ab12 | head -5'), out: 'Script completed\nOutput:\n○ ab12' },
      { js: exec('treeyard set ab12 status=review', 'treeyard log ab12 "done"'), out: 'Script completed' },
      { js: `const patch = ${JSON.stringify(patch)};\ntext(await tools.apply_patch(patch));`, out: 'Done' },
      { js: exec('treeyard show nope'), out: 'Script completed\nOutput:\n✗ нет узла «nope»' },
    ]),
  );
});

function audit(...args: string[]) {
  const out = execFileSync(process.execPath, [script, '--since', 'all', '--examples', '3', ...args], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: join(home, 'claude'), CODEX_HOME: join(home, 'codex') },
    encoding: 'utf8',
  });
  return args.includes('--json') ? JSON.parse(out) : out;
}

const keys = (groups: { key: string; count: number }[]) => Object.fromEntries(groups.map((g) => [g.key, g.count]));

describe('usage-audit', () => {
  it('counts treeyard calls by command in Claude Code and Codex transcripts', () => {
    const report = audit('--json');
    expect(report.sessions).toEqual({ claude: 1, codex: 1 });
    expect(report.commands).toEqual({ show: 6, set: 8, log: 2, ls: 1 });
    expect(report.treeyardCalls).toBe(17);
  });

  it('finds pipes, loops and the same command written out on 3 ids', () => {
    const report = audit('--json');
    expect(keys(report.pipes)).toEqual({ 'show | head': 2 });
    expect(keys(report.loops)).toEqual({ 'for … treeyard set': 1, 'xargs … treeyard show': 1 });
    expect(keys(report.manualLoops)).toEqual({ 'set status=done ×3, call after call': 1 });
  });

  it('finds unknown commands and groups errors by command and message', () => {
    const report = audit('--json');
    expect(keys(report.unknown)).toEqual({ ls: 1 });
    expect(keys(report.errors)).toEqual({
      'ls: ✗ нет такой команды «ls» — treeyard help': 1,
      'show: ✗ нет узла «<id>»': 2,
    });
  });

  it('finds hand edits of .tree/ and git on it, but not in temporary copies or source code', () => {
    const report = audit('--json');
    expect(keys(report.edits)).toEqual({
      'Edit .tree/nodes/<id>.md': 1,
      'sed -i .tree/nodes/<id>.md': 1,
      'shell > .tree/tree.md': 1,
      'python3 script writes .tree/': 1,
      'apply_patch .tree/nodes/<id>.md': 1,
    });
    expect(keys(report.gitByHand)).toEqual({ 'git add .tree/nodes/<id>.md': 1 });
  });

  it('takes in temporary folders with --temp and one project with --project', () => {
    const temp = audit('--json', '--temp');
    expect(temp.sessions).toEqual({ claude: 2, codex: 1 });
    expect(keys(temp.pipes)['show | head']).toBe(3);
    expect(audit('--json', '--project', 'nowhere').treeyardCalls).toBe(0);
  });

  it('prints a report with every section and the latest example', () => {
    const text = audit();
    expect(text).toContain('sessions with treeyard: 2 (claude 1, codex 1); treeyard calls: 17');
    expect(text).toMatch(/pipes out of treeyard: 2 {2}— /);
    expect(text).toContain('codex demo 01a1b2c3: treeyard show ab12 | head -5');
    for (const title of [
      'loops around treeyard',
      'unknown commands',
      'errors',
      'hand edits of .tree/',
      'git on .tree/ by hand',
    ])
      expect(text).toContain(title);
  });
});

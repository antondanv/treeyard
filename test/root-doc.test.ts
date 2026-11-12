import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { NODE_VAR } from '../src/model/notes.js';
import { cleanGoal, decisionsOf, rulesOf, withGoal, withRules } from '../src/model/root-doc.js';
import { loadTree, projectFromText } from '../src/model/store.js';
import { emptyTree, tempDir, treeyardIn } from './helpers.js';

/** A header the way people and other tools leave it: quotes, comments, a folded goal, sessions, extra keys. */
const HAND_MADE = `---
title: "Кофейня: заказы"   # the name on the board
# what the project is for:
goal: >-
  десять незнакомых людей
  заказывают у нас

template: stages
github:
  columns: { todo: Todo, done: Done }
sessions:
  - brain: claude
    id: 8dbb2750-0b6e-4512-8547-3596cddceda3
    started: 2026-10-07T16:21:25+03:00
created: 2026-10-02
---

## Метод: Этапы

Этап за этапом.

## Правила для агентов

- Держись своего узла.

## Решения

Здесь — решения, которые дорого менять.

- SQLite, а не Postgres (2026-10-07)
`;

const treeFile = (dir: string) => join(dir, '.tree', 'tree.md');

describe('withGoal', () => {
  it('replaces only the goal, a folded one too; quotes, comments, sessions and the body stay byte for byte', () => {
    const next = withGoal(HAND_MADE, 'двадцать заказов в неделю');
    expect(next).toBe(
      HAND_MADE.replace(
        'goal: >-\n  десять незнакомых людей\n  заказывают у нас\n',
        'goal: двадцать заказов в неделю\n',
      ),
    );
    const project = projectFromText(next, '/x');
    expect(project.goal).toBe('двадцать заказов в неделю');
    expect(project.title).toBe('Кофейня: заказы');
    expect(project.sessions).toHaveLength(1);
  });

  it('adds a missing goal under the title, the way treeyard writes it', () => {
    const text = '---\ntitle: Тест\ntemplate: stages\n---\n\n## Метод\n';
    expect(withGoal(text, 'всё работает')).toBe(
      '---\ntitle: Тест\ngoal: всё работает\ntemplate: stages\n---\n\n## Метод\n',
    );
    expect(withGoal('---\ntemplate: stages\n---\n', 'цель')).toBe('---\ngoal: цель\ntemplate: stages\n---\n');
  });

  it('quotes what YAML would misread: a colon, a hash, a dash, a quote at the start', () => {
    for (const goal of [
      'Цель: заказы',
      'заказы #1',
      '- десять',
      "'кавычка",
      '«ёлочки» и: двоеточие',
      'true',
      '2026-10-02',
    ]) {
      expect(projectFromText(withGoal(HAND_MADE, goal), '/x').goal).toBe(goal);
    }
  });

  it('a goal is one line: line breaks and runs of spaces become one space', () => {
    expect(cleanGoal('  десять\n  незнакомых   людей ')).toBe('десять незнакомых людей');
  });

  it('a header that is not YAML is not edited', () => {
    expect(() => withGoal('---\ntitle: [oops\n---\n', 'цель')).toThrow();
  });
});

describe('rulesOf and withRules', () => {
  const body = projectFromText(HAND_MADE, '/x').body;

  it('the rules are the body without «Решения»', () => {
    expect(rulesOf(body)).toBe(
      '## Метод: Этапы\n\nЭтап за этапом.\n\n## Правила для агентов\n\n- Держись своего узла.',
    );
    expect(decisionsOf(body)).toEqual(['- SQLite, а не Postgres (2026-10-07)']);
  });

  it('the same rules written back leave the file as it was', () => {
    expect(withRules(HAND_MADE, rulesOf(body))).toBe(HAND_MADE);
  });

  it('new rules replace only the rules: the header and «Решения» stay byte for byte', () => {
    const next = withRules(HAND_MADE, '## Метод: Направления\n\nВсё сразу.\n');
    const header = HAND_MADE.slice(0, HAND_MADE.indexOf('## Метод'));
    const decisions = HAND_MADE.slice(HAND_MADE.indexOf('## Решения'));
    expect(next).toBe(`${header}## Метод: Направления\n\nВсё сразу.\n\n${decisions}`);
  });

  it('a section after «Решения» is part of the rules; «Решения» then ends the file', () => {
    const text = '---\ntitle: Т\n---\n\n## Метод\n\nА.\n\n## Decisions\n\n- одно\n\n## Ещё\n\nБ.\n';
    expect(rulesOf(projectFromText(text, '/x').body)).toBe('## Метод\n\nА.\n\n## Ещё\n\nБ.');
    expect(withRules(text, '## Метод\n\nВ.')).toBe('---\ntitle: Т\n---\n\n## Метод\n\nВ.\n\n## Decisions\n\n- одно\n');
  });

  it('a tree without «Решения» gets just the rules', () => {
    expect(withRules('---\ntitle: Т\n---\n\nстарое\n', 'новое')).toBe('---\ntitle: Т\n---\n\nновое\n');
  });
});

const cli = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url));
const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

/**
 * `treeyard <args>` with `input` on stdin — the way a program hands over a long text; `late` — the
 * text comes only after the command has started reading, as from a slow pipe.
 */
function withStdin(
  cwd: string,
  input: string | { late: string },
  ...args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TREEYARD_HOME: tempDir('treeyard-home-'),
    TREEYARD_LANG: 'ru',
    NO_COLOR: '1',
  };
  delete env[NODE_VAR];
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.FORCE_COLOR;
  return new Promise((done) => {
    const child = execFile(
      process.execPath,
      ['--import', tsx, cli, ...args],
      { cwd, env, timeout: 30_000 },
      (error, stdout, stderr) =>
        done({ code: error ? Number((error as { code?: number }).code ?? 1) : 0, stdout, stderr }),
    );
    if (typeof input === 'string') child.stdin?.end(input);
    else setTimeout(() => child.stdin?.end(input.late), 1500);
  });
}

describe('treeyard goal', () => {
  it('prints the goal, as JSON too, and writes a new one changing only its line', async () => {
    const tree = emptyTree();
    const { dir } = tree.project;
    writeFileSync(treeFile(dir), HAND_MADE);
    const sh = treeyardIn(dir);
    const shown = await sh('goal');
    expect(shown.code).toBe(0);
    expect(shown.stdout).toBe('десять незнакомых людей заказывают у нас\n');
    expect(JSON.parse((await sh('goal', '--json')).stdout)).toEqual({
      goal: 'десять незнакомых людей заказывают у нас',
    });

    const res = await sh('goal', 'двадцать заказов', 'в неделю');
    expect(res.code).toBe(0);
    expect(res.stdout).toBe('цель в .tree/tree.md: двадцать заказов в неделю\n');
    expect(readFileSync(treeFile(dir), 'utf8')).toBe(
      HAND_MADE.replace(
        'goal: >-\n  десять незнакомых людей\n  заказывают у нас\n',
        'goal: двадцать заказов в неделю\n',
      ),
    );
    const json = await sh('goal', 'Цель: заказы', '--json');
    expect(JSON.parse(json.stdout)).toEqual({ goal: 'Цель: заказы' });
    expect(loadTree(dir).project.goal).toBe('Цель: заказы');
  }, 40_000);

  it('a tree without a goal says how to write one; JSON gives null; an empty goal is refused', async () => {
    const tree = emptyTree();
    const { dir } = tree.project;
    writeFileSync(treeFile(dir), '---\ntitle: Тест\n---\n\n## Метод\n');
    const sh = treeyardIn(dir);
    expect((await sh('goal')).stdout).toBe('цели пока нет — treeyard goal "чего проект добивается в жизни"\n');
    expect(JSON.parse((await sh('goal', '--json')).stdout)).toEqual({ goal: null });
    const empty = await sh('goal', '  ');
    expect(empty.code).toBe(2);
    expect(empty.stderr).toContain('цель пустая');
    expect(readFileSync(treeFile(dir), 'utf8')).toBe('---\ntitle: Тест\n---\n\n## Метод\n');
  }, 40_000);

  it('reaches the tree of another folder with --project', async () => {
    const tree = emptyTree();
    const sh = treeyardIn(tempDir());
    expect((await sh('goal', '--project', tree.project.dir)).stdout).toBe('всё работает\n');
    await sh('goal', 'работает везде', '--project', tree.project.dir);
    expect(loadTree(tree.project.dir).project.goal).toBe('работает везде');
  }, 40_000);
});

describe('treeyard rules', () => {
  it('prints the rules without «Решения», as JSON too', async () => {
    const tree = emptyTree();
    writeFileSync(treeFile(tree.project.dir), HAND_MADE);
    const sh = treeyardIn(tree.project.dir);
    const rules = '## Метод: Этапы\n\nЭтап за этапом.\n\n## Правила для агентов\n\n- Держись своего узла.';
    expect((await sh('rules')).stdout).toBe(`${rules}\n`);
    expect(JSON.parse((await sh('rules', '--json')).stdout)).toEqual({ rules });
  }, 40_000);

  it('writes new rules from stdin and from a file; the header and «Решения» stay, decide still works', async () => {
    const tree = emptyTree();
    const { dir } = tree.project;
    writeFileSync(treeFile(dir), HAND_MADE);
    const res = await withStdin(dir, '## Метод: Направления\n\nВсё сразу.\n', 'rules', '--from', '-');
    expect(res.code).toBe(0);
    expect(res.stdout).toBe('правила в .tree/tree.md: 3 стр.\n');
    const header = HAND_MADE.slice(0, HAND_MADE.indexOf('## Метод'));
    const decisions = HAND_MADE.slice(HAND_MADE.indexOf('## Решения'));
    expect(readFileSync(treeFile(dir), 'utf8')).toBe(`${header}## Метод: Направления\n\nВсё сразу.\n\n${decisions}`);

    // A writer that is slower than treeyard's start: the pipe is waited for, not an EAGAIN.
    const late = await withStdin(
      dir,
      { late: '## Метод: Направления\n\nВсё сразу, но позже.\n' },
      'rules',
      '--from',
      '-',
    );
    expect(late.stderr).toBe('');
    expect(late.code).toBe(0);
    expect(rulesOf(loadTree(dir).project.body)).toBe('## Метод: Направления\n\nВсё сразу, но позже.');

    const file = join(tempDir(), 'rules.md');
    writeFileSync(file, '## Правила\n\n- Коротко.\n');
    const sh = treeyardIn(dir);
    const json = await sh('rules', '--from', file, '--json');
    expect(JSON.parse(json.stdout)).toEqual({ rules: '## Правила\n\n- Коротко.' });
    await sh('decide', 'Оплата — только картой (2026-11-12)');
    expect((await sh('rules')).stdout).toBe('## Правила\n\n- Коротко.\n');
    expect((await sh('decide')).stdout).toBe(
      '- SQLite, а не Postgres (2026-10-07)\n- Оплата — только картой (2026-11-12)\n',
    );
    expect((await sh('goal')).stdout).toBe('десять незнакомых людей заказывают у нас\n');
  }, 60_000);

  it('refuses rules with «Решения», empty rules and text without --from, writing nothing', async () => {
    const tree = emptyTree();
    const { dir } = tree.project;
    const before = readFileSync(treeFile(dir), 'utf8');
    const withDecisions = await withStdin(dir, '## Метод\n\nА.\n\n## Решения\n\n- Б\n', 'rules', '--from', '-');
    expect(withDecisions.code).toBe(2);
    expect(withDecisions.stderr).toContain('treeyard decide');
    const empty = await withStdin(dir, '\n  \n', 'rules', '--from', '-');
    expect(empty.code).toBe(2);
    expect(empty.stderr).toContain('правила пустые');
    const loose = await treeyardIn(dir)('rules', 'новые правила');
    expect(loose.code).toBe(2);
    expect(loose.stderr).toContain('--from');
    expect(readFileSync(treeFile(dir), 'utf8')).toBe(before);
  }, 40_000);
});

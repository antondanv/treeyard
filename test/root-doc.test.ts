import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  cleanGoal,
  decisionList,
  decisionsOf,
  rulesOf,
  withDecisions,
  withGoal,
  withRules,
} from '../src/model/root-doc.js';
import { loadTree, projectFromText } from '../src/model/store.js';
import { emptyTree, tempDir, treeyardIn, withStdin } from './helpers.js';

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

describe('withDecisions', () => {
  it('adds only the line at the end of «Решения»: the hand-made header and the rest stay byte for byte', () => {
    expect(withDecisions(HAND_MADE, ['Оплата — картой (2026-11-12)'])).toBe(
      `${HAND_MADE}- Оплата — картой (2026-11-12)\n`,
    );
  });

  it('a section after «Решения» and the blank lines before it stay where they were', () => {
    const text = '---\ntitle: Т # имя\n---\n\n## Decisions\n\n- одно\n\n\n## Ещё\n\nБ.\n';
    expect(withDecisions(text, ['два', 'три'])).toBe(
      '---\ntitle: Т # имя\n---\n\n## Decisions\n\n- одно\n- два\n- три\n\n\n## Ещё\n\nБ.\n',
    );
  });

  it('after a paragraph or the bare heading, a blank line first; a continued item goes on as a list', () => {
    expect(withDecisions('---\nt: 1\n---\n\n## Решения\n\nЗдесь — решения.\n', ['А'])).toBe(
      '---\nt: 1\n---\n\n## Решения\n\nЗдесь — решения.\n\n- А\n',
    );
    expect(withDecisions('---\nt: 1\n---\n\n## Решения\n', ['А'])).toBe('---\nt: 1\n---\n\n## Решения\n\n- А\n');
    expect(withDecisions('## Решения\n\n- длинное\n  продолжение\n', ['А'])).toBe(
      '## Решения\n\n- длинное\n  продолжение\n- А\n',
    );
    // A file that ended without a line end gets one after the new line.
    expect(withDecisions('## Решения\n\n- одно', ['А'])).toBe('## Решения\n\n- одно\n- А\n');
  });

  it('a «## Решения» comment in the header is not the section; without one the section ends the file', () => {
    const text = '---\ntitle: Т\n## Решения\n---\n\n## Метод\n\nА.\n\n';
    expect(withDecisions(text, ['Б'])).toBe('---\ntitle: Т\n## Решения\n---\n\n## Метод\n\nА.\n\n## Решения\n\n- Б\n');
    expect(withDecisions('---\ntitle: Т\n---', ['Б'])).toBe('---\ntitle: Т\n---\n\n## Решения\n\n- Б\n');
  });

  it('a CRLF file stays CRLF', () => {
    const crlf = HAND_MADE.replace(/\n/g, '\r\n');
    expect(withDecisions(crlf, ['Оплата (2026-11-12)'])).toBe(`${crlf}- Оплата (2026-11-12)\r\n`);
    expect(withDecisions('---\r\nt: 1\r\n---\r\n', ['А'])).toBe('---\r\nt: 1\r\n---\r\n\r\n## Решения\r\n\r\n- А\r\n');
    expect(decisionsOf(projectFromText(crlf, '/x').body)).toEqual(['- SQLite, а не Postgres (2026-10-07)']);
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

describe('decisionList', () => {
  it('each line as written without «- », and its date: the last one, null without one', () => {
    const body = [
      '## Решения',
      '',
      'Здесь — решения, которые дорого менять.',
      '',
      '- SQLite, а не Postgres (2026-10-07)',
      '- Публичные узлы — в git (2026-10-07, веха 3)',
      '- Релиз 2026-12-01, а не раньше (2026-11-12)',
      '- Стек — TypeScript',
      '',
      '## После',
      '',
      '- не решение',
    ].join('\n');
    expect(decisionList(body)).toEqual([
      { text: 'SQLite, а не Postgres (2026-10-07)', date: '2026-10-07' },
      { text: 'Публичные узлы — в git (2026-10-07, веха 3)', date: '2026-10-07' },
      { text: 'Релиз 2026-12-01, а не раньше (2026-11-12)', date: '2026-11-12' },
      { text: 'Стек — TypeScript', date: null },
    ]);
    expect(decisionList('## Метод\n\n- правило\n')).toEqual([]);
  });
});

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

describe('treeyard decide --json', () => {
  it('gives «Решения» as {text, date}, after a write too; the text output stays', async () => {
    const tree = emptyTree();
    const { dir } = tree.project;
    writeFileSync(treeFile(dir), HAND_MADE);
    const sh = treeyardIn(dir);
    const shown = await sh('decide', '--json');
    expect(shown.code).toBe(0);
    expect(JSON.parse(shown.stdout)).toEqual({
      decisions: [{ text: 'SQLite, а не Postgres (2026-10-07)', date: '2026-10-07' }],
    });

    const res = await sh('decide', 'Оплата — только картой', '--json');
    expect(res.code).toBe(0);
    const { decisions } = JSON.parse(res.stdout) as { decisions: { text: string; date: string | null }[] };
    expect(decisions).toHaveLength(2);
    const added = decisions[1]!;
    expect(added.date).toMatch(/^\d{4}-\d\d-\d\d$/);
    expect(added.text).toBe(`Оплата — только картой (${added.date})`);
    // JSON is what the file now says, and the text form reads the same lines.
    expect((await sh('decide')).stdout).toBe(
      `- SQLite, а не Postgres (2026-10-07)\n- Оплата — только картой (${added.date})\n`,
    );
    const dated = await sh('decide', 'Ролики — в Motionlab (2026-10-07, веха 3)', '--json');
    expect(JSON.parse(dated.stdout).decisions[2]).toEqual({
      text: 'Ролики — в Motionlab (2026-10-07, веха 3)',
      date: '2026-10-07',
    });
  }, 40_000);

  it('writes only the decision line: a hand-made header keeps its comments and folded goal', async () => {
    const tree = emptyTree();
    const { dir } = tree.project;
    writeFileSync(treeFile(dir), HAND_MADE);
    const res = await treeyardIn(dir)('decide', 'Оплата — только картой (2026-11-12)');
    expect(res.code).toBe(0);
    expect(readFileSync(treeFile(dir), 'utf8')).toBe(`${HAND_MADE}- Оплата — только картой (2026-11-12)\n`);
  }, 40_000);

  it('a tree without «Решения» gives an empty list; --project reaches another folder', async () => {
    const tree = emptyTree();
    const { dir } = tree.project;
    writeFileSync(treeFile(dir), '---\ntitle: Тест\n---\n\n## Метод\n');
    const sh = treeyardIn(tempDir());
    expect(JSON.parse((await sh('decide', '--json', '--project', dir)).stdout)).toEqual({ decisions: [] });
    const res = await sh('decide', 'Без сервера (2026-11-12)', '--json', '--project', dir);
    expect(JSON.parse(res.stdout)).toEqual({ decisions: [{ text: 'Без сервера (2026-11-12)', date: '2026-11-12' }] });
    expect(decisionsOf(loadTree(dir).project.body)).toEqual(['- Без сервера (2026-11-12)']);
  }, 40_000);
});

describe('treeyard import --from-json into an existing tree', () => {
  const FOLDED = 'goal: >-\n  десять незнакомых людей\n  заказывают у нас\n';
  const plan = (goal: string) =>
    JSON.stringify({
      goal,
      decisions: ['Оплата — только картой (2026-11-12)', 'Без своего сервера'],
      nodes: [{ title: 'Касса', status: 'todo', children: [{ title: 'Чек на почту', status: 'idea' }] }],
    });

  it('a goal already there stays as written; only the decision lines are added', async () => {
    const tree = emptyTree();
    const { dir } = tree.project;
    writeFileSync(treeFile(dir), HAND_MADE);
    const res = await withStdin(dir, plan('совсем другая цель'), 'import', '--from-json', '-');
    expect(res.code, res.stderr).toBe(0);
    expect(readFileSync(treeFile(dir), 'utf8')).toBe(
      `${HAND_MADE}- Оплата — только картой (2026-11-12)\n- Без своего сервера\n`,
    );
    expect([...loadTree(dir).nodes.values()].map((node) => node.title).sort()).toEqual(['Касса', 'Чек на почту']);
  }, 40_000);

  it('a tree without a goal gains only its line under the title, besides the decisions', async () => {
    const tree = emptyTree();
    const { dir } = tree.project;
    const noGoal = HAND_MADE.replace(FOLDED, '');
    writeFileSync(treeFile(dir), noGoal);
    const res = await withStdin(dir, plan('двадцать заказов\n  в неделю'), 'import', '--from-json', '-');
    expect(res.code, res.stderr).toBe(0);
    expect(readFileSync(treeFile(dir), 'utf8')).toBe(
      `${noGoal.replace('# the name on the board\n', '# the name on the board\ngoal: двадцать заказов в неделю\n')}- Оплата — только картой (2026-11-12)\n- Без своего сервера\n`,
    );
  }, 40_000);
});

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { projectContext, sessionPlan } from '../src/agents/context.js';
import { uncommittedPaths } from '../src/git.js';
import { setLang } from '../src/i18n/i18n.js';
import { addNode } from '../src/model/ops.js';
import {
  deadlineIn,
  finishedParents,
  isMilestone,
  longTitles,
  openUnderClosed,
  overdueNodes,
} from '../src/model/review.js';
import { ROOT, type Status, type Tree } from '../src/model/types.js';
import { emptyTree } from './helpers.js';

beforeEach(() => setLang('ru'));

const LONG = 'Строка с эмодзи из нескольких символов в Terminal.app обрезается у правого края и рамка панели пропадает';

function node(tree: Tree, title: string, status: Status = 'todo', parent = ROOT, doneWhen?: string) {
  return addNode(tree, { title, status, parent, ...(doneWhen ? { doneWhen } : {}) });
}

describe('parents and milestones whose children are all done', () => {
  it('finds an open parent with every child done, dropped or an idea', () => {
    const tree = emptyTree();
    const data = node(tree, 'Данные для веба');
    node(tree, 'Схема', 'done', data.id);
    node(tree, 'Выгрузка', 'done', data.id);
    node(tree, 'Старый путь', 'dropped', data.id);
    node(tree, 'Кэш', 'idea', data.id);
    const found = finishedParents(tree);
    expect(found.map((item) => item.node.id)).toEqual([data.id]);
    expect(found[0]).toMatchObject({ done: 2, ideas: 1 });
  });

  it('leaves out work still open inside, nothing done, review, waiting and closed parents', () => {
    const tree = emptyTree();
    const going = node(tree, 'Идёт');
    node(tree, 'Готово', 'done', going.id);
    node(tree, 'Ещё нет', 'todo', going.id);
    const ideas = node(tree, 'Только идеи');
    node(tree, 'Мысль', 'idea', ideas.id);
    for (const status of ['review', 'waiting', 'done', 'dropped'] as const) {
      const parent = node(tree, `Родитель ${status}`, status);
      node(tree, 'Готово', 'done', parent.id);
    }
    expect(node(tree, 'Лист')).toBeTruthy();
    expect(finishedParents(tree)).toEqual([]);
  });

  it('knows a milestone by its title, in both languages', () => {
    const tree = emptyTree();
    expect(isMilestone(node(tree, 'Веха 3: полная интеграция с GitHub'))).toBe(true);
    expect(isMilestone(node(tree, 'Milestone 2 — npm'))).toBe(true);
    expect(isMilestone(node(tree, 'Вехами не считаем'))).toBe(false);
    expect(isMilestone(node(tree, 'Релиз 0.2.0'))).toBe(false);
  });
});

describe('open nodes under closed branches', () => {
  it('finds the topmost open node under a done or dropped parent', () => {
    const tree = emptyTree();
    const done = node(tree, 'Веха 1', 'done');
    const idea = node(tree, 'Забытая идея', 'idea', done.id);
    node(tree, 'Шаг идеи', 'todo', idea.id);
    node(tree, 'Сделанное', 'done', done.id);
    const dropped = node(tree, 'Снятое', 'dropped');
    const left = node(tree, 'Осталось', 'waiting', dropped.id);
    const open = node(tree, 'Открытая ветка');
    node(tree, 'Обычный', 'todo', open.id);
    const found = openUnderClosed(tree).map(({ node, parent }) => [node.id, parent.id]);
    expect(found).toEqual([
      [idea.id, done.id],
      [left.id, dropped.id],
    ]);
  });
});

describe('long titles', () => {
  it('lists open nodes over 60 characters, not closed ones', () => {
    const tree = emptyTree();
    const open = node(tree, LONG, 'idea');
    node(tree, `${LONG} (готово)`, 'done');
    node(tree, 'Короткое название');
    expect(longTitles(tree).map((item) => item.id)).toEqual([open.id]);
  });
});

describe('deadlines', () => {
  const base = '2026-11-08';
  it('reads a date after a deadline word, in the forms trees use', () => {
    expect(deadlineIn('14 дней сессий до 2026-10-16 без правок', base)).toEqual({
      date: '2026-10-16',
      text: 'до 2026-10-16',
    });
    expect(deadlineIn('релиз к 20.12.2026', base)?.date).toBe('2026-12-20');
    expect(deadlineIn('релиз к 20.12.26', base)?.date).toBe('2026-12-20');
    expect(deadlineIn('Срок: 1 декабря 2026', base)?.date).toBe('2026-12-01');
    expect(deadlineIn('не позже 5 марта', base)?.date).toBe('2027-03-05');
    expect(deadlineIn('ship by 2026-10-01', base)?.date).toBe('2026-10-01');
    expect(deadlineIn('Deadline: October 16, 2026', base)?.date).toBe('2026-10-16');
    expect(deadlineIn('done before 3 Nov 2026', base)?.date).toBe('2026-11-03');
  });

  it('places a date without a year on or after the day the node was created', () => {
    expect(deadlineIn('до 30.11', base)?.date).toBe('2026-11-30');
    expect(deadlineIn('до 15.01', base)?.date).toBe('2027-01-15');
    expect(deadlineIn('до 08.11', base)?.date).toBe('2026-11-08');
  });

  it('takes the latest of several deadlines', () => {
    expect(deadlineIn('черновик до 01.12.2026, финал до 15.12.2026', base)?.date).toBe('2026-12-15');
  });

  it('ignores dates of work done, sizes, durations, versions and impossible dates', () => {
    for (const text of [
      '28.08 Сквозная проверка всех этапов',
      'проверены живьём 05–08.09',
      'копия до 20 МБ',
      'ролик до 95 с',
      'прогон доходит до 422',
      'до 1.5 с',
      'обновить до 1.20.3',
      'до 31.02.2026',
      'кдо 2026-01-01',
    ])
      expect(deadlineIn(text, base), text).toBeUndefined();
  });

  it('lists open nodes past their deadline, the longest overdue first', () => {
    const tree = emptyTree();
    const late = node(tree, 'Веха 1: две недели на дереве', 'todo', ROOT, '14 дней сессий до 2026-10-16');
    const later = node(tree, 'Релиз к 10.11.2026', 'waiting');
    node(tree, 'Будущее', 'todo', ROOT, 'до 2026-12-01');
    node(tree, 'Сегодня', 'todo', ROOT, 'до 2026-11-17');
    node(tree, 'Закрыто', 'done', ROOT, 'до 2026-10-01');
    node(tree, 'На проверке', 'review', ROOT, 'до 2026-10-01');
    node(tree, '28.08 Разбор прогонов', 'todo');
    const found = overdueNodes(tree, '2026-11-17');
    expect(found.map((item) => [item.node.id, item.deadline.date, item.days])).toEqual([
      [late.id, '2026-10-16', 32],
      [later.id, '2026-11-10', 7],
    ]);
  });
});

describe('the root review context', () => {
  function crooked(): Tree {
    const tree = emptyTree();
    const web = node(tree, 'Данные для веба');
    node(tree, 'Схема', 'done', web.id);
    node(tree, 'Кэш', 'idea', web.id);
    const closed = node(tree, 'Веха 1: две недели на дереве', 'done');
    node(tree, 'Забытая идея', 'idea', closed.id);
    node(tree, LONG, 'idea');
    node(tree, 'Веха 2: npm', 'todo', ROOT, 'пакет в npm до 2020-01-15');
    return tree;
  }

  it('lists each finding with what to do about it', () => {
    const tree = crooked();
    const text = projectContext(tree);
    expect(text).toContain('## Все дети готовы, а узел открыт');
    expect(text).toMatch(/- Данные для веба \(`\w+`\) — готово детей: 1 · идей внутри: 1/);
    expect(text).toContain('Постоянные корзины (идеи, замечания) не закрывают');
    expect(text).toContain('## Открытые узлы под закрытыми ветками');
    expect(text).toMatch(/- Забытая идея \(`\w+`, идея\) — под «Веха 1: две недели на дереве» \(готово\)/);
    expect(text).toContain('## Сроки прошли');
    expect(text).toMatch(/- Веха 2: npm \(`\w+`\) — веха · срок 2020-01-15 \(«до 2020-01-15»\) прошёл \d+ дн назад/);
    expect(text).toContain('## Длинные названия');
    expect(text).toContain(`${LONG} (\``);
    expect(text).toContain('— 104 символа');
    expect(text).toContain('set <id> title="…" note="…"');
  });

  it('in English', () => {
    setLang('en');
    const text = projectContext(crooked());
    expect(text).toContain('## All children done, the node still open');
    expect(text).toContain('children done: 1 · ideas inside: 1');
    expect(text).toContain('## Open nodes under closed branches');
    expect(text).toContain('— under «Веха 1: две недели на дереве» (done)');
    expect(text).toContain('## Deadlines passed');
    expect(text).toMatch(/milestone · deadline 2020-01-15 \(«до 2020-01-15»\) passed \d+ d ago/);
    expect(text).toContain('## Long titles');
    expect(text).toContain('— 104 characters');
    expect(text).not.toContain('готово детей');
  });

  it('a tidy tree gets none of these sections', () => {
    const tree = emptyTree();
    const going = node(tree, 'Идёт');
    node(tree, 'Готово', 'done', going.id);
    node(tree, 'Ещё нет', 'todo', going.id);
    const text = projectContext(tree);
    for (const heading of ['Все дети готовы', 'под закрытыми', 'не закоммичен', 'Сроки прошли', 'Длинные названия'])
      expect(text).not.toContain(heading);
  });

  it('the review prompt names the checks and the sections, in both languages', () => {
    const tree = emptyTree();
    const ru = sessionPlan(tree, ROOT, 'plan', 'claude').prompt!;
    expect(ru).toContain('родителей и вехи, у которых все дети готовы');
    expect(ru).toContain('открытые узлы под закрытыми ветками');
    expect(ru).toContain('«на проверке», а код не закоммичен');
    expect(ru).toContain('вехи с прошедшим сроком');
    expect(ru).toContain('«Сроки прошли»');
    setLang('en');
    const en = sessionPlan(tree, ROOT, 'plan', 'claude').prompt!;
    expect(en).toContain('parents and milestones whose children are all done');
    expect(en).toContain('open nodes under closed branches');
    expect(en).toContain('"in review" with the code not committed');
    expect(en).toContain('milestones past their deadline');
    expect(en).toContain('«Deadlines passed»');
  });
});

describe('in review with uncommitted code', () => {
  const git = (dir: string, ...args: string[]) =>
    execFileSync('git', args, { cwd: dir, stdio: 'ignore', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });

  /** A tree in a fresh repository with everything committed. */
  function repo(): Tree {
    const tree = emptyTree();
    const dir = tree.project.dir;
    writeFileSync(join(dir, 'app.ts'), 'export {};\n');
    git(dir, 'init', '-q');
    git(dir, 'add', '-A');
    git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
    return tree;
  }

  it('lists the uncommitted files and the nodes in review, those without commits first', () => {
    const tree = repo();
    const dir = tree.project.dir;
    const committed = node(tree, 'С коммитом', 'review');
    committed.commits = ['abc1234'];
    const bare = node(tree, 'Без коммита', 'review');
    writeFileSync(join(dir, 'app.ts'), 'export const x = 1;\n');
    writeFileSync(join(dir, 'new.ts'), 'export {};\n');
    expect(uncommittedPaths(dir).filter((path) => !path.startsWith('.tree/'))).toEqual(['app.ts', 'new.ts']);
    const text = projectContext(tree);
    expect(text).toContain('## На проверке, а код не закоммичен');
    expect(text).toContain('В рабочей папке не закоммичено файлов: 2 (app.ts, new.ts)');
    const section = text.slice(text.indexOf('## На проверке, а код не закоммичен'));
    expect(section.indexOf(`Без коммита (\`${bare.id}\`) — коммитов в узле нет`)).toBeGreaterThan(0);
    expect(section.indexOf(`С коммитом (\`${committed.id}\`) — коммитов в узле: 1`)).toBeGreaterThan(
      section.indexOf('Без коммита'),
    );
    setLang('en');
    expect(projectContext(tree)).toContain('## In review, but the code is not committed');
  });

  it('stays quiet when only the tree files changed, or nothing is in review', () => {
    const tree = repo();
    node(tree, 'На проверке', 'review');
    // addNode wrote .tree/: shared by every session, committed with `treeyard commit`.
    expect(projectContext(tree)).not.toContain('не закоммичен');
    const quiet = repo();
    writeFileSync(join(quiet.project.dir, 'app.ts'), 'export const y = 2;\n');
    node(quiet, 'В работе', 'active');
    expect(projectContext(quiet)).not.toContain('не закоммичен');
  });

  it('outside git there is nothing to report', () => {
    const tree = emptyTree();
    node(tree, 'На проверке', 'review');
    expect(uncommittedPaths(tree.project.dir)).toEqual([]);
    expect(projectContext(tree)).not.toContain('не закоммичен');
  });
});

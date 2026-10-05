import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { contextText, fullAccess, sessionPlan } from '../src/agents/context.js';
import { countNodes, parseProposal, plant } from '../src/agents/importer.js';
import { addNode } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { childrenOf } from '../src/model/tree.js';
import { ROOT } from '../src/model/types.js';
import { DEFAULTS, saveSettings } from '../src/settings.js';
import { addPointer, removePointer } from '../src/templates/pointer.js';
import { createTree, fill, getTemplate, listTemplates, variables } from '../src/templates/templates.js';
import { emptyTree, tempDir } from './helpers.js';

describe('templates', () => {
  it('ships five, in order, each with a goal question', () => {
    const ids = listTemplates().map((template) => template.id);
    expect(ids).toEqual(['stages', 'directions', 'mikado', 'discovery', 'client']);
    for (const template of listTemplates()) {
      expect(template.questions.find((q) => q.key === 'goal')?.required).toBe(true);
      expect(template.method.length).toBeGreaterThan(50);
    }
  });

  it('fills placeholders, with phrases for missing answers', () => {
    const vars = variables({ goal: 'клиент доволен' });
    expect(fill('Готово: {{goal}}. {{client_line}}', vars)).toBe('Готово: клиент доволен.');
    expect(vars.loop_done).toBe('Главный сценарий проходит от начала до конца.');
    expect(variables({ loop: 'ссылка → отзыв' }).loop_done).toContain('«ссылка → отзыв»');
  });

  it('plants a tree: project file with the method and shared rules, and the skeleton', () => {
    const dir = tempDir();
    const tree = createTree(dir, getTemplate('stages')!, {
      title: 'Пилот',
      answers: { goal: 'первый отзыв', loop: 'ссылка → отзыв' },
    });
    expect(tree.project).toMatchObject({ title: 'Пилот', goal: 'первый отзыв', template: 'stages', brain: 'claude' });
    expect(tree.project.body).toContain('## Метод: Этапы');
    expect(tree.project.body).toContain('## Правила для агентов');
    // The template's own rules land under the shared ones.
    expect(tree.project.body).toMatch(/Conventional Commits[^\n]*\n- Этап закрыт/);
    const top = childrenOf(tree, ROOT).map((node) => node.title);
    expect(top).toEqual([
      'Этап 0 — Каркас',
      'Этап 1 — Главный сценарий',
      'Этап 2 — Вокруг сценария',
      'Этап 3 — Запуск',
      'Идеи',
    ]);
    const launch = childrenOf(tree, ROOT).find((node) => node.title === 'Этап 3 — Запуск');
    expect(launch).toMatchObject({ doneWhen: 'первый отзыв', who: 'human' });
    expect(readFileSync(join(dir, '.tree', '.gitignore'), 'utf8')).toBe('.local/\n');
    expect(() => createTree(dir, getTemplate('stages')!, { title: 'x', answers: {} })).toThrow(/уже есть дерево/);
  });

  it('replaces the default directions with your own', () => {
    const dir = tempDir();
    const tree = createTree(dir, getTemplate('directions')!, {
      title: 'X',
      answers: { goal: 'g', directions: 'Бот, Сайт; Видео' },
    });
    expect(childrenOf(tree, ROOT).map((node) => node.title)).toEqual(['Бот', 'Сайт', 'Видео', 'Идеи']);
  });
});

describe('pointer in CLAUDE.md / AGENTS.md', () => {
  it('is added once, replaced in place, and removable', () => {
    const dir = tempDir();
    const file = join(dir, 'CLAUDE.md');
    writeFileSync(file, '# Правила\n\nТекст.\n');
    addPointer(file);
    addPointer(file);
    const text = readFileSync(file, 'utf8');
    expect(text.match(/<!-- treeyard -->/g)).toHaveLength(1);
    expect(text.startsWith('# Правила')).toBe(true);
    expect(removePointer(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('# Правила\n\nТекст.\n');
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(false);
  });
});

describe('what an agent gets', () => {
  it('the path, the criterion, the neighbours and the commands — not the whole project', () => {
    const tree = emptyTree();
    const media = addNode(tree, { title: 'Медиа-цех', body: 'Картинки и ролики.', doneWhen: 'ролик собирается' });
    const video = addNode(tree, {
      title: 'Вертикальный ролик',
      parent: media.id,
      doneWhen: 'ролик 9:16 с субтитрами',
      check: 'pytest tests/media -q',
    });
    addNode(tree, { title: 'Обложки', parent: media.id, status: 'done' });
    const text = contextText(tree, video.id);
    expect(text).toContain(`## Твой узел: Вертикальный ролик (\`${video.id}\`)`);
    expect(text).toContain('Путь: Тест › Медиа-цех › Вертикальный ролик');
    expect(text).toContain('Готово, когда: ролик 9:16 с субтитрами');
    expect(text).toContain('Проверка: `pytest tests/media -q`');
    expect(text).toContain('Медиа-цех');
    expect(text).toContain('Картинки и ролики.');
    expect(text).toContain('Соседи: ✓ Обложки');
    expect(text).toMatch(/set .* status=review/);
  });

  it('tells about treeyard note once notes have a tree to go to', () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'X' });
    const home = process.env.TREEYARD_HOME;
    process.env.TREEYARD_HOME = tempDir('treeyard-home-');
    try {
      expect(contextText(tree, node.id)).not.toContain(' note "');
      saveSettings({ ...DEFAULTS, notes: '/projects/Treeyard' });
      expect(contextText(tree, node.id)).toMatch(/note "что мешает"` — неудобство самого treeyard/);
    } finally {
      process.env.TREEYARD_HOME = home;
    }
  });

  it('gives Antigravity full access in every mode; Claude Code and Codex keep their own settings', () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'X' });
    for (const start of ['plan', 'do', 'chat'] as const)
      expect(sessionPlan(tree, node.id, start, 'antigravity').permissionMode).toBe('bypassPermissions');
    expect(sessionPlan(tree, node.id, 'do', 'codex').permissionMode).toBeUndefined();
    expect(sessionPlan(tree, node.id, 'do', 'claude').permissionMode).toBeUndefined();
    expect(fullAccess('antigravity')).toEqual({ permissionMode: 'bypassPermissions' });
    expect(fullAccess('codex')).toEqual({});
  });

  it('OpenCode keeps its own access; a plan starts in its plan agent, and there is no /goal', () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'X', doneWhen: 'тесты зелёные' });
    expect(fullAccess('opencode')).toEqual({});
    expect(sessionPlan(tree, node.id, 'plan', 'opencode').permissionMode).toBe('plan');
    expect(sessionPlan(tree, node.id, 'do', 'opencode').permissionMode).toBeUndefined();
    expect(sessionPlan(tree, node.id, 'chat', 'opencode').permissionMode).toBeUndefined();
    expect(sessionPlan(tree, ROOT, 'plan', 'opencode').permissionMode).toBe('plan');
    const goal = sessionPlan(tree, node.id, 'goal', 'opencode');
    expect(goal.start).toBe('do');
    expect(goal.prompt).toMatch(/^Сделай узел/);
  });

  it('starts with a plan by default, and /goal only in Claude Code with a criterion', () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'X', doneWhen: 'тесты зелёные', check: 'npm test' });
    const plan = sessionPlan(tree, node.id, 'plan', 'claude');
    expect(plan.permissionMode).toBe('plan');
    expect(plan.prompt).toMatch(/предложи план/);
    expect(plan.name).toBe('Тест · X');

    const goal = sessionPlan(tree, node.id, 'goal', 'claude');
    expect(goal.prompt?.startsWith('/goal ')).toBe(true);
    expect(goal.prompt).toContain('npm test');
    expect(sessionPlan(tree, node.id, 'goal', 'codex').start).toBe('do');

    const bare = addNode(tree, { title: 'Без критерия' });
    expect(sessionPlan(tree, bare.id, 'goal', 'claude').start).toBe('do');
    expect(sessionPlan(tree, bare.id, 'chat', 'claude').prompt).toBeUndefined();
  });
});

describe('import', () => {
  it('finds the JSON in an answer and plants it, goal included', () => {
    const answer = `Вот дерево:\n\`\`\`json\n${JSON.stringify({
      goal: 'неделю веду канал через бота',
      nodes: [
        {
          title: 'Конвейер',
          status: 'done',
          who: 'agent',
          note: 'docs/06-roadmap.md, этап 0',
          children: [{ title: 'Хребет', status: 'done' }],
        },
        { title: 'Публикация на сервер', status: 'waiting', who: 'human', waiting: 'нет сервера', until: 'VPS' },
        { title: '', status: 'todo' },
        { title: 'Странный', status: 'whatever', who: 'robot' },
      ],
    })}\n\`\`\``;
    const proposal = parseProposal(answer);
    expect(countNodes(proposal.nodes)).toBe(4);
    expect(proposal.nodes[2]).toMatchObject({ title: 'Странный', status: 'todo' });
    expect(proposal.nodes[2]?.who).toBeUndefined();

    const tree = emptyTree();
    tree.project.goal = undefined;
    expect(plant(tree, proposal)).toBe(4);
    const reread = loadTree(tree.project.dir);
    expect(reread.project.goal).toBe('неделю веду канал через бота');
    const deploy = [...reread.nodes.values()].find((node) => node.title === 'Публикация на сервер');
    expect(deploy).toMatchObject({ status: 'waiting', waiting: 'нет сервера', until: 'VPS', who: 'human' });
    const pipe = [...reread.nodes.values()].find((node) => node.title === 'Конвейер');
    expect(pipe?.body).toContain('docs/06-roadmap.md');
  });

  it('says so when there is no tree in the answer', () => {
    expect(() => parseProposal('Не могу, извините.')).toThrow(/не нашлось дерева/);
  });
});

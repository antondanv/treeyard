import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { contextText, projectContext, START_HINT, selfCommand } from '../src/agents/context.js';
import { defaultBrain } from '../src/agents/launch.js';
import { setLang } from '../src/i18n/i18n.js';
import { addNode } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { createTree, getTemplate } from '../src/templates/templates.js';
import { emptyTree, tempDir } from './helpers.js';

// The rules agents broke most in real sessions: they live in «Tree commands» of both contexts.

beforeEach(() => setLang('ru'));

const self = selfCommand();

/** The part of a context after its «Tree commands» heading. */
function commands(text: string): string {
  const at = text.search(/^## (Команды дерева|Tree commands)$/m);
  expect(at).toBeGreaterThan(-1);
  return text.slice(at);
}

describe('a node session', () => {
  it('names nodes by title, done only at the person’s word, the id and --project to a helper, show uncut', () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Оплата картой', doneWhen: 'платёж проходит' });
    const text = commands(contextText(tree, node.id));

    expect(text).toContain(
      '- Человеку узлы называй по названию — «Оплата картой», а id — только в командах, даже не в скобках рядом с названием',
    );
    expect(text).toContain(
      `- Статус done ставит человек. Если он в этом разговоре прямо просит закрыть узлы — \`${self} set <id> status=done --as ты\``,
    );
    expect(text).toContain('Без такой просьбы — только review.');
    expect(text).toContain(
      `- Отдаёшь работу субагенту или помощнику — передай ему id узла (\`${node.id}\`) и \`--project ${tree.project.dir}\` для команд treeyard`,
    );
    expect(text).toContain('- Вывод `show` и `find` читай целиком, не обрезай через head, tail, grep или sed');
    expect(text).toContain('длинно — `--brief`, `--journal N` или `--only`');
    expect(text).toContain(
      `show ${node.id} --brief\` — шапка и последние записи (без --brief — целиком; \`--journal N\``,
    );
  });

  it('the same in English, with --as you', () => {
    setLang('en');
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Card payment' });
    const text = commands(contextText(tree, node.id));

    expect(text).toContain('- Name nodes to the person by their title — «Card payment»; ids go in commands only');
    expect(text).toContain(`\`${self} set <id> status=done --as you\`: the decision is theirs`);
    expect(text).toContain('Without such a request — review only.');
    expect(text).toContain(`give it the node id (\`${node.id}\`) and \`--project ${tree.project.dir}\``);
    expect(text).toContain('- Read the output of `show` and `find` whole, never cut it with head, tail, grep or sed');
    expect(text).toContain('`--journal N` — how many entries');
  });

  it('points to treeyard status for the main tree from a worktree and the setup', () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Оплата картой' });
    expect(commands(contextText(tree, node.id))).toContain(
      `- \`${self} status\` — сводка по проекту: папка и дерево (из git worktree — основное, с \`--project\` для команд), скиллы, указатель, git-хук`,
    );

    setLang('en');
    expect(commands(contextText(tree, node.id))).toContain(
      `- \`${self} status\` — the project at a glance: the folder and its tree (from a git worktree — the main one, with the \`--project\` for commands), skills, the pointer, the git hook`,
    );
  });

  it('a project folder with a space is quoted, so the helper can paste it', () => {
    const dir = tempDir('treeyard test ');
    createTree(dir, getTemplate('directions')!, { title: 'Тест', answers: { goal: 'всё' }, skeleton: false });
    const tree = loadTree(dir);
    const node = addNode(tree, { title: 'Узел' });
    expect(contextText(tree, node.id)).toContain(`\`--project ${JSON.stringify(tree.project.dir)}\``);
  });
});

describe('a session from the root', () => {
  it('has the same rules, without a node of its own', () => {
    const tree = emptyTree();
    addNode(tree, { title: 'Оплата картой' });
    const text = commands(projectContext(tree));

    expect(text).toContain(
      '- Человеку узлы называй по названию, а id — только в командах, даже не в скобках рядом с названием',
    );
    expect(text).toContain(`\`${self} set <id> status=done --as ты\`: решение его`);
    expect(text).toContain(
      `- Отдаёшь работу субагенту или помощнику — передай ему id узла и \`--project ${tree.project.dir}\``,
    );
    expect(text).toContain('- Вывод `show` и `find` читай целиком');
    expect(text).toContain('`show <id…> --brief` — шапки и последние записи узлов, `--journal N` — сколько записей');
  });

  it('in English', () => {
    setLang('en');
    const text = commands(projectContext(emptyTree()));
    expect(text).toContain('- Name nodes to the person by their title; ids go in commands only');
    expect(text).toContain(`\`${self} set <id> status=done --as you\``);
    expect(text).toContain('- Handing work to a subagent or a helper — give it the node id and `--project ');
    expect(text).toContain('- Read the output of `show` and `find` whole');
  });
});

describe('neutral CLI defaults and wording', () => {
  it('START_HINT.goal does not frame Claude as the default agent in either language', () => {
    expect(START_HINT.goal).not.toMatch(/^Claude\b/);
    setLang('en');
    expect(START_HINT.goal).not.toMatch(/^Claude\b/);
  });

  it('defaultBrain prefers project brain, then TREEYARD_AS, then first installed CLI, then deterministic fallback', () => {
    const emptyBin = tempDir('treeyard-empty-bin-');
    const codexBin = tempDir('treeyard-codex-bin-');
    writeFileSync(join(codexBin, 'codex'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

    // Project brain wins over TREEYARD_AS and installed binaries.
    expect(defaultBrain('opencode', { PATH: codexBin, TREEYARD_AS: 'antigravity' })).toBe('opencode');
    // Without project brain, current session's TREEYARD_AS wins.
    expect(defaultBrain(undefined, { PATH: codexBin, TREEYARD_AS: 'antigravity' })).toBe('antigravity');
    // Invalid/human TREEYARD_AS falls through to the first installed CLI on PATH.
    expect(defaultBrain(undefined, { PATH: codexBin, TREEYARD_AS: 'ты' })).toBe('codex');
    // Without any installed CLI, deterministic fallback keeps tests and bare setups stable.
    expect(defaultBrain(undefined, { PATH: emptyBin })).toBe('claude');
  });
});

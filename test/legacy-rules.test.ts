import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { ProjectStatus } from '../src/status.js';
import { legacyAgentRules, upgradeAgentRules } from '../src/templates/legacy-rules.js';
import { emptyTree, treeyardIn } from './helpers.js';

// «Rules for agents» exactly as a tree planted by 0.1.1 from «Directions» has them,
// plus a line of the person's own and a rule of another method.
const treeFile = (dir: string) => join(dir, '.tree', 'tree.md');

const OLD_RU = `## Метод: Направления

Проект — это несколько независимых направлений.

## Как держим дерево

- Новая идея по ходу — новый узел со статусом «идея», а не «заодно».

## Правила для агентов

- Ты работаешь над одним узлом дерева. Держись его; путь от корня объясняет, зачем он нужен.
- Сначала разберись и предложи план; меняй файлы, когда план понятен.
- Всплыла новая задача или идея — заведи узел (\`treeyard add "…" --parent <id> --status idea\`) и вернись к своему.
- Упёрся во внешнее — \`treeyard set <id> status=waiting waiting="что мешает" until="когда вернуться"\`.
- Критерий выполнен — \`treeyard set <id> status=review\` и покажи доказательства: команду и её вывод. «Готово» ставит человек.
- В конце или при перерыве — запиши итог: \`treeyard log <id> "что сделано; что осталось"\`.
- Git: перед работой \`git status\` и ветка; чужие незакоммиченные правки не трогай; коммить только своё, по смыслу (Conventional Commits); push и PR — только по просьбе.
- Перед началом проверь, не ждёт ли узел или его направление чего-то внешнего.
- Если задача упирается во внешнее, не обходи это костылём: поставь «ждёт» и скажи, что нужно от человека.
- Деплой — только через make deploy.
- Не начинай задачи следующего этапа, пока текущий не на проверке.`;

const OLD_EN = `## Rules for agents

- You work on one node of the tree. Stay on it; the path from the root explains why it matters.
- First understand and propose a plan; change files once the plan is clear.
- Criterion met — \`treeyard set <id> status=review\` and show the evidence: the command and its output. "Done" is set by a person.

## Notes

Something after.`;

describe('the agents’ rules of an old template', () => {
  it('are found line by line and taken out; the person’s lines and the method’s rules stay', () => {
    expect(legacyAgentRules(OLD_RU)).toHaveLength(9);
    const next = upgradeAgentRules(OLD_RU);
    expect(next).toContain('## Как держим дерево\n\n- Новая идея по ходу');
    expect(next).toMatch(
      /## Правила для агентов\n\nКак вести дерево — в скилле `treeyard`[^\n]*\n\n- Деплой — только через make deploy\.\n- Не начинай задачи следующего этапа/,
    );
    expect(next).not.toContain('Сначала разберись и предложи план');
    expect(next).not.toContain('status=review');
    expect(legacyAgentRules(next)).toEqual([]);
    // Twice is once.
    expect(upgradeAgentRules(next)).toBe(next);
  });

  it('in English, in the tree’s own language, with the sections after it untouched', () => {
    const next = upgradeAgentRules(OLD_EN);
    expect(next).toBe(
      '## Rules for agents\n\nHow to keep the tree is in the `treeyard` skill; this section holds only what this project adds to it.\n\n## Notes\n\nSomething after.',
    );
  });

  it('leave alone rules with no old lines, or with no agents’ section at all', () => {
    const own = '## Правила для агентов\n\n- Держись своего узла.';
    expect(upgradeAgentRules(own)).toBe(own);
    expect(upgradeAgentRules('## Метод\n\nВсё сразу.')).toBe('## Метод\n\nВсё сразу.');
    // The same words elsewhere are not the agents' rules.
    const elsewhere = '## Как держим дерево\n\n- Сначала разберись и предложи план; меняй файлы, когда план понятен.';
    expect(legacyAgentRules(elsewhere)).toEqual([]);
  });
});

describe('treeyard status and rules --upgrade', () => {
  it('status names the old lines and the command; the command fixes them, «Решения» and the header stay', async () => {
    const tree = emptyTree();
    const file = treeFile(tree.project.dir);
    const head = '---\ntitle: Старое\n---\n\n';
    writeFileSync(file, `${head}${OLD_RU}\n\n## Решения\n\n- Стек: TypeScript (2026-10-01)\n`);
    const sh = treeyardIn(tree.project.dir);

    const before = JSON.parse((await sh('status', '--json')).stdout) as ProjectStatus;
    expect(before.legacyRules).toBe(9);
    expect(before.problems).toContainEqual(
      expect.objectContaining({ kind: 'rules-legacy', fix: 'treeyard rules --upgrade' }),
    );

    const res = await sh('rules', '--upgrade');
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('убрано строк старого шаблона: 9');
    const text = readFileSync(file, 'utf8');
    expect(text.startsWith(head)).toBe(true);
    expect(text).toContain('- Деплой — только через make deploy.');
    expect(text).toMatch(/## Решения\n\n- Стек: TypeScript \(2026-10-01\)\n$/);

    expect((await sh('rules', '--upgrade')).stdout).toContain('менять нечего');
    expect(readFileSync(file, 'utf8')).toBe(text);
    const after = JSON.parse((await sh('status', '--json')).stdout) as ProjectStatus;
    expect(after.legacyRules).toBeUndefined();
    expect(after.problems.map((p) => p.kind)).not.toContain('rules-legacy');

    const both = await sh('rules', '--upgrade', '--from', '-');
    expect(both.code).toBe(2);
  }, 60_000);
});

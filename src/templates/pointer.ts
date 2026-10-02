/**
 * A short block in CLAUDE.md and AGENTS.md that tells any session opened in
 * the project — not only the ones started from the tree — where the tree is
 * and how to write back to it. Between markers, so it is replaced, not
 * duplicated, and easy to remove.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { pick } from '../i18n/i18n.js';

const START = '<!-- treeyard -->';
const END = '<!-- /treeyard -->';

/** The block in the current language. */
export function pointer(): string {
  return `${START}\n${pick({
    ru: `## Дерево задач

Проект ведётся деревом целей в \`.tree/\` (treeyard): обзор — \`.tree/README.md\`, узлы — \`.tree/nodes/<id>.md\`.
Работаешь над задачей — найди её узел (\`treeyard show\`) и держись его. Итог — в журнал узла
(\`treeyard log <id> "что сделано; что осталось"\`), всплывшие идеи — новыми узлами
(\`treeyard add "…" --parent <id> --status idea\`). Критерий выполнен — \`treeyard set <id> status=review\`; готово ставит человек.`,
    en: `## Task tree

The project is run as a goal tree in \`.tree/\` (treeyard): overview — \`.tree/README.md\`, nodes — \`.tree/nodes/<id>.md\`.
Working on a task — find its node (\`treeyard show\`) and stay on it. Write the outcome to the node journal
(\`treeyard log <id> "what is done; what is left"\`), ideas that come up — as new nodes
(\`treeyard add "…" --parent <id> --status idea\`). Criterion met — \`treeyard set <id> status=review\`; "done" is set by a person.`,
  })}\n${END}`;
}

/**
 * Which agent instruction files the project already has. A file that only
 * imports another (`CLAUDE.md` with `@AGENTS.md`) gets the block through it:
 * a second copy would only cost context.
 */
export function pointerTargets(dir: string): string[] {
  return ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'].filter((file) => {
    const path = join(dir, file);
    if (!existsSync(path)) return false;
    const lines = readFileSync(path, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    return !(lines.length > 0 && lines.every((line) => /^@\S+\.md$/.test(line)));
  });
}

export function addPointer(path: string): void {
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  let next: string;
  if (start >= 0 && end > start) next = text.slice(0, start) + pointer() + text.slice(end + END.length);
  else next = `${text.trimEnd()}${text.trim() ? '\n\n' : ''}${pointer()}\n`;
  writeFileSync(path, next);
}

export function removePointer(path: string): boolean {
  if (!existsSync(path)) return false;
  const text = readFileSync(path, 'utf8');
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start < 0 || end < start) return false;
  writeFileSync(
    path,
    `${text.slice(0, start).trimEnd()}\n${text.slice(end + END.length).replace(/^\n+/, '\n')}`.trimEnd() + '\n',
  );
  return true;
}

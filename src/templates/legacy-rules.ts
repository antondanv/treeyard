/**
 * «Rules for agents» as the templates wrote them before the `treeyard` skill took them over
 * (0.1.0–0.1.1). A tree planted then still carries them, and a node session reads them next to
 * the skill: two copies that disagree («plan first» against a session started to do the node,
 * `set status=review` against one `log … --status review`). Recognised line by line, verbatim,
 * so the person's own lines and the method's rules stay where they are.
 */
import type { Lang } from '../i18n/i18n.js';
import { commonTextIn } from './templates.js';

export const LEGACY_LINES = [
  // _common.md, ru
  '- Ты работаешь над одним узлом дерева. Держись его; путь от корня объясняет, зачем он нужен.',
  '- Сначала разберись и предложи план; меняй файлы, когда план понятен.',
  '- Всплыла новая задача или идея — заведи узел (`treeyard add "…" --parent <id> --status idea`) и вернись к своему.',
  '- Упёрся во внешнее — `treeyard set <id> status=waiting waiting="что мешает" until="когда вернуться"`.',
  '- Нужна правка в другом проекте — `treeyard add "…" --project ../X --for <id>`: узел ляжет в «Совместные узлы» того дерева и свяжется с твоим; не правь там молча. Сделал там нужное — `treeyard set <id> status=done --project ../X`: совместный узел агент закрывает сам.',
  '- Критерий выполнен — `treeyard set <id> status=review` и покажи доказательства: команду и её вывод. «Готово» ставит человек.',
  '- В конце или при перерыве — запиши итог: `treeyard log <id> "что сделано; что осталось"`.',
  '- Git: перед работой `git status` и ветка; чужие незакоммиченные правки не трогай; коммить только своё, по смыслу (Conventional Commits); push и PR — только по просьбе.',
  // directions.yaml, ru
  '- Перед началом проверь, не ждёт ли узел или его направление чего-то внешнего.',
  '- Если задача упирается во внешнее, не обходи это костылём: поставь «ждёт» и скажи, что нужно от человека.',
  // _common.md, en
  '- You work on one node of the tree. Stay on it; the path from the root explains why it matters.',
  '- First understand and propose a plan; change files once the plan is clear.',
  '- A new task or idea came up — add a node (`treeyard add "…" --parent <id> --status idea`) and go back to yours.',
  '- Blocked by something outside — `treeyard set <id> status=waiting waiting="what blocks it" until="when to come back"`.',
  '- A change is needed in another project — `treeyard add "…" --project ../X --for <id>`: the node goes to «Shared nodes» of that tree, linked to yours; do not change it silently. Done what was needed there — `treeyard set <id> status=done --project ../X`: an agent closes a shared node itself.',
  '- Criterion met — `treeyard set <id> status=review` and show the evidence: the command and its output. "Done" is set by a person.',
  '- At the end, or when you stop — write the outcome: `treeyard log <id> "what is done; what is left"`.',
  "- Git: `git status` and the branch before you start; do not touch other people's uncommitted changes; commit only your own work, by meaning (Conventional Commits); push and PRs only when asked.",
  // directions.yaml, en
  '- Before you start, check whether the node or its direction waits for something outside.',
  '- If a task is blocked by something outside, do not work around it with a hack: set "waiting" and say what is needed from a person.',
];

/** Spaces as typed by hand or reflowed by an editor do not make a line the person's own. */
const norm = (line: string) => line.trim().replace(/\s+/g, ' ');
const LEGACY = new Set(LEGACY_LINES.map(norm));

const HEADING = /^## (Правила для агентов|Rules for agents)[ \t]*$/m;
export const SKILL_LINE = /скилле `treeyard`|`treeyard` skill/;

interface Section {
  start: number;
  end: number;
  lang: Lang;
  lines: string[];
}

function agentSection(rules: string): Section | undefined {
  const heading = HEADING.exec(rules);
  if (!heading) return undefined;
  const start = heading.index + heading[0].length;
  const next = /^## /m.exec(rules.slice(start));
  const end = next ? start + next.index : rules.length;
  return {
    start,
    end,
    lang: heading[1] === 'Rules for agents' ? 'en' : 'ru',
    lines: rules.slice(start, end).split('\n'),
  };
}

/** The lines of the agents' rules that an old template wrote and the skill now holds. */
export function legacyAgentRules(rules: string): string[] {
  return (agentSection(rules)?.lines ?? []).filter((line) => LEGACY.has(norm(line)));
}

/** The paragraph a template puts under the heading now: where the rules live. */
function skillParagraph(language: Lang): string {
  const common = commonTextIn(language);
  const section = agentSection(common);
  const paragraph = section?.lines.map((line) => line.trim()).find((line) => SKILL_LINE.test(line));
  if (!paragraph) throw new Error(`templates/${language === 'en' ? 'en/' : ''}_common.md: no line about the skill`);
  return paragraph;
}

/**
 * The rules with the old template's lines taken out of «Rules for agents» and the line about
 * the skill in their place; the same text when there was nothing to take out.
 */
export function upgradeAgentRules(rules: string): string {
  const section = agentSection(rules);
  if (!section || !legacyAgentRules(rules).length) return rules;
  const kept = section.lines
    .filter((line) => !LEGACY.has(norm(line)))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const intro = SKILL_LINE.test(kept) ? '' : skillParagraph(section.lang);
  const body = [intro, kept].filter(Boolean).join('\n\n');
  const after = rules.slice(section.end).trimStart();
  return `${rules.slice(0, section.start)}\n\n${body}\n${after ? `\n${after}` : ''}`.trimEnd();
}

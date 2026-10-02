/**
 * Small jobs for an agent that do not need a session: break a node into
 * steps, put its "done" into words. Read-only and headless, through
 * Brainyard; the answer is a proposal you accept or throw away — nothing
 * lands in the tree on its own.
 */
import { type AgentEvent, run } from '@antondanv/brainyard';
import { pick, t } from '../i18n/i18n.js';
import { childrenOf } from '../model/tree.js';
import type { BrainId, Tree, Who } from '../model/types.js';
import { WHO } from '../model/types.js';
import { contextText } from './context.js';

export interface Step {
  title: string;
  doneWhen?: string;
  who?: Who;
  note?: string;
}

export interface Criterion {
  doneWhen: string;
  check?: string;
}

export interface AssistOptions {
  brain: BrainId;
  model?: string;
  effort?: string;
  onEvent?: (event: AgentEvent) => void;
  signal?: AbortSignal;
}

export function splitPrompt(tree: Tree, id: string): string {
  const existing = childrenOf(tree, id).map((node) => `- ${node.title}`);
  return `${contextText(tree, id)}

---

${pick({
  ru: `Задача сейчас — не делать узел, а разбить его на шаги. Загляни в код и документы проекта, сколько нужно, ничего не меняя.

Предложи от 3 до 7 подзадач, которые вместе доводят узел до его критерия готовности:
- каждая — одна сессия агента или один PR; результат виден сразу, а не «ещё чуть-чуть»;
- title — до 60 символов, по-русски, словами проекта;
- done_when — проверяемый критерий одним предложением: команда, сценарий, то, что можно увидеть;
- who: agent — код; human — то, что может сделать только человек (доступы, договор, решение, показать людям); any — не важно;
- note — одна фраза: зачем этот шаг или с чего начать.
${existing.length ? `\nУже есть под узлом (не повторяй их):\n${existing.join('\n')}\n` : ''}
Ответь ТОЛЬКО JSON в блоке \`\`\`json:`,
  en: `The job now is not to do the node but to break it into steps. Look into the project's code and documents as much as you need, changing nothing.

Propose 3 to 7 subtasks that together bring the node to its "done when":
- each is one agent session or one PR; its result shows right away, not "a little more";
- title — up to 60 characters, in English, in the project's own words;
- done_when — a checkable criterion in one sentence: a command, a scenario, something you can see;
- who: agent — code; human — what only a person can do (access, a contract, a decision, showing it to people); any — either;
- note — one phrase: why this step or where to start.
${existing.length ? `\nAlready under the node (do not repeat them):\n${existing.join('\n')}\n` : ''}
Answer ONLY with JSON in a \`\`\`json block:`,
})}
{"children": [{"title": "…", "done_when": "…", "who": "agent", "note": "…"}]}`;
}

export function criterionPrompt(tree: Tree, id: string): string {
  return `${contextText(tree, id)}

---

${pick({
  ru: `Задача сейчас — сформулировать для этого узла критерий готовности.
- done_when — одно предложение: что можно увидеть или запустить, когда узел сделан. Не «реализовано X», а проверяемый результат.
- check — команда, которая это доказывает (тест, скрипт, curl), если такая разумна для проекта; иначе пусто.

Ответь ТОЛЬКО JSON в блоке \`\`\`json:`,
  en: `The job now is to write a "done when" for this node.
- done_when — one sentence: what you can see or run once the node is done. Not "X is implemented" but a checkable result.
- check — a command that proves it (a test, a script, curl), if one makes sense for the project; otherwise empty.

Answer ONLY with JSON in a \`\`\`json block:`,
})}
{"done_when": "…", "check": "…"}`;
}

export async function proposeSteps(tree: Tree, id: string, options: AssistOptions): Promise<Step[]> {
  const text = await ask(tree, splitPrompt(tree, id), options);
  const data = json(text);
  const list = Array.isArray(data.children) ? data.children : Array.isArray(data.nodes) ? data.nodes : [];
  const steps: Step[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const title = typeof record.title === 'string' ? record.title.trim() : '';
    if (!title) continue;
    const step: Step = { title: title.slice(0, 120) };
    if (typeof record.done_when === 'string' && record.done_when.trim()) step.doneWhen = record.done_when.trim();
    if ((WHO as readonly string[]).includes(String(record.who))) step.who = record.who as Who;
    if (typeof record.note === 'string' && record.note.trim()) step.note = record.note.trim();
    steps.push(step);
  }
  if (steps.length === 0) throw new Error(t('агент не предложил ни одного шага'));
  return steps;
}

export async function proposeCriterion(tree: Tree, id: string, options: AssistOptions): Promise<Criterion> {
  const data = json(await ask(tree, criterionPrompt(tree, id), options));
  const doneWhen = typeof data.done_when === 'string' ? data.done_when.trim() : '';
  if (!doneWhen) throw new Error(t('агент не сформулировал критерий'));
  const criterion: Criterion = { doneWhen };
  if (typeof data.check === 'string' && data.check.trim()) criterion.check = data.check.trim();
  return criterion;
}

async function ask(tree: Tree, prompt: string, options: AssistOptions): Promise<string> {
  const result = await run({
    brain: options.brain,
    cwd: tree.project.dir,
    prompt,
    access: 'readonly',
    web: false,
    ...(options.model ? { model: options.model } : {}),
    ...(options.effort ? { effort: options.effort } : {}),
    ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!result.ok) throw new Error(result.error?.message ?? t('агент не ответил'));
  return result.text;
}

/** The JSON object in an answer: the last ```json block, or the outermost braces. */
export function json(text: string): Record<string, unknown> {
  const fenced = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((match) => match[1] ?? '').reverse();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  const candidates = [...fenced, ...(first >= 0 && last > first ? [text.slice(first, last + 1)] : [])];
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch {
      // Next candidate.
    }
  }
  throw new Error(t('в ответе агента нет JSON'));
}

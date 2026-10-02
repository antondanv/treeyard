/**
 * Moving an existing project into a tree: an agent reads the plan the
 * project already has — README, ROADMAP, docs, git history — and proposes a
 * tree. Read-only: it changes nothing in the project, it only answers.
 */
import { spawnSync } from 'node:child_process';

import { type AgentEvent, run } from '@antondanv/brainyard';

import { pick, t } from '../i18n/i18n.js';
import { addNode } from '../model/ops.js';
import { writeOverview } from '../model/overview.js';
import { writeProject } from '../model/store.js';
import { type BrainId, STATUSES, type Status, type Tree, WHO, type Who } from '../model/types.js';

export interface ImportedNode {
  title: string;
  status: Status;
  who?: Who;
  doneWhen?: string;
  waiting?: string;
  until?: string;
  note?: string;
  /** A command that verifies the node. */
  check?: string;
  children: ImportedNode[];
}

export interface Proposal {
  goal?: string;
  /** For a new tree: the project's name and the template it is grown by. */
  title?: string;
  template?: string;
  /** Lines for the tree's «Решения»: what was decided, and why. */
  decisions?: string[];
  nodes: ImportedNode[];
}

export interface ImportOptions {
  brain: BrainId;
  model?: string;
  effort?: string;
  /** Extra words from the person: what to focus on. */
  hint?: string;
  onEvent?: (event: AgentEvent) => void;
  signal?: AbortSignal;
}

/**
 * What git knows about the project, gathered here: a read-only agent may not
 * be allowed to run commands at all (Claude Code's read-only mode has no
 * shell), and history is half of "what is actually done".
 */
export function gitSummary(dir: string): string {
  const git = (args: string[]) => {
    const got = spawnSync('git', args, { cwd: dir, encoding: 'utf8', timeout: 15_000 });
    return got.status === 0 ? got.stdout.trim() : '';
  };
  const log = git(['log', '--date=short', '--format=%ad %s', '-100']);
  if (!log) return '';
  const branches = git(['branch', '-a', '--sort=-committerdate', '--format=%(committerdate:short) %(refname:short)'])
    .split('\n')
    .slice(0, 40)
    .join('\n');
  const status = git(['status', '--short']).split('\n').slice(0, 40).join('\n');
  const L = pick({
    ru: {
      log: '## git log (последние 100 коммитов)',
      branches: '## Ветки (свежие сверху)',
      status: '## Незакоммиченное',
    },
    en: { log: '## git log (last 100 commits)', branches: '## Branches (newest first)', status: '## Uncommitted' },
  });
  return [L.log, log, branches ? `\n${L.branches}\n${branches}` : '', status ? `\n${L.status}\n${status}` : ''].join(
    '\n',
  );
}

export function importPrompt(hint?: string, git?: string): string {
  const tail = `${git ? `\n${git}\n` : ''}`;
  return pick({
    ru: `Ты помогаешь перенести план проекта в дерево целей (treeyard). Отвечаешь по-русски.

Прочитай, что есть в этой папке о плане и состоянии проекта:
- README, ROADMAP, PLAN, TASKS, docs/ (видение, дорожная карта, этапы), AGENTS.md и CLAUDE.md — только как контекст;
- если плана в документах нет — структуру кода и README.
История git собрана ниже — по ней видно, что реально сделано и над чем работали недавно.
Ничего не меняй: только читай файлы.

Построй дерево:
- goal — цель проекта в реальном мире: как человек поймёт, что проект сделал своё дело. Возьми из документов; если там её нет — предложи и скажи об этом в note первого узла.
- Верхний уровень — 4–9 направлений или этапов, как устроен план проекта. Глубина — не больше трёх уровней.
- title — коротко, до 60 символов, по-русски, словами проекта.
- status: done — только при свидетельстве (отмечено в документах или видно по git); active — над этим работали недавно и не закончили; waiting — упирается во внешнее (сервер, доступы, люди, деньги); idea — бэклог, «потом», «отложено»; todo — остальное.
- who: human — то, что может сделать только человек (договор, юрист, сервер, оплата, показать людям, принять решение); agent — код; any — не важно.
- done_when — проверяемый критерий одним предложением, где он ясен из документов. Не выдумывай, если неясно.
- waiting и until — только для status waiting: что мешает и когда вернуться.
- note — одно-два предложения: что это и откуда взято (например, «docs/06-roadmap.md, этап 3»).
- Сделанные этапы сворачивай: одно-два звена внутри, без перечисления мелочей.
- Отдельно ищи то, что мешает закончить: незакрытые критерии готовности, задачи «только для человека», «что делать прямо сейчас», открытые вопросы.
- Всего 30–90 узлов: лучше меньше, но точнее.
${hint ? `\nПожелание человека: ${hint}\n` : ''}${tail}
Ответь ТОЛЬКО JSON в блоке \`\`\`json — без пояснений до и после:
{"goal": "…", "nodes": [{"title": "…", "status": "todo", "who": "agent", "done_when": "…", "waiting": "…", "until": "…", "note": "…", "children": []}]}`,
    en: `You are helping to move a project's plan into a goal tree (treeyard). Answer in English.

Read what this folder has about the project's plan and state:
- README, ROADMAP, PLAN, TASKS, docs/ (vision, roadmap, stages), AGENTS.md and CLAUDE.md — as context only;
- if the documents have no plan, the code structure and the README.
The git history is below — it shows what is really done and what was worked on lately.
Change nothing: only read files.

Build the tree:
- goal — the project's goal in the real world: how a person will know the project did its job. Take it from the documents; if it is not there, propose one and say so in the note of the first node.
- The top level — 4–9 directions or stages, the way the project's plan is organised. No more than three levels deep.
- title — short, up to 60 characters, in English, in the project's own words.
- status: done — only with evidence (marked in the documents or visible in git); active — worked on lately and not finished; waiting — blocked by something outside (a server, access, people, money); idea — backlog, "later", "postponed"; todo — the rest.
- who: human — what only a person can do (a contract, a lawyer, a server, payment, showing it to people, a decision); agent — code; any — either.
- done_when — a checkable criterion in one sentence, where the documents make it clear. Do not invent one.
- waiting and until — only for status waiting: what blocks it and when to come back.
- note — one or two sentences: what it is and where it comes from (e.g. "docs/06-roadmap.md, stage 3").
- Fold finished stages: one or two items inside, no small details.
- Look separately for what stands in the way of finishing: open "done when"s, human-only tasks, "what to do right now", open questions.
- 30–90 nodes in total: fewer and more precise is better.
${hint ? `\nWhat the person asks for: ${hint}\n` : ''}${tail}
Answer ONLY with JSON in a \`\`\`json block — nothing before or after:
{"goal": "…", "nodes": [{"title": "…", "status": "todo", "who": "agent", "done_when": "…", "waiting": "…", "until": "…", "note": "…", "children": []}]}`,
  });
}

export async function proposeTree(dir: string, options: ImportOptions): Promise<Proposal> {
  const result = await run({
    brain: options.brain,
    cwd: dir,
    prompt: importPrompt(options.hint, gitSummary(dir)),
    access: 'readonly',
    web: false,
    ...(options.model ? { model: options.model } : {}),
    ...(options.effort ? { effort: options.effort } : {}),
    ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!result.ok) throw new Error(result.error?.message ?? t('агент не ответил'));
  return parseProposal(result.text);
}

/** The JSON out of an answer: the last ```json block, or the outermost braces. */
export function parseProposal(text: string): Proposal {
  const fenced = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((match) => match[1] ?? '');
  const candidates = [...fenced.reverse()];
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      const data = JSON.parse(candidate) as Record<string, unknown>;
      const nodes = Array.isArray(data.nodes) ? data.nodes.map((item) => toNode(item, 0)).filter(isNode) : [];
      if (nodes.length === 0) continue;
      const proposal: Proposal = { nodes };
      if (typeof data.goal === 'string' && data.goal.trim()) proposal.goal = data.goal.trim();
      if (typeof data.title === 'string' && data.title.trim()) proposal.title = data.title.trim().slice(0, 120);
      if (typeof data.template === 'string' && data.template.trim()) proposal.template = data.template.trim();
      if (Array.isArray(data.decisions)) {
        const decisions = data.decisions
          .filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
          .map((line) => line.trim().replace(/\s+/g, ' '));
        if (decisions.length) proposal.decisions = decisions;
      }
      return proposal;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error(t('в ответе агента не нашлось дерева в JSON'));
}

function isNode(value: ImportedNode | undefined): value is ImportedNode {
  return value !== undefined;
}

function toNode(value: unknown, depth: number): ImportedNode | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const data = value as Record<string, unknown>;
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  if (!title) return undefined;
  const status = (STATUSES as readonly string[]).includes(String(data.status)) ? (data.status as Status) : 'todo';
  const node: ImportedNode = { title: title.slice(0, 120), status, children: [] };
  if ((WHO as readonly string[]).includes(String(data.who))) node.who = data.who as Who;
  const text = (key: string) =>
    typeof data[key] === 'string' && (data[key] as string).trim() ? (data[key] as string).trim() : undefined;
  const doneWhen = text('done_when');
  if (doneWhen) node.doneWhen = doneWhen;
  const waiting = text('waiting');
  if (waiting) node.waiting = waiting;
  const until = text('until');
  if (until) node.until = until;
  const note = text('note');
  if (note) node.note = note;
  const check = text('check');
  if (check) node.check = check;
  if (depth < 4 && Array.isArray(data.children)) {
    node.children = data.children.map((item) => toNode(item, depth + 1)).filter(isNode);
  }
  return node;
}

export function countNodes(nodes: ImportedNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countNodes(node.children), 0);
}

const DECISIONS = /^##\s+(?:Решения|Decisions)\s*$/m;

/** Decisions go under the tree's «Решения» heading, one line each; the heading is added when missing. */
export function addDecisions(body: string, decisions: readonly string[]): string {
  const lines = decisions.map((line) => `- ${line}`).join('\n');
  const match = DECISIONS.exec(body);
  if (!match) return `${body.trimEnd()}\n\n${pick({ ru: '## Решения', en: '## Decisions' })}\n\n${lines}\n`;
  // After the heading's own paragraph, before the next heading.
  const from = match.index + match[0].length;
  const next = body.slice(from).search(/^##\s/m);
  const end = next < 0 ? body.length : from + next;
  const section = body.slice(from, end).trimEnd();
  return `${body.slice(0, from)}${section}\n\n${lines}\n${next < 0 ? '' : `\n${body.slice(end)}`}`;
}

/** Plants a proposal under the root (or `parent`); returns how many nodes were added. */
export function plant(tree: Tree, proposal: Proposal, parent = 'root'): number {
  let projectChanged = false;
  if (proposal.goal && !tree.project.goal) {
    tree.project.goal = proposal.goal;
    projectChanged = true;
  }
  if (proposal.decisions?.length) {
    tree.project.body = addDecisions(tree.project.body, proposal.decisions);
    projectChanged = true;
  }
  if (projectChanged) writeProject(tree.project);
  let added = 0;
  const walk = (list: ImportedNode[], under: string) => {
    for (const item of list) {
      const node = addNode(tree, {
        title: item.title,
        parent: under,
        status: item.status,
        ...(item.who ? { who: item.who } : {}),
        ...(item.doneWhen ? { doneWhen: item.doneWhen } : {}),
        ...(item.waiting ? { waiting: item.waiting } : {}),
        ...(item.until ? { until: item.until } : {}),
        ...(item.note ? { body: item.note } : {}),
        ...(item.check ? { check: item.check } : {}),
      });
      added += 1;
      walk(item.children, node.id);
    }
  };
  walk(proposal.nodes, parent);
  writeOverview(tree);
  return added;
}

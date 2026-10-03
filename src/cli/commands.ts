/**
 * `treeyard` — the tree of a project in the terminal.
 *
 * Without arguments: the TUI (or a wizard, when the folder has no tree yet).
 * With a command: small, scriptable steps — the same ones agents use to read
 * the tree and write back to it.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

import { parseArgs } from 'node:util';

import { contextText, START_HINT, START_LABEL, sessionPlan } from '../agents/context.js';
import { countNodes, type Proposal, parseProposal, plant, proposeTree } from '../agents/importer.js';
import { BRAIN_LABEL, launch, projectSessions, sessionOwners } from '../agents/launch.js';
import { launchInPane } from '../agents/panes.js';
import { pick, t } from '../i18n/i18n.js';
import { addLinkedNode, setNeeds } from '../model/links.js';
import { addNote, noteOrigin, originText } from '../model/notes.js';
import { addNode, logToNode, moveNode, STATUS_LABEL, setStatus, updateNode } from '../model/ops.js';
import { writeOverview } from '../model/overview.js';
import { findProject, loadTree, writeProject } from '../model/store.js';
import { ago } from '../model/time.js';
import { isStatusOrder, STATUS_ORDER_NAMES, type StatusOrderName } from '../model/tree.js';
import {
  type BrainId,
  ROOT,
  START_MODES,
  STATUSES,
  type StartMode,
  type Status,
  type Tree,
  WHO,
  type Who,
} from '../model/types.js';
import { MAX_PANES, orderOf, SLEEP_AFTER, settings, settingsPath, updateSettings } from '../settings.js';
import { createTree, getTemplate, listTemplates } from '../templates/templates.js';
import { inlineMark, WORDMARK } from '../tui/logo.js';
import { nodeText, paint, treeJson, treeText } from './print.js';

const require = createRequire(import.meta.url);
const VERSION = (require('../../package.json') as { version: string }).version;
const out = paint(process.stdout);
const err = paint(process.stderr);

class UsageError extends Error {}

function helpText(): string {
  const statuses = STATUSES.map((s) => `${s} (${STATUS_LABEL[s]})`).join(' · ');
  const head = `${out.c('#7ee2a8', out.bold(WORDMARK))} ${VERSION}`;
  return pick({
    ru: `${head} — дерево целей проекта в терминале, с сессиями агентов в узлах

${out.bold('Без аргументов')}  открывает дерево (или мастер, если дерева ещё нет)

${out.bold('Команды')}
  treeyard init [--template <id>]          посадить дерево: с агентом или по шаблону (мастер)
  treeyard init --agent [--brain codex]    агент изучит папку, задаст вопросы и посадит дерево
  treeyard import [--brain claude]         агент молча читает план проекта и строит дерево
  treeyard import --from-json <файл|->     посадить дерево из JSON (так сажает агент)
  treeyard pointer                         дописать блок о дереве в AGENTS.md / CLAUDE.md
  treeyard skills [install]                скилл посадки: где он, поставить в Claude Code, Codex, Antigravity
  treeyard templates                       шаблоны: этапы, направления, микадо…
  treeyard show [id] [--json] [--open]     дерево или узел текстом (--open — без готового)
  treeyard add "<название>" [--parent id] [--status s] [--who agent|human|any]
                [--done-when "…"] [--check "команда"] [--note "…"]
  treeyard add "<название>" --project ../X --for <id>   узел в дереве проекта X, нужный узлу id отсюда
  treeyard set <id> ключ=значение…         status, title, who, done_when, check, waiting, until, parent,
                                           needs=../X#id (ждёт узла другого проекта); --project ../X — узел там
  treeyard log <id> "<текст>" [--as имя]   запись в журнал узла
  treeyard note "<текст>" [--node id]      замечание о treeyard из любой папки — в «Замечания» дерева notes
  treeyard context <id> [--start plan|do|goal|chat]   что получит агент
  treeyard open <id> [--brain claude|codex|antigravity] [--pane|--bg] [--start …] [--yes]
                                           сессия по узлу прямо из shell
  treeyard sessions [--json]               сессии папки во всех CLI и чьи они
  treeyard config [ключ [значение]]        настройки: lang ru|en, confirm, theme…

${out.bold('Статусы')}  ${statuses}
${out.bold('Пример')}   treeyard set k3f9 status=waiting waiting="нет сервера" until="появится VPS"`,
    en: `${head} — a project's goal tree in the terminal, with agent sessions on its nodes

${out.bold('No arguments')}    opens the tree (or a wizard when there is no tree yet)

${out.bold('Commands')}
  treeyard init [--template <id>]          plant a tree: with an agent or from a template (wizard)
  treeyard init --agent [--brain codex]    an agent studies the folder, asks questions, plants the tree
  treeyard import [--brain claude]         an agent silently reads the project's plan and builds the tree
  treeyard import --from-json <file|->     plant a tree from JSON (how the agent plants it)
  treeyard pointer                         add the block about the tree to AGENTS.md / CLAUDE.md
  treeyard skills [install]                the planting skill: where it is, install into Claude Code, Codex, Antigravity
  treeyard templates                       templates: stages, directions, mikado…
  treeyard show [id] [--json] [--open]     the tree or a node as text (--open hides finished work)
  treeyard add "<title>" [--parent id] [--status s] [--who agent|human|any]
                [--done-when "…"] [--check "command"] [--note "…"]
  treeyard add "<title>" --project ../X --for <id>   a node in project X's tree that node id here needs
  treeyard set <id> key=value…             status, title, who, done_when, check, waiting, until, parent,
                                           needs=../X#id (waits for a node of another project); --project ../X — a node there
  treeyard log <id> "<text>" [--as name]   a line in the node's journal
  treeyard note "<text>" [--node id]       a note about treeyard from any folder — into «Notes» of the notes tree
  treeyard context <id> [--start plan|do|goal|chat]   what an agent gets
  treeyard open <id> [--brain claude|codex|antigravity] [--pane|--bg] [--start …] [--yes]
                                           a session for a node straight from the shell
  treeyard sessions [--json]               sessions of this folder in every CLI, and whose they are
  treeyard config [key [value]]            settings: lang ru|en, confirm, theme…

${out.bold('Statuses')}  ${statuses}
${out.bold('Example')}   treeyard set k3f9 status=waiting waiting="no server" until="a VPS is rented"`,
  });
}

async function main(argv: string[]): Promise<number> {
  // Language and theme before the first word is printed.
  settings();
  const [command, ...rest] = argv;
  switch (command) {
    case undefined:
      return openTui();
    case 'init':
      return initCommand(rest);
    case 'import':
      return importCommand(rest);
    case 'pointer':
      return pointerCommand();
    case 'skills':
    case 'skill':
      return skillsCommand(rest);
    case 'templates':
      return templatesCommand();
    case 'show':
    case 'tree':
      return showCommand(rest);
    case 'add':
      return addCommand(rest);
    case 'set':
      return setCommand(rest);
    case 'log':
      return logCommand(rest);
    case 'note':
      return noteCommand(rest);
    case 'context':
      return contextCommand(rest);
    case 'open':
      return openCommand(rest);
    case 'sessions':
      return sessionsCommand(rest);
    case 'config':
    case 'settings':
      return configCommand(rest);
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(`${helpText()}\n`);
      return 0;
    case '--version':
    case '-v':
    case 'version':
      process.stdout.write(`${VERSION}\n`);
      return 0;
    default:
      throw new UsageError(
        t('нет такой команды «{command}» — treeyard help', {
          command,
        }),
      );
  }
}

function parse<T extends NonNullable<Parameters<typeof parseArgs>[0]>['options']>(args: string[], options: T) {
  try {
    return parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
}

function project(): Tree {
  const dir = findProject();
  if (!dir) throw new UsageError(t('здесь нет дерева (.tree/) — treeyard init, чтобы посадить'));
  return loadTree(dir);
}

function nodeArg(tree: Tree, id: string | undefined): string {
  if (!id) throw new UsageError(t('укажи id узла — он виден в treeyard show'));
  if (id === ROOT) return id;
  if (tree.nodes.has(id)) return id;
  // A prefix is enough when it is unique.
  const matches = [...tree.nodes.keys()].filter((key) => key.startsWith(id));
  if (matches.length === 1) return matches[0]!;
  throw new UsageError(
    matches.length > 1
      ? t('id «{id}» подходит к нескольким узлам', {
          id,
        })
      : t('нет узла «{id}»', {
          id,
        }),
  );
}

function statusArg(value: string): Status {
  const normalized = value.trim().toLowerCase();
  if ((STATUSES as readonly string[]).includes(normalized)) return normalized as Status;
  const byLabel = STATUSES.find((status) => STATUS_LABEL[status] === normalized);
  if (byLabel) return byLabel;
  throw new UsageError(
    t('статус бывает: {p1}', {
      p1: STATUSES.join(', '),
    }),
  );
}

/** An absolute folder; `~` too, which a quoted path brings unexpanded. */
function folderArg(value: string): string {
  return resolve(value.trim().replace(/^~(?=$|\/)/, homedir()));
}

function whoArg(value: string): Who {
  if ((WHO as readonly string[]).includes(value)) return value as Who;
  throw new UsageError(t('who бывает: agent, human, any'));
}

function brainArg(value: string | undefined, fallback: BrainId): BrainId {
  if (!value) return fallback;
  const v = value.toLowerCase();
  if (v === 'claude' || v === 'cc') return 'claude';
  if (v === 'codex') return 'codex';
  if (v === 'antigravity' || v === 'agy') return 'antigravity';
  throw new UsageError(t('мозг бывает: claude, codex, antigravity'));
}

function startArg(value: string | undefined, fallback: StartMode): StartMode {
  if (!value) return fallback;
  if ((START_MODES as readonly string[]).includes(value)) return value as StartMode;
  throw new UsageError(
    t('старт бывает: {p1}', {
      p1: START_MODES.join(', '),
    }),
  );
}

/** Who writes to the journal: you at a terminal, an agent when nobody is. */
function sourceOf(given: string | undefined): string {
  return given?.trim() || process.env.TREEYARD_AS || (process.stdin.isTTY ? t('ты') : t('агент'));
}

/**
 * Whether a person is at the keyboard. Agents run commands without a
 * terminal; `--as claude` names the agent but does not make it a person.
 */
function byPerson(given: string | undefined): boolean {
  if (process.stdin.isTTY) return true;
  return /^(ты|you)$/i.test(given?.trim() ?? process.env.TREEYARD_AS ?? '');
}

// ── TUI ─────────────────────────────────────────────────────────────────────

async function openTui(): Promise<number> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    // No terminal to draw in: print the tree instead.
    return showCommand([]);
  }
  const dir = findProject();
  // No tree here yet: the first-run wizard, which may hand over to an agent.
  if (!dir) return wizard(process.cwd());
  const { runTui } = await import('../tui/run.js');
  await runTui(dir);
  return 0;
}

async function initCommand(args: string[]): Promise<number> {
  const { values } = parse(args, {
    template: { type: 'string', short: 't' },
    title: { type: 'string' },
    goal: { type: 'string' },
    brain: { type: 'string' },
    agent: { type: 'boolean', short: 'a' },
    bare: { type: 'boolean' },
    yes: { type: 'boolean', short: 'y' },
  });
  const dir = process.cwd();
  if (values.agent) return plantCommand(dir, brainArg(values.brain, 'claude'), Boolean(values.yes));
  if (findProject(dir) === dir) throw new UsageError(t('здесь уже есть дерево — treeyard, чтобы открыть'));
  if (values.template && values.goal) {
    const template = getTemplate(values.template);
    if (!template)
      throw new UsageError(
        t('нет шаблона «{template}» — treeyard templates', {
          template: values.template,
        }),
      );
    const tree = createTree(dir, template, {
      title: values.title ?? dir.split('/').pop() ?? t('Проект'),
      answers: { goal: values.goal },
      brain: brainArg(values.brain, 'claude'),
      // --bare: the method and the goal, without the template's example branches.
      ...(values.bare ? { skeleton: false } : {}),
    });
    process.stdout.write(`${treeText(tree, out)}\n`);
    return 0;
  }
  if (!process.stdin.isTTY) throw new UsageError(t('без терминала: treeyard init --template <id> --goal "…"'));
  return wizard(dir, values.template);
}

/** The wizard; it may hand over to an agent, and the tree opens once it is planted. */
async function wizard(dir: string, template?: string): Promise<number> {
  const { runInit } = await import('../tui/init.js');
  const result = await runInit(dir, template);
  if (result.agent) return plantCommand(dir, result.agent, true);
  if (result.created) {
    const { runTui } = await import('../tui/run.js');
    await runTui(dir);
  }
  return 0;
}

/** An agent interviews the person and plants the tree; then the tree opens. */
async function plantCommand(dir: string, brain: BrainId, confirmed: boolean): Promise<number> {
  const { folderFacts, plantingInPane, plantWithAgent } = await import('../agents/planting.js');
  const facts = folderFacts(dir);
  if (!confirmed && settings().confirm && process.stdin.isTTY) {
    process.stderr.write(
      `\n${inlineMark(err.c)}\n` +
        `  ${err.dim(t('Кто'))}        ${BRAIN_LABEL[brain]} · ${plantingInPane() ? t('в панели') : t('в этом терминале')}\n` +
        `  ${err.dim(t('Что'))}        ${
          facts.tree
            ? t('посмотрит дерево и проект, предложит, как дорастить')
            : facts.empty
              ? t('попросит выложить всё о проекте, потом поведёт по вопросам')
              : t('изучит папку, даст короткий отчёт, потом поведёт по вопросам')
        }\n` +
        `  ${err.dim(t('Запишет'))}    ${t('дерево и короткие документы — только после твоего «да»')}\n\n`,
    );
    if (!(await askYes(t('Начать?')))) {
      process.stderr.write(`${err.dim(t('не запускаю'))}\n`);
      return 0;
    }
  }
  const planted = await plantWithAgent(dir, brain);
  if (planted.mode === 'pane') {
    const { runTui } = await import('../tui/run.js');
    await runTui(dir, planted.pane);
    return 0;
  }
  const { result } = planted;
  if (result.error) {
    process.stderr.write(`${err.c('#ff8f8f', '✗')} ${result.error.message}\n`);
    return 1;
  }
  if (findProject(dir) === dir && process.stdin.isTTY && process.stdout.isTTY) {
    const { runTui } = await import('../tui/run.js');
    await runTui(dir);
    return 0;
  }
  process.stderr.write(
    findProject(dir) === dir
      ? `${err.c('#7ee2a8', '✓')} ${t('дерево посажено — treeyard, чтобы открыть')}\n`
      : `${err.dim(t('дерево пока не посажено — продолжить: treeyard init --agent'))}\n`,
  );
  return 0;
}

/** Adds (or refreshes) the block about the tree in AGENTS.md, CLAUDE.md and GEMINI.md. */
async function pointerCommand(): Promise<number> {
  const dir = findProject() ?? process.cwd();
  const { addPointer, pointerTargets } = await import('../templates/pointer.js');
  const targets = pointerTargets(dir);
  if (targets.length === 0) {
    process.stderr.write(`${t('нет AGENTS.md, CLAUDE.md или GEMINI.md — нечего дописывать')}\n`);
    return 1;
  }
  for (const file of targets) addPointer(resolve(dir, file));
  process.stdout.write(
    `${t('блок о дереве — в {files}', {
      files: targets.join(', '),
    })}\n`,
  );
  return 0;
}

/** The planting skill: where it is, and installing it into the CLIs. */
async function skillsCommand(args: string[]): Promise<number> {
  const { installSkill, SKILL, skillHomes, skillPath } = await import('../agents/planting.js');
  const action = args[0] ?? 'list';
  if (action === 'install') {
    const written = installSkill();
    if (written.length === 0) {
      process.stderr.write(`${t('не нашёл ни Claude Code, ни Codex, ни Antigravity')}\n`);
      return 1;
    }
    for (const file of written) process.stdout.write(`${out.c('#7ee2a8', '✓')} ${file}\n`);
    process.stdout.write(
      `${t('теперь в любой папке: «посади дерево этого проекта» или /{skill} в Claude Code', {
        skill: SKILL,
      })}\n`,
    );
    return 0;
  }
  if (action === 'path') {
    process.stdout.write(`${skillPath()}\n`);
    return 0;
  }
  process.stdout.write(`${out.bold(SKILL)}  ${out.dim(skillPath())}\n`);
  for (const home of skillHomes()) {
    const installed = (await import('node:fs')).existsSync(resolve(home.dir, SKILL, 'SKILL.md'));
    process.stdout.write(
      `  ${BRAIN_LABEL[home.brain].padEnd(12)} ${
        installed
          ? out.c('#7ee2a8', t('установлен'))
          : home.present
            ? out.dim(t('не установлен'))
            : out.dim(t('нет CLI'))
      }  ${out.dim(home.dir)}\n`,
    );
  }
  process.stdout.write(`${out.dim(t('treeyard skills install — поставить во все найденные CLI'))}\n`);
  return 0;
}

async function importCommand(args: string[]): Promise<number> {
  const { values } = parse(args, {
    brain: { type: 'string' },
    model: { type: 'string' },
    effort: { type: 'string' },
    template: { type: 'string' },
    hint: { type: 'string' },
    'dry-run': { type: 'boolean' },
    'from-json': { type: 'string' },
  });
  const dir = findProject() ?? process.cwd();
  const existing = findProject();
  const brain = brainArg(values.brain, 'claude');
  let proposal: Proposal;
  if (values['from-json']) {
    // `-`: the agent that planted it with a person passes it in one command, no file left behind.
    const source = values['from-json'] === '-' ? 0 : resolve(values['from-json']);
    proposal = parseProposal(readFileSync(source, 'utf8'));
  } else {
    process.stderr.write(
      t('{p1} {p2} {p3} читает план проекта {p4}\n', {
        p1: inlineMark(err.c),
        p2: err.dim('·'),
        p3: BRAIN_LABEL[brain],
        p4: err.dim(dir),
      }),
    );
    const started = Date.now();
    proposal = await proposeTree(dir, {
      brain,
      ...(values.model ? { model: values.model } : {}),
      ...(values.effort ? { effort: values.effort } : {}),
      ...(values.hint ? { hint: values.hint } : {}),
      onEvent: (event) => {
        if (event.feed && event.kind !== 'message') process.stderr.write(`  ${err.dim(event.summary)}\n`);
      },
    });
    const total = countNodes(proposal.nodes);
    process.stderr.write(
      `${err.dim(
        t('  ответ за {p1} с · {total} узлов', {
          p1: Math.round((Date.now() - started) / 1000),
          total,
        }),
      )}\n`,
    );
  }
  if (values['dry-run']) {
    process.stdout.write(`${JSON.stringify(proposal, null, 2)}\n`);
    return 0;
  }
  let tree: Tree;
  if (existing) {
    tree = loadTree(existing);
  } else {
    const wanted = values.template ?? proposal.template ?? 'directions';
    const template = getTemplate(wanted);
    if (!template)
      throw new UsageError(
        t('нет шаблона «{template}»', {
          template: wanted,
        }),
      );
    tree = createTree(dir, template, {
      title: proposal.title ?? dir.split('/').pop() ?? t('Проект'),
      answers: proposal.goal ? { goal: proposal.goal } : {},
      brain,
      skeleton: false,
    });
  }
  const added = plant(tree, proposal);
  process.stdout.write(`${treeText(loadTree(tree.project.dir), out)}\n`);
  process.stderr.write(
    t('\n{p1} в дереве {added} новых узлов — treeyard, чтобы открыть\n', {
      p1: err.c('#7ee2a8', '✓'),
      added,
    }),
  );
  return 0;
}

function templatesCommand(): number {
  for (const template of listTemplates()) {
    process.stdout.write(
      `${out.bold(template.name.padEnd(18))} ${out.dim(template.id.padEnd(11))} ${template.tagline}\n${' '.repeat(31)}${out.dim(template.for)}\n`,
    );
  }
  return 0;
}

// ── Reading and writing the tree ───────────────────────────────────────────

function showCommand(args: string[]): number {
  const { values, positionals } = parse(args, { json: { type: 'boolean' }, open: { type: 'boolean' } });
  const tree = project();
  if (positionals[0]) {
    const id = nodeArg(tree, positionals[0]);
    const node = tree.nodes.get(id);
    if (!node)
      throw new UsageError(
        t('нет узла «{id}»', {
          id,
        }),
      );
    if (values.json) process.stdout.write(`${JSON.stringify(node, null, 2)}\n`);
    else process.stdout.write(`${nodeText(tree, node, out)}\n`);
    return 0;
  }
  if (values.json) process.stdout.write(`${JSON.stringify(treeJson(tree), null, 2)}\n`);
  else process.stdout.write(`${treeText(tree, out, { closed: !values.open })}\n`);
  for (const problem of tree.problems) process.stderr.write(`${err.c('#ff7b72', '!')} ${problem}\n`);
  return 0;
}

function addCommand(args: string[]): number {
  const { values, positionals } = parse(args, {
    parent: { type: 'string', short: 'p' },
    status: { type: 'string', short: 's' },
    who: { type: 'string' },
    'done-when': { type: 'string' },
    check: { type: 'string' },
    note: { type: 'string' },
    waiting: { type: 'string' },
    until: { type: 'string' },
    after: { type: 'string' },
    project: { type: 'string' },
    for: { type: 'string' },
    as: { type: 'string' },
  });
  const title = positionals.join(' ').trim();
  if (!title) throw new UsageError(t('treeyard add "<название>" [--parent id]'));
  if (values.for && !values.project)
    throw new UsageError(t('--for связывает с узлом другого проекта: добавь --project ../Проект'));
  if (values.project && !values.for)
    throw new UsageError(t('--project нужен вместе с --for <id> — узлом, который ждёт эту работу'));
  const here = project();
  // The node goes into the other tree; `--for` names the node here that waits for it.
  const tree = values.project ? otherProject(here, values.project) : here;
  const parent = values.parent ? nodeArg(tree, values.parent) : values.project ? undefined : ROOT;
  const input = {
    title,
    ...(parent ? { parent } : {}),
    status: values.status ? statusArg(values.status) : ('todo' as Status),
    ...(values.who ? { who: whoArg(values.who) } : {}),
    ...(values['done-when'] ? { doneWhen: values['done-when'] } : {}),
    ...(values.check ? { check: values.check } : {}),
    ...(values.note ? { body: values.note } : {}),
    ...(values.waiting ? { waiting: values.waiting } : {}),
    ...(values.until ? { until: values.until } : {}),
    ...(values.after ? { after: nodeArg(tree, values.after) } : {}),
  };
  if (values.project && values.for) {
    const waiter = nodeArg(here, values.for);
    const node = addLinkedNode(here, waiter, tree, input, sourceOf(values.as));
    const branch = tree.nodes.get(node.parent)?.title;
    process.stdout.write(
      `${node.id} · ${tree.project.title}${branch ? ` › ${branch}` : ''} ← ${here.project.title} › ${waiter}\n`,
    );
    return 0;
  }
  const node = addNode(tree, input, sourceOf(values.as));
  process.stdout.write(`${node.id}\n`);
  return 0;
}

/** Another project's tree, by its folder relative to this project's — the way refs are written. */
function otherProject(here: Tree, folder: string): Tree {
  const dir = resolve(here.project.dir, folder.trim().replace(/^~(?=$|\/)/, homedir()));
  if (findProject(dir) !== dir)
    throw new UsageError(t('в {dir} нет дерева (.tree/tree.md) — сначала treeyard init там', { dir }));
  if (dir === here.project.dir) throw new UsageError(t('--project указывает на этот же проект'));
  return loadTree(dir);
}

function setCommand(args: string[]): number {
  const { values, positionals } = parse(args, {
    as: { type: 'string' },
    note: { type: 'string' },
    project: { type: 'string' },
  });
  const here = project();
  // `--project ../X`: a node of another tree, the way an agent closes the shared node it made there.
  const tree = values.project ? otherProject(here, values.project) : here;
  const id = nodeArg(tree, positionals[0]);
  const pairs = positionals.slice(1);
  if (pairs.length === 0) throw new UsageError('treeyard set <id> status=review [waiting="…"] …');
  const fields: Record<string, string> = {};
  for (const pair of pairs) {
    const cut = pair.indexOf('=');
    if (cut <= 0)
      throw new UsageError(
        t('«{pair}» — нужно ключ=значение', {
          pair,
        }),
      );
    fields[pair.slice(0, cut).trim().replace(/-/g, '_')] = pair.slice(cut + 1);
  }
  const source = sourceOf(values.as);
  const known = new Set(['status', 'title', 'who', 'done_when', 'check', 'waiting', 'until', 'parent', 'needs']);
  for (const key of Object.keys(fields))
    if (!known.has(key))
      throw new UsageError(
        t('не знаю поле «{key}»', {
          key,
        }),
      );
  if (
    fields.title !== undefined ||
    fields.who !== undefined ||
    fields.done_when !== undefined ||
    fields.check !== undefined
  ) {
    updateNode(tree, id, {
      ...(fields.title !== undefined ? { title: fields.title } : {}),
      ...(fields.who !== undefined ? { who: fields.who ? whoArg(fields.who) : null } : {}),
      ...(fields.done_when !== undefined ? { doneWhen: fields.done_when } : {}),
      ...(fields.check !== undefined ? { check: fields.check } : {}),
    });
  }
  if (fields.needs !== undefined) {
    const refs = fields.needs
      .split(',')
      .map((ref) => ref.trim())
      .filter(Boolean);
    let links: ReturnType<typeof setNeeds>;
    try {
      links = setNeeds(tree, id, refs, source);
    } catch (error) {
      throw new UsageError((error as Error).message);
    }
    for (const link of links.filter((item) => item.missing))
      process.stderr.write(
        t('{p1} {ref} — не найдено, связь записана\n', { p1: err.c('#ffcf70', '!'), ref: link.ref }),
      );
  }
  if (fields.parent !== undefined) moveNode(tree, id, fields.parent === ROOT ? ROOT : nodeArg(tree, fields.parent));
  if (fields.status !== undefined || fields.waiting !== undefined || fields.until !== undefined) {
    const node = tree.nodes.get(id)!;
    const status = fields.status !== undefined ? statusArg(fields.status) : node.status;
    // A shared node (made from another project) is closed by the agent that did the work:
    // nobody comes to this tree to close it by hand.
    const shared = Boolean(tree.nodes.get(id)?.neededBy?.length);
    const agentDone = status === 'done' && !shared && !byPerson(values.as);
    if (agentDone) {
      process.stderr.write(
        t('{p1} готово ставит человек — ставлю «на проверке»\n', {
          p1: err.c('#ffcf70', '!'),
        }),
      );
    }
    setStatus(tree, id, agentDone ? 'review' : status, {
      ...(fields.waiting !== undefined ? { waiting: fields.waiting } : {}),
      ...(fields.until !== undefined ? { until: fields.until } : {}),
      source,
      ...(values.note ? { note: values.note } : {}),
    });
  }
  const node = tree.nodes.get(id)!;
  process.stdout.write(`${node.id} · ${STATUS_LABEL[node.status]} · ${node.title}\n`);
  return 0;
}

function logCommand(args: string[]): number {
  const { values, positionals } = parse(args, { as: { type: 'string' } });
  const tree = project();
  const id = nodeArg(tree, positionals[0]);
  const text = positionals.slice(1).join(' ').trim();
  if (!text) throw new UsageError(t('treeyard log <id> "что сделано; что осталось"'));
  logToNode(tree, id, text, sourceOf(values.as));
  process.stdout.write(
    t('{id} · записано\n', {
      id,
    }),
  );
  return 0;
}

/** One line about what gets in the way, from any folder into «Замечания» of the `notes` tree. */
function noteCommand(args: string[]): number {
  const { values, positionals } = parse(args, { node: { type: 'string', short: 'n' }, as: { type: 'string' } });
  const text = positionals.join(' ').trim();
  if (!text) throw new UsageError(t('treeyard note "что мешает или чего не хватает" [--node id]'));
  if (!settings().notes) throw new UsageError(t('куда писать замечания? treeyard config notes <папка с деревом>'));
  const target = folderArg(settings().notes);
  if (findProject(target) !== target)
    throw new UsageError(t('в {dir} нет дерева — treeyard config notes <папка с деревом>', { dir: target }));
  const here = findProject();
  const tree = here ? loadTree(here) : undefined;
  if (values.node && !tree) throw new UsageError(t('здесь нет дерева (.tree/) — --node не к чему отнести'));
  const origin = noteOrigin(
    tree,
    process.cwd(),
    process.env,
    tree && values.node ? nodeArg(tree, values.node) : undefined,
  );
  const notes = loadTree(target);
  const node = addNote(notes, text, origin, sourceOf(values.as));
  const branch = notes.nodes.get(node.parent)?.title ?? '';
  process.stdout.write(`${node.id} · ${notes.project.title} › ${branch} ← ${originText(origin)}\n`);
  return 0;
}

function contextCommand(args: string[]): number {
  const { values, positionals } = parse(args, { start: { type: 'string' }, brain: { type: 'string' } });
  const tree = project();
  const id = nodeArg(tree, positionals[0]);
  const brain = brainArg(values.brain, tree.project.brain ?? 'claude');
  const plan = sessionPlan(tree, id, startArg(values.start, tree.project.start ?? 'plan'), brain);
  process.stdout.write(
    t('{p1}\n\n# Первое сообщение ({start})\n\n{p3}\n', {
      p1: contextText(tree, id),
      start: plan.start,
      p3: plan.prompt ?? '—',
    }),
  );
  return 0;
}

async function openCommand(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {
    brain: { type: 'string', short: 'b' },
    start: { type: 'string' },
    bg: { type: 'boolean' },
    pane: { type: 'boolean' },
    model: { type: 'string' },
    effort: { type: 'string' },
    worktree: { type: 'boolean' },
    yes: { type: 'boolean', short: 'y' },
  });
  const tree = project();
  const id = nodeArg(tree, positionals[0]);
  const brain = brainArg(values.brain, tree.project.brain ?? 'claude');
  if (values.pane && values.bg) throw new UsageError(t('выбери одно: --pane или --bg'));
  const options = {
    brain,
    start: startArg(values.start, tree.project.start ?? 'plan'),
    ...(values.bg ? { background: true } : {}),
    ...(values.pane ? { pane: true } : {}),
    ...(values.model ? { model: values.model } : {}),
    ...(values.effort ? { effort: values.effort } : {}),
    ...(values.worktree ? { worktree: true } : {}),
  };
  if (settings().confirm && !values.yes && process.stdin.isTTY) {
    const node = tree.nodes.get(id)!;
    const plan = sessionPlan(tree, id, options.start, brain);
    process.stderr.write(
      `\n${inlineMark(err.c)}\n` +
        `  ${err.dim(t('Узел'))}        ${node.title}\n` +
        `  ${err.dim(t('Кто'))}         ${BRAIN_LABEL[brain]} · ${options.background ? t('в фоне, сам по себе') : options.pane ? t('в панели') : t('в этом терминале')}\n` +
        `  ${err.dim(t('Как начать'))}  ${START_LABEL[plan.start]} — ${START_HINT[plan.start]}\n\n`,
    );
    if (!(await askYes(t('Запустить сессию?')))) {
      process.stderr.write(`${err.dim(t('не запускаю'))}\n`);
      return 0;
    }
  }
  if (options.pane) {
    const { pane, warnings } = await launchInPane(tree, id, options, {
      width: process.stdout.columns || 100,
      height: Math.max(5, (process.stdout.rows || 30) - 6),
    });
    for (const warning of warnings) process.stderr.write(`! ${warning}\n`);
    process.stdout.write(t('сессия запущена в панели {pane} · открой treeyard, чтобы увидеть её\n', { pane }));
    return 0;
  }
  const { result, ref } = await launch(tree, id, options);
  for (const warning of result.warnings) process.stderr.write(`${err.c('#ffcf70', '!')} ${warning}\n`);
  if (result.error) {
    process.stderr.write(`${err.c('#ff7b72', '✗')} ${result.error.message}\n`);
    return 1;
  }
  if (ref)
    process.stderr.write(
      t('{p1} сессия {id} сохранена в узле {id2}\n', {
        p1: err.c('#7ee2a8', '✓'),
        id: ref.id,
        id2: id,
      }),
    );
  return result.ok ? 0 : 1;
}

async function sessionsCommand(args: string[]): Promise<number> {
  const { values } = parse(args, { json: { type: 'boolean' } });
  const tree = project();
  const list = await projectSessions(tree);
  const owners = sessionOwners(tree);
  if (values.json) {
    process.stdout.write(
      `${JSON.stringify(
        list.map((s) => ({ ...s, node: owners.get(s.id) })),
        null,
        2,
      )}\n`,
    );
    return 0;
  }
  for (const session of list) {
    const owner = owners.get(session.id);
    const live = session.live ? out.c('#c6a0ff', ` ● ${session.live.status}`) : '';
    process.stdout.write(
      `${session.brain.padEnd(11)} ${out.dim(session.id.slice(0, 8))}  ${(ago(session.updatedAt ?? session.startedAt) || '').padEnd(10)} ${session.title ?? out.dim(t('без названия'))}${live}${owner ? out.dim(`  → ${tree.nodes.get(owner)?.title}`) : ''}\n`,
    );
  }
  if (list.length === 0) process.stdout.write(`${out.dim(t('сессий в этой папке ещё не было'))}\n`);
  return 0;
}

/** «Запустить? [Y/n]» — Enter is yes. */
async function askYes(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise<string>((done) => rl.question(`${question} ${err.dim('[Y/n]')} `, done));
  rl.close();
  return !/^\s*(n|no|н|нет|т)\s*$/i.test(answer);
}

const GLOBAL_KEYS = [
  'lang',
  'confirm',
  'theme',
  'animation',
  'marquee',
  'statusOrder',
  'live',
  'open',
  'sleepAfter',
  'maxPanes',
  'notes',
] as const;
/** Keys in settings.json and on the command line, where they differ from the code. */
const SNAKE: Record<string, string> = { sleepAfter: 'sleep_after', maxPanes: 'max_panes', statusOrder: 'status_order' };
const PROJECT_KEYS = ['brain', 'start', 'model', 'effort', 'assist_model'] as const;

function configCommand(args: string[]): number {
  const [requestedKey, ...rest] = args;
  const key = Object.keys(SNAKE).find((name) => SNAKE[name] === requestedKey) ?? requestedKey;
  const value = rest.join(' ').trim();
  const dir = findProject();
  const tree = dir ? loadTree(dir) : undefined;
  if (!key) {
    process.stdout.write(`${out.bold(t('Для всех проектов'))}  ${out.dim(settingsPath())}\n`);
    for (const name of GLOBAL_KEYS) {
      const label = SNAKE[name] ?? name;
      process.stdout.write(`  ${label.padEnd(13)} ${shown(name)}\n`);
    }
    if (tree) {
      process.stdout.write(`${out.bold(t('Этот проект'))}  ${out.dim('.tree/tree.md')}\n`);
      const p = tree.project;
      const values: Record<string, string | undefined> = {
        brain: p.brain,
        start: p.start,
        model: p.model,
        effort: p.effort,
        assist_model: p.assistModel,
      };
      for (const name of PROJECT_KEYS) process.stdout.write(`  ${name.padEnd(13)} ${values[name] ?? out.dim('—')}\n`);
    }
    process.stdout.write(`\n${out.dim(t('Изменить: treeyard config <ключ> <значение> · в дереве — клавиша «,»'))}\n`);
    return 0;
  }
  function shown(name: (typeof GLOBAL_KEYS)[number]): string {
    const now = settings();
    if (name === 'notes') return now.notes || '—';
    if (name !== 'statusOrder') return String(now[name]);
    // The order itself, so a preset says what it means.
    return `${now.statusOrder}  ${orderOf(now).join(',')}`;
  }
  const flag = (text: string) => {
    if (/^(on|yes|true|да|1)$/i.test(text)) return true;
    if (/^(off|no|false|нет|0)$/i.test(text)) return false;
    throw new UsageError(t('{key}: да или нет (on/off)', { key }));
  };
  if ((GLOBAL_KEYS as readonly string[]).includes(key)) {
    if (!value) {
      process.stdout.write(`${shown(key as (typeof GLOBAL_KEYS)[number])}\n`);
      return 0;
    }
    if (key === 'lang') {
      if (value !== 'ru' && value !== 'en') throw new UsageError(t('язык: ru или en'));
      updateSettings({ lang: value });
    } else if (key === 'theme') {
      if (value !== 'dark' && value !== 'light') throw new UsageError(t('тема: dark или light'));
      updateSettings({ theme: value });
    } else if (key === 'open') {
      if (value !== 'pane' && value !== 'terminal') throw new UsageError(t('где: pane или terminal'));
      updateSettings({ open: value });
    } else if (key === 'statusOrder') {
      const list = value.split(/[\s,]+/).filter(Boolean);
      if ((STATUS_ORDER_NAMES as readonly string[]).includes(value))
        updateSettings({ statusOrder: value as StatusOrderName });
      else if (isStatusOrder(list)) updateSettings({ statusOrder: 'custom', customOrder: list });
      else
        throw new UsageError(
          t('порядок статусов: {names} или все статусы через запятую: {statuses}', {
            names: STATUS_ORDER_NAMES.join(', '),
            statuses: STATUSES.join(','),
          }),
        );
      if (tree) writeOverview(tree);
    } else if (key === 'sleepAfter' || key === 'maxPanes') {
      const choices: readonly number[] = key === 'sleepAfter' ? SLEEP_AFTER : MAX_PANES;
      const n = /^(off|none)$/i.test(value) ? 0 : Number(value);
      if (!choices.includes(n))
        throw new UsageError(t('{key}: выбери {choices}', { key: requestedKey, choices: choices.join('/') }));
      updateSettings({ [key]: n });
    } else if (key === 'notes') {
      if (/^(off|none|-)$/i.test(value)) updateSettings({ notes: '' });
      else {
        const dir = folderArg(value);
        if (findProject(dir) !== dir) throw new UsageError(t('в {dir} нет дерева (.tree/tree.md)', { dir }));
        updateSettings({ notes: dir });
      }
    } else updateSettings({ [key]: flag(value) });
    process.stdout.write(`${requestedKey} = ${shown(key as (typeof GLOBAL_KEYS)[number])}\n`);
    return 0;
  }
  if ((PROJECT_KEYS as readonly string[]).includes(key)) {
    if (!tree) throw new UsageError(t('здесь нет дерева (.tree/) — treeyard init, чтобы посадить'));
    const p = tree.project;
    if (key === 'brain') p.brain = brainArg(value, 'claude');
    else if (key === 'start') p.start = startArg(value, 'plan');
    else if (key === 'model') p.model = value || undefined;
    else if (key === 'effort') p.effort = value || undefined;
    else p.assistModel = value || undefined;
    writeProject(p);
    process.stdout.write(`${key} = ${value || '—'}\n`);
    return 0;
  }
  throw new UsageError(t('нет такой настройки «{key}» — treeyard config', { key }));
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof UsageError) {
      process.stderr.write(`${err.c('#ff7b72', '✗')} ${error.message}\n`);
      process.exitCode = 2;
      return;
    }
    process.stderr.write(`${err.c('#ff7b72', '✗')} ${(error as Error).message ?? String(error)}\n`);
    if (process.env.TREEYARD_DEBUG) process.stderr.write(`${(error as Error).stack}\n`);
    process.exitCode = 1;
  },
);

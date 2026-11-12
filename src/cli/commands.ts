/**
 * `treeyard` — the tree of a project in the terminal.
 *
 * Without arguments: the TUI (or a wizard, when the folder has no tree yet).
 * With a command: small, scriptable steps — the same ones agents use to read
 * the tree and write back to it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';
import { createInterface } from 'node:readline';

import { parseArgs } from 'node:util';

import {
  contextText,
  ROOT_START_HINT,
  ROOT_START_LABEL,
  START_HINT,
  START_LABEL,
  sessionPlan,
} from '../agents/context.js';
import { addDecisions, countNodes, type Proposal, parseProposal, plant, proposeTree } from '../agents/importer.js';
import { BRAIN_LABEL, launch, projectSessions, sessionOwners } from '../agents/launch.js';
import { isPending, launchInPane, sessionPanes } from '../agents/panes.js';
import { bindHeadCommit, HOOK_LINE, hookStatus, installHook, removeHook } from '../commit-hook.js';
import { parsePatch } from '../diff.js';
import { lineCount, linesLabel, projectDocs } from '../docs.js';
import { type DiffSource, diffText, fileLabel, fileStats, type GitFile, gitRepository } from '../git.js';
import {
  type Board,
  boardOf,
  cardOf,
  followStatuses,
  linkBoard,
  linkedRepo,
  linkRepo,
  parseBoardRef,
  settlePushes,
  syncBoard,
  syncIssues,
} from '../github.js';
import { pick, plural, t } from '../i18n/i18n.js';
import { BatchError, type BatchNode, parseBatch, plantBatch, resolveBatchRefs } from '../model/batch.js';
import { clipboardImage, forgetClipboard } from '../model/clipboard.js';
import { type FindField, findNodes } from '../model/find.js';
import { isCreationLine, lastOwnEntry, parseEntry } from '../model/history.js';
import { addImage, imagePath, listImages, purgeImages, removeImage, setImageNote } from '../model/images.js';
import { journalEntries, replaceEntry } from '../model/journal.js';
import { addLinkedNode, isSameTree, normalizeRef, setNeeds } from '../model/links.js';
import { addNote, homeShort, NODE_VAR, noteOrigin, notesFolder, originText } from '../model/notes.js';
import {
  addNode,
  attachCommit,
  deleteNode,
  detachCommit,
  logToNode,
  moveNode,
  STATUS_LABEL,
  setStatus,
  updateNode,
} from '../model/ops.js';
import {
  cleanGoal,
  decisionList,
  decisionsOf,
  hasDecisions,
  rulesOf,
  writeGoal,
  writeRules,
} from '../model/root-doc.js';
import { staleOf } from '../model/stale.js';
import { parseStatus, parseStatuses, UnknownStatus } from '../model/status-words.js';
import { findProject, loadTree, nodePath, writeProject } from '../model/store.js';
import { ago, nowIso, today } from '../model/time.js';
import {
  childrenOf,
  descendants,
  holderOf,
  isStatusOrder,
  offTree,
  offTreeLine,
  offTreeTally,
  STATUS_ORDER_NAMES,
  type StatusOrderName,
} from '../model/tree.js';
import {
  type BrainId,
  ROOT,
  START_MODES,
  STATUSES,
  type StartMode,
  type Status,
  type Tree,
  type TreeNode,
  WHO,
  type Who,
} from '../model/types.js';
import { rememberProject, seenProjects } from '../projects.js';
import { MAX_PANES, orderOf, SLEEP_AFTER, settings, settingsPath, updateSettings } from '../settings.js';
import { locate, projectStatus } from '../status.js';
import { createTree, getTemplate, listTemplates } from '../templates/templates.js';
import { commitTree, treeChanges, treeMessage } from '../tree-commit.js';
import { inlineMark, WORDMARK } from '../tui/logo.js';
import { WATCH_VERSION, watchTree } from '../watch.js';
import {
  foundJson,
  fullTreeJson,
  NODE_PARTS,
  type NodePart,
  nodeLine,
  nodeText,
  paint,
  partsJson,
  type StaleFn,
  staleJson,
  treeJson,
  treeText,
  watchLine,
} from './print.js';
import { skillLines, statusText } from './status-text.js';

const require = createRequire(import.meta.url);
const VERSION = (require('../../package.json') as { version: string }).version;
const out = paint(process.stdout);
const err = paint(process.stderr);

class UsageError extends Error {}

/** The command lines of the help, an entry (one line or a few) per command, in the current language. */
function commandLines(): string {
  return pick({
    ru: `  treeyard init [--template <id>]          посадить дерево: с агентом или по шаблону (мастер)
  treeyard init --agent [--brain codex]    агент изучит папку, задаст вопросы и посадит дерево
  treeyard import [--brain claude]         агент молча читает план проекта и строит дерево
  treeyard import --from-json <файл|->     посадить дерево из JSON (так сажает агент)
  treeyard status [--json] [--project <папка>]   сводка: версии, папка и дерево, узлы по статусам и брошенные,
                                           скиллы, указатель, git-хук, живые сессии и панели, GitHub;
                                           у каждой проблемы — команда, которая её исправит
  treeyard pointer                         дописать блок о дереве в AGENTS.md / CLAUDE.md
  treeyard skills [install]                скиллы treeyard и treeyard-init: где стоят, поставить в Claude Code, Codex,
                                           Antigravity (папки в проекте — обновить)
  treeyard templates                       шаблоны: этапы, направления, микадо…
  treeyard show [id…] [--json] [--open]    дерево или узлы текстом (--open — без готового; вне терминала готовое
                                           свёрнуто в «✓ готово: N», --all — всё)
                [--brief] [--journal N|all]  --brief — шапка, критерий и 3 последние записи; --journal — сколько записей
                [--only журнал,сессии…]    только эти части: header, criterion, commits, children, sessions, note,
                                           journal, history (смены статуса); можно по-русски
                [--project <папка>]        дерево другой папки, например основного worktree
  treeyard show --status review,idea [--under id]   узлы этих статусов в ветке, по строке: id, статус словом, путь
  treeyard show --under <id>               ветка узла деревом (с --open, --all, --json, как всё дерево)
  treeyard show --json --all [--under id]  всё о каждом узле для программ: описание, журнал, смены статуса (кто, когда,
                                           откуда, куда), картинки, даты, место среди соседей; version — формат JSON
  treeyard watch [--json] [--project <папка>]   следить за деревом, пока не прервёшь: строка на каждое изменение —
                                           узел добавлен, удалён, сменил статус, новая запись журнала, другая правка;
                                           пачка правок — по событию на узел; --json — строка JSON на событие, для программ
  treeyard find "<текст>" [--status s] [--under id]   поиск по названиям, критериям, описаниям и журналам всех узлов,
                                           готовых тоже: id, статус, путь и кусок совпадения (a|b — любое; --json, --limit N)
  treeyard docs [--json] [--project <папка>]   документы проекта, как в окне «Документы»: .md из Git (отслеживаемые и
                                           новые, без игнорируемых и узлов дерева; без Git — файлы папки), первым
                                           .tree/tree.md, затем README, AGENTS, CLAUDE; --json — путь, заголовок, строки, время
  treeyard projects [--json]               папки с деревьями, где запускались команды treeyard или дерево, свежие сверху:
                                           название, путь, когда видел; удалённые папки и git worktree не попадают;
                                           --json — path, title, goal, seen (для программ)
  treeyard add "<название>" [--parent id] [--after id] [--status s] [--who agent|human|any]
                [--done-when "…"] [--check "команда"] [--note "…"]   --after — после брата того же статуса
  treeyard add "<название>" --project ../X --for <id>   узел в дереве проекта X, нужный узлу id отсюда
  treeyard add --parent <id> --from-json <файл|->   несколько узлов разом: [{"title", "done_when", "note", "who", "status",
                                           "needs", "key", "children"}]; печатает их id; ошибка — не заводится ни один
  treeyard set <id> [<id>…] ключ=значение…  status, title, who, done_when, check, note (описание), waiting, until, parent,
                                           after=<id брата>|first|last (место среди братьев),
                                           needs=<id>|../X#id (ждёт узла этого дерева или другого проекта); --project ../X — узел там
                                           несколько id — то же всем (after= ставит их подряд); ошибка — не меняется ни один
  treeyard log <id> "<текст>" [--as имя]   запись в журнал узла
                [--status s] [--commit <ref>…]   заодно статус и коммиты (HEAD, ветка, SHA) — закрыть узел одной
                                           командой: log <id> "итог" --status review --commit HEAD
  treeyard log <id> --fix "<текст>"        исправить свою последнюю запись (время остаётся; статусы и коммиты не трогает)
                [--project <папка>]        писать в дерево другой папки, например основного worktree
  treeyard note "<текст>" [--node id]      замечание о treeyard из любой папки — в «Замечания» дерева notes
  treeyard rm <id> [<id>…]                 удалить узел, заведённый по ошибке (без журнала, детей, сессий, коммитов);
                                           узел с историей не удаляется — его закрывают: set <id> status=dropped
  treeyard decide ["<решение>"] [--json] [--project <папка>]   дописать решение в «Решения» .tree/tree.md (с датой);
                                           без текста — список; --json — {"decisions": [{"text", "date"}]}
  treeyard goal ["<цель>"] [--json] [--project <папка>]   цель дерева (goal в .tree/tree.md): без текста — посмотреть,
                                           с текстом — записать новую; остальное в файле не меняется
  treeyard rules [--from <файл|->] [--json] [--project <папка>]   правила дерева: .tree/tree.md без «Решения» — метод,
                                           как держим дерево, правила для агентов; --from — записать новые (шапка и
                                           «Решения» не меняются; решения — treeyard decide)
  treeyard commit [<id>…] [-m "…"]         закоммитить файлы дерева этих узлов, README и tree.md (chore(tree): …);
                                           код, другие узлы и чужой индекс не берёт; без id — узел этой сессии
  treeyard image <id> [файл…|--paste] [--note "…"]…   картинки узла: список, приложить файлы или из буфера;
                                           по --note на каждый файл по порядку или одна подпись на все
  treeyard image <id> 001.png --note "…" | --rm 001.png   подпись к картинке · удалить её
  treeyard diff <id> [--commit <ref>] [--file <путь>] [--stat|--json]   дифы коммитов узла
  treeyard diff <id> --add <ref>… | --rm <sha>   привязать коммиты (HEAD, ветка, тег, SHA) · убрать привязку
  treeyard diff <id> --working              текущие изменения проекта (общие для узлов)
  treeyard hook install|remove|status      git-хук post-commit: коммиты сессии из узла привязываются к узлу сами
  treeyard context <id> [--start plan|do|goal|chat] [--task "…"]   что получит агент
  treeyard open <id> [--brain claude|codex|antigravity|opencode] [--pane|--bg] [--start …] [--yes]
                                           сессия по узлу прямо из shell
                [--task "…"|-]             задание сверх контекста узла: в конец первого сообщения (- — из stdin)
                [--model <модель>] [--effort <уровень>]   только на этот запуск
                [--worktree]               только Claude Code: в новом git worktree (остальные CLI предупредят)
                [--pane --json]            для программ: JSON с id сессии и именем панели tmux (tmux -L brainyard)
  treeyard sessions [--json]               сессии папки во всех CLI и чьи они; ▣ — живая панель (в JSON — pane)
  treeyard github [link <owner>/<N>|<owner>/<repo> [--parent id] | sync]
                                           доска GitHub Project (карточки — узлы, колонки — статусы) или issues
                                           репозитория (открытые — узлы, закрытие — в обе стороны)
  treeyard config [ключ [значение]]        настройки: lang ru|en, confirm, theme…`,
    en: `  treeyard init [--template <id>]          plant a tree: with an agent or from a template (wizard)
  treeyard init --agent [--brain codex]    an agent studies the folder, asks questions, plants the tree
  treeyard import [--brain claude]         an agent silently reads the project's plan and builds the tree
  treeyard import --from-json <file|->     plant a tree from JSON (how the agent plants it)
  treeyard status [--json] [--project <dir>]   a summary: versions, the folder and its tree, nodes by status and
                                           abandoned ones, skills, the pointer, the git hook, live sessions and panes,
                                           GitHub; every problem with the command that fixes it
  treeyard pointer                         add the block about the tree to AGENTS.md / CLAUDE.md
  treeyard skills [install]                the treeyard and treeyard-init skills: where they are, install into Claude Code,
                                           Codex, Antigravity (copies in the project — refresh)
  treeyard templates                       templates: stages, directions, mikado…
  treeyard show [id…] [--json] [--open]    the tree or nodes as text (--open hides finished work; off a terminal
                                           finished work folds into «✓ done: N», --all shows everything)
                [--brief] [--journal N|all]  --brief — header, criterion and the last 3 entries; --journal — how many entries
                [--only journal,sessions…]  only these parts: header, criterion, commits, children, sessions, note,
                                           journal, history (status changes)
                [--project <dir>]          the tree of another folder, e.g. the main worktree
  treeyard show --status review,idea [--under id]   nodes of these statuses in a branch, a line each: id, status word, path
  treeyard show --under <id>               a node's branch as a tree (--open, --all, --json work as for the whole tree)
  treeyard show --json --all [--under id]  everything about every node for programs: description, journal, status
                                           changes (who, when, from, to), pictures, dates, place among siblings;
                                           version — the JSON format
  treeyard watch [--json] [--project <dir>]   watch the tree until interrupted: a line per change — a node added,
                                           removed, its status changed, a new journal entry, another edit; a burst of
                                           edits gives one event per node; --json — a JSON line per event, for programs
  treeyard find "<text>" [--status s] [--under id]   search titles, criteria, descriptions and journals of every node,
                                           done ones too: id, status, path and the matching piece (a|b — either; --json, --limit N)
  treeyard docs [--json] [--project <dir>]   the project's documents, as in the «Documents» window: .md from Git
                                           (tracked and new, without ignored files and tree nodes; without Git — the
                                           folder's files), .tree/tree.md first, then README, AGENTS, CLAUDE;
                                           --json — path, title, lines, time
  treeyard projects [--json]               folders with trees where treeyard commands or the tree ran, the most recent
                                           first: title, path, when seen; removed folders and git worktrees are left
                                           out; --json — path, title, goal, seen (for programs)
  treeyard add "<title>" [--parent id] [--after id] [--status s] [--who agent|human|any]
                [--done-when "…"] [--check "command"] [--note "…"]   --after — after a sibling of the same status
  treeyard add "<title>" --project ../X --for <id>   a node in project X's tree that node id here needs
  treeyard add --parent <id> --from-json <file|->   several nodes at once: [{"title", "done_when", "note", "who", "status",
                                           "needs", "key", "children"}]; prints their ids; an error adds none
  treeyard set <id> [<id>…] key=value…     status, title, who, done_when, check, note (description), waiting, until, parent,
                                           after=<sibling id>|first|last (the place among siblings),
                                           needs=<id>|../X#id (waits for a node of this tree or of another project); --project ../X — a node there
                                           several ids — the same to each (after= puts them one after another); an error changes none
  treeyard log <id> "<text>" [--as name]   a line in the node's journal
                [--status s] [--commit <ref>…]   the status and commits (HEAD, a branch, a SHA) too — close a node
                                           in one command: log <id> "summary" --status review --commit HEAD
  treeyard log <id> --fix "<text>"         correct your last entry (its time stays; status changes and commits are left alone)
                [--project <dir>]          write to the tree of another folder, e.g. the main worktree
  treeyard note "<text>" [--node id]       a note about treeyard from any folder — into «Notes» of the notes tree
  treeyard rm <id> [<id>…]                 delete a node added by mistake (no journal, children, sessions, commits);
                                           a node with a history is not deleted but closed: set <id> status=dropped
  treeyard decide ["<decision>"] [--json] [--project <dir>]   add a decision to «Decisions» in .tree/tree.md (dated);
                                           without text — the list; --json — {"decisions": [{"text", "date"}]}
  treeyard goal ["<goal>"] [--json] [--project <dir>]   the tree's goal (goal in .tree/tree.md): without text — read it,
                                           with text — write a new one; nothing else in the file changes
  treeyard rules [--from <file|->] [--json] [--project <dir>]   the tree's rules: .tree/tree.md without «Decisions» —
                                           the method, how the tree is kept, rules for agents; --from — write new ones
                                           (the header and «Decisions» stay; decisions — treeyard decide)
  treeyard commit [<id>…] [-m "…"]         commit the tree files of these nodes, README and tree.md (chore(tree): …);
                                           never the code, other nodes or what others staged; no ids — this session's node
  treeyard image <id> [file…|--paste] [--note "…"]…   a node's pictures: the list, attach files or the clipboard;
                                           a --note per file in order, or one caption for all
  treeyard image <id> 001.png --note "…" | --rm 001.png   caption a picture · remove it
  treeyard diff <id> [--commit <ref>] [--file <path>] [--stat|--json]   patches of the node's commits
  treeyard diff <id> --add <ref>… | --rm <sha>   attach commits (HEAD, a branch, a tag, a SHA) · remove the link
  treeyard diff <id> --working              current project changes (shared by nodes)
  treeyard hook install|remove|status      git post-commit hook: commits of a node's session attach to the node by themselves
  treeyard context <id> [--start plan|do|goal|chat] [--task "…"]   what an agent gets
  treeyard open <id> [--brain claude|codex|antigravity|opencode] [--pane|--bg] [--start …] [--yes]
                                           a session for a node straight from the shell
                [--task "…"|-]             an assignment on top of the node's context: added to the first message (- reads stdin)
                [--model <model>] [--effort <level>]   for this launch only
                [--worktree]               Claude Code only: in a new git worktree (other CLIs warn)
                [--pane --json]            for programs: JSON with the session id and the tmux pane name (tmux -L brainyard)
  treeyard sessions [--json]               sessions of this folder in every CLI, and whose they are; ▣ — a live pane
                                           (pane in JSON)
  treeyard github [link <owner>/<N>|<owner>/<repo> [--parent id] | sync]
                                           a GitHub Project board (cards are nodes, columns are statuses) or a
                                           repository's issues (open ones are nodes, closing goes both ways)
  treeyard config [key [value]]            settings: lang ru|en, confirm, theme…`,
  });
}

/** Command words that run another command's code. */
const COMMAND_ALIASES: Record<string, string> = { tree: 'show', skill: 'skills', images: 'image', settings: 'config' };

/** The lines of the general help that belong to one command; undefined for a word that is not a command. */
function commandHelp(name: string): string | undefined {
  const word = COMMAND_ALIASES[name] ?? name;
  const lines: string[] = [];
  let mine = false;
  for (const line of commandLines().split('\n')) {
    // An indented line without `treeyard` continues the entry above it.
    const head = /^ {2}treeyard (\S+)/.exec(line);
    if (head) mine = head[1] === word;
    if (mine) lines.push(line);
  }
  return lines.length ? `${lines.join('\n')}\n${out.dim(t('все команды — treeyard help'))}` : undefined;
}

/** Whether the arguments, up to a `--`, ask for help. */
function asksForHelp(args: string[]): boolean {
  const end = args.indexOf('--');
  return (end < 0 ? args : args.slice(0, end)).some((arg) => arg === '--help' || arg === '-h');
}

function unknownCommand(command: string): UsageError {
  return new UsageError(t('нет такой команды «{command}» — treeyard help', { command }));
}

function helpText(): string {
  const commands = commandLines();
  const statuses = STATUSES.map((s) => `${s} (${STATUS_LABEL[s]})`).join(' · ');
  const head = `${out.c('#7ee2a8', out.bold(WORDMARK))} ${VERSION}`;
  return pick({
    ru: `${head} — дерево целей проекта в терминале, с сессиями агентов в узлах

${out.bold('Без аргументов')}  открывает дерево (или мастер, если дерева ещё нет)

${out.bold('Команды')}
${commands}

${out.bold('Статусы')}  ${statuses}
           в командах — ключом, словом на любом языке или алиасом: review, на проверке, проверка
${out.bold('Пример')}   treeyard set k3f9 status=waiting waiting="нет сервера" until="появится VPS"`,
    en: `${head} — a project's goal tree in the terminal, with agent sessions on its nodes

${out.bold('No arguments')}    opens the tree (or a wizard when there is no tree yet)

${out.bold('Commands')}
${commands}

${out.bold('Statuses')}  ${statuses}
           in commands — the key, the word in either language or an alias: review, in review, check
${out.bold('Example')}   treeyard set k3f9 status=waiting waiting="no server" until="a VPS is rented"`,
  });
}

async function main(argv: string[]): Promise<number> {
  // Language and theme before the first word is printed.
  settings();
  // A status changed by any command moves its card on the GitHub board.
  followStatuses();
  const [command, ...rest] = argv;
  // `treeyard <command> --help` prints that command's lines, not an "unknown option" error.
  if (command && command !== 'help' && asksForHelp(rest)) {
    const help = commandHelp(command);
    if (help) {
      process.stdout.write(`${help}\n`);
      return 0;
    }
  }
  switch (command) {
    case undefined:
      return openTui();
    case 'init':
      return initCommand(rest);
    case 'import':
      return importCommand(rest);
    case 'status':
      return statusCommand(rest);
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
    case 'find':
      return findCommand(rest);
    case 'watch':
      return watchCommand(rest);
    case 'docs':
      return docsCommand(rest);
    case 'projects':
      return projectsCommand(rest);
    case 'add':
      return addCommand(rest);
    case 'set':
      return setCommand(rest).then(reportPushes);
    case 'log':
      return logCommand(rest);
    case 'note':
      return noteCommand(rest);
    case 'rm':
      return rmCommand(rest);
    case 'decide':
      return decideCommand(rest);
    case 'goal':
      return goalCommand(rest);
    case 'rules':
      return rulesCommand(rest);
    case 'commit':
      return commitCommand(rest);
    case 'image':
    case 'images':
      return imageCommand(rest);
    case 'diff':
      return diffCommand(rest);
    case 'hook':
      return hookCommand(rest);
    case 'context':
      return contextCommand(rest);
    case 'open':
      return openCommand(rest);
    case 'sessions':
      return sessionsCommand(rest);
    case 'github':
      return githubCommand(rest);
    case 'config':
    case 'settings':
      return configCommand(rest);
    case 'help':
      return helpCommand(rest[0]);
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
      throw unknownCommand(command);
  }
}

/** `treeyard help` is the whole help; `treeyard help <command>`, the lines of one command. */
function helpCommand(name: string | undefined): number {
  const text = name && name !== 'help' ? commandHelp(name) : helpText();
  if (text === undefined) throw unknownCommand(name!);
  process.stdout.write(`${text}\n`);
  return 0;
}

function parse<T extends NonNullable<Parameters<typeof parseArgs>[0]>['options']>(args: string[], options: T) {
  try {
    return parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
}

/**
 * The folder with the tree: the current one, or the one `--project` names. Any folder inside
 * a project does, so a git worktree reaches the main tree the same way.
 */
function projectDir(folder?: string): string {
  const dir = folder ? findProject(folderArg(folder)) : findProject();
  if (!dir) throw new UsageError(t('здесь нет дерева (.tree/) — treeyard init, чтобы посадить'));
  // So `treeyard projects` lists it.
  rememberProject(dir);
  return dir;
}

function project(folder?: string): Tree {
  const tree = loadTree(projectDir(folder));
  purgeImages(tree);
  return tree;
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

/** `after=`: a sibling's id (or its start), `first` or `last` — the place among the children of `parent`. */
function placeArg(tree: Tree, id: string, parent: string, value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const word = value.trim().toLowerCase();
  // No node id has an `i` or an `l`, so these words never clash with one.
  if (word === 'first') return null;
  if (word === 'last') return undefined;
  const sibling = nodeArg(tree, value.trim());
  if (sibling === id) throw new UsageError(t('after= не может указывать на сам узел'));
  if (tree.nodes.get(sibling)?.parent !== parent) {
    throw new UsageError(t('after=«{id}»: это не узел того же родителя — нужен брат, first или last', { id: sibling }));
  }
  return sibling;
}

/** `idea, todo (к работе), …`: the keys, with the label where it says more. */
function statusChoices(): string {
  return STATUSES.map((s) => (STATUS_LABEL[s] === s ? s : `${s} (${STATUS_LABEL[s]})`)).join(', ');
}

/** A status by its key, its label in either language, a short alias or its glyph. */
function statusArg(value: string): Status {
  const status = parseStatus(value);
  if (status) return status;
  throw new UsageError(t('статус бывает: {p1}', { p1: statusChoices() }));
}

/** `--status review,idea`: one or several statuses, in any of the forms `statusArg` takes. */
function statusesArg(value: string): Status[] {
  try {
    return parseStatuses(value);
  } catch (error) {
    if (!(error instanceof UnknownStatus)) throw error;
    throw new UsageError(t('«{word}» — не статус; статус бывает: {p1}', { word: error.word, p1: statusChoices() }));
  }
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
  if (v === 'opencode') return 'opencode';
  throw new UsageError(t('мозг бывает: claude, codex, antigravity, opencode'));
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
    rememberProject(dir);
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

/**
 * The project's setup in one look: versions, the folder and its tree (the main one from a git
 * worktree), nodes, skills, the pointer, the hook, live sessions and panes, GitHub — and for every
 * problem the command that fixes it. It reads and asks, never writes.
 */
async function statusCommand(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, { json: { type: 'boolean' }, project: { type: 'string' } });
  if (positionals.length) throw new UsageError(t('treeyard status [--json] [--project <папка>]'));
  const start = values.project ? folderArg(values.project) : process.cwd();
  const status = await projectStatus(locate(start));
  process.stdout.write(values.json ? `${JSON.stringify(status, null, 2)}\n` : `${statusText(status, out)}\n`);
  return 0;
}

/** Adds (or refreshes) the block about the tree in AGENTS.md, CLAUDE.md and GEMINI.md. */
async function pointerCommand(): Promise<number> {
  // The folder `treeyard status` checks: in a git worktree, the worktree's own files.
  const dir = locate(process.cwd()).folder;
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

/** The skills treeyard ships: where they are, and installing them into the CLIs. */
async function skillsCommand(args: string[]): Promise<number> {
  const { installSkills, skillStates, skillsRoot } = await import('../agents/skills.js');
  const { SKILL, skillPath } = await import('../agents/planting.js');
  const action = args[0] ?? 'list';
  const folder = locate(process.cwd()).folder;
  if (action === 'install') {
    const done = installSkills(folder);
    if (done.length === 0) {
      process.stderr.write(`${t('не нашёл ни Claude Code, ни Codex, ни Antigravity')}\n`);
      return 1;
    }
    for (const item of done)
      process.stdout.write(
        item.action === 'written'
          ? `${out.c('#7ee2a8', '✓')} ${homeShort(item.path)}\n`
          : `${out.dim(`· ${homeShort(item.path)} — ${t('уже стоит')}`)}\n`,
      );
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
  if (action !== 'list') throw new UsageError(t('treeyard skills [install]'));
  process.stdout.write(`${out.bold(t('скиллы treeyard'))}  ${out.dim(homeShort(skillsRoot()))}\n`);
  for (const line of skillLines(skillStates(folder), out)) process.stdout.write(`  ${line}\n`);
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
    proposal = parseProposal(await textFrom(values['from-json']));
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

/**
 * Abandoned nodes by the threshold alone: a CLI call does not ask the CLIs or tmux who is
 * alive, and a session that works writes to the node (opened, journal) anyway.
 */
function staleFn(tree: Tree): StaleFn {
  const afterHours = settings().staleAfter;
  return (node) => staleOf(node, { afterHours, tree });
}

function showCommand(args: string[]): number {
  const { values, positionals } = parse(args, {
    json: { type: 'boolean' },
    open: { type: 'boolean' },
    all: { type: 'boolean' },
    brief: { type: 'boolean' },
    journal: { type: 'string' },
    only: { type: 'string' },
    status: { type: 'string', short: 's' },
    under: { type: 'string' },
    project: { type: 'string' },
  });
  const tree = project(values.project);
  const only = values.only !== undefined ? onlyArg(values.only) : undefined;
  if (only && positionals.length === 0)
    throw new UsageError(t('--only — части узла: treeyard show <id> --only journal,sessions'));
  // Off a terminal (agents, pipes) statuses are words too: an agent filters by a word, never by a glyph.
  const piped = !process.stdout.isTTY;
  if (positionals.length > 0) {
    if (values.status !== undefined || values.under !== undefined)
      throw new UsageError(
        t('--status и --under — для дерева, без id узлов: treeyard show --status review --under <id>'),
      );
    // Resolve every id first: an unknown one fails the call without partial output.
    const nodes = positionals.map((arg) => {
      const id = nodeArg(tree, arg);
      const node = tree.nodes.get(id);
      if (!node)
        throw new UsageError(
          t('нет узла «{id}»', {
            id,
          }),
        );
      return node;
    });
    const staleOfNode = staleFn(tree);
    if (values.json) {
      const keep = journalOption(values.journal).journal;
      const rows = nodes.map((node) =>
        only ? partsJson(tree, node, only, keep) : { ...node, ...staleJson(staleOfNode(node)) },
      );
      process.stdout.write(`${JSON.stringify(rows.length === 1 ? rows[0] : rows, null, 2)}\n`);
      return 0;
    }
    const options = {
      brief: values.brief === true,
      ...journalOption(values.journal),
      ...(piped ? { words: true } : {}),
      ...(only ? { only } : {}),
    };
    const text = nodes.map((node) => {
      const stale = staleOfNode(node);
      return nodeText(tree, node, out, { ...options, ...(stale ? { stale } : {}) });
    });
    process.stdout.write(`${text.join('\n\n')}\n`);
    return 0;
  }
  const under = values.under !== undefined ? nodeArg(tree, values.under) : ROOT;
  if (values.status !== undefined) return statusList(tree, statusesArg(values.status), under, values.json === true);
  if (values.json) {
    // --all is the whole export for a program; without it — the short tree scripts already read.
    const json = values.all ? fullTreeJson(tree, staleFn(tree), under) : treeJson(tree, staleFn(tree), under);
    process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
  } else {
    // Off a terminal finished work folds into a counter, as in the TUI; --all brings it back.
    const fold = piped && !values.all && !values.open;
    const branch = tree.nodes.get(under);
    if (branch) process.stdout.write(`${nodeLine(tree, branch, out)}\n`);
    process.stdout.write(
      `${treeText(tree, out, {
        closed: !values.open,
        foldDone: fold,
        stale: staleFn(tree),
        words: piped,
        ...(branch ? { under: branch.id } : {}),
      })}\n`,
    );
  }
  for (const problem of tree.problems) process.stderr.write(`${err.c('#ff7b72', '!')} ${problem}\n`);
  return 0;
}

/** `show --status review,idea [--under id]`: the nodes of those statuses in the branch, a line each. */
function statusList(tree: Tree, statuses: Status[], under: string, json: boolean): number {
  const found = descendants(tree, under).filter((node) => statuses.includes(node.status));
  if (json) {
    process.stdout.write(
      `${JSON.stringify(
        found.map((node) => foundJson(tree, node, under)),
        null,
        2,
      )}\n`,
    );
    return 0;
  }
  const words = statuses.map((status) => STATUS_LABEL[status]).join(', ');
  const branch = tree.nodes.get(under);
  const where = branch ? t(' · в ветке «{title}»', { title: branch.title }) : '';
  if (!found.length) {
    process.stdout.write(`${t('{statuses}: таких узлов нет', { statuses: words })}${where}\n`);
    return 0;
  }
  const count = `${found.length} ${plural(found.length, ['узел', 'узла', 'узлов'], ['node', 'nodes'])}`;
  process.stdout.write(`${out.dim(`${words} · ${count}${where}`)}\n`);
  for (const node of found) process.stdout.write(`${nodeLine(tree, node, out, under)}\n`);
  return 0;
}

/** What `--only` takes for each part: the English name, a few synonyms and the Russian word. */
const PART_WORDS: Record<NodePart, readonly string[]> = {
  header: ['header', 'head', 'status', 'шапка', 'статус'],
  criterion: ['criterion', 'done_when', 'done-when', 'критерий', 'готово'],
  commits: ['commits', 'commit', 'коммиты', 'коммит'],
  children: ['children', 'kids', 'внутри', 'дети', 'подузлы'],
  sessions: ['sessions', 'session', 'сессии', 'сессия'],
  note: ['note', 'description', 'about', 'описание'],
  journal: ['journal', 'log', 'журнал'],
  history: ['history', 'история'],
};

/** `--only journal,sessions`: the parts of a node card to print. */
function onlyArg(value: string): Set<NodePart> {
  const parts = new Set<NodePart>();
  for (const raw of value.split(',')) {
    const word = raw.trim().toLowerCase();
    if (!word) continue;
    const part = NODE_PARTS.find((name) => PART_WORDS[name].includes(word));
    if (!part)
      throw new UsageError(
        t('--only: «{part}» — нет такой части; части: {parts}', { part: raw.trim(), parts: NODE_PARTS.join(', ') }),
      );
    parts.add(part);
  }
  if (!parts.size) throw new UsageError(t('--only: части через запятую: {parts}', { parts: NODE_PARTS.join(', ') }));
  return parts;
}

/** `treeyard find "текст"`: nodes that mention it anywhere, finished ones too, with the piece that matched. */
function findCommand(args: string[]): number {
  const { values, positionals } = parse(args, {
    status: { type: 'string', short: 's' },
    under: { type: 'string' },
    limit: { type: 'string' },
    json: { type: 'boolean' },
    project: { type: 'string' },
  });
  const query = positionals.join(' ').trim();
  if (!query) throw new UsageError(t('treeyard find "текст" [--status s] [--under id] — что искать?'));
  const tree = project(values.project);
  const under = values.under !== undefined ? nodeArg(tree, values.under) : ROOT;
  const statuses = values.status !== undefined ? statusesArg(values.status) : undefined;
  const limit = limitArg(values.limit);
  const found = findNodes(tree, query, { under, ...(statuses ? { statuses } : {}) });
  if (values.json) {
    const rows = found.slice(0, limit).map(({ node, hits }) => ({
      ...foundJson(tree, node, under),
      hits: hits.map(({ field, snippet, when }) => ({ field, text: snippet, ...(when ? { when } : {}) })),
    }));
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    return 0;
  }
  const branch = tree.nodes.get(under);
  const where = [
    statuses ? statuses.map((status) => STATUS_LABEL[status]).join(', ') : '',
    branch ? t('в ветке «{title}»', { title: branch.title }) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  if (!found.length) {
    process.stdout.write(`${t('по «{query}» ничего не нашлось', { query })}${where ? ` · ${where}` : ''}\n`);
    return 0;
  }
  const count = `${found.length} ${plural(found.length, ['узел', 'узла', 'узлов'], ['node', 'nodes'])}`;
  process.stdout.write(`${out.dim(`«${query}» · ${count}${where ? ` · ${where}` : ''}`)}\n`);
  const label: Record<FindField, string> = {
    title: '',
    id: '',
    done_when: t('готово, когда:'),
    check: t('проверка:'),
    waiting: t('ждёт:'),
    note: t('описание:'),
    journal: t('журнал:'),
  };
  for (const { node, hits } of found.slice(0, limit)) {
    process.stdout.write(`${nodeLine(tree, node, out, under)}\n`);
    for (const hit of hits) {
      if (hit.field === 'title' || hit.field === 'id') continue;
      const text = `${hit.snippet.slice(0, hit.at)}${out.bold(hit.snippet.slice(hit.at, hit.at + hit.length))}${hit.snippet.slice(hit.at + hit.length)}`;
      process.stdout.write(`    ${out.dim(hit.when ? `${label[hit.field]} ${hit.when}` : label[hit.field])} ${text}\n`);
    }
  }
  if (found.length > limit)
    process.stdout.write(
      `${out.dim(t('… ещё {n} — уточни запрос, добавь --status или --under, или --limit all', { n: found.length - limit }))}\n`,
    );
  return 0;
}

/**
 * `treeyard watch`: a line per change of the tree until Ctrl+C, a closed pipe or SIGTERM. With
 * `--json` the first line says the watch has begun — a program loads the whole tree after it and
 * misses nothing in between.
 */
function watchCommand(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, { json: { type: 'boolean' }, project: { type: 'string' } });
  if (positionals.length) throw new UsageError(t('treeyard watch [--json] [--project <папка>]'));
  const dir = projectDir(values.project);
  const json = values.json === true;
  return new Promise((done) => {
    const watcher = watchTree(dir, (events) => {
      const lines = events.map((event) => (json ? JSON.stringify(event) : watchLine(event, out)));
      process.stdout.write(`${lines.join('\n')}\n`);
    });
    const stop = () => {
      watcher.stop();
      done(0);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    // `treeyard watch | head` ends quietly when the reader goes away.
    process.stdout.on('error', stop);
    if (json) process.stdout.write(`${JSON.stringify({ type: 'ready', version: WATCH_VERSION, dir, at: nowIso() })}\n`);
    else
      process.stderr.write(
        `${err.dim(t('слежу за деревом в {dir} — Ctrl+C, чтобы выйти', { dir: homeShort(dir) }))}\n`,
      );
  });
}

/**
 * `treeyard docs`: the project's documents in the order of the «Документы» window, so a program
 * (Treeyard Web) never picks the files itself. `--json` — `[{path, title, lines, modified}]`.
 */
async function docsCommand(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, { json: { type: 'boolean' }, project: { type: 'string' } });
  if (positionals.length) throw new UsageError(t('treeyard docs [--json] [--project <папка>]'));
  const docs = await projectDocs(projectDir(values.project));
  if (values.json) {
    const list = docs.map((doc) => ({
      path: doc.path,
      title: doc.title,
      lines: doc.lines,
      modified: nowIso(new Date(doc.mtime)),
    }));
    process.stdout.write(`${JSON.stringify(list, null, 2)}\n`);
    return 0;
  }
  if (!docs.length) {
    process.stdout.write(`${out.dim(t('В проекте нет .md файлов'))}\n`);
    return 0;
  }
  const width = Math.min(Math.max(...docs.map((doc) => doc.path.length)), 40);
  for (const doc of docs) {
    // The file's own name says nothing new: README → README.
    const named = doc.title !== basename(doc.path).replace(/\.(md|markdown)$/i, '');
    process.stdout.write(
      `${doc.path.padEnd(width)}  ${named ? `${doc.title} ` : ''}${out.dim(`· ${linesLabel(doc.lines)} · ${ago(doc.mtime)}`)}\n`,
    );
  }
  return 0;
}

/** The folders with trees treeyard has seen, the most recent first; `--json` — for Treeyard Web. */
function projectsCommand(args: string[]): number {
  const { values, positionals } = parse(args, { json: { type: 'boolean' } });
  if (positionals.length) throw new UsageError(t('treeyard projects [--json]'));
  const projects = seenProjects();
  if (values.json) {
    const list = projects.map((p) => ({ path: p.path, title: p.title, goal: p.goal ?? null, seen: p.seen }));
    process.stdout.write(`${JSON.stringify(list, null, 2)}\n`);
    return 0;
  }
  if (!projects.length) {
    process.stdout.write(
      `${out.dim(t('treeyard ещё не видел ни одного дерева — запусти treeyard в папке проекта'))}\n`,
    );
    return 0;
  }
  const width = Math.min(Math.max(...projects.map((p) => p.title.length)), 32);
  const paths = projects.map((p) => homeShort(p.path));
  const pathWidth = Math.min(Math.max(...paths.map((path) => path.length)), 48);
  projects.forEach((p, i) => {
    process.stdout.write(`${p.title.padEnd(width)}  ${paths[i]!.padEnd(pathWidth)}  ${out.dim(ago(p.seen))}\n`);
  });
  return 0;
}

/** `--limit N|all`: how many found nodes to print; 30 by default. */
function limitArg(raw: string | undefined): number {
  if (raw === undefined) return 30;
  if (raw === 'all') return Number.POSITIVE_INFINITY;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new UsageError(t('--limit: число узлов или all'));
  return n;
}

function journalOption(raw: string | undefined): { journal?: number } {
  if (raw === undefined) return {};
  if (raw === 'all') return { journal: Number.POSITIVE_INFINITY };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new UsageError(t('--journal: число записей или all'));
  return { journal: n };
}

async function addCommand(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {
    'from-json': { type: 'string' },
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
  if (values['from-json'] !== undefined) return addBatch(title, values);
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

/**
 * `add --parent <id> --from-json <file|->`: several nodes, children and `needs` between them,
 * checked as a whole first; prints each new id with its title, children indented.
 */
async function addBatch(title: string, values: Record<string, string | boolean | undefined>): Promise<number> {
  if (title) throw new UsageError(t('--from-json: названия — в JSON, без названия в команде'));
  const alone = ['project', 'for', 'after', 'done-when', 'check', 'note', 'waiting', 'until'].find(
    (name) => values[name] !== undefined,
  );
  if (alone) throw new UsageError(t('--from-json: --{name} задаётся в JSON у каждого узла', { name: alone }));
  const tree = project();
  const parent = values.parent ? nodeArg(tree, String(values.parent)) : ROOT;
  const from = String(values['from-json']);
  let batch: BatchNode[];
  try {
    batch = parseBatch(await textFrom(from));
    resolveBatchRefs(tree, batch);
  } catch (error) {
    if (error instanceof BatchError) throw new UsageError(error.message);
    throw error;
  }
  const planted = plantBatch(tree, parent, batch, sourceOf(values.as as string | undefined), {
    ...(values.status ? { status: statusArg(String(values.status)) } : {}),
    ...(values.who ? { who: whoArg(String(values.who)) } : {}),
  });
  for (const { node, depth } of planted) process.stdout.write(`${'  '.repeat(depth)}${node.id}  ${node.title}\n`);
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

const SET_FIELDS = new Set([
  'status',
  'title',
  'who',
  'done_when',
  'check',
  'note',
  'waiting',
  'until',
  'parent',
  'after',
  'needs',
]);

/**
 * `treeyard set <id> [<id>…] key=value…`: one node or several, the same change to each. Ids
 * come first, pairs after; everything is checked before the first write, so an unknown id or
 * a bad value leaves every node as it was.
 */
async function setCommand(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {
    as: { type: 'string' },
    note: { type: 'string' },
    project: { type: 'string' },
  });
  const here = project();
  // `--project ../X`: a node of another tree, the way an agent closes the shared node it made there.
  const tree = values.project ? otherProject(here, values.project) : here;
  const firstPair = positionals.findIndex((arg) => arg.includes('='));
  const idArgs = firstPair < 0 ? positionals : positionals.slice(0, firstPair);
  const pairs = firstPair < 0 ? [] : positionals.slice(firstPair);
  // `status = review` with spaces: a field name among the ids.
  const loose = idArgs.find((arg) => SET_FIELDS.has(arg.replace(/-/g, '_')) && !tree.nodes.has(arg));
  if (loose) throw new UsageError(t('«{pair}» — нужно ключ=значение', { pair: loose }));
  const ids = [...new Set((idArgs.length ? idArgs : [undefined]).map((arg) => nodeArg(tree, arg)))];
  if (pairs.length === 0) throw new UsageError('treeyard set <id> [<id>…] status=review [waiting="…"] …');
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
  for (const key of Object.keys(fields)) {
    // `order` is a stored number in steps of 10: the way to change it is a place, not a number.
    if (key === 'order') throw new UsageError(t('порядок задаётся местом, а не числом: after=<id брата>|first|last'));
    if (!SET_FIELDS.has(key))
      throw new UsageError(
        t('не знаю поле «{key}»', {
          key,
        }),
      );
  }
  // Everything that can fail is checked here, before the first node is written.
  if (fields.title !== undefined && ids.length > 1)
    throw new UsageError(t('title= — у каждого узла своё название: меняй по одному'));
  const who = fields.who === undefined ? undefined : fields.who ? whoArg(fields.who) : null;
  const status = fields.status !== undefined ? statusArg(fields.status) : undefined;
  const refs = fields.needs !== undefined ? needsArg(tree, fields.needs) : undefined;
  if (refs && ids.some((id) => refs.includes(`.#${id}`))) throw new UsageError(t('узел не может ждать сам себя'));
  if (fields.note !== undefined && /^##\s+(?:Журнал|Journal)\s*$/m.test(fields.note))
    throw new UsageError(t('Раздел «Журнал» заполняется отдельно — убери его из описания'));
  const moves = fields.parent !== undefined || fields.after !== undefined ? planMoves(tree, ids, fields) : [];

  for (const id of ids) {
    if (
      who !== undefined ||
      fields.title !== undefined ||
      fields.done_when !== undefined ||
      fields.check !== undefined ||
      fields.note !== undefined
    ) {
      updateNode(tree, id, {
        ...(fields.title !== undefined ? { title: fields.title } : {}),
        ...(who !== undefined ? { who } : {}),
        ...(fields.done_when !== undefined ? { doneWhen: fields.done_when } : {}),
        ...(fields.check !== undefined ? { check: fields.check } : {}),
        ...(fields.note !== undefined ? { description: fields.note } : {}),
      });
    }
    if (refs) {
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
  }
  for (const move of moves) moveNode(tree, move.id, move.parent, move.after);
  const demoted = new Set<string>();
  if (status !== undefined || fields.waiting !== undefined || fields.until !== undefined) {
    for (const id of ids) {
      const next = closingStatus(tree, id, status ?? tree.nodes.get(id)!.status, values.as);
      if (next.demoted && !demoted.size) {
        process.stderr.write(
          t('{p1} готово ставит человек — ставлю «на проверке»\n', {
            p1: err.c('#ffcf70', '!'),
          }),
        );
      }
      if (next.demoted) demoted.add(id);
      setStatus(tree, id, next.status, {
        ...(fields.waiting !== undefined ? { waiting: fields.waiting } : {}),
        ...(fields.until !== undefined ? { until: fields.until } : {}),
        source,
        ...(values.note ? { note: values.note } : {}),
      });
    }
  }
  for (const id of ids) {
    const node = tree.nodes.get(id)!;
    // Done turned into review is said here too: stderr is often thrown away (`2>/dev/null`).
    const note = demoted.has(id) ? ` · ${demotedNote(values.as)}` : '';
    process.stdout.write(`${node.id} · ${STATUS_LABEL[node.status]} · ${node.title}${note}\n`);
  }
  return 0;
}

/** `needs=a,../X#b`: `y79a` and `#y79a` are nodes of this tree — an id prefix is enough, like in every command. */
function needsArg(tree: Tree, value: string): string[] {
  return value
    .split(',')
    .map((ref) => ref.trim())
    .filter(Boolean)
    .map((ref) => (normalizeRef(ref) === ref ? ref : `.#${nodeArg(tree, ref.replace(/^#/, ''))}`));
}

/**
 * Where `parent=` and `after=` put each node. `parent=` alone puts them last, `after=` alone
 * keeps their parent; several nodes stand one after another in the order given.
 */
function planMoves(
  tree: Tree,
  ids: string[],
  fields: Record<string, string>,
): { id: string; parent: string; after: string | null | undefined }[] {
  const target = fields.parent === undefined ? undefined : fields.parent === ROOT ? ROOT : nodeArg(tree, fields.parent);
  const parents = ids.map((id) => {
    const parent = target ?? tree.nodes.get(id)?.parent ?? ROOT;
    if (parent === id || descendants(tree, id).some((kid) => kid.id === parent))
      throw new UsageError(t('нельзя перенести узел внутрь самого себя'));
    return parent;
  });
  if (fields.after === undefined) return ids.map((id, i) => ({ id, parent: parents[i]!, after: undefined }));
  if (new Set(parents).size > 1)
    throw new UsageError(t('after= для нескольких узлов — им нужен один родитель: добавь parent=<id>'));
  const place = placeArg(tree, ids[0]!, parents[0]!, fields.after);
  if (typeof place === 'string' && ids.includes(place))
    throw new UsageError(t('after= не может указывать на сам узел'));
  return ids.map((id, i) => ({ id, parent: parents[i]!, after: i === 0 ? place : ids[i - 1] }));
}

/** Says where the cards moved by this command went, or why they did not. */
async function reportPushes(code: number): Promise<number> {
  for (const push of await settlePushes()) {
    if (push.error)
      process.stderr.write(
        t('{p1} github: не вышло: {text} — {error}\n', {
          p1: err.c('#ffcf70', '!'),
          text: push.text,
          error: push.error,
        }),
      );
    else process.stdout.write(`github: ${push.text}\n`);
  }
  return code;
}

async function githubCommand(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, { parent: { type: 'string' } });
  const tree = project();
  const [action, ref] = positionals;
  if (action === 'link') {
    if (!ref) throw new UsageError(t('treeyard github link <owner>/<номер>|<owner>/<репозиторий> [--parent id]'));
    const parent = values.parent ? nodeArg(tree, values.parent) : undefined;
    try {
      // owner/N or a project link is a board; anything else is a repository.
      if (parseBoardRef(ref)) {
        const board = await linkBoard(tree, ref, parent);
        process.stdout.write(t('дерево привязано к доске {board}\n', { board: `${board.owner}/${board.number}` }));
        printBoard(board, tree);
      } else {
        const repo = await linkRepo(tree, ref, parent);
        process.stdout.write(t('дерево привязано к репозиторию {repo}\n', { repo: `${repo.owner}/${repo.name}` }));
        printRepo(tree);
      }
    } catch (error) {
      throw new UsageError((error as Error).message);
    }
    return 0;
  }
  if (action === 'sync') {
    const board = boardOf(tree);
    const repo = linkedRepo(tree);
    if (!board && !repo)
      throw new UsageError(
        t('дерево не привязано к GitHub — treeyard github link <owner>/<номер>|<owner>/<репозиторий>'),
      );
    const line = (mark: string, node: TreeNode, text: string) =>
      process.stdout.write(`${mark} ${out.dim(node.id)} ${node.title}${text ? out.dim(` · ${text}`) : ''}\n`);
    let failed = 0;
    if (board) {
      const result = await syncBoard(tree);
      for (const node of result.added) line(out.c('#7ee2a8', '+'), node, STATUS_LABEL[node.status]);
      for (const node of result.pulled) line('←', node, STATUS_LABEL[node.status]);
      for (const node of result.pushed) line('→', node, cardOf(node)?.column ?? '');
      for (const { node, error } of result.failed) line(err.c('#ff7b72', '✗'), node, error);
      process.stdout.write(
        t('новых {added} · с доски {pulled} · на доску {pushed} · готовых карточек без узла {skipped}\n', {
          added: result.added.length,
          pulled: result.pulled.length,
          pushed: result.pushed.length,
          skipped: result.skipped,
        }),
      );
      failed += result.failed.length;
    }
    if (repo) {
      const result = await syncIssues(tree);
      for (const node of result.added) line(out.c('#7ee2a8', '+'), node, STATUS_LABEL[node.status]);
      for (const node of result.pulled) line('←', node, STATUS_LABEL[node.status]);
      for (const node of result.pushed) line('→', node, STATUS_LABEL[node.status]);
      for (const node of result.gone) line(err.c('#ffcf70', '?'), node, t('issue больше нет'));
      for (const { node, error } of result.failed) line(err.c('#ff7b72', '✗'), node, error);
      process.stdout.write(
        t('issues: новых {added} · с GitHub {pulled} · на GitHub {pushed}\n', {
          added: result.added.length,
          pulled: result.pulled.length,
          pushed: result.pushed.length,
        }),
      );
      failed += result.failed.length;
    }
    return failed ? 1 : 0;
  }
  if (action) throw new UsageError(t('treeyard github [link <owner>/<номер>|<owner>/<репозиторий> | sync]'));
  const board = boardOf(tree);
  if (!board && !linkedRepo(tree)) {
    process.stdout.write(
      `${out.dim(t('дерево не привязано к GitHub — treeyard github link <owner>/<номер>|<owner>/<репозиторий>'))}\n`,
    );
    return 0;
  }
  if (board) {
    process.stdout.write(t('доска {board}\n', { board: `${board.owner}/${board.number}` }));
    printBoard(board, tree);
  }
  if (linkedRepo(tree)) printRepo(tree);
  return 0;
}

function printRepo(tree: Tree): void {
  const repo = linkedRepo(tree)!;
  const parent = tree.nodes.get(String((tree.project.extra.github as { parent?: unknown }).parent))?.title;
  process.stdout.write(
    t('issues {repo} → узлы в «{parent}»: открытые — идеи, закрытая issue закрывает узел, «готово» закрывает issue\n', {
      repo: `${repo.owner}/${repo.name}`,
      parent: parent ?? t('корень'),
    }),
  );
}

function printBoard(board: Board, tree: Tree): void {
  for (const status of STATUSES)
    process.stdout.write(
      `  ${STATUS_LABEL[status].padEnd(12)} → ${board.columns[status] ?? out.dim(t('не двигать'))}\n`,
    );
  const parent = board.parent ? tree.nodes.get(board.parent)?.title : undefined;
  process.stdout.write(
    `${out.dim(t('новые карточки — в «{parent}» · колонки правятся в .tree/tree.md, github.columns', { parent: parent ?? t('корень') }))}\n`,
  );
}

/**
 * A journal entry; with `--status` and `--commit` also the status and the commits — closing a
 * node is one command, not a chain of diff, log and set. The commits are resolved before
 * anything is written; done from an agent becomes review, as with `set`.
 */
async function logCommand(args: string[]): Promise<number> {
  const { values, positionals } = parse(spreadRefs(args, '--commit'), {
    as: { type: 'string' },
    project: { type: 'string' },
    status: { type: 'string', short: 's' },
    commit: { type: 'string', multiple: true },
    waiting: { type: 'string' },
    until: { type: 'string' },
    fix: { type: 'boolean' },
  });
  const dir = projectDir(values.project);
  let tree = project(values.project);
  const id = nodeArg(tree, positionals[0]);
  const text = positionals.slice(1).join(' ').trim();
  if (!text) throw new UsageError(t('treeyard log <id> "что сделано; что осталось"'));
  if (values.fix) return fixEntry(tree, id, text, values);
  const status = values.status !== undefined ? statusArg(values.status) : undefined;
  if ((values.waiting !== undefined || values.until !== undefined) && status !== 'waiting')
    throw new UsageError(t('--waiting и --until — вместе с --status waiting'));
  const refs = (values.commit ?? []).flatMap((ref) => ref.split(',')).filter((ref) => ref.trim());
  let commits: string[] = [];
  if (refs.length) {
    const repo = await gitRepository(dir);
    commits = (await Promise.all(refs.map((ref) => repo.commit(ref.trim())))).map((commit) => commit.sha);
    // Git reads are asynchronous; keep any journal entries written in the meantime.
    tree = loadTree(dir);
  }
  const source = sourceOf(values.as);
  for (const sha of commits) attachCommit(tree, id, sha, source);
  logToNode(tree, id, text, source);
  const said = [id, t('записано')];
  if (commits.length) said.push(t('привязано коммитов: {n}', { n: commits.length }));
  if (status) {
    const before = tree.nodes.get(id)!.status;
    const next = closingStatus(tree, id, status, values.as);
    setStatus(tree, id, next.status, {
      ...(values.waiting !== undefined ? { waiting: values.waiting } : {}),
      ...(values.until !== undefined ? { until: values.until } : {}),
      source,
    });
    said.push(
      before === next.status ? STATUS_LABEL[next.status] : `${STATUS_LABEL[before]} → ${STATUS_LABEL[next.status]}`,
    );
    if (next.demoted) said.push(demotedNote(values.as));
  }
  process.stdout.write(`${said.join(' · ')}\n`);
  return 0;
}

/** `log <id> --fix "…"`: a new text for the last entry this author wrote by hand; its time stays. */
function fixEntry(
  tree: Tree,
  id: string,
  text: string,
  values: { as?: string; status?: string; commit?: string[]; waiting?: string; until?: string },
): number {
  if (
    values.status !== undefined ||
    values.commit?.length ||
    values.waiting !== undefined ||
    values.until !== undefined
  )
    throw new UsageError(t('--fix исправляет только текст записи — без --status и --commit'));
  const source = sourceOf(values.as);
  const node = tree.nodes.get(id)!;
  const found = lastOwnEntry(node.body, source);
  if (!found) throw new UsageError(t('у узла {id} нет записей «{source}», которые можно исправить', { id, source }));
  const { when } = found.entry;
  updateNode(tree, id, { body: replaceEntry(node.body, found.index, `${when} · ${source} · ${text}`) });
  process.stdout.write(`${id} · ${t('запись от {when} исправлена', { when })}\n`);
  return 0;
}

/**
 * `--commit a b c` → `--commit a --commit b --commit c`: refs follow the flag until the next
 * option or a word that cannot be a ref (a journal text has spaces).
 */
function spreadRefs(args: string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    out.push(arg);
    if (arg === '--') {
      out.push(...args.slice(i + 1));
      break;
    }
    if (arg !== flag) continue;
    if (i + 1 < args.length) out.push(args[++i]!);
    while (i + 1 < args.length && /^[\w./~^@{}:,-]+$/.test(args[i + 1]!) && !args[i + 1]!.startsWith('-'))
      out.push(flag, args[++i]!);
  }
  return out;
}

/**
 * Done from an agent becomes review: the person sets done. A shared node (made from another
 * project) is closed by the agent that did the work — nobody comes to that tree to close it;
 * a node of this same tree waiting for it does not make it shared.
 */
function closingStatus(
  tree: Tree,
  id: string,
  wanted: Status,
  as: string | undefined,
): { status: Status; demoted: boolean } {
  const shared = Boolean(tree.nodes.get(id)?.neededBy?.some((ref) => !isSameTree(tree.project.dir, ref)));
  const demoted = wanted === 'done' && !shared && !byPerson(as);
  return { status: demoted ? 'review' : wanted, demoted };
}

/** Said on stdout too: a warning on stderr gets lost behind `2>/dev/null`. A typo in `--as` shows here. */
function demotedNote(as: string | undefined): string {
  const given = as?.trim();
  return given
    ? t('не готово: «{as}» — не человек, готово ставит человек', { as: given })
    : t('не готово: готово ставит человек');
}

/** A node's explicit commit links and the project's separate working changes. */
async function diffCommand(args: string[]): Promise<number> {
  const { values, positionals } = parse(spreadRefs(args, '--add'), {
    add: { type: 'string', multiple: true },
    rm: { type: 'string' },
    commit: { type: 'string' },
    file: { type: 'string' },
    working: { type: 'boolean' },
    stat: { type: 'boolean' },
    json: { type: 'boolean' },
    project: { type: 'string' },
    as: { type: 'string' },
  });
  const dir = projectDir(values.project);
  let tree = loadTree(dir);
  const id = nodeArg(tree, positionals[0]);
  if (!tree.nodes.has(id)) throw new UsageError(t('выбери узел, чтобы посмотреть его дифы'));
  if (positionals.length > 1 || (values.add && values.rm) || (values.working && values.commit))
    throw new UsageError(t('treeyard diff <id>: выбери просмотр, --add или --rm'));
  if ((values.add || values.rm) && (values.working || values.commit || values.file || values.stat))
    throw new UsageError(t('treeyard diff <id>: выбери просмотр, --add или --rm'));
  const source = sourceOf(values.as);
  if (values.rm) {
    if (!/^[a-f0-9]{4,64}$/i.test(values.rm))
      throw new UsageError(t('укажи SHA коммита (от 4 шестнадцатеричных символов)'));
    const matches = (tree.nodes.get(id)!.commits ?? []).filter((sha) => sha.startsWith(values.rm!.toLowerCase()));
    if (matches.length !== 1)
      throw new UsageError(t('у узла нет единственного коммита с SHA {sha}', { sha: values.rm }));
    detachCommit(tree, id, matches[0]!, source);
    process.stdout.write(
      values.json
        ? `${JSON.stringify({ id, commits: tree.nodes.get(id)!.commits ?? [] })}\n`
        : `${id} · ${t('убрана привязка коммита {sha}', { sha: matches[0] })}\n`,
    );
    return 0;
  }
  const repo = await gitRepository(dir);
  if (values.add) {
    const refs = values.add.flatMap((ref) => ref.split(',')).filter((ref) => ref.trim());
    const commits = await Promise.all(refs.map((sha) => repo.commit(sha.trim())));
    // Git reads are asynchronous; keep any journal entries written in the meantime.
    tree = loadTree(dir);
    for (const commit of commits) attachCommit(tree, id, commit.sha, source);
    process.stdout.write(
      values.json
        ? `${JSON.stringify({ id, commits: tree.nodes.get(id)!.commits ?? [] })}\n`
        : `${id} · ${t('привязано коммитов: {n}', { n: commits.length })}\n`,
    );
    return 0;
  }
  const node = tree.nodes.get(id)!;
  let refs = node.commits ?? [];
  if (values.commit) {
    const commit = await repo.commit(values.commit);
    if (!refs.includes(commit.sha))
      throw new UsageError(t('коммит {sha} не привязан к узлу {id}', { sha: commit.sha, id }));
    refs = [commit.sha];
  }
  type Section = {
    title: string;
    sha?: string;
    kind?: string;
    files: (GitFile & { patch?: string })[];
    error?: string;
  };
  const sections: Section[] = [];
  const sources: { title: string; source: DiffSource; files: GitFile[] }[] = [];
  if (values.working) {
    const working = await repo.working();
    const labels = { staged: t('В индексе'), unstaged: t('В рабочей папке'), untracked: t('Новые файлы') };
    for (const kind of ['staged', 'unstaged', 'untracked'] as const)
      sources.push({ title: labels[kind], source: { kind }, files: working[kind] });
  } else {
    for (const ref of refs) {
      try {
        const commit = await repo.commit(ref);
        const source: DiffSource = { kind: 'commit', commit };
        sources.push({
          title: `${commit.sha.slice(0, 8)} · ${diffText(commit.subject)}`,
          source,
          files: await repo.files(source),
        });
      } catch (error) {
        sections.push({ title: ref, sha: ref, files: [], error: (error as Error).message });
      }
    }
  }
  let matched = false;
  for (const { title, source, files } of sources) {
    const chosen = values.file
      ? files.filter((file) => file.path === values.file || file.oldPath === values.file)
      : files;
    if (chosen.length) matched = true;
    if (values.file && !chosen.length) continue;
    const patches: (GitFile & { patch?: string })[] = [];
    for (const file of chosen)
      patches.push({ ...file, ...(!values.stat ? { patch: await repo.patch(source, file) } : {}) });
    sections.push({
      title,
      ...(source.kind === 'commit' ? { sha: source.commit.sha } : { kind: source.kind }),
      files: patches,
    });
  }
  if (values.file && !matched) throw new UsageError(t('среди этих изменений нет файла {file}', { file: values.file }));
  const title = values.working ? t('Текущие изменения проекта') : t('Дифы · {title}', { title: node.title });
  if (values.json) process.stdout.write(`${JSON.stringify({ id, root: repo.dir, title, sections }, null, 2)}\n`);
  else {
    process.stdout.write(`${out.bold(title)}\n`);
    if (!sections.length)
      process.stdout.write(`${t('к узлу пока не привязаны коммиты · treeyard diff <id> --add <sha>')}\n`);
    for (const section of sections) {
      process.stdout.write(`\n${out.bold(section.title)}\n`);
      if (section.error) process.stdout.write(`${section.error}\n`);
      else if (!section.files.length) process.stdout.write(`${t('изменений нет')}\n`);
      for (const file of section.files) {
        const stats =
          file.added !== null && file.removed !== null && !file.binary
            ? `${out.c('#5fd38d', `+${file.added}`)} ${out.c('#ff7b72', `−${file.removed}`)}`
            : fileStats(file);
        process.stdout.write(`  ${file.status} ${fileLabel(file)}  ${stats}\n`);
        if (file.patch) {
          const patch = parsePatch(file.patch)
            .map((line) =>
              line.kind === 'add' || line.kind === 'remove'
                ? out.c(
                    line.kind === 'add' ? '#5fd38d' : '#ff7b72',
                    line.raw[0]! + line.parts.map((part) => (part.changed ? out.bold(part.text) : part.text)).join(''),
                  )
                : line.kind === 'hunk'
                  ? out.c('#62d0e0', line.raw)
                  : line.kind === 'header' || line.kind === 'meta' || line.kind === 'no-newline'
                    ? out.dim(line.raw)
                    : line.raw,
            )
            .join('\n');
          process.stdout.write(`${patch}\n`);
        }
      }
    }
  }
  return sections.some((section) => section.error) ? 1 : 0;
}

/** Pictures of a node: list, attach (files or the clipboard), caption, remove. */
function imageCommand(args: string[]): number {
  const { values, positionals } = parse(args, {
    note: { type: 'string', multiple: true },
    paste: { type: 'boolean' },
    rm: { type: 'string' },
    as: { type: 'string' },
  });
  const tree = project();
  const id = nodeArg(tree, positionals[0]);
  const { dir } = tree.project;
  const source = sourceOf(values.as);
  const files = positionals.slice(1);
  const notes = values.note ?? [];
  const known = new Set(listImages(dir, id).map((image) => image.file));
  if (values.rm) {
    if (!known.has(values.rm)) throw new UsageError(t('у узла {id} нет картинки {file}', { id, file: values.rm }));
    removeImage(dir, id, values.rm);
    logToNode(tree, id, t('картинка удалена: {file}', { file: values.rm }), source);
    process.stdout.write(t('{id} · удалена {file}\n', { id, file: values.rm }));
    return 0;
  }
  if (files.length === 1 && known.has(files[0]!) && notes.length) {
    if (notes.length > 1) throw new UsageError(t('у одной картинки одна подпись'));
    const image = setImageNote(dir, id, files[0]!, notes[0]!);
    if (image.note) logToNode(tree, id, t('подпись к {file}: {note}', { file: image.file, note: image.note }), source);
    process.stdout.write(t('{id} · подпись к {file} сохранена\n', { id, file: image.file }));
    return 0;
  }
  // A caption for each file in order, or one for all of them; checked before the first is added.
  const count = files.length + (values.paste ? 1 : 0);
  if (notes.length > 1 && notes.length !== count)
    throw new UsageError(
      t('подписей {notes}, картинок {files}: по --note на каждую или одна на все', {
        notes: notes.length,
        files: count,
      }),
    );
  const missing = files.find((file) => !existsSync(resolve(file)));
  if (missing) throw new UsageError(t('нет файла {file}', { file: missing }));
  const sources: (Buffer | string)[] = [...files];
  const found = values.paste ? clipboardImage() : undefined;
  if (values.paste && !found) throw new UsageError(t('в буфере нет картинки'));
  if (found) sources.push(found.kind === 'png' ? found.data : found.path);
  try {
    for (const [i, item] of sources.entries()) {
      const image = addImage(dir, id, item, notes.length > 1 ? notes[i] : notes[0]);
      logToNode(
        tree,
        id,
        t('картинка добавлена: {file}', { file: image.file }) + (image.note ? ` — ${image.note}` : ''),
        source,
      );
    }
  } finally {
    if (found) forgetClipboard(found);
  }
  const images = listImages(dir, id);
  if (images.length === 0) {
    process.stdout.write(t('{id} · картинок нет — treeyard image {id} <файл> или --paste\n', { id }));
    return 0;
  }
  for (const image of images) {
    process.stdout.write(`${imagePath(dir, id, image.file)}${image.note ? ` — ${image.note}` : ''}\n`);
  }
  return 0;
}

/**
 * `treeyard rm <id>…`: deletes a node added by mistake — no children, no journal beyond «завёл
 * узел», no sessions, commits, pictures or links. A node with a history is dropped, not
 * deleted: then nothing is deleted, and the command says why.
 */
function rmCommand(args: string[]): number {
  const { positionals } = parse(args, {});
  const tree = project();
  const ids = [...new Set((positionals.length ? positionals : [undefined]).map((arg) => nodeArg(tree, arg)))];
  if (ids.includes(ROOT)) throw new UsageError(t('корень не удаляется'));
  const reasons: string[] = [];
  for (const id of ids) {
    const node = tree.nodes.get(id)!;
    const why = keepReasons(tree, node);
    if (why.length) reasons.push(`${id} «${node.title}»: ${why.join(', ')}`);
  }
  if (reasons.length)
    throw new UsageError(
      `${t('не удаляю — у узла есть история; закрой его: treeyard set {ids} status=dropped', { ids: ids.join(' ') })}\n  ${reasons.join('\n  ')}`,
    );
  for (const id of ids) {
    const { title } = tree.nodes.get(id)!;
    deleteNode(tree, id);
    process.stdout.write(`${id} · ${t('удалён')} · ${title}\n`);
  }
  return 0;
}

/** What makes a node part of the record: anything beyond its title, criterion and description. */
function keepReasons(tree: Tree, node: TreeNode): string[] {
  const why: string[] = [];
  const kids = childrenOf(tree, node.id).length;
  if (kids) why.push(t('внутри узлов: {n}', { n: kids }));
  const written = journalEntries(node.body).filter((line) => !isCreationLine(parseEntry(line).text)).length;
  if (written) why.push(t('записей в журнале: {n}', { n: written }));
  if (node.sessions.length) why.push(t('сессий: {n}', { n: node.sessions.length }));
  if (node.commits?.length) why.push(t('коммитов: {n}', { n: node.commits.length }));
  if (node.needs?.length || node.neededBy?.length) why.push(t('связи с другими узлами'));
  const pictures = listImages(tree.project.dir, node.id).length;
  if (pictures) why.push(t('картинок: {n}', { n: pictures }));
  return why;
}

/**
 * `treeyard decide "…"`: a line in «Решения» of `.tree/tree.md`, dated; without text, the list.
 * `--json` gives the list as `{"decisions": [{"text", "date"}]}`, after a write too.
 */
function decideCommand(args: string[]): number {
  const { values, positionals } = parse(args, { json: { type: 'boolean' }, project: { type: 'string' } });
  const tree = project(values.project);
  const text = positionals.join(' ').replace(/\s+/g, ' ').trim();
  const line = !text || /\b\d{4}-\d\d-\d\d\b/.test(text) ? text : `${text} (${today()})`;
  if (line) {
    tree.project.body = addDecisions(tree.project.body, [line]);
    writeProject(tree.project);
  }
  if (values.json) {
    const decisions = decisionList(loadTree(tree.project.dir).project.body);
    process.stdout.write(`${JSON.stringify({ decisions }, null, 2)}\n`);
  } else if (line) process.stdout.write(`${t('в «Решения» .tree/tree.md: {line}', { line })}\n`);
  else {
    const lines = decisionsOf(tree.project.body);
    process.stdout.write(
      lines.length ? `${lines.join('\n')}\n` : `${t('решений пока нет — treeyard decide "что решили и почему"')}\n`,
    );
  }
  return 0;
}

/**
 * `treeyard goal ["…"]`: the goal of the tree (`goal:` in the header of `.tree/tree.md`);
 * with text, a new one — only that line of the file changes.
 */
function goalCommand(args: string[]): number {
  const { values, positionals } = parse(args, { json: { type: 'boolean' }, project: { type: 'string' } });
  const dir = projectDir(values.project);
  if (positionals.length) {
    const goal = cleanGoal(positionals.join(' '));
    if (!goal) throw new UsageError(t('цель пустая — treeyard goal "чего проект добивается в жизни"'));
    rootEdit(() => writeGoal(dir, goal));
  }
  const goal = loadTree(dir).project.goal;
  if (values.json) process.stdout.write(`${JSON.stringify({ goal: goal ?? null }, null, 2)}\n`);
  else if (positionals.length) process.stdout.write(`${t('цель в .tree/tree.md: {goal}', { goal: goal ?? '' })}\n`);
  else process.stdout.write(`${goal ?? t('цели пока нет — treeyard goal "чего проект добивается в жизни"')}\n`);
  return 0;
}

/**
 * `treeyard rules [--from <file|->]`: the rules of the tree — the body of `.tree/tree.md`
 * without «Решения» (those are `decide`'s); with `--from`, new ones — the header and «Решения» stay.
 */
async function rulesCommand(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {
    json: { type: 'boolean' },
    from: { type: 'string' },
    project: { type: 'string' },
  });
  if (positionals.length) throw new UsageError(t('правила — из файла или stdin: treeyard rules --from <файл|->'));
  const dir = projectDir(values.project);
  if (values.from !== undefined) {
    const rules = (await textFrom(values.from)).trim();
    if (!rules) throw new UsageError(t('правила пустые — нечего записать'));
    if (hasDecisions(rules))
      throw new UsageError(t('«Решения» в правила не входят — убери раздел; решения дописывает treeyard decide'));
    rootEdit(() => writeRules(dir, rules));
  }
  const rules = rulesOf(loadTree(dir).project.body);
  if (values.json) process.stdout.write(`${JSON.stringify({ rules }, null, 2)}\n`);
  else if (values.from !== undefined)
    process.stdout.write(`${t('правила в .tree/tree.md: {lines}', { lines: linesLabel(lineCount(rules)) })}\n`);
  else process.stdout.write(`${rules || t('правил пока нет — treeyard rules --from <файл|->')}\n`);
  return 0;
}

/**
 * A file, or stdin for `-`, read as a stream: `readFileSync(0)` throws EAGAIN on a pipe whose
 * writer has not written yet, and a program hands its text over exactly that way.
 */
async function textFrom(from: string): Promise<string> {
  if (from !== '-') return readFileSync(resolve(from), 'utf8');
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8');
}

/** A point edit of tree.md; a header it cannot edit in place (broken YAML) is the user's to fix. */
function rootEdit(edit: () => unknown): void {
  try {
    edit();
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
}

/**
 * `treeyard commit [<id>…]`: the files of these nodes, the overview and tree.md — not the code,
 * not other nodes, not what others staged. Without ids, the node of this session.
 */
function commitCommand(args: string[]): number {
  const { values, positionals } = parse(args, { message: { type: 'string', short: 'm' } });
  const tree = project();
  const own = process.env[NODE_VAR]?.trim();
  const given = positionals.length ? positionals : own && tree.nodes.has(own) ? [own] : [];
  if (!given.length) throw new UsageError(t('укажи узлы, чьи файлы коммитить: treeyard commit <id>…'));
  // A node deleted with `rm` is gone from the tree, but its file's deletion is still to commit.
  const gone = (arg: string) => /^[2-9a-z]{4,6}$/.test(arg) && !existsSync(nodePath(tree.project.dir, arg));
  const ids = [...new Set(given.map((arg) => (!tree.nodes.has(arg) && gone(arg) ? arg : nodeArg(tree, arg))))];
  if (ids.includes(ROOT)) throw new UsageError(t('корень — это .tree/tree.md, он входит в коммит сам: укажи узлы'));
  let files: string[];
  try {
    files = treeChanges(tree, ids);
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  if (!files.length) {
    process.stdout.write(`${t('в дереве нечего коммитить: {ids}', { ids: ids.join(' ') })}\n`);
    return 0;
  }
  const message = values.message?.trim() || treeMessage(tree, ids);
  const done = commitTree(tree, files, message);
  process.stdout.write(`${done.sha.slice(0, 7)} ${done.message}\n`);
  for (const file of done.files) process.stdout.write(`  ${file}\n`);
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

/** The coordinator's assignment: the text itself, or stdin for `-` (long text with quotes). */
export async function taskArg(
  value: string | undefined,
  stdin: () => Promise<string> = () => textFrom('-'),
): Promise<string | undefined> {
  if (value === undefined) return undefined;
  const text = (value === '-' ? await stdin() : value).trim();
  if (!text) throw new UsageError(t('--task без текста'));
  return text;
}

/** The post-commit hook: installed by a person, run by git (`post-commit`) after each commit. */
function hookCommand(args: string[]): number {
  const [action, ...extra] = args;
  if (action === 'post-commit') {
    // Called by git; whatever goes wrong, the commit stays untouched.
    try {
      bindHeadCommit(process.env, process.cwd());
    } catch {
      // Silent by design.
    }
    return 0;
  }
  if (!['install', 'remove', 'status'].includes(action ?? '') || extra.length)
    throw new UsageError(t('treeyard hook install | remove | status'));
  const cwd = process.cwd();
  const where = (file: string) => homeShort(file);
  if (action === 'status') {
    const { installed, file, tracked } = hookStatus(cwd);
    process.stdout.write(
      installed
        ? `${t('хук стоит: {file}', { file: where(file) })}\n`
        : `${t('хука нет — treeyard hook install (файл: {file})', { file: where(file) })}\n`,
    );
    if (tracked && !installed)
      process.stdout.write(`${t('хуки лежат внутри репозитория — добавь строку сам:')}\n${HOOK_LINE}\n`);
    return 0;
  }
  const result = action === 'install' ? installHook(cwd) : removeHook(cwd);
  const file = where(result.file);
  if (result.kind === 'manual') {
    process.stdout.write(
      action === 'install'
        ? `${t('core.hooksPath ведёт внутрь репозитория ({file}) — файлы там лежат в git, туда не пишу. Добавь в post-commit строку сам:', { file })}\n${HOOK_LINE}\n`
        : `${t('хуки лежат внутри репозитория ({file}) — убери строку treeyard hook post-commit из post-commit сам', { file })}\n`,
    );
  } else {
    const text = {
      installed: t('хук поставлен: {file}', { file }),
      already: t('хук уже стоит: {file}', { file }),
      removed: t('хук убран: {file}', { file }),
      absent: t('хука нет: {file}', { file }),
    }[result.kind];
    process.stdout.write(`${text}\n`);
  }
  return 0;
}

async function contextCommand(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {
    start: { type: 'string' },
    brain: { type: 'string' },
    task: { type: 'string' },
  });
  const tree = project();
  const id = nodeArg(tree, positionals[0]);
  const brain = brainArg(values.brain, tree.project.brain ?? 'claude');
  const task = await taskArg(values.task);
  const plan = sessionPlan(tree, id, startArg(values.start, tree.project.start ?? 'plan'), brain, task);
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
    task: { type: 'string' },
    yes: { type: 'boolean', short: 'y' },
    json: { type: 'boolean' },
  });
  const tree = project();
  const id = nodeArg(tree, positionals[0]);
  const brain = brainArg(values.brain, tree.project.brain ?? 'claude');
  if (values.pane && values.bg) throw new UsageError(t('выбери одно: --pane или --bg'));
  // In this terminal the CLI owns stdout; only a pane returns at once with something to print.
  if (values.json && !values.pane)
    throw new UsageError(t('--json — только с --pane: treeyard open <id> --pane --json'));
  const task = await taskArg(values.task);
  const options = {
    brain,
    start: startArg(values.start, tree.project.start ?? 'plan'),
    ...(values.bg ? { background: true } : {}),
    ...(values.pane ? { pane: true } : {}),
    ...(values.model ? { model: values.model } : {}),
    ...(values.effort ? { effort: values.effort } : {}),
    ...(values.worktree ? { worktree: true } : {}),
    ...(task ? { task } : {}),
  };
  if (settings().confirm && !values.yes && process.stdin.isTTY) {
    const node = holderOf(tree, id)!;
    const plan = sessionPlan(tree, id, options.start, brain, task);
    process.stderr.write(
      `\n${inlineMark(err.c)}\n` +
        `  ${err.dim(t('Узел'))}        ${node.title}\n` +
        `  ${err.dim(t('Кто'))}         ${BRAIN_LABEL[brain]} · ${options.background ? t('в фоне, сам по себе') : options.pane ? t('в панели') : t('в этом терминале')}\n` +
        `  ${err.dim(t('Как начать'))}  ${(id === ROOT ? ROOT_START_LABEL : START_LABEL)[plan.start]} — ${(id === ROOT ? ROOT_START_HINT : START_HINT)[plan.start]}\n\n`,
    );
    if (!(await askYes(t('Запустить сессию?')))) {
      process.stderr.write(`${err.dim(t('не запускаю'))}\n`);
      return 0;
    }
  }
  if (options.pane) {
    const { pane, ref, warnings } = await launchInPane(tree, id, options, {
      width: process.stdout.columns || 100,
      height: Math.max(5, (process.stdout.rows || 30) - 6),
    });
    if (values.json) {
      // Codex, Antigravity and OpenCode name the session once it has started: `id` is null until
      // then, and `treeyard sessions --json` finds it by this pane.
      const started = { node: id, brain, id: isPending(ref) ? null : ref.id, pane, startedAt: ref.started, warnings };
      process.stdout.write(`${JSON.stringify(started, null, 2)}\n`);
      return 0;
    }
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
  const panes = await sessionPanes(tree.project.dir);
  // A pane the tree started belongs to its node before the node learns the session's id.
  for (const [session, pane] of panes) {
    const node = owners.get(`pane:${pane}`);
    if (node && !owners.has(session)) owners.set(session, node);
  }
  if (values.json) {
    process.stdout.write(
      `${JSON.stringify(
        list.map((s) => ({ ...s, node: owners.get(s.id), offTree: offTree(s, owners), pane: panes.get(s.id) ?? null })),
        null,
        2,
      )}\n`,
    );
    return 0;
  }
  for (const session of list) {
    const owner = owners.get(session.id);
    const pane = panes.get(session.id);
    const live =
      (session.live ? out.c('#c6a0ff', ` ● ${session.live.status}`) : '') +
      (pane ? out.c('#c6a0ff', ` ▣ ${pane}`) : '');
    const where = owner
      ? out.dim(`  → ${owner === ROOT ? `◆ ${tree.project.title}` : tree.nodes.get(owner)?.title}`)
      : offTree(session, owners)
        ? out.c('#ffcf70', `  ${t('без узла')}`)
        : '';
    process.stdout.write(
      `${session.brain.padEnd(11)} ${out.dim(session.id.slice(0, 8))}  ${(ago(session.updatedAt ?? session.startedAt) || '').padEnd(10)} ${session.title ?? out.dim(t('без названия'))}${live}${where}\n`,
    );
  }
  if (list.length === 0) process.stdout.write(`${out.dim(t('сессий в этой папке ещё не было'))}\n`);
  else process.stdout.write(`\n${offTreeLine(offTreeTally(list, owners))}\n`);
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
  'staleAfter',
  'notes',
] as const;
/** Keys in settings.json and on the command line, where they differ from the code. */
const SNAKE: Record<string, string> = {
  sleepAfter: 'sleep_after',
  maxPanes: 'max_panes',
  staleAfter: 'stale_after',
  statusOrder: 'status_order',
};
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
    } else if (key === 'sleepAfter' || key === 'maxPanes') {
      const choices: readonly number[] = key === 'sleepAfter' ? SLEEP_AFTER : MAX_PANES;
      const n = /^(off|none)$/i.test(value) ? 0 : Number(value);
      if (!choices.includes(n))
        throw new UsageError(t('{key}: выбери {choices}', { key: requestedKey, choices: choices.join('/') }));
      updateSettings({ [key]: n });
    } else if (key === 'staleAfter') {
      const n = /^(off|none)$/i.test(value) ? 0 : Number(value);
      if (!Number.isInteger(n) || n < 0)
        throw new UsageError(t('{key}: часы целым числом, 0 — выключено', { key: requestedKey }));
      updateSettings({ staleAfter: n });
    } else if (key === 'notes') {
      try {
        updateSettings({ notes: notesFolder(value) });
      } catch (error) {
        throw new UsageError((error as Error).message);
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

/**
 * The CLI: runs the command and sets the exit code, never throws. Called by `main.ts` only, so
 * importing this module (a test does) runs nothing.
 */
export function run(argv: string[]): void {
  main(argv).then(
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
}

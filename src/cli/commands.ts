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
import { basename, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';

import { parseArgs } from 'node:util';

import type { Catalog, UsageReport } from '@antondanv/brainyard';

import {
  ACCESS_HINT,
  ACCESS_LABEL,
  type AccessChoice,
  accessChoices,
  accessPatch,
  accessQuestion,
  accessText,
  fullAccess,
  needsAccessChoice,
} from '../agents/access.js';
import {
  agyMailHookPlaces,
  deliverAgyMidTurn,
  installAgyMailHook,
  parseAgyHookInput,
  removeAgyMailHook,
} from '../agents/agy-hook.js';
import {
  codexMailHookPlaces,
  deliverCodexMidTurn,
  installCodexMailHook,
  removeCodexMailHook,
} from '../agents/codex-hook.js';
import {
  contextText,
  ROOT_START_HINT,
  ROOT_START_LABEL,
  START_HINT,
  START_LABEL,
  sessionPlan,
} from '../agents/context.js';
import { type Attempt, deliverAll, ensureDeliverer, runDeliverer } from '../agents/deliver.js';
import { countNodes, type Proposal, parseProposal, plant, proposeTree } from '../agents/importer.js';
import {
  BRAIN_LABEL,
  defaultBrain,
  type LaunchOptions,
  launch,
  projectSessions,
  sessionOwners,
} from '../agents/launch.js';
import {
  deliverOpencodeMidTurn,
  installOpencodeMailPlugin,
  opencodeMailHookPlaces,
  parseOpencodeHookInput,
  removeOpencodeMailPlugin,
} from '../agents/opencode-plugin.js';
import {
  isPending,
  launchInPane,
  peekJson,
  peekNodePane,
  peekText,
  readPanes,
  sessionPanes,
  sleepNodePanes,
} from '../agents/panes.js';
import { DEFAULT_MAIL_LIMIT } from '../agents/pingpong.js';
import { LIMIT, type QueueEvent, queueNodes, queueSources, runQueue } from '../agents/queue.js';
import {
  answerQuestion,
  NotAnswered,
  type PermissionDecision,
  permissionSummary,
  resolvePermission,
  waitReply,
} from '../agents/reply.js';
import { NotSent, PingPongStop, sendToNode } from '../agents/send.js';
import { autoInstallSkills, skillHomes } from '../agents/skills.js';
import {
  deliverMidTurn,
  installMailHook,
  mailHookPlaces,
  parseHookInput,
  removeMailHook,
} from '../agents/turn-hook.js';
import { parseDuration, waitFor } from '../agents/wait.js';
import { bindHeadCommit, HOOK_LINE, hookStatus, installHook, moveText, noteMove, removeHook } from '../commit-hook.js';
import { CrashReported, guardCrashes } from '../crash.js';
import { parsePatch } from '../diff.js';
import { lineCount, linesLabel, projectDocs } from '../docs.js';
import { type DiffSource, diffText, fileLabel, fileStats, type GitFile, refRepository } from '../git.js';
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
import { description, journalEntries, replaceEntry } from '../model/journal.js';
import { addLinkedNode, isSameTree, normalizeRef, setNeeds } from '../model/links.js';
import { DELIVERY_TEXT, letterState, senderNode } from '../model/mail.js';
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
  writeDecisions,
  writeGoal,
  writeRules,
} from '../model/root-doc.js';
import { staleOf } from '../model/stale.js';
import { parseStatus, parseStatuses, UnknownStatus } from '../model/status-words.js';
import { findProject, loadTree, nodePath, writeProject } from '../model/store.js';
import { ago, clockOf, nowIso, today } from '../model/time.js';
import { isLongTitle } from '../model/titles.js';
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
  BRAIN_IDS,
  type BrainId,
  ROOT,
  type SessionRef,
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
import { MAX_PANES, orderOf, SLEEP_AFTER, settings, settingsPath, skillsAuto, updateSettings } from '../settings.js';
import { locate, projectStatus } from '../status.js';
import { createTree, getTemplate, listTemplates } from '../templates/templates.js';
import { commitTree, treeChanges, treeMessage } from '../tree-commit.js';
import { inlineMark, WORDMARK } from '../tui/logo.js';
import type { Leftover } from '../uninstall.js';
import { WATCH_VERSION, watchTree } from '../watch.js';
import {
  blockers,
  closedWorktrees,
  ensureWorktree,
  insideFolder,
  isWorktreeCleanMerged,
  type NodeWorktree,
  nodeCommits,
  prepareAgain,
  removeWorktree,
  shortPath,
  stateText,
  togetherWorktrees,
  treeOfWorktree,
  WorktreeBusy,
  type WorktreeWish,
  worktreeFor,
  worktreeState,
  worktreesOf,
} from '../worktree.js';
import { fetchCatalogs, fetchLimits, limitsText, modelsText, settleExpired } from './models-text.js';
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
  worktreeJson,
} from './print.js';
import { skillLines, skillsAutoLine, statusText } from './status-text.js';
import { overlapLines, sightBlock, waitJson, waitText } from './wait-text.js';

const require = createRequire(import.meta.url);
const VERSION = (require('../../package.json') as { version: string }).version;
const out = paint(process.stdout);
const err = paint(process.stderr);

class UsageError extends Error {}

/** The command lines of the help, an entry (one line or a few) per command, in the current language. */
function commandLines(): string {
  return pick({
    ru: `  treeyard init [--template <id>]          посадить дерево: с агентом или по шаблону (мастер)
  treeyard init --agent [--brain <cli>]    агент изучит папку, задаст вопросы и посадит дерево
  treeyard import [--brain <cli>]          агент молча читает план проекта и строит дерево
  treeyard import --from-json <файл|->     посадить дерево из JSON (так сажает агент)
  treeyard status [--json] [--project <папка>]   сводка: версии, папка и дерево, узлы по статусам и брошенные,
                                           скиллы, как Codex проходит песочницу к treeyard и git, указатель, git-хук,
                                           живые сессии и панели, GitHub; у каждой проблемы — команда, которая её исправит
                                           (Codex без доступа — ещё и строки для ~/.codex/config.toml)
  treeyard pointer                         дописать блок о дереве в AGENTS.md / CLAUDE.md
  treeyard skills [install]                скиллы treeyard, treeyard-init и treeyard-coordinate: где стоят, поставить
                                           в Claude Code, Codex, Antigravity (папки в проекте — обновить)
  treeyard templates                       шаблоны: этапы, направления, микадо…
  treeyard show [id…] [--json] [--open]    дерево или узлы текстом (--open — без готового; вне терминала готовое
                                           свёрнуто в «✓ готово: N», --all — всё; открытое под готовым видно,
                                           родитель — свёрнутой строкой)
                [--brief] [--journal N|all]  --brief — шапка, критерий и 3 последние записи; --journal — сколько записей
                [--only журнал,сессии…]    только эти части: header, criterion, commits, children, sessions, note,
                                           journal, history (смены статуса), mail (письма treeyard send); можно по-русски
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
                [--done-when "…"] [--check "команда"] [--note "…"] [--project <папка>]
                                           --after — сразу после брата (любого статуса, как set after=; без --parent —
                                           под его родителем); --project — дерево другой папки, например основного worktree;
                                           название — суть в 2–6 словах; подробности — в --note и --done-when
  treeyard add "<название>" --project ../X --for <id>   узел в дереве проекта X, нужный узлу id отсюда
  treeyard add [--parent <id>] [--project <папка>] --from-json <файл|->   несколько узлов разом: [{"title", "parent",
                                           "done_when", "note", "who", "status", "needs", "key", "children"}];
                                           печатает их id; ошибка — не заводится ни один
  treeyard set <id> [<id>…] ключ=значение…  status, title, who, done_when, check, note (описание), waiting, until, parent,
                                           after=<id брата>|first|last (место среди братьев),
                                           needs=<id>|../X#id (ждёт узла этого дерева или другого проекта); --project <папка> — узел там
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
  treeyard hook claude install|remove|status [--user]   хуки Claude Code для писем сессиям узлов
                                           UserPromptSubmit — вместе с запросом, PostToolUse — посреди хода
                                           настройки: .claude/settings.local.json в проекте или с --user глобально
  treeyard hook codex install|remove|status [--user]    хуки Codex для писем сессиям узлов (одобрить при старте или в /hooks)
                                           настройки: .codex/hooks.json в проекте или с --user в ~/.codex/hooks.json
  treeyard hook antigravity install|remove|status [--user]   хук Antigravity для писем сессиям узлов (алиас: agy)
                                           PreInvocation — вместе с запросом и посреди хода
                                           настройки: .agents/hooks.json в проекте или с --user в ~/.gemini/config/hooks.json
  treeyard hook opencode install|remove|status [--user]   плагин OpenCode для писем сессиям узлов
                                           chat.message — вместе с запросом, tool.execute.after — посреди хода
                                           файл: .opencode/plugins/treeyard-mail.js или с --user в ~/.config/opencode/plugins/
  treeyard uninstall [--settings] [--dry-run]   убрать всё, что treeyard поставил вне .tree: скиллы из папок CLI
                                           и проекта, хуки post-commit, Claude Code, Codex, Antigravity и плагин OpenCode (здесь и в известных проектах);
                                           --settings — и ~/.treeyard; --dry-run — только показать; .tree/ и блок в AGENTS.md остаются
  treeyard context <id> [--start plan|do|goal|chat] [--task "…"]   что получит агент
  treeyard open <id> [--brain claude|codex|antigravity|opencode] [--pane|--bg] [--start …] [--yes]
                                           сессия по узлу прямо из shell
                [--task "…"|-]             задание сверх контекста узла: в конец первого сообщения (- — из stdin)
                [--model <модель>] [--effort <уровень>]   только на этот запуск
                [--worktree|--no-worktree]   в своём git worktree узла (ветка treeyard/<id>; сессии любого CLI) или в
                                           папке проекта; без флага — в worktree узла, если он уже есть
                [--pane|--bg --json]       для программ: JSON с id сессии (у --pane и с именем панели tmux, tmux -L brainyard)
  treeyard open <id> <id>… --pane|--bg [--task …]   несколько узлов — только с --pane или --bg: сессия в каждом по
                                           очереди, строка на узел (✓ id название · сессия <id> | панель <имя>);
                                           не встала — ✗ и код 1; --json — массив вместо объекта; все узлы, кроме первого,
                                           — каждый в своём worktree, первый остаётся в папке проекта
  treeyard worktree [add|setup <id>] [--json]   worktree узлов: без слов — список (папка, ветка, коммиты, что не
                                           закоммичено); add — завести (подготовка: setup из tree.md и копия по
                                           .worktreeinclude); setup — подготовить заново; сессии в нём пишут основное дерево
  treeyard worktree rm <id>…|--done [--dry-run] [--json]   убрать worktree и ветку (не пока есть незакоммиченное,
                                           невлитое или живая панель): несколько id — строка на узел, отказ у одного не
                                           мешает остальным (код 1); --done — все закрытые узлы (готово и отказ), где всё
                                           закоммичено и влито, с отчётом, что убрано и что оставлено; --dry-run — только показать
  treeyard sessions [--json]               сессии папки во всех CLI и чьи они; ▣ — живая панель (в JSON — pane)
  treeyard sleep <id> [<id>…] [--force] [--json] [--project <папка>]   усыпить живую панель узла: закрывает процесс
                                           tmux, оставляя сессию в узле для пробуждения и продолжения; отказывает,
                                           если панель работает, ждёт человека или к ней подключён терминал (без --force)
  treeyard peek <id> [--lines N] [--json] [--project <папка>]   заглянуть на экран живой панели узла: статус сессии, имя
                                           панели и последние N строк экрана (по умолчанию 25) без ANSI-кодов; для спящей
                                           или отсутствующей панели — понятное сообщение
  treeyard models [brain] [--json]         модели и уровни effort для CLI (claude, codex, antigravity, opencode);
                                           id, название (если отличается) и усилия (отмечено по умолчанию); --json — структура
  treeyard limits [brain] [--json]         локальные окна лимитов CLI через Brainyard без вызовов сети (offline);
                                           процент использования, время сброса, источник и возраст снимка
  treeyard wait <id> [<id>…] [--all] [--timeout 10m] [--json]   ждать, пока узел уйдёт из «в работе» или его сессия
                                           закончит ход, будет ждать человека или закончится; печатает статус, последнюю
                                           запись журнала, сессию и её последнее сообщение целиком — вопрос или итог
                                           из стенограммы CLI (нет стенограммы — конец экрана панели; в --json поле
                                           «message»); --all — пока все узлы; время вышло — код 124; узел уже не в
                                           работе — ответ сразу; письмо узлу твоей сессии (координатора) — тоже возврат,
                                           с письмом целиком; два узла в работе (или на проверке), правящие один файл
                                           (коммиты их веток и незакоммиченное в worktree), — строка «A» и «B» правят один
                                           файл: путь (в --json — conflicts); сессиям обоих один раз на пару и файл
                                           уходит письмо об этом
  treeyard send <id> "<текст>"|- [--force] [--json]   письмо следующей репликой той же сессии узла, а не новой сессии: сначала
                                           в ящик (номер), потом свободной панели — вставкой, уснувшей — пробуждением,
                                           фоновой Claude Code — продолжением; занятой, ждущей человека, открытой в его
                                           терминале и узлу без сессии — в очереди: доставит treeyard сам (первой сессии
                                           узла — в первом сообщении); вывод — номер и статус; строка — в журнал узла;
                                           --wait [--timeout 10m] — дождаться ответа (письма от узла тебе) и напечатать его,
                                           а без ответа — конец хода сессии и её экран; код 124 — время вышло;
                                           тормоз: между двумя узлами уже ушло mail_limit писем подряд (6; treeyard
                                           config mail_limit N|off), а у них не было записи в журнал не-письмом, смены
                                           статуса или коммита — следующее не уходит, код 1, в --json reason "ping-pong";
                                           спроси координатора или человека; велели продолжать — --force; письма из
                                           shell без узла не тормозятся
  treeyard send <id> --answer "<вариант>|<текст>"   ответ человека на вопрос в диалоге сессии узла (панель):
                                           номер или слова варианта, иначе текст — в строку своего ответа; разрешения
                                           не трогает — для них --approve / --reject с --as ты
  treeyard send <id> --approve [пункт] --as ты | --reject --as ты [--json]
                                           подтвердить или отклонить диалог разрешения (или доверия к папке / импортов)
                                           в панели — только по прямой просьбе человека; без --as ты отказывает,
                                           проверяет диалог на экране и пишет в журнал узла, что подтверждено/отклонено
  treeyard deliver [--once]                доставить ждущие письма; обычно запускается сам из send
  treeyard queue <id> [<id>…] --pane|--bg [--parallel 2] [--task "…"] [--limit 90] [--json]   очередь узлов:
                                           у одного узла с детьми — его открытые дети по порядку, иначе — как названы;
                                           не больше --parallel сессий (панелей — и не больше max_panes), следующий —
                                           когда узел ушёл из «в работе» или его сессия закончилась; узел с needs —
                                           когда нужные на проверке или готовы; при лимите CLI от --limit % ждёт сброса
                                           окна; строка на событие, пока все не пройдут; Ctrl+C — больше не запускать,
                                           повторный запуск подхватит узлы в работе; --brain, --start (do), --model,
                                           --effort, --worktree, --no-worktree, --yes — как у open; при --parallel от 2 один узел идёт в
                                           папке проекта, остальные — каждый в своём worktree
                                           узлы, правящие один файл, — строка «A» и «B» правят один файл: путь (событие overlap в
                                           --json) и письмо их сессиям, как у wait
  treeyard github [link <owner>/<N>|<owner>/<repo> [--parent id] | sync]
                                           доска GitHub Project (карточки — узлы, колонки — статусы) или issues
                                           репозитория (открытые — узлы, закрытие — в обе стороны)
  treeyard config [ключ [значение]]        настройки: lang ru|en, confirm, theme…
                                           codex_access sandbox|config|ask — как запускать Codex из дерева: песочница
                                           + treeyard и git (workspace-write, сеть и .git проекта открыты) или как в
                                           ~/.codex/config.toml; ask — спросить перед запуском; antigravity_access full|normal|ask`,
    en: `  treeyard init [--template <id>]          plant a tree: with an agent or from a template (wizard)
  treeyard init --agent [--brain <cli>]    an agent studies the folder, asks questions, plants the tree
  treeyard import [--brain <cli>]          an agent silently reads the project's plan and builds the tree
  treeyard import --from-json <file|->     plant a tree from JSON (how the agent plants it)
  treeyard status [--json] [--project <dir>]   a summary: versions, the folder and its tree, nodes by status and
                                           abandoned ones, skills, Codex's way through its sandbox to treeyard and git,
                                           the pointer, the git hook, live sessions and panes, GitHub;
                                           every problem with the command that fixes it (a Codex without access —
                                           the lines for ~/.codex/config.toml too)
  treeyard pointer                         add the block about the tree to AGENTS.md / CLAUDE.md
  treeyard skills [install]                the treeyard, treeyard-init and treeyard-coordinate skills: where they are,
                                           install into Claude Code, Codex, Antigravity (copies in the project — refresh)
  treeyard templates                       templates: stages, directions, mikado…
  treeyard show [id…] [--json] [--open]    the tree or nodes as text (--open hides finished work; off a terminal
                                           finished work folds into «✓ done: N», --all shows everything; open work
                                           under a finished parent stays, the parent folded into one line)
                [--brief] [--journal N|all]  --brief — header, criterion and the last 3 entries; --journal — how many entries
                [--only journal,sessions…]  only these parts: header, criterion, commits, children, sessions, note,
                                           journal, history (status changes), mail (treeyard send letters)
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
                [--done-when "…"] [--check "command"] [--note "…"] [--project <dir>]
                                           --after — right after a sibling (of any status, like set after=; without --parent —
                                           under its parent); --project — the tree of another folder, e.g. the main worktree;
                                           the title is the gist in 2–6 words; details go to --note and --done-when
  treeyard add "<title>" --project ../X --for <id>   a node in project X's tree that node id here needs
  treeyard add [--parent <id>] [--project <dir>] --from-json <file|->   several nodes at once: [{"title", "parent",
                                           "done_when", "note", "who", "status", "needs", "key", "children"}];
                                           prints their ids; an error adds none
  treeyard set <id> [<id>…] key=value…     status, title, who, done_when, check, note (description), waiting, until, parent,
                                           after=<sibling id>|first|last (the place among siblings),
                                           needs=<id>|../X#id (waits for a node of this tree or of another project); --project <dir> — a node there
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
  treeyard hook claude install|remove|status [--user]   Claude Code hooks for letters to node sessions
                                           UserPromptSubmit delivers with the prompt, PostToolUse during the turn
                                           settings: .claude/settings.local.json in the project or global with --user
  treeyard hook codex install|remove|status [--user]    Codex hooks for letters to node sessions (trust once at start or /hooks)
                                           settings: .codex/hooks.json in the project or ~/.codex/hooks.json with --user
  treeyard hook antigravity install|remove|status [--user]   Antigravity hook for letters to node sessions (alias: agy)
                                           PreInvocation delivers with the prompt and during the turn
                                           settings: .agents/hooks.json in the project or ~/.gemini/config/hooks.json with --user
  treeyard hook opencode install|remove|status [--user]   OpenCode plugin for letters to node sessions
                                           chat.message delivers with the prompt, tool.execute.after during the turn
                                           file: .opencode/plugins/treeyard-mail.js or ~/.config/opencode/plugins/ with --user
  treeyard uninstall [--settings] [--dry-run]   remove all treeyard put outside .tree: skills from the CLIs' folders
                                           and the project, post-commit, Claude Code, Codex and Antigravity hooks and the OpenCode plugin (here and in known projects);
                                           --settings — ~/.treeyard too; --dry-run — only show; .tree/ and the AGENTS.md block stay
  treeyard context <id> [--start plan|do|goal|chat] [--task "…"]   what an agent gets
  treeyard open <id> [--brain claude|codex|antigravity|opencode] [--pane|--bg] [--start …] [--yes]
                                           a session for a node straight from the shell
                [--task "…"|-]             an assignment on top of the node's context: added to the first message (- reads stdin)
                [--model <model>] [--effort <level>]   for this launch only
                [--worktree|--no-worktree]   in the node's own git worktree (branch treeyard/<id>; sessions of any CLI)
                                           or in the project's folder; without a flag — in the node's worktree if it has one
                [--pane|--bg --json]       for programs: JSON with the session id (with --pane, the tmux pane name too, tmux -L brainyard)
  treeyard open <id> <id>… --pane|--bg [--task …]   several nodes — only with --pane or --bg: a session in each, one
                                           after another, a line per node (✓ id title · session <id> | pane <name>);
                                           one that fails — ✗ and exit 1; --json — an array instead of an object; all nodes
                                           but the first get a worktree each, the first stays in the project's folder
  treeyard worktree [add|setup <id>] [--json]   the nodes' worktrees: bare — the list (folder, branch, commits, what is
                                           not committed); add — make one (preparation: setup from tree.md and the copy
                                           by .worktreeinclude); setup — prepare again; sessions in it write the main tree
  treeyard worktree rm <id>…|--done [--dry-run] [--json]   remove worktrees and branches (never while anything is
                                           uncommitted, unmerged or a pane is open): several ids — a line per node, one
                                           refusal does not stop the rest (exit 1); --done — every closed node (done or
                                           dropped) that is clean and merged, reporting what was removed and what was kept;
                                           --dry-run — only show
  treeyard sessions [--json]               sessions of this folder in every CLI, and whose they are; ▣ — a live pane
                                           (pane in JSON)
  treeyard sleep <id> [<id>…] [--force] [--json] [--project <dir>]   put a node's live pane to sleep: closes the tmux
                                           process, leaving the session in the node for waking and continuation; refuses
                                           if the pane is working, waiting for the person, or attached (without --force)
  treeyard peek <id> [--lines N] [--json] [--project <dir>]   peek at a node's live pane screen: session status, pane name
                                           and the last N lines (default 25) without ANSI codes; for a sleeping or missing
                                           pane — a clear message
  treeyard models [brain] [--json]         models and effort levels of the CLIs (claude, codex, antigravity, opencode);
                                           shows id, label (if different) and efforts (default marked); --json — clean structure
  treeyard limits [brain] [--json]         local limit windows of the CLIs via Brainyard without network calls (offline);
                                           utilization percentage, reset time, source and snapshot age
  treeyard wait <id> [<id>…] [--all] [--timeout 10m] [--json]   wait until a node leaves «active» or its session
                                           ends its turn, waits for the person or ends; prints the status, the last journal
                                           entry, the session and its last message whole — a question or a summary from
                                           the CLI's transcript (no transcript — the end of the pane's screen; the
                                           field «message» in --json); --all — until every node does; out of time — exit
                                           code 124; a node no longer active — at once; a message to your session's node
                                           (the coordinator's) — it returns too, whole; two nodes at work (or in review)
                                           that change one file (their branches' commits and what is uncommitted in their
                                           worktrees) — a line «A» and «B» edit the same file: path (conflicts in --json);
                                           the sessions of both get a letter about it, once per pair and file
  treeyard send <id> "<text>"|- [--force] [--json]   a message as the next one of the node's own session, not a new session: into
                                           the mailbox first (a number), then typed into an idle pane, waking a sleeping
                                           one, resuming a Claude Code background one; for a busy one, one waiting for the
                                           person, one open in their terminal and a node with no session — queued: treeyard
                                           delivers it by itself (a node's first session gets it in its first message);
                                           prints the number and the state; a line in the node's journal; --wait
                                           [--timeout 10m] — wait for the answer (a message from the node to you) and print
                                           it, or, with none, the end of the session's turn and its screen; 124 — out of time;
                                           the brake: mail_limit messages in a row have gone between two nodes (6; treeyard
                                           config mail_limit N|off) and neither wrote a journal entry that is not a message,
                                           changed a status or committed — the next one is not sent, exit 1, "ping-pong" as
                                           the reason in --json; ask the coordinator or the person; told to go on — --force;
                                           messages from a shell outside the nodes are not braked
  treeyard send <id> --answer "<choice>|<text>"   the person's answer to a question in the dialog of the node's
                                           session (a pane): a choice's number or words, otherwise a text into the row of
                                           one's own answer; never a permission — use --approve / --reject with --as you
  treeyard send <id> --approve [choice] --as you | --reject --as you [--json]
                                           confirm or decline a permission (or folder trust / imports) dialog in a pane —
                                           only at the person's direct request; refuses without --as you, checks the
                                           dialog on the screen and logs in the node's journal what was approved/rejected
  treeyard deliver [--once]                deliver the waiting messages; send usually starts it by itself
  treeyard queue <id> [<id>…] --pane|--bg [--parallel 2] [--task "…"] [--limit 90] [--json]   a queue of nodes:
                                           one node with children — its open children in order, otherwise as named; at
                                           most --parallel sessions (panes — and at most max_panes), the next one when a
                                           node leaves «active» or its session ends; a node with needs — when they are in
                                           review or done; with the CLI's window at --limit % it waits for the reset; a line
                                           per event until all have gone; Ctrl+C — start no more, running it again picks
                                           up the nodes at work; --brain, --start (do), --model, --effort, --worktree,
                                           --no-worktree, --yes — as for open; from --parallel 2 one node goes in the project's folder,
                                           the rest in a worktree each
                                           nodes that change one file — a line «A» and «B» edit the same file: path (an overlap
                                           event in --json) and a letter to their sessions, as in wait
  treeyard github [link <owner>/<N>|<owner>/<repo> [--parent id] | sync]
                                           a GitHub Project board (cards are nodes, columns are statuses) or a
                                           repository's issues (open ones are nodes, closing goes both ways)
  treeyard config [key [value]]            settings: lang ru|en, confirm, theme…
                                           codex_access sandbox|config|ask — how Codex starts from the tree: the sandbox
                                           + treeyard and git (workspace-write, the network and the project's .git open) or
                                           as ~/.codex/config.toml says; ask — ask before the launch; antigravity_access full|normal|ask`,
  });
}

/** Command words that run another command's code. */
const COMMAND_ALIASES: Record<string, string> = {
  tree: 'show',
  skill: 'skills',
  images: 'image',
  settings: 'config',
  worktrees: 'worktree',
};

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
  const skillsNote = autoSkills(command);
  // The tree says it in a toast; the others before their own output.
  if (skillsNote && command !== undefined) process.stderr.write(`${err.dim(skillsNote)}\n`);
  switch (command) {
    case undefined:
      return openTui(skillsNote);
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
    case 'wait':
      return waitCommand(rest);
    case 'send':
      return sendCommand(rest);
    case 'deliver':
      return deliverCommand(rest);
    case 'queue':
      return queueCommand(rest);
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
    case 'merge-overview':
      return mergeOverviewCommand(rest);
    case 'uninstall':
      return uninstallCommand(rest);
    case 'context':
      return contextCommand(rest);
    case 'open':
      return openCommand(rest);
    case 'worktree':
    case 'worktrees':
      return worktreeCommand(rest);
    case 'sessions':
      return sessionsCommand(rest);
    case 'sleep':
      return sleepCommand(rest);
    case 'peek':
      return peekCommand(rest);
    case 'models':
      return modelsCommand(rest);
    case 'limits':
      return limitsCommand(rest);
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
  // From a linked git worktree, read and write the main checkout's tree, not the branch's copy.
  // Explicit `--project` (e.g. `--project .` inside a worktree) selects that folder's tree directly.
  const dir = folder ? findProject(folderArg(folder)) : (treeOfWorktree() ?? findProject());
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

function parseBrain(value: string): BrainId {
  const v = value.toLowerCase();
  if (v === 'claude' || v === 'cc') return 'claude';
  if (v === 'codex') return 'codex';
  if (v === 'antigravity' || v === 'agy') return 'antigravity';
  if (v === 'opencode') return 'opencode';
  throw new UsageError(t('мозг бывает: claude, codex, antigravity, opencode'));
}

function brainArg(value: string | undefined, fallback: BrainId): BrainId {
  return value ? parseBrain(value) : fallback;
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

/** `--worktree` and `--no-worktree` as the launch option: said yes, said no, or not said (the node's own worktree if it has one). */
function worktreeOption(values: { worktree?: boolean | undefined; 'no-worktree'?: boolean | undefined }): {
  worktree?: boolean;
} {
  if (values.worktree && values['no-worktree']) throw new UsageError(t('выбери одно: --worktree или --no-worktree'));
  if (values.worktree) return { worktree: true };
  return values['no-worktree'] ? { worktree: false } : {};
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
  const explicit = given?.trim();
  if (explicit) return /^(ты|you)$/i.test(explicit);
  const as = process.env.TREEYARD_AS?.trim();
  // A session treeyard started names its CLI: its terminal (Antigravity runs commands in one) is no person.
  if (as && !/^(ты|you)$/i.test(as)) return false;
  if (process.stdin.isTTY) return true;
  return /^(ты|you)$/i.test(as ?? '');
}

// ── TUI ─────────────────────────────────────────────────────────────────────

async function openTui(skillsNote = ''): Promise<number> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    if (skillsNote) process.stderr.write(`${err.dim(skillsNote)}\n`);
    // No terminal to draw in: print the tree instead.
    return showCommand([]);
  }
  const dir = treeOfWorktree() ?? findProject();
  // No tree here yet: the first-run wizard, which may hand over to an agent; the note waits until it is over.
  if (!dir) {
    const code = await wizard(process.cwd());
    if (skillsNote) process.stderr.write(`${err.dim(skillsNote)}\n`);
    return code;
  }
  // Letters left waiting since the last deliverer stopped go on while the tree is open and after.
  try {
    ensureDeliverer(loadTree(dir));
  } catch {}
  const { runTui } = await import('../tui/run.js');
  await runTui(dir, undefined, skillsNote ? { text: skillsNote } : undefined);
  return 0;
}

/** Commands that only show the setup or change it: they install nothing by themselves. */
const NO_AUTO_SKILLS = new Set([
  'status',
  // Run by git in the middle of a merge: quiet and quick.
  'merge-overview',
  // Started in the background by send: nothing to install or say.
  'deliver',
  // Run by git after a commit and by Claude Code between tool calls: quiet and quick.
  'hook',
  // It is taking them away.
  'uninstall',
  'skills',
  'skill',
  'config',
  'settings',
  'help',
  '--help',
  '-h',
  '--version',
  '-v',
  'version',
]);

/**
 * Where there is a tree, or one is about to be planted (`init`, `treeyard` with the wizard), the
 * skills its agents read are put into every CLI on the machine and kept at this version — unless
 * the setting `skills` is off. Returns what to tell the person; empty when nothing was written.
 */
function autoSkills(command: string | undefined): string {
  if (command && NO_AUTO_SKILLS.has(command)) return '';
  const project = treeOfWorktree() ?? findProject();
  const planting = command === 'init' || (command === undefined && Boolean(process.stdin.isTTY));
  if (!project && !planting) return '';
  if (!skillsAuto()) return '';
  const written = autoInstallSkills(project ?? undefined);
  if (!written.length) return '';
  const homes = skillHomes();
  const where = [
    ...new Set(
      written.map((path) => {
        const home = homes.find((h) => path.startsWith(h.dir + sep));
        return home ? BRAIN_LABEL[home.brain] : t('папка проекта');
      }),
    ),
  ];
  return t('скиллы treeyard {version} — в {where} · не ставить их самому: treeyard config skills off', {
    version: VERSION,
    where: where.join(', '),
  });
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
  if (values.agent) return plantCommand(dir, brainArg(values.brain, defaultBrain()), Boolean(values.yes));
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
      ...(values.brain ? { brain: parseBrain(values.brain) } : {}),
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
  if (!(await chooseAccess(brain))) return 0;
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
        `  ${err.dim(t('Запишет'))}    ${t('дерево и короткие документы — только после твоего «да»')}\n` +
        `  ${err.dim(t('Права'))}      ${accessText(brain, fullAccess(brain, dir).permissionMode)}\n\n`,
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
  let place = locate(start);
  // A worktree resolves to the main tree through git common dir (or TREEYARD_PROJECT for a sub-tree inside main).
  const owner = values.project ? undefined : treeOfWorktree(start);
  if (owner && place.worktree) place = { ...place, project: owner };
  const status = await projectStatus(place);
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
      `${t('теперь в любой папке: «посади дерево этого проекта» или /{skill} в твоём CLI', {
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
  process.stdout.write(`${out.dim(skillsAutoLine(skillsAuto()))}\n`);
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
  const brain = brainArg(values.brain, defaultBrain(existing ? loadTree(existing).project.brain : undefined));
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
        only
          ? partsJson(tree, node, only, keep)
          : { ...node, ...worktreeJson(tree, node), ...staleJson(staleOfNode(node)) },
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
  mail: ['mail', 'letters', 'письма', 'почта'],
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
 * `treeyard wait <id…>`: until one of the nodes needs the coordinator — it left «в работе», or its
 * session ended its turn, waits for the person or ended (see agents/wait.ts). Exit 124: out of time.
 */
async function waitCommand(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {
    all: { type: 'boolean' },
    timeout: { type: 'string' },
    json: { type: 'boolean' },
    project: { type: 'string' },
  });
  const usage = t('treeyard wait <id> [<id>…] [--all] [--timeout 10m] [--json]');
  if (!positionals.length) throw new UsageError(usage);
  const tree = project(values.project);
  const ids = [...new Set(positionals.map((p) => nodeArg(tree, p)))];
  if (ids.includes(ROOT)) throw new UsageError(t('корень не ждут — назови узлы: {usage}', { usage }));
  // Letters left waiting since the last deliverer stopped (a restart, a sandbox) go on now.
  ensureDeliverer(tree);
  let timeoutMs: number | undefined;
  if (values.timeout !== undefined) {
    timeoutMs = parseDuration(values.timeout);
    if (timeoutMs === undefined) throw new UsageError(t('--timeout — секунды или 90s, 10m, 1h'));
  }
  // The coordinator's own node: letters its sessions write to it end the wait.
  const inbox = senderNode(tree)?.id;
  const result = await waitFor(tree.project.dir, ids, {
    ...(values.all ? { all: true } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(inbox ? { inbox } : {}),
  });
  if (values.json) {
    process.stdout.write(`${JSON.stringify(waitJson(result), null, 2)}\n`);
    return result.timedOut ? 124 : 0;
  }
  if (result.timedOut)
    process.stderr.write(
      `${err.c('#ffcf70', '!')} ${t('время вышло ({timeout}) — узлы ещё в работе', { timeout: values.timeout ?? '' })}\n`,
    );
  process.stdout.write(waitText(result, out));
  return result.timedOut ? 124 : 0;
}

/**
 * `treeyard send <id> "…"`: a letter to the node's own session (see agents/send.ts) — delivered at
 * once when the session can take it, queued in the mailbox and delivered by treeyard otherwise.
 */
async function sendCommand(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {
    json: { type: 'boolean' },
    project: { type: 'string' },
    as: { type: 'string' },
    wait: { type: 'boolean' },
    timeout: { type: 'string' },
    answer: { type: 'string' },
    approve: { type: 'boolean' },
    reject: { type: 'boolean' },
    force: { type: 'boolean' },
  });
  const usage = t(
    'treeyard send <id> "<текст>"|- [--wait [--timeout 10m]] [--force] [--json] · treeyard send <id> --answer "<вариант>|<текст>" · treeyard send <id> --approve [пункт] --as ты | --reject --as ты',
  );
  const dialogModes = [values.answer !== undefined, values.approve === true, values.reject === true].filter(
    Boolean,
  ).length;
  if (dialogModes > 1) throw new UsageError(t('выбери одно: --answer, --approve или --reject'));
  if ((values.approve || values.reject) && (values.wait || values.timeout !== undefined || values.force))
    throw new UsageError(t('--approve и --reject не сочетаются с --wait, --timeout и --force'));
  const tree = project(values.project);
  if (values.answer !== undefined) {
    if (positionals.length !== 1 || values.wait || values.timeout !== undefined || values.force)
      throw new UsageError(usage);
    return answerCommand(tree, nodeArg(tree, positionals[0]), values.answer, values.json === true, sourceOf(values.as));
  }
  if (values.approve || values.reject) {
    if (!positionals.length) throw new UsageError(usage);
    if (values.reject && positionals.length > 1) throw new UsageError(usage);
    const choice = values.approve ? positionals.slice(1).join(' ').trim() || undefined : undefined;
    return permissionCommand(
      tree,
      nodeArg(tree, positionals[0]),
      values.approve ? 'approve' : 'reject',
      choice,
      values.json === true,
      values.as,
    );
  }
  if (positionals.length < 2) throw new UsageError(usage);
  const id = nodeArg(tree, positionals[0]);
  if (id === ROOT) throw new UsageError(t('корню не пишут — назови узел: {usage}', { usage }));
  let timeoutMs: number | undefined;
  if (values.timeout !== undefined) {
    if (!values.wait) throw new UsageError(t('--timeout — только с --wait: {usage}', { usage }));
    timeoutMs = parseDuration(values.timeout);
    if (timeoutMs === undefined) throw new UsageError(t('--timeout — секунды или 90s, 10m, 1h'));
  }
  const raw = positionals.slice(1).join(' ');
  const text = (raw === '-' ? await textFrom('-') : raw).trim();
  if (!text) throw new UsageError(usage);
  let sent: Awaited<ReturnType<typeof sendToNode>>;
  try {
    sent = await sendToNode(tree, id, text, {
      size: paneSize(),
      source: sourceOf(values.as),
      sender: senderNode(tree),
      ...(values.force ? { force: true } : {}),
    });
  } catch (error) {
    if (!(error instanceof NotSent)) throw error;
    if (values.json)
      process.stdout.write(
        `${JSON.stringify(
          {
            node: id,
            sent: false,
            error: error.message,
            // The brake on letters going round in a circle: why, and how far it went.
            ...(error instanceof PingPongStop
              ? {
                  reason: 'ping-pong',
                  from: error.stop.from,
                  letters: error.stop.letters,
                  limit: error.stop.limit,
                }
              : {}),
          },
          null,
          2,
        )}\n`,
      );
    process.stderr.write(`${err.c('#ff7b72', '✗')} ${error.message}\n`);
    return 1;
  }
  const replied = values.wait
    ? await waitReply(tree.project.dir, sent.letter, timeoutMs ? { timeoutMs } : {})
    : undefined;
  if (values.json) {
    const letter = replied?.letter ?? sent.letter;
    process.stdout.write(
      `${JSON.stringify(
        {
          node: id,
          sent: true,
          letter: letter.n,
          state: letter.state,
          how: letter.delivered?.how ?? sent.how ?? null,
          held: letter.state === 'queued' ? (letter.held ?? sent.held ?? null) : null,
          heldFor: letter.state === 'queued' ? (letter.heldFor ?? null) : null,
          brain: sent.ref?.brain ?? null,
          id: sent.ref?.id ?? null,
          pane: sent.pane ?? null,
          warnings: sent.warnings,
          ...(replied
            ? {
                reply: replied.reply
                  ? {
                      n: replied.reply.n,
                      from: replied.reply.from ?? null,
                      text: replied.reply.text,
                      at: replied.reply.at,
                    }
                  : null,
                session: replied.sight
                  ? (
                      waitJson({ settled: [replied.sight], pending: [], letters: [], timedOut: false }) as {
                        settled: unknown[];
                      }
                    ).settled[0]
                  : null,
                timedOut: replied.timedOut,
              }
            : {}),
        },
        null,
        2,
      )}\n`,
    );
    return replied?.timedOut ? 124 : 0;
  }
  for (const warning of sent.warnings) process.stderr.write(`${err.c('#ffcf70', '!')} ${warning}\n`);
  const title = tree.nodes.get(id)!.title;
  if (sent.how) {
    let how = DELIVERY_TEXT[sent.how];
    if (sent.how === 'typed') how = t('набрано в панели {pane}', { pane: sent.pane });
    if (sent.how === 'woke') how = t('панель {pane} проснулась с письмом', { pane: sent.pane });
    if (sent.how === 'resumed')
      how = t('фоновая сессия {short} продолжена с письмом', { short: sent.ref?.id.slice(0, 8) ?? '' });
    process.stdout.write(
      `${out.c('#7ee2a8', '✓')} ${id}  ${title} · ${t('письмо №{n} доставлено: {how}', { n: sent.letter.n, how })}\n`,
    );
  } else {
    const why = letterState({ state: 'queued', held: sent.held, ...(sent.heldFor ? { heldFor: sent.heldFor } : {}) });
    process.stdout.write(
      `${out.c('#ffcf70', '✉')} ${id}  ${title} · ${t('письмо №{n}', { n: sent.letter.n })} ${why}\n`,
    );
    // Where the person answers what the session waits for; the letter goes after that.
    if (sent.held === 'waiting' && sent.ref)
      process.stdout.write(
        `  ${out.dim(
          sent.ref.mode === 'pane' && sent.ref.pane
            ? t('ответить ей: tmux -L brainyard attach -t {pane}', { pane: sent.ref.pane })
            : sent.ref.brain === 'claude'
              ? t('ответить ей: claude attach {id}', { id: sent.ref.id.slice(0, 8) })
              : t('ответить ей: в терминале, где открыта сессия'),
        )}\n`,
      );
    if (sent.held === 'none')
      process.stdout.write(`  ${out.dim(t('начать её: treeyard open {id} --pane|--bg --task "…"', { id }))}\n`);
    else if (!replied)
      process.stdout.write(
        `  ${out.dim(t('доставит treeyard сам; посмотреть — treeyard show {id} --only mail', { id }))}\n`,
      );
  }
  if (!replied) return 0;
  if (replied.reply) {
    const answers = replied.reply.replyTo ? ` · ${t('ответ на №{n}', { n: replied.reply.replyTo })}` : '';
    process.stdout.write(
      `\n${out.bold(`✉ ${t('письмо №{n}', { n: replied.reply.n })}`)} ${t('от «{title}»', { title })}${out.dim(answers)}\n`,
    );
    for (const row of replied.reply.text.split('\n')) process.stdout.write(`  ${row}\n`);
    return 0;
  }
  if (replied.sight) {
    process.stdout.write(`\n${t('ответа нет:')}\n${sightBlock(replied.sight, out)}\n`);
    return 0;
  }
  process.stderr.write(
    `${err.c('#ffcf70', '!')} ${t('время вышло ({timeout}) — ответа нет; письмо №{n}: {state}', {
      timeout: values.timeout ?? '',
      n: replied.letter.n,
      state: letterState(replied.letter),
    })}\n`,
  );
  return 124;
}

/** `treeyard send <id> --answer "…"`: the person's answer to a question the node's session asks in a dialog. */
async function answerCommand(
  tree: Tree,
  id: string,
  answer: string,
  json: boolean,
  source: string | undefined,
): Promise<number> {
  if (id === ROOT) throw new UsageError(t('корню не пишут — назови узел'));
  if (!answer.trim()) throw new UsageError(t('--answer — номер варианта, его слова или свой текст'));
  let answered: Awaited<ReturnType<typeof answerQuestion>>;
  try {
    answered = await answerQuestion(tree, id, answer, source ? { source } : {});
  } catch (error) {
    if (!(error instanceof NotAnswered)) throw error;
    if (json) process.stdout.write(`${JSON.stringify({ node: id, answered: false, error: error.message }, null, 2)}\n`);
    process.stderr.write(`${err.c('#ff7b72', '✗')} ${error.message}\n`);
    return 1;
  }
  if (json) {
    process.stdout.write(
      `${JSON.stringify({ node: id, answered: true, option: answered.option.n, label: answered.option.label, text: answered.text ?? null, pane: answered.pane, screen: answered.screen }, null, 2)}\n`,
    );
    return 0;
  }
  const what = answered.text
    ? t('«{text}» в «{label}»', { text: answered.text, label: answered.option.label })
    : `${answered.option.n}. ${answered.option.label}`;
  process.stdout.write(
    `${out.c('#7ee2a8', '✓')} ${id}  ${tree.nodes.get(id)!.title} · ${t('ответ передан: {what}', { what })}\n`,
  );
  if (answered.screen.length) {
    process.stdout.write(`  ${out.dim(t('конец экрана:'))}\n`);
    for (const row of answered.screen) process.stdout.write(`    ${out.dim('│')} ${row}\n`);
  }
  return 0;
}

/** `treeyard send <id> --approve [choice] --as ты` / `--reject --as ты`: confirm or decline a permission dialog. */
async function permissionCommand(
  tree: Tree,
  id: string,
  decision: PermissionDecision,
  choice: string | undefined,
  json: boolean,
  as: string | undefined,
): Promise<number> {
  if (id === ROOT) throw new UsageError(t('корню не пишут — назови узел'));
  if (!byPerson(as)) {
    const given = as?.trim();
    const message = given
      ? t(
          'разрешения даёт только человек («{as}» — не человек) — по прямой просьбе человека добавь --as ты или ответь в панели: tmux -L brainyard attach',
          { as: given },
        )
      : t(
          'разрешения даёт только человек — по прямой просьбе человека добавь --as ты или ответь в панели: tmux -L brainyard attach',
        );
    if (json)
      process.stdout.write(`${JSON.stringify({ node: id, resolved: false, decision, error: message }, null, 2)}\n`);
    process.stderr.write(`${err.c('#ff7b72', '✗')} ${message}\n`);
    return 1;
  }
  let resolved: Awaited<ReturnType<typeof resolvePermission>>;
  try {
    resolved = await resolvePermission(tree, id, decision, {
      ...(choice ? { choice } : {}),
      source: sourceOf(as),
    });
  } catch (error) {
    if (!(error instanceof NotAnswered)) throw error;
    if (json)
      process.stdout.write(
        `${JSON.stringify({ node: id, resolved: false, decision, error: error.message }, null, 2)}\n`,
      );
    process.stderr.write(`${err.c('#ff7b72', '✗')} ${error.message}\n`);
    return 1;
  }
  if (json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          node: id,
          resolved: true,
          decision: resolved.decision,
          option: resolved.option?.n ?? null,
          label: resolved.option?.label ?? null,
          key: resolved.key,
          waitingFor: resolved.waitingFor ?? null,
          pane: resolved.pane,
          screen: resolved.screen,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }
  const what = permissionSummary(resolved);
  const label =
    decision === 'approve'
      ? t('разрешение подтверждено: {what}', { what })
      : t('разрешение отклонено: {what}', { what });
  process.stdout.write(`${out.c('#7ee2a8', '✓')} ${id}  ${tree.nodes.get(id)!.title} · ${label}\n`);
  if (resolved.screen.length) {
    process.stdout.write(`  ${out.dim(t('конец экрана:'))}\n`);
    for (const row of resolved.screen) process.stdout.write(`    ${out.dim('│')} ${row}\n`);
  }
  return 0;
}

/**
 * `treeyard deliver`: hands the waiting letters of the project to their sessions until none is left
 * that a session could take. `send` starts it in the background by itself; by hand — to look.
 */
async function deliverCommand(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, { project: { type: 'string' }, once: { type: 'boolean' } });
  if (positionals.length) throw new UsageError(t('treeyard deliver [--once] [--project <папка>]'));
  const dir = projectDir(values.project);
  if (values.once) {
    const attempts = await deliverAll(dir, { size: paneSize() });
    for (const attempt of attempts) process.stdout.write(`${attemptLine(attempt)}\n`);
    return 0;
  }
  await runDeliverer(dir, { size: paneSize() });
  return 0;
}

function attemptLine(attempt: Attempt): string {
  const numbers = attempt.letters.map((n) => t('№{n}', { n })).join(', ');
  if (attempt.how) return `${out.c('#7ee2a8', '✓')} ${attempt.node}  ${numbers} · ${DELIVERY_TEXT[attempt.how]}`;
  if (attempt.error) return `${out.c('#ff7b72', '✗')} ${attempt.node}  ${numbers} · ${attempt.error}`;
  return `${out.c('#ffcf70', '✉')} ${attempt.node}  ${numbers} · ${letterState({ state: 'queued', ...(attempt.held ? { held: attempt.held } : {}), ...(attempt.heldFor ? { heldFor: attempt.heldFor } : {}) })}`;
}

/** `treeyard queue <id…>`: start the nodes one after another as slots and limits allow (see agents/queue.ts). */
async function queueCommand(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {
    brain: { type: 'string', short: 'b' },
    start: { type: 'string' },
    bg: { type: 'boolean' },
    pane: { type: 'boolean' },
    parallel: { type: 'string' },
    limit: { type: 'string' },
    model: { type: 'string' },
    effort: { type: 'string' },
    worktree: { type: 'boolean' },
    'no-worktree': { type: 'boolean' },
    task: { type: 'string' },
    yes: { type: 'boolean', short: 'y' },
    json: { type: 'boolean' },
  });
  const usage = t('treeyard queue <id> [<id>…] --pane|--bg [--parallel 2] [--task "…"] [--limit 90] [--json]');
  if (!positionals.length) throw new UsageError(usage);
  if (values.pane === values.bg) throw new UsageError(t('выбери одно: --pane или --bg — {usage}', { usage }));
  const tree = project();
  const ids = [...new Set(positionals.map((p) => nodeArg(tree, p)))];
  if (ids.includes(ROOT)) throw new UsageError(t('корень в очередь не ставят — назови узлы: {usage}', { usage }));
  const parallel = values.parallel === undefined ? 2 : Number(values.parallel);
  if (!Number.isInteger(parallel) || parallel < 1) throw new UsageError(t('--parallel — целое от 1'));
  const limit = values.limit === undefined ? LIMIT * 100 : Number(values.limit);
  if (!Number.isFinite(limit) || limit <= 0 || limit > 100) throw new UsageError(t('--limit — проценты, от 1 до 100'));
  const brain = brainArg(values.brain, defaultBrain(tree.project.brain));
  const task = await taskArg(values.task);
  const options: LaunchOptions = {
    brain,
    // Nobody approves a plan in a queue: its sessions do the node.
    start: startArg(values.start, 'do'),
    ...(values.bg ? { background: true } : { pane: true }),
    ...(values.model ? { model: values.model } : {}),
    ...(values.effort ? { effort: values.effort } : {}),
    ...worktreeOption(values),
    ...(task ? { task } : {}),
  };
  if (!(await chooseAccess(brain))) return 0;
  if (settings().confirm && !values.yes && process.stdin.isTTY) {
    const titles = queueNodesOf(tree, ids);
    process.stderr.write(`\n${titles.map((title) => `  ${title}`).join('\n')}\n\n`);
    if (!(await askYes(t('Поставить в очередь: {n}, по {parallel} сразу?', { n: titles.length, parallel })))) return 0;
  }
  const json = values.json === true;
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  const end = await runQueue(tree.project.dir, ids, {
    launch: options,
    parallel,
    ...(options.pane ? { maxPanes: settings().maxPanes } : {}),
    limit: limit / 100,
    signal: controller.signal,
    sources: queueSources(async (current, id, launchOptions) => {
      if (launchOptions.pane) {
        const { pane, ref } = await launchInPane(current, id, launchOptions, paneSize());
        return { pane, ...(isPending(ref) ? {} : { session: ref.id }) };
      }
      const { result, ref } = await launch(current, id, launchOptions);
      if (result.error || !ref) throw new Error(result.error?.message ?? t('сессия не встала'));
      return { session: ref.id };
    }),
    onEvent: (event) =>
      process.stdout.write(`${json ? JSON.stringify({ ...event, at: nowIso() }) : queueLine(event, out)}\n`),
  });
  return end.type === 'end' && end.blocked ? 1 : 0;
}

function queueNodesOf(tree: Tree, ids: string[]): string[] {
  return queueNodes(tree, ids).map((id) => `${id}  ${tree.nodes.get(id)?.title ?? ''}`);
}

/** A queue event as one line: the time, a mark, the node and what happened. */
function queueLine(event: QueueEvent, p: typeof out): string {
  const now = new Date();
  const clock = p.dim(
    [now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':'),
  );
  const node = (id: string, title: string) => `${id}  ${title}`;
  switch (event.type) {
    case 'start':
      return `${clock}  ${p.c('#8ab4ff', '▶')} ${node(event.node, event.title)} · ${
        event.pane ? t('панель {pane}', { pane: event.pane }) : t('сессия {session}', { session: event.session ?? '?' })
      }`;
    case 'fail':
      return `${clock}  ${p.c('#ff7b72', '✗')} ${node(event.node, event.title)} · ${event.error}`;
    case 'done':
      return event.ended
        ? `${clock}  ${p.c('#ffcf70', '■')} ${node(event.node, event.title)} · ${t('сессия закончилась, узел ещё в работе — загляни: treeyard show {id}', { id: event.node })}`
        : `${clock}  ${p.c('#7ee2a8', '✓')} ${node(event.node, event.title)} · ${STATUS_LABEL[event.status]}`;
    case 'asks':
      return `${clock}  ${p.c('#ffcf70', '?')} ${node(event.node, event.title)} · ${
        event.state === 'waiting'
          ? t('ждёт человека{why}', { why: event.waitingFor ? `: ${event.waitingFor}` : '' })
          : t('закончила ход, узел ещё в работе — treeyard wait {id}, ответ — treeyard send {id}', { id: event.node })
      }`;
    case 'limit':
      return `${clock}  ${p.c('#ffcf70', '‖')} ${t(
        'лимит {brain} ({window}) — {percent}%: новые узлы не запускаю{until}',
        {
          brain: event.brain,
          window: event.window,
          percent: Math.round(event.utilization * 100),
          until: event.resetsAt ? t(' до {time}', { time: clockOf(event.resetsAt * 1000) }) : '',
        },
      )}`;
    case 'resume':
      return `${clock}  ${p.c('#8ab4ff', '▶')} ${t('лимит {brain} снова есть — продолжаю', { brain: event.brain })}`;
    case 'blocked':
      return `${clock}  ${p.c('#ffcf70', '‖')} ${node(event.node, event.title)} · ${
        event.reason ? t('не дождался: {needs}', { needs: event.reason }) : t('не запустился')
      }`;
    case 'overlap':
      return overlapLines(event.aTitle, event.bTitle, event.files)
        .map((line) => `${clock}  ${p.c('#ffcf70', '⚠')} ${line}`)
        .join('\n');
    default: {
      const counts = { started: event.started, finished: event.finished, blocked: event.blocked };
      return `${clock}  ${p.dim(
        event.stopped
          ? t(
              'очередь остановлена: запущено {started}, закончено {finished}; та же команда подхватит узлы в работе',
              counts,
            )
          : t('очередь прошла: запущено {started}, закончено {finished}, не дождались {blocked}', counts),
      )}`;
    }
  }
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
  // With `--for`, the node goes into another project and links back to a node here; without it,
  // `--project` simply names the tree to add to (e.g. the main folder from a git worktree).
  const here = values.for ? project() : undefined;
  const tree = here ? otherProject(here, values.project!) : project(values.project);
  const afterId = values.after ? nodeArg(tree, values.after) : undefined;
  const after = afterId ? tree.nodes.get(afterId) : undefined;
  // The root has no siblings to stand after.
  if (afterId && !after) throw new UsageError(t('нет узла «{id}»', { id: afterId }));
  // `--after` alone says where the node goes: under the same parent as that sibling.
  const parent = values.parent ? nodeArg(tree, values.parent) : (after?.parent ?? (here ? undefined : ROOT));
  if (after && after.parent !== parent)
    throw new UsageError(
      t('--after {id}: это узел другого родителя, не {parent} — укажи брата или убери --parent', {
        id: after.id,
        parent: parent ?? ROOT,
      }),
    );
  const status = values.status ? statusArg(values.status) : ('todo' as Status);
  // Siblings show grouped by status: after one of another status the node lands in its own group, so say so.
  const regrouped =
    after && after.status !== status
      ? t(
          '{p1} --after {id}: у брата статус «{sibling}», у нового узла — «{status}»; он встал на ближайшее место в группе «{status}»\n',
          {
            p1: err.c('#ffcf70', '!'),
            id: after.id,
            sibling: STATUS_LABEL[after.status],
            status: STATUS_LABEL[status],
          },
        )
      : '';
  const input = {
    title,
    ...(parent ? { parent } : {}),
    status,
    ...(values.who ? { who: whoArg(values.who) } : {}),
    ...(values['done-when'] ? { doneWhen: values['done-when'] } : {}),
    ...(values.check ? { check: values.check } : {}),
    ...(values.note ? { body: values.note } : {}),
    ...(values.waiting ? { waiting: values.waiting } : {}),
    ...(values.until ? { until: values.until } : {}),
    ...(after ? { after: after.id } : {}),
  };
  if (here && values.for) {
    const waiter = nodeArg(here, values.for);
    const node = addLinkedNode(here, waiter, tree, input, sourceOf(values.as));
    const branch = tree.nodes.get(node.parent)?.title;
    process.stdout.write(
      `${node.id} · ${tree.project.title}${branch ? ` › ${branch}` : ''} ← ${here.project.title} › ${waiter}\n`,
    );
    if (regrouped) process.stderr.write(regrouped);
    longTitleHint(node.id, node.title, Boolean(values.note));
    return 0;
  }
  const node = addNode(tree, input, sourceOf(values.as));
  process.stdout.write(`${node.id}\n`);
  if (regrouped) process.stderr.write(regrouped);
  longTitleHint(node.id, node.title, Boolean(values.note));
  return 0;
}

/**
 * A title past the limit is usually a paragraph: the node is added anyway, and stderr says where
 * the details go and how to fix it (stderr, so a script reading the id from stdout is not bothered).
 */
function longTitleHint(id: string, title: string, hasNote: boolean): void {
  if (!isLongTitle(title)) return;
  const length = [...title].length;
  const text = hasNote
    ? t('название на {n} симв. — суть в 2–6 словах, подробности уже в --note; сократить: treeyard set {id} title="…"', {
        n: length,
        id,
      })
    : t(
        'название на {n} симв. — суть в 2–6 словах, подробности в --note, проверка в --done-when; поправить: treeyard set {id} title="…" note="…"',
        { n: length, id },
      );
  process.stderr.write(`${err.c('#ffcf70', '!')} ${text}\n`);
}

/**
 * `add --parent <id> --from-json <file|->`: several nodes, children and `needs` between them,
 * checked as a whole first; prints each new id with its title, children indented.
 */
async function addBatch(title: string, values: Record<string, string | boolean | undefined>): Promise<number> {
  if (title) throw new UsageError(t('--from-json: названия — в JSON, без названия в команде'));
  const unsupported = ['for', 'after'].find((name) => values[name] !== undefined);
  if (unsupported) throw new UsageError(t('--from-json не работает с --{name}', { name: unsupported }));
  const alone = ['done-when', 'check', 'note', 'waiting', 'until'].find((name) => values[name] !== undefined);
  if (alone) throw new UsageError(t('--from-json: --{name} задаётся в JSON у каждого узла', { name: alone }));
  const tree = project(typeof values.project === 'string' ? values.project : undefined);
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
  for (const { node } of planted) longTitleHint(node.id, node.title, description(node.body) !== '');
  return 0;
}

/** Another project's tree, by its folder relative to this project's — the way refs are written. */
function otherProject(here: Tree, folder: string): Tree {
  const dir = resolve(here.project.dir, folder.trim().replace(/^~(?=$|\/)/, homedir()));
  if (findProject(dir) !== dir)
    throw new UsageError(t('в {dir} нет дерева (.tree/tree.md) — сначала treeyard init там', { dir }));
  if (insideFolder(dir, here.project.dir) && insideFolder(here.project.dir, dir))
    throw new UsageError(t('--project указывает на этот же проект'));
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
  // `--project <folder>`: another project (e.g. closing a shared node) or the main tree from a worktree.
  const tree = project(values.project);
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
    // One node set to «в работе» from a node's session: the session moved there, its commits follow.
    // Several at once say nothing about where the session itself works.
    if (status === 'active' && ids.length === 1) {
      const said = moveText(tree, noteMove(tree, ids[0]!));
      if (said) process.stderr.write(`${err.dim(said)}\n`);
    }
  }
  for (const id of ids) {
    const node = tree.nodes.get(id)!;
    // Done turned into review is said here too: stderr is often thrown away (`2>/dev/null`).
    const note = demoted.has(id) ? ` · ${demotedNote(values.as)}` : '';
    process.stdout.write(`${node.id} · ${STATUS_LABEL[node.status]} · ${node.title}${note}\n`);
  }
  if (status === 'done') {
    const clean = ids.filter((id) => !demoted.has(id) && isWorktreeCleanMerged(tree.project.dir, id));
    if (clean.length === 1) {
      process.stdout.write(
        `${out.dim(t('worktree влит и чист — убрать: treeyard worktree rm {id}', { id: clean[0]! }))}\n`,
      );
    } else if (clean.length > 1) {
      process.stdout.write(
        `${out.dim(t('worktree влиты и чисты — убрать: treeyard worktree rm {ids}', { ids: clean.join(' ') }))}\n`,
      );
    }
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
    const repo = await refRepository(dir);
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
    if (next.status === 'active') {
      const moved = moveText(tree, noteMove(tree, id));
      if (moved) process.stderr.write(`${err.dim(moved)}\n`);
    }
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
  const repo = await refRepository(dir);
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
  // The commits attached to the node, and the ones its worktree's branch made: no hook, no --add.
  let refs = nodeCommits(dir, node);
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
  const dir = projectDir(values.project);
  const text = positionals.join(' ').replace(/\s+/g, ' ').trim();
  const line = !text || /\b\d{4}-\d\d-\d\d\b/.test(text) ? text : `${text} (${today()})`;
  // Only the line goes into the file: the header, the rules and earlier decisions stay as written.
  if (line) writeDecisions(dir, [line]);
  const { body } = loadTree(dir).project;
  if (values.json) process.stdout.write(`${JSON.stringify({ decisions: decisionList(body) }, null, 2)}\n`);
  else if (line) process.stdout.write(`${t('в «Решения» .tree/tree.md: {line}', { line })}\n`);
  else {
    const lines = decisionsOf(body);
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
  const here = treeOfWorktree() ?? findProject();
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

/** Takes away what treeyard put outside `.tree/`; `--dry-run` only lists it. */
async function uninstallCommand(args: string[]): Promise<number> {
  const { values } = parse(args, { settings: { type: 'boolean' }, 'dry-run': { type: 'boolean' } });
  const { leftovers, uninstall } = await import('../uninstall.js');
  const options = { folder: locate(process.cwd()).folder, settings: Boolean(values.settings) };
  const what = (item: Leftover): string => {
    if (item.kind === 'hook') return t('хук post-commit');
    if (item.kind === 'claude-hook') return t('хук Claude Code для писем');
    if (item.kind === 'codex-hook') return t('хук Codex для писем');
    if (item.kind === 'agy-hook') return t('хук Antigravity для писем');
    if (item.kind === 'opencode-hook') return t('плагин OpenCode для писем');
    if (item.kind === 'merge') return t('драйвер слияния обзора дерева');
    if (item.kind === 'settings') return t('настройки treeyard');
    if (item.kind === 'crashes') return t('журналы падений treeyard');
    const where = item.brain ? BRAIN_LABEL[item.brain] : t('папка проекта');
    return `${t('скилл {skill}', { skill: item.skill })} · ${where}${item.link ? ` · ${t('ссылка')}` : ''}`;
  };
  const row = (mark: string, item: Leftover, note = '') =>
    `${mark} ${what(item)}  ${out.dim(homeShort(item.path))}${note ? ` ${out.dim(`— ${note}`)}` : ''}\n`;
  const stays = () =>
    process.stdout.write(
      `${out.dim(t('.tree/ и блок о дереве в AGENTS.md / CLAUDE.md остаются — они часть проекта'))}\n`,
    );

  if (values['dry-run']) {
    const items = leftovers(options);
    if (!items.length) process.stdout.write(`${t('вне .tree от treeyard ничего нет — убирать нечего')}\n`);
    else {
      process.stdout.write(`${t('treeyard uninstall уберёт:')}\n`);
      for (const item of items)
        process.stdout.write(
          row(
            ' ',
            item,
            item.kind === 'hook' && item.manual ? t('хуки лежат в репозитории, строку убрать самому') : '',
          ),
        );
    }
    stays();
    return 0;
  }

  const done = uninstall(options);
  if (!done.length) process.stdout.write(`${t('вне .tree от treeyard ничего нет — убирать нечего')}\n`);
  for (const { item, result, error } of done) {
    if (result === 'removed') process.stdout.write(row(out.c('#7ee2a8', '✓'), item));
    else if (result === 'manual')
      process.stdout.write(
        `${out.dim('·')} ${t('хуки лежат внутри репозитория ({file}) — убери строку treeyard hook post-commit из post-commit сам', { file: homeShort(item.path) })}\n`,
      );
    else process.stdout.write(`${out.c('#ff8a8a', '✗')} ${what(item)}  ${homeShort(item.path)} — ${error ?? ''}\n`);
  }
  stays();
  process.stdout.write(
    `${out.dim(t('сам treeyard: npm uninstall -g @antondanv/treeyard — пока он стоит, команда в папке с деревом снова поставит скиллы (не ставить: treeyard config skills off)'))}\n`,
  );
  return done.some((item) => item.result === 'failed') ? 1 : 0;
}

/** Git's merge driver for `.tree/README.md` (`.tree/.gitattributes`): `merge-overview %O %A %B`. */
async function mergeOverviewCommand(args: string[]): Promise<number> {
  const [base, ours, theirs, ...extra] = args;
  if (!base || !ours || !theirs || extra.length) throw new UsageError('treeyard merge-overview <base> <ours> <theirs>');
  const { runMergeDriver } = await import('../model/overview-merge.js');
  return runMergeDriver(base, ours, theirs);
}

/** Stdin as text, given a moment: Claude Code writes it at once and closes it; a terminal has nothing. */
function readHookStdin(waitMs = 1000): Promise<string> {
  if (process.stdin.isTTY) return Promise.resolve('');
  return new Promise((done) => {
    const chunks: Buffer[] = [];
    const finish = () => {
      clearTimeout(timer);
      process.stdin.removeAllListeners();
      process.stdin.pause();
      done(Buffer.concat(chunks).toString('utf8'));
    };
    const timer = setTimeout(finish, waitMs);
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
  });
}

/**
 * The Claude Code hooks that hand waiting letters to a session with a prompt or between tool calls
 * (agents/turn-hook.ts): `install | remove | status` are the person's; `mail` is what Claude Code runs.
 */
async function claudeHookCommand(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, { user: { type: 'boolean' } });
  const [action, ...extra] = positionals;
  if (action === 'mail' && !extra.length) {
    // Whatever goes wrong, the prompt or tool call goes on.
    try {
      await deliverMidTurn(process.env, parseHookInput(await readHookStdin()));
    } catch {
      // A letter that could not be printed stays queued for the next delivery attempt.
    }
    return 0;
  }
  if (!['install', 'remove', 'status'].includes(action ?? '') || extra.length)
    throw new UsageError(t('treeyard hook claude install | remove | status [--user]'));
  const dir = projectDir();
  const scope = values.user ? 'user' : 'project';
  const where = (file: string) => homeShort(file);
  if (action === 'status') {
    const places = mailHookPlaces(dir);
    for (const place of places) {
      const file = where(place.file);
      const label = place.scope === 'project' ? t('в проекте') : t('у тебя');
      const state = place.needsUpdate
        ? t('обновить хук в {file} — treeyard hook claude install{p1}', {
            file,
            p1: place.scope === 'user' ? ' --user' : '',
          })
        : place.installed
          ? t('хук стоит: {file}', { file })
          : t('хука нет: {file}', { file });
      process.stdout.write(`${label}: ${state}\n`);
    }
    if (!places.some((place) => place.installed))
      process.stdout.write(
        `${t('поставить — treeyard hook claude install (только для проекта) или с --user (для всех проектов)')}\n`,
      );
    return 0;
  }
  const result = action === 'install' ? installMailHook(scope, dir) : removeMailHook(scope, dir);
  const file = where(result.file);
  const text = {
    installed: t('хук поставлен: {file}', { file }),
    updated: t('хук обновлён: {file}', { file }),
    already: t('хук уже стоит: {file}', { file }),
    removed: t('хук убран: {file}', { file }),
    absent: t('хука нет: {file}', { file }),
  }[result.kind];
  process.stdout.write(`${text}\n`);
  if (action === 'install' && result.kind !== 'already')
    process.stdout.write(
      `${t('сессии Claude Code из узлов получат письма вместе с запросом и посреди хода. Убрать оба хука — treeyard hook claude remove{p1}', { p1: scope === 'user' ? ' --user' : '' })}\n`,
    );
  return 0;
}

/**
 * The Codex hooks that hand waiting letters to a session with a prompt or between tool calls
 * (agents/codex-hook.ts): `install | remove | status` are the person's; `mail` is what Codex runs.
 */
async function codexHookCommand(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, { user: { type: 'boolean' } });
  const [action, ...extra] = positionals;
  if (action === 'mail' && !extra.length) {
    try {
      await deliverCodexMidTurn(process.env, parseHookInput(await readHookStdin()));
    } catch {
      // A letter that could not be printed stays queued for the next delivery attempt.
    }
    return 0;
  }
  if (!['install', 'remove', 'status'].includes(action ?? '') || extra.length)
    throw new UsageError(t('treeyard hook codex install | remove | status [--user]'));
  const dir = projectDir();
  const scope = values.user ? 'user' : 'project';
  const where = (file: string) => homeShort(file);
  if (action === 'status') {
    const places = codexMailHookPlaces(dir);
    for (const place of places) {
      const file = where(place.file);
      const label = place.scope === 'project' ? t('в проекте') : t('у тебя');
      const state = place.needsUpdate
        ? t('обновить хук в {file} — treeyard hook codex install{p1}', {
            file,
            p1: place.scope === 'user' ? ' --user' : '',
          })
        : place.installed
          ? t('хук стоит: {file}', { file })
          : t('хука нет: {file}', { file });
      process.stdout.write(`${label}: ${state}\n`);
    }
    if (!places.some((place) => place.installed))
      process.stdout.write(
        `${t('поставить — treeyard hook codex install (только для проекта) или с --user (для всех проектов и worktree)')}\n`,
      );
    return 0;
  }
  const result = action === 'install' ? installCodexMailHook(scope, dir) : removeCodexMailHook(scope, dir);
  const file = where(result.file);
  const text = {
    installed: t('хук поставлен: {file}', { file }),
    updated: t('хук обновлён: {file}', { file }),
    already: t('хук уже стоит: {file}', { file }),
    removed: t('хук убран: {file}', { file }),
    absent: t('хука нет: {file}', { file }),
  }[result.kind];
  process.stdout.write(`${text}\n`);
  if (action === 'install' && result.kind !== 'already')
    process.stdout.write(
      `${t('сессии Codex из узлов получат письма вместе с запросом и посреди хода после одобрения хука в Codex (при старте сессии или /hooks). Убрать оба хука — treeyard hook codex remove{p1}', { p1: scope === 'user' ? ' --user' : '' })}\n`,
    );
  return 0;
}

/**
 * The Antigravity hook that hands waiting letters to a session before each model call
 * (agents/agy-hook.ts): `install | remove | status` are the person's; `mail` is what Antigravity runs.
 */
async function agyHookCommand(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, { user: { type: 'boolean' } });
  const [action, ...extra] = positionals;
  if (action === 'mail' && !extra.length) {
    try {
      await deliverAgyMidTurn(process.env, parseAgyHookInput(await readHookStdin()));
    } catch {
      // A letter that could not be printed stays queued for the next delivery attempt.
    }
    return 0;
  }
  if (!['install', 'remove', 'status'].includes(action ?? '') || extra.length)
    throw new UsageError(t('treeyard hook antigravity install | remove | status [--user]'));
  const dir = projectDir();
  const scope = values.user ? 'user' : 'project';
  const where = (file: string) => homeShort(file);
  if (action === 'status') {
    const places = agyMailHookPlaces(dir);
    for (const place of places) {
      const file = where(place.file);
      const label = place.scope === 'project' ? t('в проекте') : t('у тебя');
      const state = place.needsUpdate
        ? t('обновить хук в {file} — treeyard hook antigravity install{p1}', {
            file,
            p1: place.scope === 'user' ? ' --user' : '',
          })
        : place.installed
          ? t('хук стоит: {file}', { file })
          : t('хука нет: {file}', { file });
      process.stdout.write(`${label}: ${state}\n`);
    }
    if (!places.some((place) => place.installed))
      process.stdout.write(
        `${t('поставить — treeyard hook antigravity install (только для проекта) или с --user (для всех проектов и worktree)')}\n`,
      );
    return 0;
  }
  const result = action === 'install' ? installAgyMailHook(scope, dir) : removeAgyMailHook(scope, dir);
  const file = where(result.file);
  const text = {
    installed: t('хук поставлен: {file}', { file }),
    updated: t('хук обновлён: {file}', { file }),
    already: t('хук уже стоит: {file}', { file }),
    removed: t('хук убран: {file}', { file }),
    absent: t('хука нет: {file}', { file }),
  }[result.kind];
  process.stdout.write(`${text}\n`);
  if (action === 'install' && result.kind !== 'already')
    process.stdout.write(
      `${t('сессии Antigravity из узлов получат письма вместе с запросом и посреди хода. Убрать хук — treeyard hook antigravity remove{p1}', { p1: scope === 'user' ? ' --user' : '' })}\n`,
    );
  return 0;
}

/**
 * The OpenCode plugin that hands waiting letters to a session with a prompt or after a tool call
 * (agents/opencode-plugin.ts): `install | remove | status` are the person's; `mail` is what the plugin runs.
 */
async function opencodeHookCommand(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, { user: { type: 'boolean' } });
  const [action, ...extra] = positionals;
  if (action === 'mail' && !extra.length) {
    try {
      await deliverOpencodeMidTurn(process.env, parseOpencodeHookInput(await readHookStdin()));
    } catch {
      // A letter that could not be printed stays queued for the next delivery attempt.
    }
    return 0;
  }
  if (!['install', 'remove', 'status'].includes(action ?? '') || extra.length)
    throw new UsageError(t('treeyard hook opencode install | remove | status [--user]'));
  const dir = projectDir();
  const scope = values.user ? 'user' : 'project';
  const where = (file: string) => homeShort(file);
  if (action === 'status') {
    const places = opencodeMailHookPlaces(dir);
    for (const place of places) {
      const file = where(place.file);
      const label = place.scope === 'project' ? t('в проекте') : t('у тебя');
      const state = place.needsUpdate
        ? t('обновить плагин в {file} — treeyard hook opencode install{p1}', {
            file,
            p1: place.scope === 'user' ? ' --user' : '',
          })
        : place.installed
          ? t('плагин стоит: {file}', { file })
          : t('плагина нет: {file}', { file });
      process.stdout.write(`${label}: ${state}\n`);
    }
    if (!places.some((place) => place.installed))
      process.stdout.write(
        `${t('поставить — treeyard hook opencode install (только для проекта) или с --user (для всех проектов и worktree)')}\n`,
      );
    return 0;
  }
  const result = action === 'install' ? installOpencodeMailPlugin(scope, dir) : removeOpencodeMailPlugin(scope, dir);
  const file = where(result.file);
  const text = {
    installed: t('плагин поставлен: {file}', { file }),
    updated: t('плагин обновлён: {file}', { file }),
    already: t('плагин уже стоит: {file}', { file }),
    removed: t('плагин убран: {file}', { file }),
    absent: t('плагина нет: {file}', { file }),
  }[result.kind];
  process.stdout.write(`${text}\n`);
  if (action === 'install' && result.kind !== 'already')
    process.stdout.write(
      `${t('сессии OpenCode из узлов получат письма вместе с запросом и посреди хода. Убрать плагин — treeyard hook opencode remove{p1}', { p1: scope === 'user' ? ' --user' : '' })}\n`,
    );
  return 0;
}

/** The post-commit hook: installed by a person, run by git (`post-commit`) after each commit. */
function hookCommand(args: string[]): number | Promise<number> {
  const [action, ...extra] = args;
  if (action === 'claude') return claudeHookCommand(extra);
  if (action === 'codex') return codexHookCommand(extra);
  if (action === 'antigravity' || action === 'agy') return agyHookCommand(extra);
  if (action === 'opencode') return opencodeHookCommand(extra);
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
  const brain = brainArg(values.brain, defaultBrain(tree.project.brain));
  const task = await taskArg(values.task);
  const plan = sessionPlan(
    tree,
    id,
    startArg(values.start, tree.project.start ?? 'plan'),
    brain,
    task,
    senderNode(tree),
  );
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
    'no-worktree': { type: 'boolean' },
    task: { type: 'string' },
    yes: { type: 'boolean', short: 'y' },
    json: { type: 'boolean' },
  });
  const tree = project();
  // Every id is checked before the first launch: a typo must not leave half the nodes started.
  const ids = positionals.length ? [...new Set(positionals.map((p) => nodeArg(tree, p)))] : [nodeArg(tree, undefined)];
  const id = ids[0]!;
  const brain = brainArg(values.brain, defaultBrain(tree.project.brain));
  if (values.pane && values.bg) throw new UsageError(t('выбери одно: --pane или --bg'));
  // Sessions in this terminal hold it one after another; only a pane or the background returns at once.
  if (ids.length > 1 && !values.bg && !values.pane)
    throw new UsageError(t('несколько узлов — только с --pane или --bg: treeyard open <id> <id>… --pane|--bg'));
  // In this terminal the CLI owns stdout; only a pane or the background returns at once with something to print.
  if (values.json && !values.pane && !values.bg)
    throw new UsageError(t('--json — только с --pane или --bg: treeyard open <id> --pane|--bg --json'));
  const task = await taskArg(values.task);
  const options = {
    brain,
    start: startArg(values.start, tree.project.start ?? 'plan'),
    ...(values.bg ? { background: true } : {}),
    ...(values.pane ? { pane: true } : {}),
    ...(values.model ? { model: values.model } : {}),
    ...(values.effort ? { effort: values.effort } : {}),
    ...worktreeOption(values),
    ...(task ? { task } : {}),
  };
  // Rights before the confirmation, and even with --yes: --yes skips a question, it does not grant access.
  if (!(await chooseAccess(brain))) return 0;
  if (settings().confirm && !values.yes && process.stdin.isTTY) {
    const titles = ids.map((each) => holderOf(tree, each)!.title);
    const plan = sessionPlan(tree, id, options.start, brain, task);
    const labels = [ids.length > 1 ? t('Узлы') : t('Узел'), t('Кто'), t('Как начать'), t('Права'), 'Worktree'];
    const where = worktreeRow(tree, ids, options.worktree);
    // Padded to the longest label, so the columns line up in either language.
    const width = Math.max(...labels.map((label) => label.length)) + 2;
    const row = (label: string, text: string) => `  ${err.dim(label)}${' '.repeat(width - label.length)}${text}\n`;
    process.stderr.write(
      `\n${inlineMark(err.c)}\n` +
        row(labels[0]!, titles.join(`\n  ${' '.repeat(width)}`)) +
        row(
          labels[1]!,
          `${BRAIN_LABEL[brain]} · ${options.background ? t('в фоне, сам по себе') : options.pane ? t('в панели') : t('в этом терминале')}`,
        ) +
        row(
          labels[2]!,
          `${(id === ROOT ? ROOT_START_LABEL : START_LABEL)[plan.start]} — ${(id === ROOT ? ROOT_START_HINT : START_HINT)[plan.start]}`,
        ) +
        row(labels[3]!, accessText(brain, plan.permissionMode)) +
        (where ? row(labels[4]!, where) : '') +
        '\n',
    );
    if (!(await askYes(ids.length > 1 ? t('Запустить сессии: {n}?', { n: ids.length }) : t('Запустить сессию?')))) {
      process.stderr.write(`${err.dim(t('не запускаю'))}\n`);
      return 0;
    }
  }
  if (options.pane) {
    // Named as typed, not as resolved: a program that passed a list gets a list back.
    if (positionals.length > 1) return openInPanes(tree, ids, options, values.json === true);
    const { pane, ref, warnings } = await launchInPane(tree, id, options, paneSize());
    if (values.json) {
      process.stdout.write(`${JSON.stringify(startedPane(id, brain, ref, pane, warnings), null, 2)}\n`);
      return 0;
    }
    for (const warning of warnings) process.stderr.write(`! ${warning}\n`);
    process.stdout.write(t('сессия запущена в панели {pane} · открой treeyard, чтобы увидеть её\n', { pane }));
    return 0;
  }
  // Named as typed, as with panes: one id gets an object, a list gets an array.
  if (options.background) return openInBackground(tree, ids, options, values.json ? positionals.length > 1 : null);
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

/** What the confirmation says about worktrees; nothing when the session starts in the project's folder as always. */
function worktreeRow(tree: Tree, ids: string[], want: WorktreeWish | undefined): string | undefined {
  if (want === false) return undefined;
  if (want === true) return t('свой git worktree и ветка treeyard/<id> у каждого узла');
  if (ids.length > 1) return t('первый узел — в папке проекта, остальные — каждый в своём git worktree');
  const wt = worktreeFor(tree.project.dir, ids[0]!);
  return wt ? t('в worktree узла, ветка {branch}', { branch: wt.branch }) : undefined;
}

const paneSize = () => ({
  width: process.stdout.columns || 100,
  height: Math.max(5, (process.stdout.rows || 30) - 6),
});

/**
 * What `open --pane --json` says of a node: the pane to attach to. Codex, Antigravity and OpenCode
 * name the session once it has started, so `id` is null until then and `treeyard sessions --json`
 * finds it by this pane. A pane that did not start has `error` and nulls instead.
 */
function startedPane(
  node: string,
  brain: BrainId,
  ref: SessionRef,
  pane: string,
  warnings: string[],
): Record<string, unknown> {
  return { node, brain, id: isPending(ref) ? null : ref.id, pane, startedAt: ref.started, warnings };
}

/**
 * `open <id>… --pane`: a pane in each node, one after another. A pane that did not start is a line
 * on stderr and the rest go on. With `--json` stdout is one array, a failed node in it too, so a
 * program learns what did start whatever happened to the others.
 */
export async function openInPanes(
  tree: Tree,
  ids: string[],
  options: LaunchOptions,
  json: boolean,
  launchPane: typeof launchInPane = launchInPane,
): Promise<number> {
  const rows: Record<string, unknown>[] = [];
  const size = paneSize();
  const flags = togetherWorktrees(ids.length, options.worktree);
  let failed = 0;
  for (const [at, id] of ids.entries()) {
    const title = holderOf(tree, id)!.title;
    try {
      const { pane, ref, warnings } = await launchPane(tree, id, withWorktree(options, flags[at]), size);
      rows.push(startedPane(id, options.brain, ref, pane, warnings));
      if (json) continue;
      for (const warning of warnings) process.stderr.write(`${err.c('#ffcf70', '!')} ${warning}\n`);
      process.stdout.write(`${out.c('#7ee2a8', '✓')} ${id}  ${title} · ${t('панель {pane}', { pane })}\n`);
    } catch (error) {
      failed++;
      const why = (error as Error).message ?? String(error);
      rows.push({ node: id, brain: options.brain, id: null, pane: null, startedAt: null, warnings: [], error: why });
      process.stderr.write(`${err.c('#ff7b72', '✗')} ${id}  ${title} · ${why}\n`);
    }
  }
  if (json) process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
  return failed ? 1 : 0;
}

/** The options of one node among several: its own worktree choice replaces the one for all of them. */
function withWorktree(options: LaunchOptions, worktree: WorktreeWish | undefined): LaunchOptions {
  const { worktree: _all, ...rest } = options;
  return worktree === undefined ? rest : { ...rest, worktree };
}

/**
 * What `open --bg --json` says of a node: the session it started. A session that did not start has
 * `error` and nulls instead (see `openInBackground`).
 */
function startedBackground(node: string, brain: BrainId, ref: SessionRef, warnings: string[]): Record<string, unknown> {
  return { node, brain, id: ref.id, startedAt: ref.started, warnings };
}

/**
 * `open <id>… --bg`: a background session in each node, one after another, and a line on stdout
 * as each starts — what a coordinator reads back. A session that did not start is a line on
 * stderr and the rest go on; a throw is the setup itself (this CLI has no `--bg`), so it stops
 * the run, and the lines already printed stay true. `list` set means `--json`: stdout is then only
 * the JSON (an array when `list`, else the one node's object), a failed node in it too.
 */
async function openInBackground(
  tree: Tree,
  ids: string[],
  options: LaunchOptions,
  list: boolean | null = null,
): Promise<number> {
  const json = list !== null;
  const rows: Record<string, unknown>[] = [];
  const flags = togetherWorktrees(ids.length, options.worktree);
  let failed = 0;
  for (const [at, id] of ids.entries()) {
    const title = holderOf(tree, id)!.title;
    const { result, ref } = await launch(tree, id, withWorktree(options, flags[at]));
    if (!json) for (const warning of result.warnings) process.stderr.write(`${err.c('#ffcf70', '!')} ${warning}\n`);
    if (result.error || !ref) {
      failed++;
      const why =
        result.error?.message ??
        t('сессия запущена ({short}), но её id не нашёлся — в узле не сохранена', { short: result.shortId ?? '?' });
      rows.push({ node: id, brain: options.brain, id: null, startedAt: null, warnings: result.warnings, error: why });
      process.stderr.write(`${err.c('#ff7b72', '✗')} ${id}  ${title} · ${why}\n`);
      continue;
    }
    rows.push(startedBackground(id, options.brain, ref, result.warnings));
    if (!json)
      process.stdout.write(
        `${out.c('#7ee2a8', '✓')} ${id}  ${title} · ${t('сессия {session}', { session: ref.id })}\n`,
      );
  }
  if (json) process.stdout.write(`${JSON.stringify(list ? rows : rows[0], null, 2)}\n`);
  return failed ? 1 : 0;
}

interface WorktreeRmRow {
  node: string;
  title: string | null;
  branch: string | null;
  path: string | null;
  status: 'removed' | 'would_remove' | 'kept';
  attached?: number;
  reasons?: string[];
}

function worktreeRemovalReasons(
  dir: string,
  wt: NodeWorktree,
  panes: ReadonlyArray<{ pane: string; cwd?: string }>,
): string[] {
  const busy = panes
    .filter((pane) => pane.cwd && insideFolder(pane.cwd, wt.path))
    .map((pane) => t('в worktree открыта сессия в панели {pane} — закрой её', { pane: pane.pane }));
  return [...busy, ...blockers(worktreeState(dir, wt))];
}

/**
 * `treeyard worktree [add|setup <id> | rm <id>…|--done [--dry-run]]`: the git worktrees of the nodes.
 * Bare — the list with what each holds; `add` makes one (the branch `treeyard/<id>`, the copy by
 * `.worktreeinclude`, the project's `setup`); `setup` prepares a standing one again; `rm` removes one,
 * several, or (`--done`) all closed nodes' clean, merged worktrees — never while anything is uncommitted,
 * unmerged or a pane is open there.
 */
async function worktreeCommand(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {
    json: { type: 'boolean' },
    done: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
  });
  const usage = t('treeyard worktree [add|setup <id> | rm <id>…|--done [--dry-run]] [--json]');
  const first = positionals[0];
  const action = first === 'add' || first === 'setup' || first === 'rm' || first === 'list' ? first : undefined;
  const rest = action ? positionals.slice(1) : positionals;
  const tree = project();
  const dir = tree.project.dir;
  const json = values.json === true;
  const doneOnly = values.done === true;
  const dryRun = values['dry-run'] === true;
  const titleOf = (id: string) => tree.nodes.get(id)?.title ?? id;
  if (action !== 'rm' && (doneOnly || dryRun)) throw new UsageError(usage);
  if (!action || action === 'list') {
    const only = rest.map((id) => nodeArg(tree, id));
    const list = worktreesOf(dir).filter((wt) => !only.length || only.includes(wt.id));
    const rows = list.map((wt) => ({ wt, state: worktreeState(dir, wt) }));
    if (json) {
      const data = rows.map(({ wt, state }) => ({
        node: wt.id,
        title: titleOf(wt.id),
        path: wt.dir,
        branch: wt.branch,
        base: wt.base,
        commits: state.commits,
        unmerged: state.unmerged,
        dirty: state.dirty,
      }));
      process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
      return 0;
    }
    if (!rows.length) {
      const none = t('worktree у узлов нет — treeyard open <id> --worktree или treeyard worktree add <id>');
      process.stdout.write(`${out.dim(none)}\n`);
      return 0;
    }
    for (const { wt, state } of rows)
      process.stdout.write(
        `${wt.id}  ${titleOf(wt.id)}\n  ${shortPath(wt.dir)} ${out.dim(`· ${wt.branch} · ${stateText(state)}`)}\n`,
      );
    return 0;
  }
  if (action === 'add' || action === 'setup') {
    if (rest.length !== 1) throw new UsageError(usage);
    const id = nodeArg(tree, rest[0]);
    if (id === ROOT) throw new UsageError(t('worktree заводят узлу, а не корню — {usage}', { usage }));
    const prepared = action === 'add' ? await ensureWorktree(tree, id) : await prepareAgain(tree, id);
    const wt = prepared.worktree;
    if (json) {
      const data = {
        node: id,
        path: wt.dir,
        branch: wt.branch,
        base: wt.base,
        created: prepared.created,
        copied: prepared.copied,
        warnings: prepared.warnings,
      };
      process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
      return 0;
    }
    for (const warning of prepared.warnings) process.stderr.write(`${err.c('#ffcf70', '!')} ${warning}\n`);
    const what = prepared.created ? t('заведён') : action === 'setup' ? t('подготовлен заново') : t('уже стоит');
    process.stdout.write(
      `${out.c('#7ee2a8', '✓')} ${id}  ${titleOf(id)} · worktree ${what}\n  ${shortPath(wt.dir)} ${out.dim(`· ${wt.branch}`)}\n`,
    );
    if (prepared.copied)
      process.stdout.write(`  ${out.dim(t('скопировано файлов по .worktreeinclude: {n}', { n: prepared.copied }))}\n`);
    return 0;
  }
  // rm
  if (doneOnly && rest.length > 0) throw new UsageError(t('выбери одно: id узлов или --done'));
  if (!doneOnly && rest.length === 0) throw new UsageError(usage);

  if (doneOnly) {
    const list = closedWorktrees(tree);
    if (!list.length) {
      if (json) process.stdout.write('[]\n');
      else process.stdout.write(`${out.dim(t('закрытых узлов с worktree нет'))}\n`);
      return 0;
    }
    const panes = await readPanes().catch(() => []);
    const rows: WorktreeRmRow[] = [];
    let removedCount = 0;
    let keptCount = 0;
    let gitFailed = 0;
    for (const wt of list) {
      const id = wt.id;
      const title = titleOf(id);
      const reasons = worktreeRemovalReasons(dir, wt, panes);
      if (reasons.length) {
        keptCount++;
        rows.push({ node: id, title, branch: wt.branch, path: wt.dir, status: 'kept', reasons });
        if (!json) {
          const why = reasons.join('; ');
          const label = dryRun ? t('оставит: {why}', { why }) : t('оставлен: {why}', { why });
          process.stdout.write(`${out.c('#ffcf70', '·')} ${id}  ${title} · ${label}\n`);
        }
        continue;
      }
      if (dryRun) {
        removedCount++;
        rows.push({ node: id, title, branch: wt.branch, path: wt.dir, status: 'would_remove' });
        if (!json)
          process.stdout.write(
            `${out.dim('·')} ${id}  ${title} · ${t('уберёт worktree, ветка {branch}', { branch: wt.branch })}\n`,
          );
        continue;
      }
      try {
        const removed = removeWorktree(tree, id);
        removedCount++;
        rows.push({
          node: id,
          title,
          branch: removed.worktree.branch,
          path: removed.worktree.dir,
          status: 'removed',
          attached: removed.attached,
        });
        if (!json) {
          const done = t('worktree убран, ветка {branch} удалена', { branch: removed.worktree.branch });
          const extra = removed.attached ? ` · ${t('коммитов у узла: {n}', { n: removed.attached })}` : '';
          process.stdout.write(`${out.c('#7ee2a8', '✓')} ${id}  ${title} · ${done}${extra}\n`);
        }
      } catch (error) {
        if (!(error instanceof WorktreeBusy)) throw error;
        keptCount++;
        gitFailed++;
        rows.push({ node: id, title, branch: wt.branch, path: wt.dir, status: 'kept', reasons: error.reasons });
        if (!json)
          process.stdout.write(
            `${out.c('#ffcf70', '·')} ${id}  ${title} · ${t('оставлен: {why}', { why: error.reasons.join('; ') })}\n`,
          );
      }
    }
    if (json) {
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    } else {
      const summary = dryRun
        ? t('уберёт: {removed} · оставит: {kept}', { removed: removedCount, kept: keptCount })
        : t('убрано: {removed} · оставлено: {kept}', { removed: removedCount, kept: keptCount });
      process.stdout.write(`${out.dim(summary)}\n`);
    }
    return gitFailed ? 1 : 0;
  }

  if (rest.length === 1) {
    const id = nodeArg(tree, rest[0]);
    if (id === ROOT) throw new UsageError(t('worktree заводят узлу, а не корню — {usage}', { usage }));
    const wt = worktreeFor(dir, id);
    if (!wt) throw new UsageError(t('у узла «{title}» нет worktree', { title: titleOf(id) }));
    const refuse = (reasons: string[]): number => {
      if (json) {
        const row: WorktreeRmRow = {
          node: id,
          title: titleOf(id),
          branch: wt.branch,
          path: wt.dir,
          status: 'kept',
          reasons,
        };
        process.stdout.write(`${JSON.stringify(row, null, 2)}\n`);
        return 1;
      }
      const hint = t('закоммить и влей ветку {branch} в ветку основной папки — тогда worktree уберётся', {
        branch: wt.branch,
      });
      const head = t('не убираю worktree узла «{title}»', { title: titleOf(id) });
      process.stderr.write(
        `${err.c('#ff7b72', '✗')} ${head}\n${reasons.map((reason) => `  - ${reason}`).join('\n')}\n${err.dim(hint)}\n`,
      );
      return 1;
    };
    const panes = await readPanes().catch(() => []);
    const reasons = worktreeRemovalReasons(dir, wt, panes);
    if (reasons.length) return refuse(reasons);
    if (dryRun) {
      if (json) {
        const row: WorktreeRmRow = {
          node: id,
          title: titleOf(id),
          branch: wt.branch,
          path: wt.dir,
          status: 'would_remove',
        };
        process.stdout.write(`${JSON.stringify(row, null, 2)}\n`);
      } else {
        process.stdout.write(
          `${out.dim('·')} ${id}  ${titleOf(id)} · ${t('уберёт worktree, ветка {branch}', { branch: wt.branch })}\n`,
        );
      }
      return 0;
    }
    try {
      const removed = removeWorktree(tree, id);
      if (json) {
        const row: WorktreeRmRow = {
          node: id,
          title: titleOf(id),
          branch: removed.worktree.branch,
          path: removed.worktree.dir,
          status: 'removed',
          attached: removed.attached,
        };
        process.stdout.write(`${JSON.stringify(row, null, 2)}\n`);
        return 0;
      }
      const done = t('worktree убран, ветка {branch} удалена', { branch: removed.worktree.branch });
      process.stdout.write(`${out.c('#7ee2a8', '✓')} ${id}  ${titleOf(id)} · ${done}\n`);
      if (removed.attached)
        process.stdout.write(`  ${out.dim(t('коммиты ветки остались у узла: {n}', { n: removed.attached }))}\n`);
      return 0;
    } catch (error) {
      if (error instanceof WorktreeBusy) return refuse(error.reasons);
      throw error;
    }
  }

  // Several explicit ids: a line per node, one refusal does not stop the rest, exit 1 if any failed.
  const panes = await readPanes().catch(() => []);
  const seen = new Set<string>();
  const rows: WorktreeRmRow[] = [];
  let failed = 0;
  for (const raw of rest) {
    let id: string;
    try {
      id = nodeArg(tree, raw);
    } catch (error) {
      failed++;
      const reason = (error as Error).message;
      rows.push({ node: raw, title: null, branch: null, path: null, status: 'kept', reasons: [reason] });
      if (!json) process.stderr.write(`${err.c('#ff7b72', '✗')} ${raw} · ${reason}\n`);
      continue;
    }
    if (id === ROOT) {
      failed++;
      const reason = t('у корня нет worktree');
      rows.push({ node: id, title: tree.project.title, branch: null, path: null, status: 'kept', reasons: [reason] });
      if (!json) process.stderr.write(`${err.c('#ff7b72', '✗')} ${id}  ${tree.project.title} · ${reason}\n`);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const title = titleOf(id);
    const wt = worktreeFor(dir, id);
    if (!wt) {
      failed++;
      const reason = t('у узла нет worktree');
      rows.push({ node: id, title, branch: null, path: null, status: 'kept', reasons: [reason] });
      if (!json) process.stderr.write(`${err.c('#ff7b72', '✗')} ${id}  ${title} · ${reason}\n`);
      continue;
    }
    const reasons = worktreeRemovalReasons(dir, wt, panes);
    if (reasons.length) {
      failed++;
      rows.push({ node: id, title, branch: wt.branch, path: wt.dir, status: 'kept', reasons });
      if (!json) process.stderr.write(`${err.c('#ff7b72', '✗')} ${id}  ${title} · ${reasons.join('; ')}\n`);
      continue;
    }
    if (dryRun) {
      rows.push({ node: id, title, branch: wt.branch, path: wt.dir, status: 'would_remove' });
      if (!json)
        process.stdout.write(
          `${out.dim('·')} ${id}  ${title} · ${t('уберёт worktree, ветка {branch}', { branch: wt.branch })}\n`,
        );
      continue;
    }
    try {
      const removed = removeWorktree(tree, id);
      rows.push({
        node: id,
        title,
        branch: removed.worktree.branch,
        path: removed.worktree.dir,
        status: 'removed',
        attached: removed.attached,
      });
      if (!json) {
        const done = t('worktree убран, ветка {branch} удалена', { branch: removed.worktree.branch });
        const extra = removed.attached ? ` · ${t('коммитов у узла: {n}', { n: removed.attached })}` : '';
        process.stdout.write(`${out.c('#7ee2a8', '✓')} ${id}  ${title} · ${done}${extra}\n`);
      }
    } catch (error) {
      if (!(error instanceof WorktreeBusy)) throw error;
      failed++;
      rows.push({ node: id, title, branch: wt.branch, path: wt.dir, status: 'kept', reasons: error.reasons });
      if (!json) process.stderr.write(`${err.c('#ff7b72', '✗')} ${id}  ${title} · ${error.reasons.join('; ')}\n`);
    }
  }
  if (json) process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
  return failed ? 1 : 0;
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

export async function sleepCommand(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {
    force: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    project: { type: 'string' },
  });
  if (positionals.length === 0) {
    throw new UsageError(t('укажи узел: treeyard sleep <id> [<id>…]'));
  }
  const tree = project(values.project);
  const results = await sleepNodePanes(tree, positionals, { force: values.force });
  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed++;
    if (values.json) continue;
    if (r.ok) {
      if (r.status === 'slept') {
        process.stdout.write(`${out.c('#7ee2a8', '✓')} ${r.node}  ${r.title} · ${r.message}\n`);
      } else {
        process.stdout.write(`${out.dim('·')} ${r.node}  ${r.title} · ${r.message}\n`);
      }
    } else {
      process.stderr.write(`${err.c('#ff7b72', '✗')} ${r.node}  ${r.title ? `${r.title} · ` : ''}${r.error}\n`);
    }
  }
  if (values.json) {
    const data = positionals.length === 1 ? results[0] : results;
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  }
  return failed ? 1 : 0;
}

function parseLines(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0 || String(n) !== raw.trim()) {
    throw new UsageError(t('--lines — положительное целое число'));
  }
  return n;
}

export async function peekCommand(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {
    lines: { type: 'string' },
    json: { type: 'boolean', default: false },
    project: { type: 'string' },
  });
  if (positionals.length === 0) {
    throw new UsageError(t('укажи узел: treeyard peek <id> [--lines N] [--json]'));
  }
  if (positionals.length > 1) {
    throw new UsageError(t('укажи один узел: treeyard peek <id> [--lines N] [--json]'));
  }
  const lines = parseLines(values.lines);
  const tree = project(values.project);
  const result = await peekNodePane(tree, positionals[0]!, {
    ...(lines !== undefined ? { lines } : {}),
  });

  if (values.json) {
    process.stdout.write(`${JSON.stringify(peekJson(result), null, 2)}\n`);
    return result.ok ? 0 : 1;
  }

  if (!result.ok) {
    process.stderr.write(`${err.c('#ff7b72', '✗')} ${result.error}\n`);
    return 1;
  }

  process.stdout.write(peekText(result, out));
  return 0;
}

export async function modelsCommand(
  args: string[],
  overrides?: { modelsFn?: (brain: BrainId) => Promise<Catalog> },
): Promise<number> {
  const { values, positionals } = parse(args, {
    json: { type: 'boolean', default: false },
    brain: { type: 'string' },
  });
  if (positionals.length > 1) {
    throw new UsageError(t('treeyard models [brain] [--json]'));
  }
  const brainTarget = positionals[0] ?? values.brain;
  const brain = brainTarget ? parseBrain(brainTarget) : undefined;
  const brains = brain ? [brain] : BRAIN_IDS;
  const results = await fetchCatalogs(brains, overrides?.modelsFn);

  if (values.json) {
    if (brain) {
      const single = results[0]!;
      const data = single.catalog ?? { brain: single.brain, error: single.error, models: [] };
      process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    } else {
      const data = results.map((r) => r.catalog ?? { brain: r.brain, error: r.error, models: [] });
      process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    }
  } else {
    process.stdout.write(`${modelsText(results, out)}\n`);
  }
  return 0;
}

export async function limitsCommand(
  args: string[],
  overrides?: {
    usageFn?: (options: { brains: BrainId[]; limit: number; offline: boolean }) => Promise<UsageReport>;
    now?: number;
  },
): Promise<number> {
  const { values, positionals } = parse(args, {
    json: { type: 'boolean', default: false },
    brain: { type: 'string' },
  });
  if (positionals.length > 1) {
    throw new UsageError(t('treeyard limits [brain] [--json]'));
  }
  const brainTarget = positionals[0] ?? values.brain;
  const brain = brainTarget ? parseBrain(brainTarget) : undefined;
  const brains = brain ? [brain] : BRAIN_IDS;
  const report = await fetchLimits(brains, overrides?.usageFn);
  const now = overrides?.now ?? Date.now();
  report.brains = settleExpired(report.brains, now);

  if (values.json) {
    if (brain) {
      const single = report.brains.find((b) => b.brain === brain) ?? report.brains[0];
      process.stdout.write(`${JSON.stringify(single, null, 2)}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(report.brains, null, 2)}\n`);
    }
  } else {
    process.stdout.write(`${limitsText(report.brains, out, now)}\n`);
  }
  return 0;
}

/** «Запустить? [Y/n]» — Enter is yes. */
async function askYes(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise<string>((done) => rl.question(`${question} ${err.dim('[Y/n]')} `, done));
  rl.close();
  return !/^\s*(n|no|н|нет|т)\s*$/i.test(answer);
}

/**
 * Before the first launch of a CLI that treeyard would start with more rights than its own
 * settings give (Antigravity, Codex): the person sees them and picks the wider or the CLI's own
 * way, once. Without a terminal nobody can answer — an agent's `open` stops and says how the
 * person chooses. False — the person did not choose: nothing starts.
 */
async function chooseAccess(brain: BrainId): Promise<boolean> {
  if (!needsAccessChoice(brain)) return true;
  const question = accessQuestion(brain);
  if (!process.stdin.isTTY) throw new UsageError(question.notChosen);
  const [yes, no] = accessChoices(brain) as [AccessChoice, AccessChoice];
  const width = Math.max(ACCESS_LABEL[yes].length, ACCESS_LABEL[no].length) + 2;
  const row = (key: string, access: AccessChoice) =>
    `  ${err.bold(key)}  ${ACCESS_LABEL[access]}${' '.repeat(width - ACCESS_LABEL[access].length)}${err.dim(ACCESS_HINT[access])}\n`;
  process.stderr.write(
    `\n${inlineMark(err.c)}\n` +
      `  ${err.bold(question.title)}\n` +
      `  ${question.intro}\n\n` +
      row('y', yes) +
      row('n', no) +
      `\n  ${err.dim(question.keptInShell)}\n`,
  );
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise<string>((done) =>
    rl.question(`${question.prompt} ${err.dim(question.answers)} `, done),
  );
  rl.close();
  const access: AccessChoice | undefined = /^\s*(y|yes|д|да)\s*$/i.test(answer)
    ? yes
    : /^\s*(n|no|н|нет|т)\s*$/i.test(answer)
      ? no
      : undefined;
  if (!access) {
    process.stderr.write(`${err.dim(t('не запускаю'))}\n`);
    return false;
  }
  updateSettings(accessPatch(brain, access));
  process.stderr.write(`${err.dim(t('{brain}: {access}', { brain: question.name, access: ACCESS_LABEL[access] }))}\n`);
  return true;
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
  'antigravityAccess',
  'codexAccess',
  'skills',
] as const;
/** Keys in settings.json and on the command line, where they differ from the code. */
const SNAKE: Record<string, string> = {
  sleepAfter: 'sleep_after',
  maxPanes: 'max_panes',
  staleAfter: 'stale_after',
  statusOrder: 'status_order',
  antigravityAccess: 'antigravity_access',
  codexAccess: 'codex_access',
};
const PROJECT_KEYS = ['brain', 'start', 'model', 'effort', 'assist_model', 'setup', 'mail_limit'] as const;

/** The project's `mail_limit` as `config` shows it: the number, `off`, or the default marked as one. */
function mailLimitShown(limit: number | undefined): string {
  if (limit === 0) return 'off';
  return limit === undefined ? `${DEFAULT_MAIL_LIMIT} ${out.dim(`(${t('по умолчанию')})`)}` : String(limit);
}

function configCommand(args: string[]): number {
  const [requestedKey, ...rest] = args;
  const key = Object.keys(SNAKE).find((name) => SNAKE[name] === requestedKey) ?? requestedKey;
  const value = rest.join(' ').trim();
  // From a node's worktree — the main tree's settings, not the branch's copy.
  const dir = treeOfWorktree() ?? findProject();
  const tree = dir ? loadTree(dir) : undefined;
  if (!key) {
    process.stdout.write(`${out.bold(t('Для всех проектов'))}  ${out.dim(settingsPath())}\n`);
    for (const name of GLOBAL_KEYS) {
      const label = SNAKE[name] ?? name;
      process.stdout.write(`  ${label.padEnd(18)} ${shown(name)}\n`);
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
        setup: p.setup,
        mail_limit: mailLimitShown(p.mailLimit),
      };
      for (const name of PROJECT_KEYS) process.stdout.write(`  ${name.padEnd(18)} ${values[name] ?? out.dim('—')}\n`);
    }
    process.stdout.write(`\n${out.dim(t('Изменить: treeyard config <ключ> <значение> · в дереве — клавиша «,»'))}\n`);
    return 0;
  }
  function shown(name: (typeof GLOBAL_KEYS)[number]): string {
    const now = settings();
    if (name === 'notes') return now.notes || '—';
    // Not chosen: the first launch of Antigravity asks.
    if (name === 'antigravityAccess') return now.antigravityAccess || 'ask';
    if (name === 'codexAccess') return now.codexAccess || 'ask';
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
    } else if (key === 'antigravityAccess' || key === 'codexAccess') {
      const brain: BrainId = key === 'codexAccess' ? 'codex' : 'antigravity';
      if (value !== 'ask' && !(accessChoices(brain) as readonly string[]).includes(value))
        throw new UsageError(accessQuestion(brain).badValue);
      updateSettings(accessPatch(brain, value === 'ask' ? '' : (value as AccessChoice)));
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
    if (key === 'brain') {
      if (!value) {
        process.stdout.write(`${p.brain ?? out.dim('—')}\n`);
        return 0;
      }
      p.brain = parseBrain(value);
    } else if (key === 'start') p.start = startArg(value, 'plan');
    else if (key === 'model') p.model = value || undefined;
    else if (key === 'effort') p.effort = value || undefined;
    else if (key === 'setup') p.setup = value || undefined;
    else if (key === 'mail_limit') {
      // No value — what it is now; `default` — the default again; off — no brake on letters going round in a circle.
      if (!value) {
        process.stdout.write(`${mailLimitShown(p.mailLimit)}\n`);
        return 0;
      }
      const n = /^(off|none)$/i.test(value) ? 0 : /^default$/i.test(value) ? undefined : Number(value);
      if (n !== undefined && (!Number.isInteger(n) || n < 0))
        throw new UsageError(t('{key}: число писем подряд, off — без тормоза, default — как по умолчанию', { key }));
      p.mailLimit = n;
    } else p.assistModel = value || undefined;
    writeProject(p);
    process.stdout.write(`${key} = ${key === 'mail_limit' ? mailLimitShown(p.mailLimit) : value || '—'}\n`);
    return 0;
  }
  throw new UsageError(t('нет такой настройки «{key}» — treeyard config', { key }));
}

/**
 * The CLI: runs the command and sets the exit code, never throws. Called by `main.ts` only, so
 * importing this module (a test does) runs nothing.
 */
export function run(argv: string[]): void {
  guardCrashes();
  main(argv).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      if (error instanceof CrashReported) {
        process.exitCode = 1;
        return;
      }
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

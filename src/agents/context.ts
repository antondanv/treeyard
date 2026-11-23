/**
 * What an agent gets when a session starts from a node: where it is in the
 * tree and why, what "done" means, the project's rules, and how to write
 * back to the tree. Only the path from the root and the node's surroundings —
 * not "read docs/ in full": a long context blurs the instructions that matter.
 */
import { realpathSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { hookInstalled } from '../commit-hook.js';
import { uncommittedPaths } from '../git.js';
import { labels, pick, plural, t } from '../i18n/i18n.js';
import { activity } from '../model/activity.js';
import { imagePath, listImages } from '../model/images.js';
import { description, journalEntries } from '../model/journal.js';
import { type Link, linkLabel, linksOf } from '../model/links.js';
import { STATUS_LABEL, WHO_LABEL } from '../model/ops.js';
import { GLYPH } from '../model/overview.js';
import {
  finishedParents,
  isMilestone,
  longTitles,
  openUnderClosed,
  overdueNodes,
  pastComeBack,
} from '../model/review.js';
import { staleNodes } from '../model/stale.js';
import { TREE_DIR } from '../model/store.js';
import { today } from '../model/time.js';
import { actionable, childrenOf, pathTo, progress, summarize, waitingNodes } from '../model/tree.js';
import { type BrainId, ROOT, type StartMode, type Tree, type TreeNode } from '../model/types.js';
import { loadSettings } from '../settings.js';
import { fullAccess } from './access.js';

export interface SessionPlan {
  /** The session's name: in Claude Code's `/resume`, agent view and the terminal title. */
  name: string;
  /** Standing instructions for the whole session. */
  system: string;
  /** The first message; none for `chat`. */
  prompt?: string;
  /** Permission mode to start in: Claude Code `plan`, OpenCode's plan agent, Antigravity full access once the person chose it. */
  permissionMode?: string;
  /** Flags the CLI takes besides its permission mode: Codex's sandbox, once the person chose it. */
  extraArgs?: string[];
  /** The start mode actually used (`goal` falls back to `do` outside Claude Code). */
  start: StartMode;
}

export const START_LABEL: Record<StartMode, string> = labels(() => ({
  plan: t('план'),
  do: t('делать'),
  goal: t('до критерия'),
  chat: t('просто открыть'),
}));

export const START_HINT: Record<StartMode, string> = labels(() => ({
  plan: t('агент изучает и предлагает план, ничего не меняя'),
  do: t('агент сразу делает узел и проверяет критерий'),
  goal: t('Claude работает, пока критерий не выполнен (/goal)'),
  chat: t('сессия с контекстом узла, первое сообщение — твоё'),
}));

/**
 * A plan starts where the CLI itself keeps edits out until the person agrees:
 * Claude Code's plan mode, OpenCode's plan agent. The others get it in words.
 */
function planMode(brain: BrainId): boolean {
  return brain === 'claude' || brain === 'opencode';
}

export function sessionName(tree: Tree, node: TreeNode): string {
  const name = `${tree.project.title} · ${node.title}`;
  return name.length > 64 ? `${name.slice(0, 63)}…` : name;
}

/**
 * A coordinator's own assignment goes after the standard first message, as a separate
 * paragraph; with no first message (`chat`) it becomes the first message.
 */
function withTask(plan: SessionPlan, task?: string): SessionPlan {
  const text = task?.trim();
  if (!text) return plan;
  const label = pick({ ru: 'Задание к узлу:', en: 'Task for this node:' });
  plan.prompt = plan.prompt ? `${plan.prompt}\n\n${label}\n${text}` : text;
  return plan;
}

/**
 * How a session opened by another node's session writes back to it. Codex's sandbox keeps a
 * session away from tmux, so there the question is its last message, which the coordinator's
 * `wait` reads off the screen.
 */
function coordinatorLine(coordinator: TreeNode, brain: BrainId): string {
  const self = selfCommand();
  const title = `«${coordinator.title}» (${coordinator.id})`;
  if (brain === 'codex')
    return pick({
      ru: `Тебя запустила сессия узла ${title} и ждёт тебя через \`${self} wait\`. Вопрос, на который ответит только она, — задай последним сообщением и закончи ход: ответ придёт следующим сообщением.`,
      en: `The session of node ${title} started you and waits for you with \`${self} wait\`. A question only it can answer — ask it as your last message and end your turn: the answer comes as your next message.`,
    });
  return pick({
    ru: `Тебя запустила сессия узла ${title}. Появится вопрос, на который ответит только она, — \`${self} send ${coordinator.id} "…"\`, затем закончи ход: ответ придёт следующим сообщением. Письмо не ушло — задай вопрос последним сообщением и закончи ход.`,
    en: `The session of node ${title} started you. A question only it can answer — \`${self} send ${coordinator.id} "…"\`, then end your turn: the answer comes as your next message. The letter did not go — ask it as your last message and end your turn.`,
  });
}

export function sessionPlan(
  tree: Tree,
  id: string,
  start: StartMode,
  brain: BrainId,
  task?: string,
  coordinator?: TreeNode,
): SessionPlan {
  const back = coordinator && coordinator.id !== id ? coordinatorLine(coordinator, brain) : undefined;
  const assignment = [task?.trim(), back].filter(Boolean).join('\n\n');
  return withTask(basePlan(tree, id, start, brain, Boolean(assignment)), assignment);
}

function basePlan(tree: Tree, id: string, start: StartMode, brain: BrainId, hasTask: boolean): SessionPlan {
  if (id === ROOT) return projectPlan(tree, start, brain, hasTask);
  const node = tree.nodes.get(id);
  if (!node) throw new Error(t('нет узла {id}', { id }));
  const mode: StartMode = start === 'goal' && (brain !== 'claude' || !node.doneWhen) ? 'do' : start;
  const plan: SessionPlan = {
    name: sessionName(tree, node),
    system: contextText(tree, id),
    start: mode,
    ...fullAccess(brain, tree.project.dir),
  };
  const title = `«${node.title}» (${node.id})`;
  const check = node.check ? `\`${node.check}\`` : '';
  const self = selfCommand();
  if (mode === 'chat' && !hasTask) {
    // Some CLIs deliver the context as a first message instead of a system instruction.
    plan.system += pick({
      ru: '\n\nЭто разговор о проекте. Дождись моего вопроса; до него не начинай ревью и не выполняй команды. Можно коротко сказать, что готов обсуждать проект.',
      en: '\n\nThis is a project conversation. Wait for my question; until then do not start a review or run commands. You may briefly say you are ready to discuss the project.',
    });
  }
  if (mode === 'plan') {
    plan.prompt = pick({
      ru:
        `Работаем над узлом ${title}. Изучи, что уже есть в коде и в журнале узла, и предложи план, ` +
        (node.doneWhen
          ? `как довести узел до критерия «${node.doneWhen}».`
          : 'как его сделать. У узла нет критерия готовности — предложи его первым пунктом.') +
        ' Ничего не меняй, пока я не соглашусь с планом.',
      en:
        `We are working on node ${title}. Look at what is already in the code and in the node's journal, and propose a plan ` +
        (node.doneWhen
          ? `to bring the node to its criterion «${node.doneWhen}».`
          : 'to do it. The node has no "done when" yet — propose one as the first item.') +
        ' Change nothing until I agree with the plan.',
    });
    if (planMode(brain)) plan.permissionMode = 'plan';
  } else if (mode === 'do') {
    plan.prompt = pick({
      ru:
        `Сделай узел ${title}.` +
        (node.doneWhen
          ? ` Готово, когда: «${node.doneWhen}».`
          : ' Критерия у узла нет — сначала сформулируй его и запиши.') +
        (check ? ` Проверка: ${check}.` : '') +
        ' Когда закончишь — проверь критерий, покажи доказательства, поставь узлу статус review и запиши итог в журнал.',
      en:
        `Do node ${title}.` +
        (node.doneWhen ? ` Done when: «${node.doneWhen}».` : ' The node has no criterion — write one down first.') +
        (check ? ` Check: ${check}.` : '') +
        ' When you finish, check the criterion, show the evidence, set the node to review and write a summary to its journal.',
    });
  } else if (mode === 'goal') {
    plan.prompt = pick({
      ru:
        `/goal Узел ${title} выполнен: ${node.doneWhen}.` +
        (check
          ? ` Команда ${check} проходит, и её вывод показан в разговоре.`
          : ' Доказательство показано в разговоре.') +
        ` Узлу поставлен статус review командой \`${self} set ${node.id} status=review\`, итог записан в журнал.`,
      en:
        `/goal Node ${title} is done: ${node.doneWhen}.` +
        (check
          ? ` The command ${check} passes and its output is shown in the conversation.`
          : ' The evidence is shown in the conversation.') +
        ` The node is set to review with \`${self} set ${node.id} status=review\`, and a summary is in its journal.`,
    });
  }
  return plan;
}

const TEXT = {
  ru: {
    heading: '# Ты работаешь над узлом дерева проекта',
    intro: (title: string) =>
      `Проект «${title}» ведётся деревом целей (treeyard). Дерево лежит в \`.tree/\`: ` +
      'обзор всего дерева — `.tree/README.md`, каждый узел — `.tree/nodes/<id>.md`.',
    goal: 'Цель проекта',
    node: 'Твой узел',
    path: 'Путь',
    status: 'Статус',
    doer: 'делает',
    doneWhen: 'Готово, когда',
    noCriterion: 'не задано — предложи формулировку и согласуй с человеком',
    check: 'Проверка',
    waiting: 'Ждёт',
    until: 'вернуться, когда',
    journal: 'Последнее в журнале узла:',
    why: '## Зачем — выше по дереву',
    project: 'Проект',
    near: '## Что рядом',
    under: 'Под узлом',
    siblings: 'Соседи',
    rules: '## Как ведётся проект',
    commands: '## Команды дерева',
    command: 'Команда',
    show: 'шапка и последние записи (без --brief — целиком; `--journal N` — сколько записей; можно несколько id; `--only journal,sessions,history` — только эти части)',
    showAll: 'открытое дерево (`--all` — всё)',
    showStatus:
      'узлы этих статусов в ветке, по строке на узел; статус — словом на любом языке или алиасом (review, на проверке, проверка), значки набирать не нужно',
    find: 'поиск по названиям, критериям, описаниям и журналам всех узлов, готовых тоже — вместо grep по `.tree/` и выводу show',
    findWhat: 'текст',
    log: 'что сделано; что осталось',
    logWhat: 'итог в журнал узла',
    add: 'Короткое название',
    addWhat:
      'всплывшая задача или идея (родителя выбирай по смыслу); название — суть в 2–6 словах, до 60 символов, без деталей и абзацев; подробности — в `--note`, проверка — в `--done-when`; несколько узлов разом — `add --parent <id> --from-json -`',
    review:
      'критерий выполнен: итог, статус и коммит одной командой, а не цепочкой diff, log и set (--commit HEAD — только после своего коммита); покажи доказательства',
    reviewText: 'итог и доказательства',
    fix: 'исправить свою последнюю запись; описание узла — `set <id> note="…"`; файлы `.tree/` руками не правь',
    commit:
      'закоммитить файлы дерева этого узла (и заведённых тобой узлов) с README — вместо `git add .tree/…` руками; чужие узлы и код не берёт',
    wait: 'waiting="что мешает" until="когда вернуться"',
    waitWhat: 'упёрся во внешнее',
    note: 'что мешает',
    noteWhat: 'неудобство самого treeyard (не задача проекта) — в «Замечания»; проект и узел запишутся сами',
    other: 'что нужно в другом проекте',
    otherWhat:
      'нужна правка в другом проекте — заведи там узел, связанный с этим (ляжет в «Совместные узлы»), а не правь там молча; связь руками — `set <id> needs=../X#id`',
    closeOther:
      'сделал там нужное — закрой тот узел сам; он закроется и сам, когда человек поставит «готово» этому узлу',
    needs: 'Ждёт',
    neededBy: 'Нужен для',
    noCut:
      'Вывод `show` и `find` читай целиком, не обрезай через head, tail, grep или sed: длинно — `--brief`, `--journal N` или `--only`; ищешь — `find`.',
    names: (example?: string) =>
      `Человеку узлы называй по названию${example ? ` — «${example}»` : ''}, а id — только в командах, даже не в скобках рядом с названием: по коду человек узел в дереве не найдёт.`,
    helper: (dir: string, id?: string) =>
      `Отдаёшь работу субагенту или помощнику — передай ему id узла${id ? ` (\`${id}\`)` : ''} и \`--project ${dir}\` для команд treeyard: в git worktree \`.tree/\` — копия ветки, а человек видит дерево основной папки.`,
    images: 'Картинки узла — открой файлы, чтобы посмотреть:',
    image: 'файл.png',
    imageWhat: 'приложить к узлу картинку или скрин (например, доказательство для проверки); без файла — список',
    coordinator:
      'раздать дочерний узел отдельной сессией (она видна в узле, и её можно продолжить из дерева), а не встроенным субагентом (--bg — только Claude Code; Codex, Antigravity и OpenCode — --brain <имя> --pane вместо --bg)',
    follow:
      'дождаться розданных узлов, а не опрашивать show и git log: вернётся, когда узел уйдёт из «в работе» или его сессия закончит ход или станет ждать человека, и напечатает итог; `send <id> "…"` — дописать той же сессии следующую реплику, а не открывать новую',
    setMany: 'одно изменение нескольким узлам сразу (after= ставит их подряд), а не цикл',
    diffWhat:
      'после коммита привяжи его к узлу (HEAD, ветка или SHA), чтобы человек мог посмотреть диф; без --add — просмотр. Привязывай только коммиты с работой по этому узлу',
    diffAuto: 'коммиты этой сессии привязываются к узлу сами (post-commit); чужие коммиты — так; без --add — просмотр',
    statusWhat:
      'сводка по проекту: папка и дерево (из git worktree — основное, с `--project` для команд), скиллы, указатель, git-хук, живые сессии; у каждой проблемы — команда, которая её исправит. Сомневаешься в настройке — сверься им, а не перебирай файлы',
  },
  en: {
    heading: '# You are working on a node of the project tree',
    intro: (title: string) =>
      `Project «${title}» is run as a goal tree (treeyard). The tree is in \`.tree/\`: ` +
      'the whole tree at a glance — `.tree/README.md`, each node — `.tree/nodes/<id>.md`.',
    goal: 'Project goal',
    node: 'Your node',
    path: 'Path',
    status: 'Status',
    doer: 'done by',
    doneWhen: 'Done when',
    noCriterion: 'not set — propose one and agree it with the person',
    check: 'Check',
    waiting: 'Waiting for',
    until: 'come back when',
    journal: 'Latest in the node journal:',
    why: '## Why — up the tree',
    project: 'Project',
    near: '## Around it',
    under: 'Under the node',
    siblings: 'Siblings',
    rules: '## How the project is run',
    commands: '## Tree commands',
    command: 'The command is',
    show: 'header and latest entries (without --brief — in full; `--journal N` — how many entries; several ids work; `--only journal,sessions,history` — just these parts)',
    showAll: 'the open tree (`--all` — everything)',
    showStatus:
      'nodes of these statuses in a branch, a line each; a status is a word in either language or an alias (review, in review, check), no glyphs to type',
    find: 'search titles, criteria, descriptions and journals of every node, done ones too — instead of grep over `.tree/` and show',
    findWhat: 'text',
    log: 'what is done; what is left',
    logWhat: 'a summary in the node journal',
    add: 'Short title',
    addWhat:
      'a task or an idea that came up (pick the parent by meaning); the title is the gist in 2–6 words, up to 60 characters, no details or paragraphs; details go to `--note`, the check to `--done-when`; several nodes at once — `add --parent <id> --from-json -`',
    review:
      'the criterion is met: the summary, the status and the commit in one command, not a chain of diff, log and set (--commit HEAD — only after your own commit); show the evidence',
    reviewText: 'summary and evidence',
    fix: 'correct your last entry; the node description — `set <id> note="…"`; never edit `.tree/` files by hand',
    commit:
      'commit the tree files of this node (and of nodes you added) with README — instead of `git add .tree/…` by hand; never other nodes or code',
    wait: 'waiting="what blocks it" until="when to come back"',
    waitWhat: 'blocked by something outside',
    note: 'what gets in the way',
    noteWhat:
      'something in treeyard itself gets in the way (not a project task) — into «Notes»; the project and the node are recorded',
    other: 'what is needed in the other project',
    otherWhat:
      'a change is needed in another project — add a node there, linked to this one (it goes to «Shared nodes»), instead of changing it silently; a link by hand — `set <id> needs=../X#id`',
    closeOther:
      'done what was needed there — close that node yourself; it also closes on its own when a person sets this node done',
    needs: 'Waits for',
    neededBy: 'Needed for',
    noCut:
      'Read the output of `show` and `find` whole, never cut it with head, tail, grep or sed: too long — `--brief`, `--journal N` or `--only`; looking for something — `find`.',
    names: (example?: string) =>
      `Name nodes to the person by their title${example ? ` — «${example}»` : ''}; ids go in commands only, not even in brackets next to the title: a person cannot find a node in the tree by its code.`,
    helper: (dir: string, id?: string) =>
      `Handing work to a subagent or a helper — give it the node id${id ? ` (\`${id}\`)` : ''} and \`--project ${dir}\` for treeyard commands: in a git worktree \`.tree/\` is the branch's copy, while the person sees the tree of the main folder.`,
    images: 'Pictures of the node — open the files to look at them:',
    image: 'file.png',
    imageWhat: 'attach a picture or a screenshot to the node (evidence for review, say); without a file — the list',
    coordinator:
      'hand a child node to a separate session (it shows in the node and can be continued from the tree) instead of a built-in subagent (--bg is Claude Code only; for Codex, Antigravity and OpenCode use --brain <name> --pane instead of --bg)',
    follow:
      'wait for the nodes handed out instead of polling show and git log: it returns when a node leaves «active» or its session ends its turn or waits for the person, and prints the summary; `send <id> "…"` — write the same session its next message instead of opening a new one',
    setMany: 'the same change to several nodes at once (after= puts them one after another), not a loop',
    diffWhat:
      'after committing, attach it to the node (HEAD, a branch or a SHA) so the person can inspect the patch; without --add — view. Attach only commits with work on this node',
    diffAuto:
      "this session's commits attach to the node by themselves (post-commit); commits of others — like this; without --add — view",
    statusWhat:
      'the project at a glance: the folder and its tree (from a git worktree — the main one, with the `--project` for commands), skills, the pointer, the git hook, live sessions; each problem comes with the command that fixes it. Unsure about the setup — check it here instead of going through files',
  },
};

export function contextText(tree: Tree, id: string): string {
  if (id === ROOT) return projectContext(tree);
  const node = tree.nodes.get(id);
  if (!node) throw new Error(t('нет узла {id}', { id }));
  const L = pick(TEXT);
  const { project } = tree;
  const self = selfCommand();
  const path = pathTo(tree, id);
  const lines: string[] = [];

  lines.push(L.heading, '');
  lines.push(L.intro(project.title));
  if (project.goal) lines.push(`${L.goal}: ${project.goal}`);
  lines.push('');

  lines.push(`## ${L.node}: ${node.title} (\`${node.id}\`)`, '');
  lines.push(`${L.path}: ${[project.title, ...path.map((step) => step.title)].join(' › ')}`);
  lines.push(`${L.status}: ${STATUS_LABEL[node.status]}${node.who ? ` · ${L.doer}: ${WHO_LABEL[node.who]}` : ''}`);
  lines.push(`${L.doneWhen}: ${node.doneWhen ?? L.noCriterion}`);
  if (node.check) lines.push(`${L.check}: \`${node.check}\``);
  if (node.status === 'waiting' && node.waiting) {
    lines.push(`${L.waiting}: ${node.waiting}${node.until ? ` · ${L.until}: ${node.until}` : ''}`);
  }
  const links = linksOf(tree, node);
  const linkLine = (link: Link) =>
    link.node ? `${linkLabel(link)} (\`${link.ref}\`, ${STATUS_LABEL[link.node.status]})` : linkLabel(link);
  for (const link of links.needs) lines.push(`${L.needs}: ${linkLine(link)}`);
  for (const link of links.neededBy) lines.push(`${L.neededBy}: ${linkLine(link)}`);
  const about = clip(description(node.body), 2500);
  if (about) lines.push('', about);
  const images = listImages(project.dir, node.id);
  if (images.length > 0) {
    lines.push('', L.images);
    for (const image of images) {
      const path = imagePath(project.dir, node.id, image.file);
      lines.push(`- \`${path}\`${image.note ? ` — ${image.note}` : ''}`);
    }
  }
  const journal = journalEntries(node.body).slice(-6);
  if (journal.length > 0) lines.push('', L.journal, ...journal.map((line) => `- ${line}`));
  lines.push('');

  const above = path.slice(0, -1).reverse();
  if (above.length > 0 || project.goal) {
    lines.push(L.why, '');
    for (const step of above) {
      const why = firstParagraph(description(step.body), 300);
      let line = `- ${step.title} (\`${step.id}\`, ${STATUS_LABEL[step.status]})`;
      if (why) line += `: ${why}`;
      if (step.doneWhen) line += ` ${L.doneWhen}: ${step.doneWhen}`;
      lines.push(line);
    }
    if (project.goal) lines.push(`- ${L.project}: ${project.goal}`);
    lines.push('');
  }

  const siblings = childrenOf(tree, node.parent).filter((other) => other.id !== node.id);
  const kids = childrenOf(tree, node.id);
  if (siblings.length > 0 || kids.length > 0) {
    lines.push(L.near, '');
    if (kids.length > 0) lines.push(`${L.under}: ${kids.map(brief).join(' · ')}`);
    if (siblings.length > 0) lines.push(`${L.siblings}: ${siblings.slice(0, 12).map(brief).join(' · ')}`);
    lines.push('');
  }

  const rules = project.body.trim();
  if (rules) lines.push(L.rules, '', clip(rules, 6000), '');

  lines.push(L.commands, '');
  lines.push(`${L.command} \`${self}\`.`);
  lines.push(`- \`${self} show ${node.id} --brief\` — ${L.show}; \`${self} show\` — ${L.showAll}`);
  lines.push(`- \`${self} show --status review,idea --under <id>\` — ${L.showStatus}`);
  lines.push(`- \`${self} find "${L.findWhat}"\` — ${L.find}`);
  lines.push(`- ${L.noCut}`);
  lines.push(`- \`${self} log ${node.id} "${L.log}"\` — ${L.logWhat}`);
  lines.push(`- \`${self} add "${L.add}" --parent ${node.id} --status idea --note "…"\` — ${L.addWhat}`);
  lines.push(`- \`${self} log ${node.id} "${L.reviewText}" --status review --commit HEAD\` — ${L.review}`);
  lines.push(`- \`${self} log ${node.id} --fix "…"\` — ${L.fix}`);
  lines.push(`- \`${self} commit ${node.id} [<id>…]\` — ${L.commit}`);
  lines.push(`- \`${self} set ${node.id} status=waiting ${L.wait}\` — ${L.waitWhat}`);
  lines.push(`- \`${self} add "${L.other}" --project ../X --for ${node.id}\` — ${L.otherWhat}`);
  lines.push(`- \`${self} set <id> status=done --project ../X\` — ${L.closeOther}`);
  lines.push(`- \`${self} image ${node.id} ${L.image} --note "…"\` — ${L.imageWhat}`);
  lines.push(`- \`${self} status\` — ${L.statusWhat}`);
  // With the hook in place the session's own commits need no command; the check is one cheap git call.
  if (hookInstalled(project.dir)) lines.push(`- \`${self} diff ${node.id} --add <ref>\` — ${L.diffAuto}`);
  else lines.push(`- \`${self} diff ${node.id} --add HEAD\` — ${L.diffWhat}`);
  // Only where work is handed out: a leaf would pay for the line in every session.
  if (kids.some((kid) => kid.status !== 'done' && kid.status !== 'dropped')) {
    lines.push(`- \`${self} open <id> [<id>…] --bg --task "…" [--model …] [--effort …]\` — ${L.coordinator}`);
    lines.push(`- \`${self} wait <id> [<id>…] --timeout 10m\` — ${L.follow}`);
    lines.push(`- \`${self} set <id> <id>… status=todo\` — ${L.setMany}`);
  }
  // Read, not applied: the context must not switch the language or the theme of whoever asks.
  if (loadSettings().notes) lines.push(`- \`${self} note "${L.note}"\` — ${L.noteWhat}`);
  lines.push(`- ${L.names(node.title)}`);
  lines.push(`- ${L.helper(quote(project.dir), node.id)}`);
  // The same rule as from the root: a node session is asked to close nodes as often.
  lines.push(`- ${pick(ROOT_TEXT).doneRule(self)}`);
  return lines.join('\n');
}

// ── The whole project: a session from the root ──────────────────────────────

/** A session from the root starts one of two ways: a review of the tree, or a talk about the project. */
export function rootStart(start: StartMode): StartMode {
  return start === 'chat' ? 'chat' : 'plan';
}

export const ROOT_START_LABEL: Record<StartMode, string> = labels(() => ({
  plan: t('ревью дерева'),
  do: t('ревью дерева'),
  goal: t('ревью дерева'),
  chat: t('разговор о проекте'),
}));

export const ROOT_START_HINT: Record<StartMode, string> = labels(() => ({
  plan: t('агент проходит всё дерево и предлагает правки командами treeyard, ничего не меняя'),
  do: t('агент проходит всё дерево и предлагает правки командами treeyard, ничего не меняя'),
  goal: t('агент проходит всё дерево и предлагает правки командами treeyard, ничего не меняя'),
  chat: t('статус, на чём остановились, завести или закрыть узлы — первое сообщение твоё'),
}));

function projectPlan(tree: Tree, start: StartMode, brain: BrainId, hasTask = false): SessionPlan {
  const mode = rootStart(start);
  const name = `${tree.project.title} · ${ROOT_START_LABEL[mode]}`;
  const plan: SessionPlan = {
    name: name.length > 64 ? `${name.slice(0, 63)}…` : name,
    system: projectContext(tree),
    start: mode,
    ...fullAccess(brain, tree.project.dir),
  };
  if (mode === 'chat' && !hasTask) {
    // Some CLIs deliver the context as a first message instead of a system instruction.
    plan.system += pick({
      ru: '\n\nЭто разговор о проекте. Дождись моего вопроса; до него не начинай ревью и не выполняй команды. Можно коротко сказать, что готов обсуждать проект.',
      en: '\n\nThis is a project conversation. Wait for my question; until then do not start a review or run commands. You may briefly say you are ready to discuss the project.',
    });
  }
  if (mode === 'plan') {
    plan.prompt = pick({
      ru:
        `Проведи ревью всего дерева проекта «${tree.project.title}». Пройди узлы (\`${selfCommand()} show <id> --brief\`, файлы .tree/nodes/), ` +
        'загляни в код и git log, сколько нужно, и найди, что в дереве криво: узлы без «готово, когда» или с критерием, ' +
        'который нельзя увидеть или запустить; переростки, которые пора разбить; названия-абзацы (длиннее 60 символов или с деталями вместо ' +
        'сути) — сократи до 2–6 слов, подробности в описание: `set <id> title="…" note="…"` (note заменяет описание целиком — не потеряй старое); ' +
        '«в работе» и «на проверке» без движения больше недели, ' +
        '«на проверке» без доказательств в журнале; «ждёт», у которых условие возврата, похоже, наступило; работу, которая по коду и ' +
        'коммитам сделана, а узел не закрыт, и наоборот; родителей и вехи, у которых все дети готовы, а сами открыты; открытые узлы ' +
        'под закрытыми ветками; «на проверке», а код не закоммичен; вехи с прошедшим сроком; дубли, идеи, которые пора поднять или ' +
        'закрыть, узлы не на своём месте; чего не хватает до ближайшей вехи и цели проекта. Часть этого treeyard уже нашёл сам — ' +
        'разделы контекста «Все дети готовы, а узел открыт», «Открытые узлы под закрытыми ветками», «На проверке, а код не закоммичен», ' +
        '«Сроки прошли», «Ждёт, а дата возврата прошла», «Длинные названия»: проверь каждую находку оттуда. Начни с короткой сводки: где проект сейчас и на чём остановились. ' +
        'Потом находки по важности — у каждой команда treeyard, которая её исправит. Ничего не меняй, пока я не соглашусь; ' +
        'после согласия выполни команды и покажи, что вышло.',
      en:
        `Review the whole tree of project «${tree.project.title}». Go through the nodes (\`${selfCommand()} show <id> --brief\`, the files in .tree/nodes/), ` +
        'look into the code and git log as much as you need, and find what is crooked in the tree: nodes without "done when" or with ' +
        'a criterion nobody can see or run; nodes grown too big to be one session; paragraph titles (over 60 characters, or details instead of ' +
        'the gist) — cut to 2–6 words, details into the description: `set <id> title="…" note="…"` (note replaces the whole description — keep the old text); ' +
        '"in progress" and "in review" without movement for ' +
        'over a week, "in review" without evidence in the journal; "waiting" whose condition to come back seems to have come; work ' +
        'done by the code and commits while its node is open, and the other way round; parents and milestones whose children are all ' +
        'done while they are open; open nodes under closed branches; "in review" with the code not committed; milestones past their ' +
        'deadline; duplicates, ideas to take up or drop, nodes in the wrong place; what is missing for the nearest milestone and the ' +
        'goal. treeyard has found part of this itself — the context sections «All children done, the node still open», «Open nodes ' +
        'under closed branches», «In review, but the code is not committed», «Deadlines passed», «Waiting, but the date to come ' +
        'back has passed», «Long titles»: check every finding ' +
        'there. Start with a short summary: where the project ' +
        'stands and where it stopped. Then the findings by importance — each with the treeyard command that fixes it. Change ' +
        'nothing until I agree; after that run the commands and show what came of them.',
    });
    if (planMode(brain)) plan.permissionMode = 'plan';
  }
  return plan;
}

const ROOT_TEXT = {
  ru: {
    heading: '# Ты работаешь со всем деревом проекта',
    role: '## Твоя роль',
    roleText: [
      'Ты не делаешь один узел — ты смотришь на проект целиком вместе с человеком, как менеджер проекта:',
      '- отвечаешь, где проект сейчас и на чём остановились — по дереву, журналам узлов и git;',
      '- находишь кривое в дереве и предлагаешь, как поправить;',
      '- по просьбе человека заводишь, переносишь, переименовываешь и закрываешь узлы — командами treeyard, а не правкой файлов руками;',
      '- код проекта не меняешь: работа над узлом — это сессия из этого узла.',
    ],
    doneRule: (self: string) =>
      `Статус done ставит человек. Если он в этом разговоре прямо просит закрыть узлы — \`${self} set <id> status=done --as ты\`: решение его, ты исполняешь. Без такой просьбы — только review.`,
    tree: '## Дерево сейчас',
    tally: (s: ReturnType<typeof summarize>) =>
      `Готово ${s.done} из ${s.total} · в работе ${s.active} · на проверке ${s.review} · ждут ${s.waiting} · идей ${s.ideas}`,
    now: '## Можно делать сейчас',
    review: '## На проверке',
    waiting: '## Ждёт',
    until: 'вернуться, когда',
    noReason: 'причина не записана',
    recent: '## Последнее в журналах',
    problems: '## Что не так с файлами дерева',
    rules: '## Как ведётся проект',
    commands: '## Команды дерева',
    command: 'Команда',
    show: 'открытое дерево (`--all` — всё); `show <id…> --brief` — шапки и последние записи узлов, `--journal N` — сколько записей',
    add: 'новый узел (родитель — по смыслу; `--status idea` для идеи); название — суть в 2–6 словах, до 60 символов, подробности — в `--note`, проверка — в `--done-when`; несколько разом, с детьми и needs — `add --parent <id> --from-json -`',
    set: 'поменять узел или несколько сразу (то же всем, after= ставит их подряд): status, title, parent, done_when, who, check, note (описание), waiting, until',
    keyValue: 'ключ=значение',
    log: 'запись в журнал узла; с `--status` и `--commit` — заодно статус и коммиты',
    sessions: 'сессии папки и чьи они',
    rm: 'удалить узел, заведённый по ошибке; узел с историей не удаляют, а закрывают — `set <id> status=dropped`',
    decide: 'решение в «Решения» `.tree/tree.md` (с датой) — только когда человек так решил',
    commit: 'закоммитить файлы дерева этих узлов, README и tree.md (chore(tree): …) — вместо `git add .tree/…` руками',
    open: 'раздать дочерний узел отдельной сессией (она видна в узле, и её можно продолжить из дерева), а не встроенным субагентом (--bg — только Claude Code; Codex, Antigravity и OpenCode — --brain <имя> --pane вместо --bg)',
    follow:
      'дождаться розданных узлов, а не опрашивать show и git log: вернётся, когда узел уйдёт из «в работе» или его сессия закончит ход или станет ждать человека, и напечатает итог; `send <id> "…"` — дописать той же сессии следующую реплику, а не открывать новую',
    doneWhen: 'готово, когда',
    more: 'ещё',
    stale: '## В работе, но без живой сессии',
    staleHint:
      'Над ними никто не работает: предложи человеку вернуть узел к работе (`set <id> status=todo`) или продолжить его.',
    staleLine: (h: number, last: string) =>
      `без сессии ${h >= 48 ? `${Math.floor(h / 24)} дн` : `${h} ч`}${last ? ` · последняя запись: ${last}` : ''}`,
    milestone: 'веха',
    finished: '## Все дети готовы, а узел открыт',
    finishedHint:
      'Проверь критерий узла: выполнен — предложи закрыть (на проверку, «готово» — по слову человека); нет — заведи то, чего не хватает. Идеи изнутри при закрытии перенеси в открытую ветку (`set <id> parent=<id>`). Постоянные корзины (идеи, замечания) не закрывают.',
    finishedLine: (done: number, ideas: number) => `готово детей: ${done}${ideas ? ` · идей внутри: ${ideas}` : ''}`,
    orphans: '## Открытые узлы под закрытыми ветками',
    orphansHint:
      'Ветка закрыта, а узел в ней открыт — в дереве его не видно. Перенеси в открытую ветку (`set <id> parent=<id>`, идею — в ветку идей) или закрой (`set <id> status=dropped`).',
    orphanLine: (title: string, status: string) => `под «${title}» (${status})`,
    dirty: '## На проверке, а код не закоммичен',
    dirtyHint: (count: number, files: string) =>
      `В рабочей папке не закоммичено файлов: ${count} (${files}). На проверку узел ставят после коммита. Выясни по \`git diff\` и журналам, чья это работа: правки узла на проверке — закоммитить и привязать (\`diff <id> --add <sha>\`); работа не кончена — вернуть узел в работу (\`set <id> status=active\`). Правки другой живой сессии не трогай.`,
    dirtyLine: (commits: number) => (commits ? `коммитов в узле: ${commits}` : 'коммитов в узле нет'),
    overdue: '## Сроки прошли',
    overdueHint:
      'Срок в названии или критерии прошёл, а узел открыт. Предложи человеку: закрыть сделанное, перенести срок (`set <id> done_when="…"`) или признать, что к сроку не успели, и решить, что дальше.',
    overdueLine: (date: string, text: string, days: number) => `срок ${date} («${text}») прошёл ${days} дн назад`,
    comeBack: '## Ждёт, а дата возврата прошла',
    comeBackHint:
      'Дата в «вернуться, когда» прошла, а узел всё ждёт. Проверь, наступило ли условие: да — верни узел к работе (`set <id> status=todo`); нет — перенеси дату (`set <id> until="…"`) или запиши в журнал, почему ждём дальше.',
    comeBackLine: (date: string, days: number, until: string) =>
      `дата возврата ${date} прошла ${days} дн назад · вернуться, когда: ${until}`,
    long: '## Длинные названия',
    longHint:
      'Длиннее 60 символов. Сократи до сути в 2–6 словах, подробности — в описание: `set <id> title="…" note="…"` (note заменяет описание целиком — сохрани старое).',
    longLine: (length: number) =>
      `${length} ${plural(length, ['символ', 'символа', 'символов'], ['character', 'characters'])}`,
  },
  en: {
    heading: '# You are working with the whole project tree',
    role: '## Your role',
    roleText: [
      'You do not do one node — you look at the project as a whole together with the person, like a project manager:',
      '- you answer where the project stands and where it stopped — from the tree, the node journals and git;',
      '- you find what is crooked in the tree and propose how to fix it;',
      '- when the person asks, you add, move, rename and close nodes — with treeyard commands, not by editing the files by hand;',
      '- you do not change the project code: work on a node is a session from that node.',
    ],
    doneRule: (self: string) =>
      `Status done is set by a person. If they ask you right in this conversation to close nodes — \`${self} set <id> status=done --as you\`: the decision is theirs, you carry it out. Without such a request — review only.`,
    tree: '## The tree now',
    tally: (s: ReturnType<typeof summarize>) =>
      `Done ${s.done} of ${s.total} · in progress ${s.active} · in review ${s.review} · waiting ${s.waiting} · ideas ${s.ideas}`,
    now: '## Can be done now',
    review: '## In review',
    waiting: '## Waiting',
    until: 'come back when',
    noReason: 'no reason written',
    recent: '## Latest in the journals',
    problems: '## What is wrong with the tree files',
    rules: '## How the project is run',
    commands: '## Tree commands',
    command: 'The command is',
    show: 'the open tree (`--all` — everything); `show <id…> --brief` — headers and latest entries of nodes, `--journal N` — how many entries',
    add: 'a new node (pick the parent by meaning; `--status idea` for an idea); the title is the gist in 2–6 words, up to 60 characters, details go to `--note`, the check to `--done-when`; several at once, with children and needs — `add --parent <id> --from-json -`',
    set: 'change a node or several at once (the same to each, after= puts them one after another): status, title, parent, done_when, who, check, note (description), waiting, until',
    keyValue: 'key=value',
    log: 'a line in the node journal; with `--status` and `--commit` — the status and commits too',
    sessions: 'the sessions of the folder and whose they are',
    rm: 'delete a node added by mistake; a node with a history is closed instead — `set <id> status=dropped`',
    decide: 'a decision in «Decisions» of `.tree/tree.md` (dated) — only when the person decided so',
    commit:
      'commit the tree files of these nodes, README and tree.md (chore(tree): …) — instead of `git add .tree/…` by hand',
    open: 'hand a child node to a separate session (it shows in the node and can be continued from the tree) instead of a built-in subagent (--bg is Claude Code only; for Codex, Antigravity and OpenCode use --brain <name> --pane instead of --bg)',
    follow:
      'wait for the nodes handed out instead of polling show and git log: it returns when a node leaves «active» or its session ends its turn or waits for the person, and prints the summary; `send <id> "…"` — write the same session its next message instead of opening a new one',
    doneWhen: 'done when',
    more: 'more',
    stale: '## In progress, but no live session',
    staleHint:
      'Nobody works on these: offer the person to put the node back to work (`set <id> status=todo`) or to continue it.',
    staleLine: (h: number, last: string) =>
      `no session for ${h >= 48 ? `${Math.floor(h / 24)} d` : `${h} h`}${last ? ` · last record: ${last}` : ''}`,
    milestone: 'milestone',
    finished: '## All children done, the node still open',
    finishedHint:
      "Check the node's criterion: met — offer to close it (to review; done at the person's word); not met — add what is missing. Ideas inside move to an open branch when it closes (`set <id> parent=<id>`). Standing buckets (ideas, notes) stay open.",
    finishedLine: (done: number, ideas: number) => `children done: ${done}${ideas ? ` · ideas inside: ${ideas}` : ''}`,
    orphans: '## Open nodes under closed branches',
    orphansHint:
      'The branch is closed while the node in it is open — nobody sees it in the tree. Move it to an open branch (`set <id> parent=<id>`, an idea to the ideas branch) or close it (`set <id> status=dropped`).',
    orphanLine: (title: string, status: string) => `under «${title}» (${status})`,
    dirty: '## In review, but the code is not committed',
    dirtyHint: (count: number, files: string) =>
      `Uncommitted files in the work folder: ${count} (${files}). A node goes to review after its commit. Find out from \`git diff\` and the journals whose work it is: changes of a node in review — commit them and attach (\`diff <id> --add <sha>\`); unfinished work — put the node back to work (\`set <id> status=active\`). Leave the changes of another live session alone.`,
    dirtyLine: (commits: number) => (commits ? `commits in the node: ${commits}` : 'no commits in the node'),
    overdue: '## Deadlines passed',
    overdueHint:
      'The deadline in the title or the criterion has passed while the node is open. Offer the person to close what is done, move the deadline (`set <id> done_when="…"`) or admit it was missed and decide what next.',
    overdueLine: (date: string, text: string, days: number) => `deadline ${date} («${text}») passed ${days} d ago`,
    comeBack: '## Waiting, but the date to come back has passed',
    comeBackHint:
      'The date in "come back when" has passed while the node still waits. Check whether the condition has come: yes — put the node back to work (`set <id> status=todo`); no — move the date (`set <id> until="…"`) or write in the journal why it waits on.',
    comeBackLine: (date: string, days: number, until: string) =>
      `the date to come back ${date} passed ${days} d ago · come back when: ${until}`,
    long: '## Long titles',
    longHint:
      'Over 60 characters. Cut to the gist in 2–6 words, details into the description: `set <id> title="…" note="…"` (note replaces the whole description — keep the old text).',
    longLine: (length: number) =>
      `${length} ${plural(length, ['символ', 'символа', 'символов'], ['character', 'characters'])}`,
  },
};

/** What a session from the root gets: the whole tree, what moves and what stands, the rules, the commands. */
export function projectContext(tree: Tree): string {
  const L = pick(ROOT_TEXT);
  const T = pick(TEXT);
  const { project } = tree;
  const self = selfCommand();
  const lines: string[] = [L.heading, '', T.intro(project.title)];
  if (project.goal) lines.push(`${T.goal}: ${project.goal}`);
  lines.push('', L.role, '', ...L.roleText, '', L.doneRule(self), '');

  lines.push(L.tree, '', L.tally(summarize(tree)), '');
  // Open work in full, with its criterion; closed work one line each — the details are a `show` away.
  const outline: string[] = [];
  const walk = (parent: string, depth: number) => {
    for (const node of childrenOf(tree, parent)) {
      let line = `${'  '.repeat(depth)}- ${GLYPH[node.status]} ${node.title} (\`${node.id}\`, ${STATUS_LABEL[node.status]})`;
      const kids = childrenOf(tree, node.id);
      if (kids.length) {
        const p = progress(tree, node.id);
        line += ` — ${p.done}/${p.total}`;
      }
      if (node.who === 'human') line += ` · ${WHO_LABEL.human}`;
      const open = node.status !== 'done' && node.status !== 'dropped';
      if (open && node.status === 'waiting' && node.waiting) line += ` · ${T.waiting}: ${clip(node.waiting, 160)}`;
      if (open && node.doneWhen) line += ` · ${L.doneWhen}: ${clip(node.doneWhen, 200)}`;
      outline.push(line);
      walk(node.id, depth + 1);
    }
  };
  walk(ROOT, 0);
  lines.push(clip(outline.join('\n'), 24_000), '');

  const brief = (node: TreeNode) => {
    const path = pathTo(tree, node.id)
      .slice(0, -1)
      .map((step) => step.title)
      .join(' › ');
    return `- ${node.title} (\`${node.id}\`)${path ? ` — ${clip(path, 120)}` : ''}`;
  };
  const listed = (title: string, nodes: TreeNode[], line: (node: TreeNode) => string = brief) => {
    if (!nodes.length) return;
    lines.push(title, '', ...nodes.slice(0, 20).map(line));
    if (nodes.length > 20) lines.push(`- … ${L.more} ${nodes.length - 20}`);
    lines.push('');
  };
  listed(
    L.now,
    actionable(tree).filter((node) => node.status !== 'review'),
  );
  listed(
    L.review,
    [...tree.nodes.values()].filter((node) => node.status === 'review'),
  );
  listed(L.waiting, waitingNodes(tree), (node) => {
    const why = node.waiting ? clip(node.waiting, 200) : L.noReason;
    return `- ${node.title} (\`${node.id}\`): ${why}${node.until ? ` · ${L.until}: ${clip(node.until, 160)}` : ''}`;
  });

  // Only by the time threshold: this text is built without asking who is alive.
  const abandoned = staleNodes(tree, { afterHours: loadSettings().staleAfter });
  if (abandoned.length) {
    lines.push(L.stale, '', L.staleHint, '');
    for (const { node, stale } of abandoned.slice(0, 20)) {
      lines.push(`${brief(node)} — ${L.staleLine(stale.hours, stale.lastEntry ? clip(stale.lastEntry, 160) : '')}`);
    }
    if (abandoned.length > 20) lines.push(`- … ${L.more} ${abandoned.length - 20}`);
    lines.push('');
  }

  // What a coordinator used to find by hand, each list with what to do about it.
  const section = <T>(title: string, hint: string, items: T[], line: (item: T) => string) => {
    if (!items.length) return;
    lines.push(title, '', hint, '', ...items.slice(0, 20).map(line));
    if (items.length > 20) lines.push(`- … ${L.more} ${items.length - 20}`);
    lines.push('');
  };
  const milestone = (node: TreeNode) => (isMilestone(node) ? `${L.milestone} · ` : '');
  section(
    L.finished,
    L.finishedHint,
    finishedParents(tree),
    ({ node, done, ideas }) => `${brief(node)} — ${milestone(node)}${L.finishedLine(done, ideas)}`,
  );
  section(
    L.orphans,
    L.orphansHint,
    openUnderClosed(tree),
    ({ node, parent }) =>
      `- ${node.title} (\`${node.id}\`, ${STATUS_LABEL[node.status]}) — ${L.orphanLine(clip(parent.title, 80), STATUS_LABEL[parent.status])}`,
  );
  const inReview = [...tree.nodes.values()].filter((node) => node.status === 'review');
  // Code only: the tree's own files are shared by every session and committed with `treeyard commit`.
  const dirty = inReview.length ? uncommittedPaths(project.dir).filter((path) => !path.startsWith(`${TREE_DIR}/`)) : [];
  if (dirty.length) {
    const files = dirty.slice(0, 8).join(', ') + (dirty.length > 8 ? `, … ${L.more} ${dirty.length - 8}` : '');
    const commits = (node: TreeNode) => node.commits?.length ?? 0;
    // A node with no commits at all is the likeliest owner of the changes.
    section(
      L.dirty,
      L.dirtyHint(dirty.length, files),
      inReview.sort((a, b) => commits(a) - commits(b)),
      (node) => `${brief(node)} — ${L.dirtyLine(commits(node))}`,
    );
  }
  section(
    L.overdue,
    L.overdueHint,
    overdueNodes(tree, today()),
    ({ node, deadline, days }) =>
      `${brief(node)} — ${milestone(node)}${L.overdueLine(deadline.date, deadline.text, days)}`,
  );
  section(
    L.comeBack,
    L.comeBackHint,
    pastComeBack(tree, today()),
    ({ node, deadline, days }) =>
      `${brief(node)} — ${L.comeBackLine(deadline.date, days, clip(node.until ?? '', 160))}`,
  );
  section(
    L.long,
    L.longHint,
    longTitles(tree),
    (node) => `${brief(node)} — ${L.longLine([...node.title.trim()].length)}`,
  );

  const events = activity(tree, 25);
  if (events.length) {
    lines.push(L.recent, '');
    for (const event of events)
      lines.push(
        `- ${event.when} · ${event.who} · «${clip(event.node.title, 80)}» (\`${event.node.id}\`): ${clip(event.text, 240)}`,
      );
    lines.push('');
  }
  if (tree.problems.length) lines.push(L.problems, '', ...tree.problems.map((line) => `- ${line}`), '');

  const rules = project.body.trim();
  if (rules) lines.push(L.rules, '', clip(rules, 6000), '');

  lines.push(L.commands, '');
  lines.push(`${L.command} \`${self}\`.`);
  lines.push(`- \`${self} show\` — ${L.show}`);
  lines.push(`- \`${self} show --status review,idea [--under <id>]\` — ${T.showStatus}`);
  lines.push(`- \`${self} find "${T.findWhat}"\` — ${T.find}`);
  lines.push(`- ${T.noCut}`);
  lines.push(`- \`${self} add "${T.add}" --parent <id> --done-when "…" --note "…"\` — ${L.add}`);
  lines.push(`- \`${self} set <id> [<id>…] ${L.keyValue}…\` — ${L.set}`);
  lines.push(`- \`${self} log <id> "…" [--status s] [--commit <ref>…]\` — ${L.log}`);
  lines.push(`- \`${self} rm <id>\` — ${L.rm}`);
  lines.push(`- \`${self} decide "…"\` — ${L.decide}`);
  lines.push(`- \`${self} commit <id>…\` — ${L.commit}`);
  lines.push(`- \`${self} sessions\` — ${L.sessions}`);
  lines.push(`- \`${self} open <id> [<id>…] --bg --task "…" [--model …] [--effort …]\` — ${L.open}`);
  lines.push(`- \`${self} wait <id> [<id>…] --timeout 10m\` — ${L.follow}`);
  if (loadSettings().notes) lines.push(`- \`${self} note "${T.note}"\` — ${T.noteWhat}`);
  lines.push(`- ${T.names()}`);
  lines.push(`- ${T.helper(quote(project.dir))}`);
  lines.push(`- ${L.doneRule(self)}`);
  return lines.join('\n');
}

/** A neighbour in one line: the status as a word too — agents do not read glyphs. */
function brief(node: TreeNode): string {
  return `${GLYPH[node.status]} ${node.title} (${node.id}, ${STATUS_LABEL[node.status]})`;
}

function firstParagraph(text: string, limit: number): string {
  const first =
    text
      .split(/\n\s*\n/)[0]
      ?.replace(/\s+/g, ' ')
      .trim() ?? '';
  return first.length > limit ? `${first.slice(0, limit - 1)}…` : first;
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

let self: string | undefined;

/**
 * How an agent calls treeyard: the bare name when the one on PATH is this
 * very program, otherwise the full command, so a development copy works too.
 */
export function selfCommand(): string {
  if (self) return self;
  const script = process.argv[1] ? safeReal(process.argv[1]) : '';
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = safeReal(join(dir, 'treeyard'));
    if (candidate && (!script || candidate === script)) {
      self = 'treeyard';
      return self;
    }
  }
  if (!script) self = 'treeyard';
  else if (script.endsWith('.ts')) self = `npx tsx ${quote(script)}`;
  else self = `node ${quote(script)}`;
  return self;
}

function safeReal(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return '';
  }
}

function quote(path: string): string {
  return /^[\w@%+=:,./-]+$/.test(path) ? path : JSON.stringify(path);
}

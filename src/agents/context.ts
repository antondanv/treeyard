/**
 * What an agent gets when a session starts from a node: where it is in the
 * tree and why, what "done" means, the project's rules, and how to write
 * back to the tree. Only the path from the root and the node's surroundings —
 * not "read docs/ in full": a long context blurs the instructions that matter.
 */
import { realpathSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { labels, pick, t } from '../i18n/i18n.js';
import { imagePath, listImages } from '../model/images.js';
import { description, journalEntries } from '../model/journal.js';
import { type Link, linkLabel, linksOf } from '../model/links.js';
import { STATUS_LABEL, WHO_LABEL } from '../model/ops.js';
import { GLYPH } from '../model/overview.js';
import { childrenOf, pathTo } from '../model/tree.js';
import type { BrainId, StartMode, Tree, TreeNode } from '../model/types.js';
import { loadSettings } from '../settings.js';

export interface SessionPlan {
  /** The session's name: in Claude Code's `/resume`, agent view and the terminal title. */
  name: string;
  /** Standing instructions for the whole session. */
  system: string;
  /** The first message; none for `chat`. */
  prompt?: string;
  /** Permission mode to start in: Claude Code `plan`, Antigravity full access. */
  permissionMode?: string;
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
 * Codex and Claude Code take their access from their own settings; agy has
 * only plan and accept-edits there, and asks before every command — an agent
 * from a node has to run treeyard and the project's tests. The flag lives for
 * one run, so a resumed session needs it again.
 */
export function fullAccess(brain: BrainId): { permissionMode?: string } {
  return brain === 'antigravity' ? { permissionMode: 'bypassPermissions' } : {};
}

export function sessionName(tree: Tree, node: TreeNode): string {
  const name = `${tree.project.title} · ${node.title}`;
  return name.length > 64 ? `${name.slice(0, 63)}…` : name;
}

export function sessionPlan(tree: Tree, id: string, start: StartMode, brain: BrainId): SessionPlan {
  const node = tree.nodes.get(id);
  if (!node) throw new Error(t('нет узла {id}', { id }));
  const mode: StartMode = start === 'goal' && (brain !== 'claude' || !node.doneWhen) ? 'do' : start;
  const plan: SessionPlan = {
    name: sessionName(tree, node),
    system: contextText(tree, id),
    start: mode,
    ...fullAccess(brain),
  };
  const title = `«${node.title}» (${node.id})`;
  const check = node.check ? `\`${node.check}\`` : '';
  const self = selfCommand();
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
    if (brain === 'claude') plan.permissionMode = 'plan';
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
    show: 'узел целиком',
    showAll: 'всё дерево',
    log: 'что сделано; что осталось',
    logWhat: 'итог в журнал узла',
    add: 'Заголовок',
    addWhat: 'всплывшая задача или идея (родителя выбирай по смыслу)',
    review: 'критерий выполнен; покажи доказательства',
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
    done: 'Статус done ставит человек.',
    images: 'Картинки узла — открой файлы, чтобы посмотреть:',
    image: 'файл.png',
    imageWhat: 'приложить к узлу картинку или скрин (например, доказательство для проверки); без файла — список',
    diffWhat:
      'после коммита привяжи его SHA к узлу, чтобы человек мог посмотреть диф; без --add — просмотр. Привязывай только коммиты с работой по этому узлу',
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
    show: 'the whole node',
    showAll: 'the whole tree',
    log: 'what is done; what is left',
    logWhat: 'a summary in the node journal',
    add: 'Title',
    addWhat: 'a task or an idea that came up (pick the parent by meaning)',
    review: 'the criterion is met; show the evidence',
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
    done: 'Status done is set by a person.',
    images: 'Pictures of the node — open the files to look at them:',
    image: 'file.png',
    imageWhat: 'attach a picture or a screenshot to the node (evidence for review, say); without a file — the list',
    diffWhat:
      'after committing, attach its SHA to the node so the person can inspect the patch; without --add — view. Attach only commits with work on this node',
  },
};

export function contextText(tree: Tree, id: string): string {
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
  lines.push(`- \`${self} show ${node.id}\` — ${L.show}; \`${self} show\` — ${L.showAll}`);
  lines.push(`- \`${self} log ${node.id} "${L.log}"\` — ${L.logWhat}`);
  lines.push(`- \`${self} add "${L.add}" --parent ${node.id} --status idea\` — ${L.addWhat}`);
  lines.push(`- \`${self} set ${node.id} status=review\` — ${L.review}`);
  lines.push(`- \`${self} set ${node.id} status=waiting ${L.wait}\` — ${L.waitWhat}`);
  lines.push(`- \`${self} add "${L.other}" --project ../X --for ${node.id}\` — ${L.otherWhat}`);
  lines.push(`- \`${self} set <id> status=done --project ../X\` — ${L.closeOther}`);
  lines.push(`- \`${self} image ${node.id} ${L.image} --note "…"\` — ${L.imageWhat}`);
  lines.push(`- \`${self} diff ${node.id} --add <sha>\` — ${L.diffWhat}`);
  // Read, not applied: the context must not switch the language or the theme of whoever asks.
  if (loadSettings().notes) lines.push(`- \`${self} note "${L.note}"\` — ${L.noteWhat}`);
  lines.push(`- ${L.done}`);
  return lines.join('\n');
}

function brief(node: TreeNode): string {
  return `${GLYPH[node.status]} ${node.title} (${node.id})`;
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

/** `treeyard status` as text: a line per part, then what to fix, each with its command. */
import { join } from 'node:path';

import { ACCESS_LABEL } from '../agents/access.js';
import { BRAIN_LABEL } from '../agents/launch.js';
import { formatMemory } from '../agents/panes.js';
import type { SkillStatus } from '../agents/skills.js';
import { t } from '../i18n/i18n.js';
import { homeShort } from '../model/notes.js';
import { STATUS_LABEL } from '../model/ops.js';
import { duration } from '../model/time.js';
import { STATUSES } from '../model/types.js';
import type { LiveSession, ProjectStatus } from '../status.js';
import { clip } from '../tui/text.js';
import type { Paint } from './print.js';

const LABEL = 11;
const GREEN = '#7ee2a8';
const YELLOW = '#ffcf70';
/** At most this many session lines; the rest is a count. */
const SESSION_LINES = 8;
/** Session lines fit a terminal this wide: the title gives way to the marks after it. */
const WIDTH = 100;
/** The indent, the CLI and the state before a session's title. */
const BEFORE = LABEL + 2 + 9 + 11 + 1;

/** Visible width, colour codes aside. */
function width(text: string): number {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: SGR codes are what is stripped.
  return text.replace(/\u001b\[[0-9;]*m/g, '').length;
}

function padTo(text: string, size: number): string {
  return text + ' '.repeat(Math.max(0, size - width(text)));
}

/** A row per CLI: the state of each skill and the CLI's skills folder. */
export function skillLines(skills: readonly SkillStatus[], p: Paint): string[] {
  const brains = [...new Set(skills.map((s) => s.brain))];
  const cells = brains.map((brain) => {
    const mine = skills.filter((s) => s.brain === brain);
    if (mine.every((s) => s.state === 'no-cli')) return p.dim(t('нет CLI'));
    return mine
      .map((s) => {
        const project = s.places.some((place) => place.scope === 'project') ? ` ${t('(в проекте)')}` : '';
        const word =
          s.state === 'installed'
            ? p.c(GREEN, t('стоит') + project)
            : s.state === 'outdated'
              ? p.c(YELLOW, t('устарел') + project)
              : p.c(YELLOW, t('не стоит'));
        return `${s.skill} ${word}`;
      })
      .join(p.dim(' · '));
  });
  const name = Math.max(...brains.map((brain) => BRAIN_LABEL[brain].length)) + 2;
  const cell = Math.max(...cells.map(width)) + 3;
  return brains.map((brain, i) => {
    const absent = skills.find((s) => s.brain === brain)!;
    const dir = absent.state === 'no-cli' ? '' : p.dim(homeShort(absent.dir));
    return `${BRAIN_LABEL[brain].padEnd(name)}${dir ? padTo(cells[i]!, cell) + dir : cells[i]}`;
  });
}

/** Whether treeyard keeps the skills in place by itself, and how to switch that. */
export function skillsAutoLine(on: boolean): string {
  return on
    ? t('ставятся и обновляются сами при запуске treeyard · выключить — treeyard config skills off')
    : t('сами не ставятся · включить — treeyard config skills on');
}

function sessionState(session: LiveSession): string {
  if (session.status === 'busy') return t('работает{p1}', { p1: '' });
  if (session.status === 'waiting')
    return t('ждёт тебя{p1}', { p1: session.waitingFor ? `: ${session.waitingFor}` : '' });
  return t('открыт');
}

export function statusText(s: ProjectStatus, p: Paint): string {
  const lines: string[] = [];
  const ok = (text: string) => p.c(GREEN, text);
  const warn = (text: string) => p.c(YELLOW, text);
  const row = (label: string, value: string) => lines.push(`${p.dim(label.padEnd(LABEL))}${value}`);
  const more = (value: string) => lines.push(`${' '.repeat(LABEL)}${value}`);

  lines.push(`${p.c(GREEN, p.bold('treeyard'))} ${s.treeyard} ${p.dim('·')} Brainyard ${s.brainyard}`);

  const branch = s.worktree?.branch ? t(', ветка {branch}', { branch: s.worktree.branch }) : '';
  row(t('папка'), homeShort(s.folder) + (s.worktree ? p.dim(` · ${t('git worktree')}${branch}`) : ''));

  if (!s.tree) row(t('дерево'), warn(t('не посажено')));
  else {
    const main = s.worktree?.tree === 'main';
    row(
      t('дерево'),
      `«${s.tree.title}» ${p.dim(homeShort(join(s.tree.dir, '.tree')))}${main ? p.dim(` · ${t('основное')}`) : ''}`,
    );
    if (main)
      more(
        p.dim(
          s.worktree?.copy
            ? t('здесь копия ветки, человек видит основное — команды дерева с --project {main}', {
                main: homeShort(s.tree.dir),
              })
            : t('команды дерева — с --project {main}', { main: homeShort(s.tree.dir) }),
        ),
      );
    if (s.worktree?.tree === 'branch') more(p.dim(t('дерево только в этой ветке: в основной папке его нет')));
  }

  if (s.nodes) {
    const counts = STATUSES.filter((status) => s.nodes!.byStatus[status] > 0).map(
      (status) => `${STATUS_LABEL[status]} ${s.nodes!.byStatus[status]}`,
    );
    row(t('узлы'), `${s.nodes.total}${counts.length ? `: ${counts.join(p.dim(' · '))}` : ''}`);
    const abandoned = s.nodes.abandoned.map((node) => `«${node.title}» (${duration(0, node.hours * 3_600_000)})`);
    row(t('брошены'), abandoned.length ? warn(`${abandoned.length}: ${abandoned.join(', ')}`) : p.dim('0'));
  }

  skillLines(s.skills, p).forEach((line, i) => {
    if (i === 0) row(t('скиллы'), line);
    else more(line);
  });
  more(p.dim(skillsAutoLine(s.skillsAuto)));

  if (s.codex) {
    const { choice, lines: missing } = s.codex;
    const how = choice === 'ask' ? p.dim(t('не выбрано — спросит при первом запуске')) : ACCESS_LABEL[choice];
    // Under `sandbox` treeyard opens the way itself; otherwise config.toml has to.
    const through =
      choice === 'sandbox'
        ? ''
        : missing.length
          ? ` ${p.dim('·')} ${warn(t('config.toml не даёт доступа к treeyard и git'))}`
          : ` ${p.dim('·')} ${ok(t('config.toml даёт доступ к treeyard и git'))}`;
    row('Codex', how + through);
  }

  if (s.pointer) {
    const word = (state: string, via?: string[]) =>
      state === 'ok'
        ? ok(t('есть'))
        : state === 'via'
          ? ok(t('через {files}', { files: (via ?? []).join(', ') }))
          : state === 'outdated'
            ? warn(t('устарел'))
            : state === 'no-block'
              ? warn(t('без блока'))
              : p.dim(t('нет файла'));
    row(t('указатель'), s.pointer.map((file) => `${file.file} ${word(file.state, file.via)}`).join(p.dim(' · ')));
  }

  if (s.hook) {
    const file = s.hook.file ? p.dim(`  ${homeShort(s.hook.file)}`) : '';
    row(
      t('git-хук'),
      s.hook.state === 'installed'
        ? ok(t('стоит')) + file
        : s.hook.state === 'missing'
          ? warn(t('не стоит')) + file
          : s.hook.state === 'manual'
            ? warn(t('не стоит — хуки лежат в репозитории')) + file
            : p.dim(t('нет git')),
    );
  }

  if (s.mailHook?.length) {
    const brains = [...new Set(s.mailHook.map((place) => place.brain))];
    const name = Math.max(...brains.map((brain) => BRAIN_LABEL[brain].length)) + 1;
    brains.forEach((brain, i) => {
      const found = s.mailHook!.find((place) => place.brain === brain && place.installed);
      const install =
        brain === 'codex'
          ? t('не стоит · treeyard hook codex install')
          : brain === 'antigravity'
            ? t('не стоит · treeyard hook antigravity install')
            : t('не стоит · treeyard hook claude install');
      const state = found ? (found.needsUpdate ? warn(t('устарел')) : ok(t('стоит'))) : '';
      const text = found
        ? `${BRAIN_LABEL[brain].padEnd(name)}${state}  ${p.dim(`${found.scope === 'user' ? t('у тебя') : t('в проекте')} · ${homeShort(found.file)}`)}`
        : `${BRAIN_LABEL[brain].padEnd(name)}${p.dim(install)}`;
      if (i === 0) row(t('хук писем'), text);
      else more(text);
    });
  }

  if (s.sessions && s.panes) {
    const live = s.sessions.length;
    row(
      t('сессии'),
      live || s.panes.length
        ? t('живых {live} · панелей {panes}', { live, panes: s.panes.length })
        : p.dim(t('живых нет · панелей нет')),
    );
    const items: string[] = [];
    for (const session of s.sessions) {
      const marks = [
        ...(session.kind === 'background' ? [p.dim(t('в фоне'))] : []),
        ...(session.pane ? [p.dim(t('в панели'))] : []),
        ...(session.node ? [] : [warn(t('без узла'))]),
      ];
      const room = Math.max(20, WIDTH - BEFORE - width(marks.map((mark) => ` · ${mark}`).join('')));
      const what = session.nodeTitle
        ? clip(session.nodeTitle, room)
        : session.title
          ? `«${clip(session.title, room - 2)}»`
          : t('без названия');
      const state = session.status === 'waiting' ? warn(sessionState(session)) : sessionState(session);
      items.push(`${session.brain.padEnd(9)}${padTo(state, 11)} ${[what, ...marks].join(p.dim(' · '))}`);
    }
    const listed = new Set(s.sessions.map((session) => session.pane).filter(Boolean));
    for (const pane of s.panes.filter((pane) => !listed.has(pane.pane))) {
      const memory = formatMemory(pane.memory);
      const title = clip(pane.nodeTitle ?? pane.label ?? pane.pane, WIDTH - BEFORE - (memory ? memory.length + 3 : 0));
      items.push(
        `${(pane.brain ?? '?').padEnd(9)}${padTo(p.dim(t('панель')), 11)} ${title}${memory ? p.dim(` · ${memory}`) : ''}`,
      );
    }
    for (const item of items.slice(0, SESSION_LINES)) more(`  ${item}`);
    if (items.length > SESSION_LINES) more(p.dim(`  ${t('… и ещё {p1}', { p1: items.length - SESSION_LINES })}`));
  }

  const g = s.github;
  if (g) {
    if (g.state === 'off') row('GitHub', p.dim(t('выключено (github: off в .tree/tree.md)')));
    else if (g.state === 'unlinked')
      row(
        'GitHub',
        t('не подключено') +
          (g.remote ? p.dim(` · ${t('репозиторий {repo}: treeyard github link {repo}', { repo: g.remote })}`) : ''),
      );
    else {
      const parts = [
        ...(g.board ? [t('доска {board}', { board: g.board })] : []),
        ...(g.repo ? [t('issues {repo}', { repo: g.repo })] : []),
        g.gh === null
          ? warn(t('gh не ответил'))
          : g.gh?.user
            ? p.dim(t('gh: {user}', { user: g.gh.user }))
            : warn(t('gh не готов')),
        ...(g.pending ? [warn(t('не дошло до GitHub: {n}', { n: g.pending }))] : []),
      ];
      row('GitHub', parts.join(p.dim(' · ')));
    }
  }

  lines.push('');
  if (s.problems.length === 0) lines.push(ok(`✓ ${t('всё на месте')}`));
  else {
    lines.push(p.bold(t('Что исправить · {n}', { n: s.problems.length })));
    for (const problem of s.problems) {
      lines.push(`  ${warn('!')} ${problem.what}`);
      lines.push(`    ${problem.fix}${problem.or ? `   ${p.dim(t('или'))} ${problem.or}` : ''}`);
      for (const line of problem.lines ?? []) lines.push(`      ${line}`);
    }
  }
  return lines.join('\n');
}

/**
 * `treeyard status`: the project's setup in one look — versions, the folder
 * and its tree (the main one, from a git worktree), nodes by status and the
 * abandoned ones, the skills in each CLI, the block about the tree in the
 * agent files, the post-commit hook, live sessions and panes, the GitHub link.
 * Every problem comes with the command that fixes it.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve, sep } from 'node:path';

import { VERSION as BRAINYARD_VERSION, liveSessions, type SessionInfo } from '@antondanv/brainyard';

import { BRAIN_LABEL } from './agents/launch.js';
import { type Pane, paneFor, paneInProject, readPanes } from './agents/panes.js';
import { type SkillStatus, skillStates } from './agents/skills.js';
import { HOOK_LINE, hookInstalled, hookPlace } from './commit-hook.js';
import {
  boardOf,
  type Gh,
  type GhState,
  ghState,
  ghWithin,
  linkedRepo,
  pendingIssue,
  pendingMove,
  repoOf,
} from './github.js';
import { t } from './i18n/i18n.js';
import { homeShort } from './model/notes.js';
import { staleNodes } from './model/stale.js';
import { findProject, loadTree } from './model/store.js';
import { duration } from './model/time.js';
import { sessionHolders, sessionOwners } from './model/tree.js';
import { type BrainId, ROOT, STATUSES, type Status, type Tree } from './model/types.js';
import { settings, skillsAuto } from './settings.js';
import { type PointerStatus, pointerStates } from './templates/pointer.js';

const require = createRequire(import.meta.url);
/** src/ and dist/ both sit one level below package.json. */
export const VERSION = (require('../package.json') as { version: string }).version;

// ── Where we are ───────────────────────────────────────────────────────────

function gitLine(dir: string, args: string[]): string | undefined {
  try {
    const out = execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, LC_ALL: 'C' },
    }).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function inside(path: string, folder: string): boolean {
  const [a, b] = [real(path), real(folder)];
  return a === b || a.startsWith(b + sep);
}

export interface Worktree {
  /** This checkout's top folder. */
  top: string;
  /** The main checkout: the first folder `git worktree list` names. */
  main: string;
  branch?: string;
}

/** The linked git worktree `dir` is in; undefined in the main checkout or outside git. */
export function worktreeOf(dir: string): Worktree | undefined {
  const top = gitLine(dir, ['rev-parse', '--show-toplevel']);
  const list = gitLine(dir, ['worktree', 'list', '--porcelain']);
  const main = list ? /^worktree (.+)$/m.exec(list)?.[1] : undefined;
  if (!top || !main || real(top) === real(main)) return undefined;
  const branch = gitLine(dir, ['branch', '--show-current']);
  return { top, main, ...(branch ? { branch } : {}) };
}

export interface Place {
  /** Where the work happens: the project folder, or its checkout in a git worktree. */
  folder: string;
  /** The folder of the tree the person sees; undefined when there is no tree. */
  project?: string;
  worktree?: Worktree;
}

/**
 * The folder and its tree. In a git worktree `.tree/` is the branch's copy, and
 * the person sees the main checkout's tree: that is the tree here too.
 */
export function locate(start: string): Place {
  const here = findProject(start);
  const worktree = worktreeOf(start);
  if (worktree) {
    // A worktree inside the main folder (.claude/worktrees/x) without a tree of its own
    // finds the main tree by walking up: only a tree inside the worktree is its own.
    const own = here && inside(here, worktree.top) ? here : undefined;
    // Git names folders by their real path (/private/var on macOS): compare them that way.
    const spot = join(worktree.main, relative(real(worktree.top), real(own ?? start)));
    const main = findProject(spot);
    if (main && inside(main, worktree.main))
      return { folder: join(worktree.top, relative(real(worktree.main), real(main))), project: main, worktree };
    return { folder: own ?? start, ...(own ? { project: own } : {}), worktree };
  }
  return { folder: here ?? start, ...(here ? { project: here } : {}) };
}

// ── What is there ──────────────────────────────────────────────────────────

export type HookState = 'installed' | 'missing' | 'manual' | 'no-git';

export interface HookInfo {
  /** `manual` — hooks live inside the repository (husky and the like): the line is added by hand. */
  state: HookState;
  file?: string;
}

export interface LiveSession {
  brain: BrainId;
  id: string;
  title?: string;
  /** `busy`, `waiting` (for you), `idle`. */
  status: string;
  waitingFor?: string;
  /** `interactive` or `background`. */
  kind: string;
  /** The node that holds it; `root` for the project's own session. */
  node?: string;
  nodeTitle?: string;
  /** The tmux pane it runs in. */
  pane?: string;
}

export interface PaneSummary {
  pane: string;
  brain?: BrainId;
  label?: string;
  sessionId?: string;
  /** A terminal shows it full screen right now. */
  attached: boolean;
  memory?: number;
  node?: string;
  nodeTitle?: string;
}

export interface GithubInfo {
  /** `off` — `github: off` in tree.md. */
  state: 'linked' | 'unlinked' | 'off';
  /** The Project board, `owner/N`. */
  board?: string;
  /** The repository whose issues come in, `owner/name`. */
  repo?: string;
  /** The repository the git remote points to. */
  remote?: string;
  /** gh as it answered; null — it did not answer in time. Asked only when something is linked. */
  gh?: GhState | null;
  /** Nodes whose status has not reached their card or issue. */
  pending: number;
}

export interface Abandoned {
  id: string;
  title: string;
  hours: number;
  lastEntry?: string;
}

export interface Problem {
  /** A stable name: `skill-missing`, `hook-missing`, `abandoned`… */
  kind: string;
  what: string;
  /** The command that fixes it. */
  fix: string;
  /** Another way to fix it. */
  or?: string;
}

export interface WorktreeStatus extends Worktree {
  /** `main` — the tree shown is the main checkout's; `branch` — only the branch has a tree. */
  tree?: 'main' | 'branch';
  /** The worktree keeps its own copy of `.tree/` (the branch's), which the person does not see. */
  copy: boolean;
}

export interface ProjectStatus {
  treeyard: string;
  brainyard: string;
  folder: string;
  worktree?: WorktreeStatus;
  tree?: { dir: string; title: string; problems: string[] };
  nodes?: { total: number; byStatus: Record<Status, number>; abandoned: Abandoned[] };
  skills: SkillStatus[];
  /** treeyard installs and refreshes the skills by itself (setting `skills`). */
  skillsAuto: boolean;
  pointer?: PointerStatus[];
  hook?: HookInfo;
  sessions?: LiveSession[];
  panes?: PaneSummary[];
  github?: GithubInfo;
  problems: Problem[];
}

export interface StatusDeps {
  env?: NodeJS.ProcessEnv;
  /** Runs gh; by default the real one, given a few seconds. */
  gh?: Gh;
  /** Live sessions of these folders, from the CLIs. */
  live?: (dirs: string[]) => Promise<SessionInfo[]>;
  panes?: () => Promise<Pane[]>;
  now?: number;
}

async function liveIn(dirs: string[]): Promise<SessionInfo[]> {
  const lists = await Promise.all(dirs.map((cwd) => liveSessions({ cwd, panes: {} }).catch(() => [])));
  const unique = new Map<string, SessionInfo>();
  for (const session of lists.flat()) unique.set(`${session.brain}:${session.id}`, session);
  return [...unique.values()];
}

function hookInfo(folder: string): HookInfo {
  const place = hookPlace(folder);
  if (!place) return { state: 'no-git' };
  if (hookInstalled(folder)) return { state: 'installed', file: place.file };
  return { state: place.tracked ? 'manual' : 'missing', file: place.file };
}

async function githubInfo(tree: Tree, folder: string, deps: StatusDeps): Promise<GithubInfo> {
  const raw = tree.project.extra.github;
  const board = boardOf(tree);
  const repo = linkedRepo(tree);
  const remote = repoOf(folder);
  const base = remote ? { remote: `${remote.owner}/${remote.name}` } : {};
  if (!board && !repo) return { state: raw === 'off' || raw === false ? 'off' : 'unlinked', ...base, pending: 0 };
  const pending = [...tree.nodes.values()].filter((node) => pendingMove(tree, node) || pendingIssue(tree, node)).length;
  const limited = deps.gh ? { run: deps.gh, late: () => false } : ghWithin(8000);
  const state = await ghState(limited.run);
  return {
    state: 'linked',
    ...(board ? { board: `${board.owner}/${board.number}` } : {}),
    ...(repo ? { repo: `${repo.owner}/${repo.name}` } : {}),
    ...base,
    gh: limited.late() ? null : state,
    pending,
  };
}

/** Everything `treeyard status` shows, with the problems and their fixes. */
export async function projectStatus(place: Place, deps: StatusDeps = {}): Promise<ProjectStatus> {
  const env = deps.env ?? process.env;
  const head: Pick<ProjectStatus, 'treeyard' | 'brainyard' | 'folder' | 'worktree'> = {
    treeyard: VERSION,
    brainyard: BRAINYARD_VERSION,
    folder: place.folder,
  };
  if (place.worktree) {
    const branchTree = place.project ? inside(place.project, place.worktree.top) : false;
    head.worktree = {
      ...place.worktree,
      ...(place.project ? { tree: branchTree ? ('branch' as const) : ('main' as const) } : {}),
      copy: !branchTree && hasTree(place.folder),
    };
  }
  const skills = skillStates(place.folder, env);
  const skillsOn = skillsAuto(env);
  if (!place.project) {
    const status: ProjectStatus = { ...head, skills, skillsAuto: skillsOn, problems: [] };
    status.problems = problemsOf(status, place);
    return status;
  }
  const tree = loadTree(place.project);
  const dirs = [...new Set([tree.project.dir, place.folder])];
  const [live, panes, github] = await Promise.all([
    (deps.live ?? liveIn)(dirs).catch(() => [] as SessionInfo[]),
    (deps.panes ?? readPanes)().catch(() => [] as Pane[]),
    githubInfo(tree, place.folder, deps),
  ]);
  const own = panes.filter((pane) => dirs.some((dir) => paneInProject(pane, dir)));
  const running = live.filter((session) => session.live);
  const liveIds = new Set(running.map((session) => session.id));

  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
  for (const node of tree.nodes.values()) byStatus[node.status] += 1;
  const abandoned = staleNodes(tree, {
    afterHours: settings().staleAfter,
    ...(deps.now !== undefined ? { now: deps.now } : {}),
    live: (node) => node.sessions.some((ref) => liveIds.has(ref.id) || Boolean(paneFor(ref, own))),
  }).map(({ node, stale }) => ({
    id: node.id,
    title: node.title,
    hours: stale.hours,
    ...(stale.lastEntry ? { lastEntry: stale.lastEntry } : {}),
  }));

  const owners = sessionOwners(tree);
  const titleOf = (id: string) => (id === ROOT ? tree.project.title : tree.nodes.get(id)?.title);
  const holder = (pane: Pane) =>
    sessionHolders(tree).find((node) => node.sessions.some((ref) => paneFor(ref, [pane])))?.id;
  const sessions = running.map((session): LiveSession => {
    const node = owners.get(session.id);
    const pane = own.find((p) => p.sessionId === session.id)?.pane;
    return {
      brain: session.brain,
      id: session.id,
      ...(session.title ? { title: session.title } : {}),
      status: session.live!.status,
      ...(session.live!.waitingFor ? { waitingFor: session.live!.waitingFor } : {}),
      kind: session.live!.kind,
      ...(node ? { node, nodeTitle: titleOf(node) ?? node } : {}),
      ...(pane ? { pane } : {}),
    };
  });
  const paneList = own.map((pane): PaneSummary => {
    const node = holder(pane);
    return {
      pane: pane.pane,
      ...(pane.brain ? { brain: pane.brain } : {}),
      ...(pane.label ? { label: pane.label } : {}),
      ...(pane.sessionId ? { sessionId: pane.sessionId } : {}),
      attached: pane.attached,
      ...(pane.memory ? { memory: pane.memory } : {}),
      ...(node ? { node, nodeTitle: titleOf(node) ?? node } : {}),
    };
  });

  // In the order of the text, so `--json` reads the same way.
  const status: ProjectStatus = {
    ...head,
    tree: { dir: tree.project.dir, title: tree.project.title, problems: tree.problems },
    nodes: { total: tree.nodes.size, byStatus, abandoned },
    skills,
    skillsAuto: skillsOn,
    pointer: pointerStates(place.folder),
    hook: hookInfo(place.folder),
    sessions,
    panes: paneList,
    github,
    problems: [],
  };
  status.problems = problemsOf(status, place);
  return status;
}

// ── What to fix ────────────────────────────────────────────────────────────

function list(items: string[]): string {
  return items.join(', ');
}

/** The problems of a status, each with its fix, the most urgent first. */
export function problemsOf(status: ProjectStatus, place: Place): Problem[] {
  const out: Problem[] = [];
  // From a worktree, a command that writes the tree goes to the main one.
  const main = place.project && place.worktree && !inside(place.project, place.worktree.top) ? place.project : '';
  const onMain = (command: string) => (main ? `${command} --project ${homeShort(main)}` : command);
  const fromMain = (command: string) => (main ? `cd ${homeShort(main)} && ${command}` : command);

  if (!status.tree) out.push({ kind: 'no-tree', what: t('здесь нет дерева (.tree/)'), fix: 'treeyard init' });

  for (const problem of status.tree?.problems ?? []) {
    const file = /^(\S+\.md):/.exec(problem)?.[1];
    const node = /^([a-z0-9]{2,}):/.exec(problem)?.[1];
    const where = file === 'tree.md' ? 'tree.md' : file ? join('nodes', file) : undefined;
    if (where) {
      const path = homeShort(join(status.tree!.dir, '.tree', where));
      out.push({ kind: 'tree-file', what: problem, fix: `$EDITOR ${path}` });
    } else if (node) out.push({ kind: 'tree-parent', what: problem, fix: onMain(`treeyard set ${node} parent=root`) });
  }

  for (const node of status.nodes?.abandoned ?? [])
    out.push({
      kind: 'abandoned',
      what: t('«{title}» в работе, но живой сессии нет {time}', {
        title: node.title,
        time: duration(0, node.hours * 3_600_000),
      }),
      fix: onMain(`treeyard set ${node.id} status=todo`),
      ...(main ? {} : { or: `treeyard open ${node.id}` }),
    });

  // One line per kind: the fix is the same command. Skills missing from the same CLIs go together.
  const missing = new Map<string, string[]>();
  for (const skill of new Set(status.skills.map((s) => s.skill))) {
    const clis = status.skills
      .filter((s) => s.skill === skill && s.state === 'missing')
      .map((s) => BRAIN_LABEL[s.brain]);
    if (clis.length) missing.set(list(clis), [...(missing.get(list(clis)) ?? []), skill]);
  }
  if (missing.size)
    out.push({
      kind: 'skill-missing',
      what: [...missing]
        .map(([clis, skills]) =>
          skills.length > 1
            ? t('скиллов {skills} нет в {clis}', { skills: list(skills), clis })
            : t('скилла {skill} нет в {clis}', { skill: skills[0], clis }),
        )
        .join('; '),
      fix: 'treeyard skills install',
    });
  const outdated = status.skills.flatMap((s) => s.places.filter((p) => !p.current).map((p) => homeShort(p.path)));
  if (outdated.length)
    out.push({
      kind: 'skill-outdated',
      what: t('скиллы устарели: {places}', { places: list([...new Set(outdated)]) }),
      fix: 'treeyard skills install',
    });

  if (status.pointer) {
    const of = (state: PointerStatus['state']) => status.pointer!.filter((p) => p.state === state).map((p) => p.file);
    if (status.pointer.every((p) => p.state === 'absent'))
      out.push({
        kind: 'no-agent-file',
        what: t('нет ни AGENTS.md, ни CLAUDE.md, ни GEMINI.md — сессии, открытые не из дерева, о нём не узнают'),
        fix: 'touch AGENTS.md && treeyard pointer',
      });
    if (of('no-block').length)
      out.push({
        kind: 'pointer-missing',
        what: t('нет блока о дереве в {files}', { files: list(of('no-block')) }),
        fix: 'treeyard pointer',
      });
    if (of('outdated').length)
      out.push({
        kind: 'pointer-outdated',
        what: t('блок о дереве устарел в {files}', { files: list(of('outdated')) }),
        fix: 'treeyard pointer',
      });
  }

  if (status.hook?.state === 'missing')
    out.push({
      kind: 'hook-missing',
      what: t('git-хука нет — коммиты из сессий узлов не привязываются к узлам сами'),
      fix: 'treeyard hook install',
    });
  if (status.hook?.state === 'manual')
    out.push({
      kind: 'hook-manual',
      what: t('git-хука нет, а хуки лежат в репозитории — строку в post-commit добавляют руками'),
      fix: `echo '${HOOK_LINE}' >> ${relative(place.folder, status.hook.file!) || status.hook.file}`,
    });

  const github = status.github;
  if (github?.state === 'linked' && github.gh) {
    if (!github.gh.installed)
      out.push({
        kind: 'gh-missing',
        what: t('дерево связано с GitHub, а gh (GitHub CLI) не установлен'),
        fix: 'brew install gh',
      });
    else if (!github.gh.user) out.push({ kind: 'gh-login', what: t('gh не вошёл в GitHub'), fix: 'gh auth login' });
    else if (github.board && github.gh.scopes && !github.gh.scopes.includes('project'))
      out.push({
        kind: 'gh-scope',
        what: t('у gh нет доступа к доскам GitHub Project'),
        fix: 'gh auth refresh -s project',
      });
  }
  if (github?.pending)
    out.push({
      kind: 'github-pending',
      what: t('статусы узлов не дошли до GitHub: {n}', { n: github.pending }),
      fix: fromMain('treeyard github sync'),
    });
  return out;
}

function hasTree(dir: string): boolean {
  return existsSync(join(dir, '.tree', 'tree.md'));
}

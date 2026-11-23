/**
 * What an agent from the tree is allowed to do. Claude Code and OpenCode take their
 * access from their own settings; treeyard only narrows a plan to their plan modes.
 * Two CLIs get less than an agent from a node needs, so treeyard can start them with
 * more — but only once the person has seen that and agreed:
 *
 * - Antigravity has only plan and accept-edits and asks before every command, while an
 *   agent from a node has to run treeyard and the project's tests: full access or its
 *   ordinary mode.
 * - Codex's default sandbox shuts the tmux socket and the project's `.git`, so
 *   `treeyard send` and `git commit` from its session fail: a sandbox that lets treeyard
 *   and git through, or whatever config.toml says.
 */
import { labels, t } from '../i18n/i18n.js';
import type { BrainId } from '../model/types.js';
import { type Access, type CodexAccess, type Settings, settings } from '../settings.js';
import { sandboxArgs } from './codex-config.js';

/** What the person picks for a CLI: Antigravity's `full`|`normal`, Codex's `sandbox`|`config`. */
export type AccessChoice = Access | CodexAccess;

const CHOICES: Partial<Record<BrainId, readonly [AccessChoice, AccessChoice]>> = {
  antigravity: ['full', 'normal'],
  codex: ['sandbox', 'config'],
};

/** The CLIs treeyard can start with more rights than their own settings give. */
export function widensAccess(brain: BrainId): boolean {
  return brain in CHOICES;
}

/** The two choices for this CLI, the first one being the wider; empty for the CLIs that have none. */
export function accessChoices(brain: BrainId): readonly AccessChoice[] {
  return CHOICES[brain] ?? [];
}

/** The person's choice for this CLI; undefined — not chosen yet. */
export function accessOf(brain: BrainId): AccessChoice | undefined {
  if (brain === 'antigravity') return settings().antigravityAccess || undefined;
  if (brain === 'codex') return settings().codexAccess || undefined;
  return undefined;
}

/** The change to the settings that records a choice; an empty one — asked again at the next launch. */
export function accessPatch(brain: BrainId, choice: AccessChoice | ''): Partial<Settings> {
  if (brain === 'antigravity') return { antigravityAccess: choice as Access | '' };
  if (brain === 'codex') return { codexAccess: choice as CodexAccess | '' };
  return {};
}

/** Ask before the first launch: the CLI would get more rights, and the person has not said yes or no. */
export function needsAccessChoice(brain: BrainId): boolean {
  return widensAccess(brain) && !accessOf(brain);
}

/**
 * What a session of this CLI starts and resumes with beyond its own settings. Not chosen yet
 * means no extra rights: Antigravity's flag lives for one run, so a resumed session needs it
 * again; Codex takes its sandbox from the command line on every start too. `dir` is the
 * project, whose `.git` Codex's sandbox opens.
 */
export function fullAccess(brain: BrainId, dir: string): { permissionMode?: string; extraArgs?: string[] } {
  const choice = accessOf(brain);
  if (brain === 'antigravity' && choice === 'full') return { permissionMode: 'bypassPermissions' };
  if (brain === 'codex' && choice === 'sandbox') return { extraArgs: sandboxArgs(dir) };
  return {};
}

/** The choices, as the settings and the first question name them. */
export const ACCESS_LABEL: Record<AccessChoice, string> = labels(() => ({
  full: t('полный доступ'),
  normal: t('обычный режим'),
  sandbox: t('песочница + treeyard и git'),
  config: t('как в config.toml'),
}));

export const ACCESS_HINT: Record<AccessChoice, string> = labels(() => ({
  full: t('команды, правка и удаление файлов, сеть — без подтверждений'),
  normal: t('Antigravity спрашивает перед каждой командой — подтверждаешь в его сессии'),
  sandbox: t(
    'workspace-write, сеть и .git проекта открыты: treeyard send и git commit работают; остальное — из config.toml',
  ),
  config: t('песочница и подтверждения только из config.toml: treeyard send и git commit могут упереться в песочницу'),
}));

/** The question before a CLI's first launch, in the terminal and in the tree. */
export interface AccessQuestion {
  /** The CLI, as the person knows it. */
  name: string;
  title: string;
  /** What the CLI lacks and what treeyard can give. */
  intro: string;
  /** The key in `treeyard config`. */
  key: string;
  /** What the settings dialog calls the row. */
  row: string;
  /** The terminal prompt, and the answers it takes. */
  prompt: string;
  answers: string;
  /** Shown in the dialog after the question. */
  kept: string;
  /** Shown in the terminal after the question. */
  keptInShell: string;
  /** Said once the person has chosen. */
  chosen: (access: AccessChoice) => string;
  /** Said to an agent whose `open` cannot ask. */
  notChosen: string;
  /** Said to a person whose `treeyard config` value is wrong. */
  badValue: string;
  /** What the settings row says while nothing is chosen. */
  unset: string;
}

/** The question of a CLI that has one (see `widensAccess`). */
export function accessQuestion(brain: BrainId): AccessQuestion {
  if (brain === 'codex')
    return {
      name: 'Codex',
      title: t('Как запускать Codex из дерева?'),
      intro: t(
        'По умолчанию песочница Codex не пускает ни в сокет tmux, ни в .git проекта: treeyard send и git commit из его сессии не проходят. Treeyard может запускать его в песочнице workspace-write с открытой сетью и .git проекта среди записываемых папок; остальное — из config.toml.',
      ),
      key: 'codex_access',
      row: t('Права Codex'),
      prompt: t('Песочница + treeyard и git?'),
      answers: t('[y — песочница + treeyard и git · n — как в config.toml · ⏎ — не запускать]'),
      kept: t('Выбор запомнится для всех проектов · поменять — «,» → «Права Codex»'),
      keptInShell: t('Выбор запомнится для всех проектов · поменять — treeyard config codex_access или «,» в дереве'),
      chosen: (access) => t('Codex: {access} · поменять — «,» → «Права Codex»', { access: ACCESS_LABEL[access] }),
      notChosen: t(
        'права Codex ещё не выбраны — человек выбирает в дереве («,» → «Права Codex») или командой treeyard config codex_access sandbox|config',
      ),
      badValue: t('права Codex: sandbox, config или ask — спросить при запуске'),
      unset: t('спрошу перед первым запуском Codex'),
    };
  return {
    name: 'Antigravity',
    title: t('Какие права дать Antigravity?'),
    intro: t(
      'Antigravity спрашивает разрешения перед каждой командой, а агенту из узла нужно запускать treeyard, тесты и git. Treeyard может запускать его с полным доступом (--dangerously-skip-permissions).',
    ),
    key: 'antigravity_access',
    row: t('Права Antigravity'),
    prompt: t('Полный доступ?'),
    answers: t('[y — полный · n — обычный · ⏎ — не запускать]'),
    kept: t('Выбор запомнится для всех проектов · поменять — «,» → «Права Antigravity»'),
    keptInShell: t(
      'Выбор запомнится для всех проектов · поменять — treeyard config antigravity_access или «,» в дереве',
    ),
    chosen: (access) =>
      t('Antigravity: {access} · поменять — «,» → «Права Antigravity»', { access: ACCESS_LABEL[access] }),
    notChosen: t(
      'права Antigravity ещё не выбраны — человек выбирает в дереве («,» → «Права Antigravity») или командой treeyard config antigravity_access full|normal',
    ),
    badValue: t('права Antigravity: full, normal или ask — спросить при запуске'),
    unset: t('спрошу перед первым запуском Antigravity'),
  };
}

/** What a session of this CLI may do, started in this permission mode: the «Права» row before a launch. */
export function accessText(brain: BrainId, permissionMode?: string): string {
  if (permissionMode === 'bypassPermissions') return t('полный доступ: команды, файлы и сеть без подтверждений');
  if (permissionMode === 'plan')
    return brain === 'opencode'
      ? t('агент plan: правит файлы только после твоего «да»')
      : t('режим плана: правит файлы только после твоего «да»');
  if (brain === 'antigravity') return t('обычный режим: спрашивает перед каждой командой');
  if (brain === 'codex')
    return accessOf('codex') === 'sandbox'
      ? t('песочница + treeyard и git: workspace-write, сеть и .git проекта открыты; остальное — из config.toml')
      : t('как в настройках Codex: песочница и подтверждения из его config.toml');
  if (brain === 'opencode') return t('как в настройках OpenCode: permission в opencode.json');
  return t('как в настройках Claude Code: спрашивает по своим правилам');
}

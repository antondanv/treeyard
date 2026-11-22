/**
 * What an agent from the tree is allowed to do. Claude Code, Codex and
 * OpenCode take their access from their own settings; treeyard only narrows a
 * plan to their plan modes. Antigravity has only plan and accept-edits there
 * and asks before every command, while an agent from a node has to run
 * treeyard and the project's tests — so treeyard can start it with full
 * access, but only once the person has seen that and agreed.
 */
import { labels, t } from '../i18n/i18n.js';
import type { BrainId } from '../model/types.js';
import { type Access, settings } from '../settings.js';

/** The CLIs treeyard can start with more rights than their own settings give. */
export function widensAccess(brain: BrainId): boolean {
  return brain === 'antigravity';
}

/** The person's choice for this CLI; undefined — not chosen yet. */
export function accessOf(brain: BrainId): Access | undefined {
  if (!widensAccess(brain)) return undefined;
  return settings().antigravityAccess || undefined;
}

/** Ask before the first launch: the CLI would get more rights, and the person has not said yes or no. */
export function needsAccessChoice(brain: BrainId): boolean {
  return widensAccess(brain) && !accessOf(brain);
}

/**
 * The permission mode a session starts and resumes in. Not chosen yet means
 * no extra rights: the flag lives for one run, so a resumed session needs it again.
 */
export function fullAccess(brain: BrainId): { permissionMode?: string } {
  return accessOf(brain) === 'full' ? { permissionMode: 'bypassPermissions' } : {};
}

/** The choices for Antigravity, as the settings and the first question name them. */
export const ACCESS_LABEL: Record<Access, string> = labels(() => ({
  full: t('полный доступ'),
  normal: t('обычный режим'),
}));

export const ACCESS_HINT: Record<Access, string> = labels(() => ({
  full: t('команды, правка и удаление файлов, сеть — без подтверждений'),
  normal: t('Antigravity спрашивает перед каждой командой — подтверждаешь в его сессии'),
}));

/** What a session of this CLI may do, started in this permission mode: the «Права» row before a launch. */
export function accessText(brain: BrainId, permissionMode?: string): string {
  if (permissionMode === 'bypassPermissions') return t('полный доступ: команды, файлы и сеть без подтверждений');
  if (permissionMode === 'plan')
    return brain === 'opencode'
      ? t('агент plan: правит файлы только после твоего «да»')
      : t('режим плана: правит файлы только после твоего «да»');
  if (brain === 'antigravity') return t('обычный режим: спрашивает перед каждой командой');
  if (brain === 'codex') return t('как в настройках Codex: песочница и подтверждения из его config.toml');
  if (brain === 'opencode') return t('как в настройках OpenCode: permission в opencode.json');
  return t('как в настройках Claude Code: спрашивает по своим правилам');
}

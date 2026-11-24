/**
 * Startup dialogs a CLI shows on its pane's screen before it writes a transcript or reports a live
 * session: trusting the folder (Claude Code, Codex, Antigravity) and allowing external `CLAUDE.md`
 * imports (Claude Code). Only the person answers them, in the pane.
 */
import { t } from '../i18n/i18n.js';
import type { BrainId } from '../model/types.js';

export type StartupDialog = 'folder-trust' | 'external-imports';

// biome-ignore lint/suspicious/noControlCharactersInRegex: escape sequences are what is stripped.
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
const RULE = /^[╭╮╰╯┌┐└┘├┤┬┴┼─━═╌╍┄┅┈┉\s]+$/;
const CODE_LINE = /^['"`+-]|['"`,;)\]}]$/;
const NUMBERED_CHOICE = /^[❯›>▸▶*]?\s*[1-4][.)]\s+(.+)$/;
const CURSOR_CHOICE = /^[❯›>▸▶]\s+(.+)$/;
const BARE_CHOICE =
  /^(?:yes,\s*(?:i trust|trust|proceed|continue|allow)|trust this (?:folder|directory)|no,\s*(?:exit|quit|skip|disable|don't|do not|ask me)|don't (?:trust|allow))\b/i;
const AFFIRMATIVE = /^(?:yes|allow|trust)\b/i;
const NEGATIVE = /^(?:no|don't|do not|quit|exit|skip|disable|cancel|require approval)\b/i;
const TURN_AFTER = /^[⏺●✦◆]|^[❯›>]\s+/;

const EXTERNAL_IMPORTS_PROMPT =
  /(?:allow\s+)?external\s+claude\.md\s+(?:file\s+)?imports\b|external\s+includes\b|claude\.md\s+imports\s+files\s+outside/i;
const FOLDER_TRUST_PROMPT =
  /do you trust the (?:files|contents) (?:in|of) this (?:folder|directory|project)|quick safety check:\s+is this a project you created or one you trust|\btrust this (?:folder|directory)\b|since this folder is (?:not )?version controlled\b/i;

/** What `waitingFor` and `heldFor` say for a startup dialog, in the current language. */
export function startupWaitingFor(dialog: StartupDialog): string {
  return dialog === 'external-imports' ? t('внешние импорты CLAUDE.md') : t('доверие к папке');
}

function unbox(line: string): string {
  return line
    .replace(/^\s*[│┃║]\s?/, '')
    .replace(/\s?[│┃║]\s*$/, '')
    .trim();
}

function choiceKind(row: string): { kind: 'yes' | 'no'; label: string } | undefined {
  if (CODE_LINE.test(row)) return undefined;
  const label = (NUMBERED_CHOICE.exec(row)?.[1] ?? CURSOR_CHOICE.exec(row)?.[1] ?? (BARE_CHOICE.test(row) ? row : ''))
    .trim()
    .replace(/\.$/, '');
  if (!label) return undefined;
  if (AFFIRMATIVE.test(label)) return { kind: 'yes', label };
  if (NEGATIVE.test(label)) return { kind: 'no', label };
  return undefined;
}

/**
 * Spots a Claude Code, Codex or Antigravity startup dialog at the bottom of a pane's screen.
 * Requires active Yes/No choices near the bottom and the dialog's prompt above them, so mentions in
 * code or chat never count.
 */
export function paneDialog(lines: readonly string[], brain?: BrainId): StartupDialog | undefined {
  if (brain && brain !== 'claude' && brain !== 'codex' && brain !== 'antigravity') return undefined;
  const plain = lines.map((line) => line.replace(ANSI, '').trimEnd());
  while (plain.length && !plain.at(-1)) plain.pop();
  const rows = plain
    .filter((line) => line.trim())
    .slice(-24)
    .filter((line) => !RULE.test(line))
    .map(unbox)
    .filter(Boolean);
  if (rows.length < 2) return undefined;

  const windowStart = Math.max(0, rows.length - 12);
  const choices: { index: number; kind: 'yes' | 'no'; label: string }[] = [];
  for (let index = windowStart; index < rows.length; index++) {
    const hit = choiceKind(rows[index]!);
    if (hit) choices.push({ index, ...hit });
  }
  if (!choices.some((c) => c.kind === 'yes') || !choices.some((c) => c.kind === 'no')) return undefined;
  const firstChoice = choices[0]!.index;
  const lastChoice = choices.at(-1)!.index;
  if (rows.length - 1 - lastChoice > 4) return undefined;
  if (rows.slice(lastChoice + 1).some((row) => TURN_AFTER.test(row))) return undefined;

  const above = rows.slice(0, firstChoice).join(' ');
  if ((brain === undefined || brain === 'claude') && EXTERNAL_IMPORTS_PROMPT.test(above)) return 'external-imports';
  if (
    FOLDER_TRUST_PROMPT.test(above) ||
    choices.some((choice) => /\btrust this (?:folder|directory)\b/i.test(choice.label))
  )
    return 'folder-trust';
  return undefined;
}

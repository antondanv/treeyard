/**
 * `treeyard models` and `treeyard limits` as text: available models with reasoning
 * effort levels and subscription quota windows.
 */
import {
  type BrainUsage,
  models as brainyardModels,
  usage as brainyardUsage,
  type Catalog,
} from '@antondanv/brainyard';

import { BRAIN_LABEL } from '../agents/launch.js';
import { t } from '../i18n/i18n.js';
import { ago, clockOf } from '../model/time.js';
import type { BrainId } from '../model/types.js';
import type { Paint } from './print.js';

export interface CatalogResult {
  brain: BrainId;
  catalog?: Catalog;
  error?: string;
}

/** Ask Brainyard for models and effort levels of the requested CLIs. */
export async function fetchCatalogs(
  brains: readonly BrainId[],
  modelsFn: (brain: BrainId) => Promise<Catalog> = brainyardModels,
): Promise<CatalogResult[]> {
  return Promise.all(
    brains.map(async (brain) => {
      try {
        const catalog = await modelsFn(brain);
        return { brain, catalog };
      } catch (err: unknown) {
        return { brain, error: (err as Error)?.message ?? String(err) };
      }
    }),
  );
}

const QUOTA_TIMEOUT_MS = 15_000;
const CODEX_SNAPSHOT_MAX_AGE_MS = 60 * 60 * 1000;

/** Keep inference disabled and let Brainyard cancel quota requests at their timeout. */
export function fetchLimits(brains: readonly BrainId[], offline: boolean, usageFn = brainyardUsage) {
  return usageFn({
    brains,
    limit: 0,
    live: false,
    offline,
    timeoutMs: QUOTA_TIMEOUT_MS,
  });
}

/** Format model catalogs into text: CLI name, model id, label, and efforts. */
export function modelsText(results: readonly CatalogResult[], p: Paint): string {
  const blocks: string[] = [];
  for (const { brain, catalog, error } of results) {
    const lines: string[] = [p.bold(BRAIN_LABEL[brain])];
    if (error) {
      lines.push(`  ${p.dim(t('ошибка: {error}', { error }))}`);
    } else if (!catalog || catalog.models.length === 0) {
      const reason =
        catalog?.source === 'builtin' && brain === 'opencode'
          ? t('{brain} не дал список моделей', { brain: BRAIN_LABEL[brain] })
          : (catalog?.note ?? t('нет доступных моделей'));
      lines.push(`  ${p.dim(reason)}`);
    } else {
      const models = catalog.models;
      const maxId = Math.max(...models.map((m) => m.id.length));
      const hasDifferentLabel = models.some((m) => m.label && m.label !== m.id);
      const maxLabel = hasDifferentLabel
        ? Math.max(...models.map((m) => (m.label && m.label !== m.id ? m.label.length : 0)))
        : 0;

      for (const m of models) {
        const idCol = m.id.padEnd(maxId);
        const labelText = m.label && m.label !== m.id ? m.label : '';
        const labelCol = maxLabel > 0 ? `${labelText.padEnd(maxLabel)}  ` : '';
        const efforts = m.efforts.length
          ? m.efforts.map((e) => (m.defaultEffort === e ? `${e}*` : e)).join(' · ')
          : p.dim('—');
        lines.push(`  ${idCol}  ${labelCol}${efforts}`);
      }
      if (models.some((m) => m.defaultEffort && m.efforts.includes(m.defaultEffort))) {
        lines.push(`  ${p.dim(t('* — по умолчанию'))}`);
      }
    }
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}

function sourceLabel(source: string | null): string {
  if (!source) return '';
  switch (source) {
    case 'cache':
      return t('кеш');
    case 'rollout':
      return 'rollout';
    case 'cli':
      return 'CLI';
    case 'api':
      return 'API';
    case 'live':
      return 'live';
    default:
      return source;
  }
}

function ageLabel(observedAt: string | null, now: number): string {
  if (!observedAt) return '';
  const a = ago(observedAt, now);
  if (!a) return '';
  return a === t('только что') || a === t('вчера') ? a : t('{age} назад', { age: a });
}

function unavailableText(b: BrainUsage): string {
  if (b.limitsUnavailable === 'not_requested') {
    return t('нет локальных данных (в офлайн-режиме сетевые запросы отключены)');
  }
  if (b.limitsUnavailable === 'other_account') {
    return t('нет локальных данных (кеш другого аккаунта)');
  }
  if (b.limitsUnavailable === 'unsupported') {
    return t('лимиты не поддерживаются');
  }
  if (b.limitsUnavailable === 'failed') {
    return b.detail ? t('ошибка: {detail}', { detail: b.detail }) : t('не удалось прочитать лимиты');
  }
  return b.detail ?? t('нет локальных данных');
}

/**
 * A window whose reset time has passed is already reset: show 0% and mark it,
 * keeping the stale value as `previousUtilization` (snapshots are not refreshed offline).
 */
export function annotateLimits(
  brains: readonly BrainUsage[],
  now = Date.now(),
): (BrainUsage & { limitsStale?: true })[] {
  return brains.map((b) => {
    if (!b.limits) return b;
    const limits = b.limits.map((w) =>
      w.resetsAt && w.resetsAt * 1000 <= now
        ? { ...w, utilization: 0, expired: true, previousUtilization: w.utilization }
        : w,
    );
    const stale =
      b.brain === 'codex' &&
      b.limitsSource === 'rollout' &&
      b.limitsObservedAt !== null &&
      now - Date.parse(b.limitsObservedAt) > CODEX_SNAPSHOT_MAX_AGE_MS;
    return stale ? { ...b, limits, limitsStale: true } : { ...b, limits };
  });
}

/** Format local limit windows into text: CLI name, metadata, windows, percentages, reset time. */
export function limitsText(rawBrains: readonly BrainUsage[], p: Paint, now = Date.now()): string {
  const brains = annotateLimits(rawBrains, now);
  const blocks: string[] = [];
  for (const b of brains) {
    const src = sourceLabel(b.limitsSource);
    const age = ageLabel(b.limitsObservedAt, now);
    const metaParts = [src, age, b.limitsStale ? t('снимок устарел') : ''].filter(Boolean);
    const meta = metaParts.length ? p.dim(` · ${metaParts.join(' · ')}`) : '';
    const header = `${p.bold(BRAIN_LABEL[b.brain])}${meta}`;
    const lines: string[] = [header];

    if (!b.limits || b.limits.length === 0) {
      lines.push(`  ${p.dim(unavailableText(b))}`);
    } else {
      // Antigravity labels remaining quota, but Brainyard gives us the fraction used.
      const names = b.limits.map((w) =>
        b.brain === 'antigravity' ? [w.group, w.window].filter(Boolean).join(' · ') : (w.label ?? w.window),
      );
      const maxWindow = Math.max(...names.map((name) => name.length));
      for (const [index, w] of b.limits.entries()) {
        const windowName = names[index]!.padEnd(maxWindow);
        const pct = Math.round(w.utilization * 100);
        const pctText = `${pct}%`.padStart(4);
        const coloredPct = pct >= 90 ? p.c('#ff7b72', pctText) : pct >= 75 ? p.c('#ffcf70', pctText) : pctText;
        const expired = (w as { expired?: boolean }).expired === true;
        const time = w.resetsAt ? clockOf(w.resetsAt * 1000, now) : '';
        // Literal keys, so the i18n check sees both lines.
        const resetText = expired ? t('сброшено в {time}', { time }) : t('сброс в {time}', { time });
        const reset = w.resetsAt ? p.dim(` · ${resetText}`) : '';
        lines.push(`  ${windowName}  ${coloredPct}${reset}`);
      }
      if (b.limitsStale) {
        lines.push(`  ${p.dim(t('Снимок обновится, когда сессия Codex запишет новые лимиты в rollout.'))}`);
      }
    }
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}

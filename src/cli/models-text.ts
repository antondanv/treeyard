/**
 * `treeyard models` and `treeyard limits` as text: available models with reasoning
 * effort levels and local quota/limit windows without network calls.
 */
import {
  type BrainUsage,
  models as brainyardModels,
  usage as brainyardUsage,
  type Catalog,
  type UsageReport,
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

/** Read local limit snapshots without making network requests. */
export async function fetchLimits(
  brains: readonly BrainId[],
  usageFn: (options: { brains: BrainId[]; limit: number; offline: boolean }) => Promise<UsageReport> = brainyardUsage,
): Promise<UsageReport> {
  return usageFn({
    brains: brains as BrainId[],
    limit: 0,
    offline: true,
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

function ageLabel(observedAt: string | null): string {
  if (!observedAt) return '';
  const a = ago(observedAt);
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
    return b.detail ? t('ошибка: {detail}', { detail: b.detail }) : t('не удалось прочитать локальные лимиты');
  }
  return b.detail ?? t('нет локальных данных');
}

/**
 * A window whose reset time has passed is already reset: show 0% and mark it,
 * keeping the stale value as `previousUtilization` (snapshots are not refreshed offline).
 */
export function settleExpired(brains: readonly BrainUsage[], now = Date.now()): BrainUsage[] {
  return brains.map((b) => {
    if (!b.limits) return b;
    const limits = b.limits.map((w) =>
      w.resetsAt && w.resetsAt * 1000 <= now
        ? { ...w, utilization: 0, expired: true, previousUtilization: w.utilization }
        : w,
    );
    return { ...b, limits };
  });
}

/** Format local limit windows into text: CLI name, metadata, windows, percentages, reset time. */
export function limitsText(rawBrains: readonly BrainUsage[], p: Paint, now = Date.now()): string {
  const brains = settleExpired(rawBrains, now);
  const blocks: string[] = [];
  for (const b of brains) {
    const src = sourceLabel(b.limitsSource);
    const age = ageLabel(b.limitsObservedAt);
    const metaParts = [src, age].filter(Boolean);
    const meta = metaParts.length ? p.dim(` · ${metaParts.join(' · ')}`) : '';
    const header = `${p.bold(BRAIN_LABEL[b.brain])}${meta}`;
    const lines: string[] = [header];

    if (!b.limits || b.limits.length === 0) {
      lines.push(`  ${p.dim(unavailableText(b))}`);
    } else {
      const maxWindow = Math.max(...b.limits.map((w) => (w.label ?? w.window).length));
      for (const w of b.limits) {
        const windowName = (w.label ?? w.window).padEnd(maxWindow);
        const pct = Math.round(w.utilization * 100);
        const pctText = `${pct}%`.padStart(4);
        const coloredPct = pct >= 90 ? p.c('#ff7b72', pctText) : pct >= 75 ? p.c('#ffcf70', pctText) : pctText;
        const expired = (w as { expired?: boolean }).expired === true;
        const resetKey = expired ? 'сброшено в {time}' : 'сброс в {time}';
        const reset = w.resetsAt ? p.dim(` · ${t(resetKey, { time: clockOf(w.resetsAt * 1000, now) })}`) : '';
        lines.push(`  ${windowName}  ${coloredPct}${reset}`);
      }
    }
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}

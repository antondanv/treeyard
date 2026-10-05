/**
 * Which models and efforts each CLI offers, for the settings and the launch
 * form. Brainyard asks the CLI itself (`codex debug models`, `agy models`,
 * `opencode models`; Claude Code has aliases that always mean the latest
 * model), so the list is never typed by hand and never stale.
 *
 * Asking takes a moment, so the list arrives after the dialog opens; until
 * then the dialog shows what is chosen now.
 */
import { type Catalog, type Effort, models } from '@antondanv/brainyard';
import { useEffect, useState } from 'react';

import { BRAIN_LABEL } from '../agents/launch.js';
import { plural, t } from '../i18n/i18n.js';
import type { BrainId } from '../model/types.js';

const known = new Map<BrainId, Catalog>();
const asking = new Map<BrainId, Promise<Catalog>>();

function ask(brain: BrainId): Promise<Catalog> {
  let pending = asking.get(brain);
  if (!pending) {
    pending = models(brain).then((catalog) => {
      known.set(brain, catalog);
      return catalog;
    });
    // A failed ask is asked again next time.
    pending.catch(() => asking.delete(brain));
    asking.set(brain, pending);
  }
  return pending;
}

/** The catalog of a CLI; undefined while it is being asked or while `active` is false. */
export function useCatalog(brain: BrainId, active = true): Catalog | undefined {
  const [catalog, setCatalog] = useState<Catalog | undefined>(() => known.get(brain));
  useEffect(() => {
    if (!active) return;
    const ready = known.get(brain);
    if (ready) return setCatalog(ready);
    setCatalog(undefined);
    let current = true;
    ask(brain)
      .then((found) => current && setCatalog(found))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [brain, active]);
  return catalog?.brain === brain ? catalog : undefined;
}

export interface Option {
  value: string;
  label: string;
}

/** «CLI default» first, then the models of the catalog; a name chosen elsewhere stays in the list. */
export function modelOptions(catalog: Catalog | undefined, current: string | undefined): Option[] {
  const options: Option[] = [{ value: '', label: t('по умолчанию CLI') }];
  for (const entry of catalog?.models ?? []) options.push({ value: entry.id, label: entry.label });
  if (current && !options.some((option) => option.value === current)) options.push({ value: current, label: current });
  return options;
}

/** The efforts the chosen model understands; the CLI's own list when no model is chosen. */
export function effortsFor(catalog: Catalog | undefined, model: string | undefined): Effort[] | undefined {
  if (!catalog) return undefined;
  const entry = model ? catalog.models.find((m) => m.id === model) : undefined;
  if (entry) return entry.efforts;
  return catalog.defaultEfforts;
}

/** «Default» first, then the efforts; the model's own default is marked. */
export function effortOptions(catalog: Catalog | undefined, model: string | undefined, current?: string): Option[] {
  const options: Option[] = [{ value: '', label: t('по умолчанию') }];
  const efforts = effortsFor(catalog, model);
  const entry = model ? catalog?.models.find((m) => m.id === model) : undefined;
  for (const effort of efforts ?? ['low', 'medium', 'high', 'xhigh', 'max'])
    options.push({ value: effort, label: entry?.defaultEffort === effort ? `${effort}*` : effort });
  if (current && !options.some((option) => option.value === current)) options.push({ value: current, label: current });
  return options;
}

/** An effort the new model does not understand falls back to the default. */
export function fitEffort(catalog: Catalog | undefined, model: string | undefined, effort: string): string {
  const efforts = effortsFor(catalog, model);
  if (!efforts || !effort) return effort;
  return (efforts as string[]).includes(effort) ? effort : '';
}

/** A choice made without the list at hand (no confirmation): an effort the model does not take is left to the CLI. */
export async function fitChoice<T extends { brain: BrainId; model?: string; effort?: string }>(choice: T): Promise<T> {
  if (!choice.effort) return choice;
  const catalog = await ask(choice.brain).catch(() => undefined);
  const { effort, ...rest } = choice;
  const fitted = fitEffort(catalog, choice.model, effort);
  return (fitted ? { ...rest, effort: fitted } : rest) as T;
}

/** Where the list came from, said in a line under the row. */
export function catalogHint(brain: BrainId, catalog: Catalog | undefined, model?: string): string {
  if (!catalog)
    return t('спрашиваю у {brain} список моделей…', {
      brain: BRAIN_LABEL[brain],
    });
  const entry = model ? catalog.models.find((m) => m.id === model) : undefined;
  const efforts = entry?.efforts.length
    ? t(' · усилие: {list}', {
        list: entry.efforts.join(', '),
      })
    : entry
      ? t(' · усилие не настраивается')
      : '';
  if (brain === 'claude') return t('псевдонимы Claude Code — всегда последняя версия модели') + efforts;
  // OpenCode has no list to fall back on: its models are the providers connected to it.
  if (catalog.source === 'builtin' && catalog.models.length === 0)
    return t('{brain} не дал список моделей', { brain: BRAIN_LABEL[brain] });
  if (catalog.source === 'builtin') return t('встроенный список: CLI не ответил') + efforts;
  return (
    t('{n} {models} из {brain}', {
      n: catalog.models.length,
      models: plural(catalog.models.length, ['модель', 'модели', 'моделей'], ['model', 'models']),
      brain: BRAIN_LABEL[brain],
    }) + efforts
  );
}

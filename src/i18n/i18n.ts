/**
 * Two languages: Russian, the source, and English, the default.
 *
 * Russian text is the key: `t('Новая сессия')` reads like the screen does,
 * and English lives in a dictionary next to it. Placeholders are `{name}`.
 * A missing translation falls back to Russian — visible, never broken — and
 * a test checks that every `t()` in the code has an English line.
 *
 * Long texts for agents (prompts, context) are not keys: they are written in
 * both languages where they are used, with `pick()`.
 */
import { EN } from './en.js';

export type Lang = 'ru' | 'en';

export const LANGS: readonly Lang[] = ['ru', 'en'];

let current: Lang = 'en';

export function setLang(lang: Lang): void {
  current = lang;
}

export function lang(): Lang {
  return current;
}

export function t(text: string, params?: Record<string, string | number | undefined>): string {
  const template = current === 'en' ? (EN[text] ?? text) : text;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = params[key];
    return value === undefined ? whole : String(value);
  });
}

/**
 * A table of labels that follows the language: `labels(() => ({ todo: t('к работе') }))`.
 * The texts are built on every read, so a switch of language shows at once.
 */
export function labels<K extends string>(build: () => Record<K, string>): Record<K, string> {
  return new Proxy({} as Record<K, string>, {
    get: (_, key) => build()[key as K],
    ownKeys: () => Reflect.ownKeys(build()),
    getOwnPropertyDescriptor: (_, key) => ({ enumerable: true, configurable: true, value: build()[key as K] }),
  });
}

/** The variant for the current language. */
export function pick<T>(variants: Record<Lang, T>): T {
  return variants[current];
}

/** Russian plural: 1 узел, 2 узла, 5 узлов. English: 1 node, 2 nodes. */
export function plural(n: number, ru: [string, string, string], en: [string, string]): string {
  if (current === 'en') return n === 1 ? en[0] : en[1];
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return ru[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return ru[1];
  return ru[2];
}

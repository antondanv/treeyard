/** Dates in local time: a person reads these files, not only a program. */
import { t } from '../i18n/i18n.js';

const pad = (value: number) => String(value).padStart(2, '0');

/** `2026-10-01T23:14:05+03:00` */
export function nowIso(date = new Date()): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const hours = pad(Math.floor(Math.abs(offset) / 60));
  const minutes = pad(Math.abs(offset) % 60);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${hours}:${minutes}`
  );
}

/** `2026-10-01` */
export function today(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `2026-10-01 23:14` — for journal lines. */
export function stamp(date = new Date()): string {
  return `${today(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** «только что», «5 мин», «3 ч», «вчера», «4 дн», «12.08». */
export function ago(value: string | number | undefined, now = Date.now()): string {
  if (value === undefined) return '';
  const time = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(time)) return '';
  const seconds = Math.max(0, (now - time) / 1000);
  if (seconds < 60) return t('только что');
  if (seconds < 3600)
    return t('{p1} мин', {
      p1: Math.floor(seconds / 60),
    });
  const date = new Date(time);
  const current = new Date(now);
  if (seconds < 86_400 && date.getDate() === current.getDate())
    return t('{p1} ч', {
      p1: Math.floor(seconds / 3600),
    });
  const days = Math.floor((startOfDay(current) - startOfDay(date)) / 86_400_000);
  if (days <= 1) return t('вчера');
  if (days < 30)
    return t('{days} дн', {
      days,
    });
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}${date.getFullYear() === current.getFullYear() ? '' : `.${date.getFullYear()}`}`;
}

/** How long something has been going on: «12 мин», «3 ч», «5 дн». */
export function duration(fromValue: string | number | undefined, now = Date.now()): string {
  if (fromValue === undefined) return '';
  const from = typeof fromValue === 'number' ? fromValue : Date.parse(fromValue);
  if (!Number.isFinite(from)) return '';
  const minutes = Math.max(0, Math.floor((now - from) / 60_000));
  if (minutes < 1) return t('меньше минуты');
  if (minutes < 60)
    return t('{minutes} мин', {
      minutes,
    });
  const hours = Math.floor(minutes / 60);
  if (hours < 48)
    return t('{hours} ч', {
      hours,
    });
  return t('{p1} дн', {
    p1: Math.floor(hours / 24),
  });
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

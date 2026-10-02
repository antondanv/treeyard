/**
 * Markdown with YAML front matter: `---\n<yaml>\n---\n<body>`.
 */
import { parse, stringify } from 'yaml';

export interface Document {
  data: Record<string, unknown>;
  body: string;
}

const FENCE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function parseDocument(text: string): Document {
  const match = FENCE.exec(text.replace(/^﻿/, ''));
  if (!match) return { data: {}, body: text };
  let data: unknown;
  try {
    data = parse(match[1] ?? '');
  } catch (error) {
    throw new Error(`front matter is not valid YAML: ${(error as Error).message}`);
  }
  const body = text.slice(match[0].length).replace(/^\r?\n/, '');
  return {
    data: data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {},
    body,
  };
}

export function stringifyDocument(data: Record<string, unknown>, body: string): string {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    clean[key] = value;
  }
  // No folding: a long title or criterion stays on one line, readable in a diff.
  const yaml = stringify(clean, { lineWidth: 0, defaultStringType: 'PLAIN', defaultKeyType: 'PLAIN' }).trimEnd();
  const text = body.trim() ? `\n${body.replace(/^\n+/, '').trimEnd()}\n` : '';
  return `---\n${yaml}\n---\n${text}`;
}

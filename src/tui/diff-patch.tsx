/** A single code column leaves room for line numbers even in a narrow terminal. */
import { Text } from 'ink';
import stringWidth from 'string-width';
import { type DiffLine, type DiffPart, parsePatch } from '../diff.js';
import { fileStats, type GitFile } from '../git.js';
import { t } from '../i18n/i18n.js';
import { C } from './theme.js';

export interface PatchRow extends DiffLine {
  continued: boolean;
}

const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

function caption(line: DiffLine): string {
  if (line.hunk) {
    const range = (start: number, count: number) => (count > 1 ? `${start}–${start + count - 1}` : String(start));
    const h = line.hunk;
    return `${t('строки {old} → {new}', { old: range(h.oldStart, h.oldCount), new: range(h.newStart, h.newCount) })}${h.context ? ` · ${h.context}` : ''}`;
  }
  if (line.kind === 'no-newline') return t('нет перевода строки в конце файла');
  if (line.kind === 'binary') return t('Бинарный файл — текстовый диф недоступен');
  const mode = /^(new file mode|deleted file mode|old mode|new mode) (\d+)$/.exec(line.text);
  if (mode) {
    const labels: Record<string, string> = {
      'new file mode': t('новый файл · режим {mode}', { mode: mode[2] }),
      'deleted file mode': t('удалённый файл · режим {mode}', { mode: mode[2] }),
      'old mode': t('прежний режим {mode}', { mode: mode[2] }),
      'new mode': t('новый режим {mode}', { mode: mode[2] }),
    };
    return labels[mode[1]!]!;
  }
  return line.text;
}

/** Wrap without dropping spaces, and carry word emphasis across every continuation. */
function wrapParts(parts: DiffPart[], width: number): DiffPart[][] {
  const text = parts.map((part) => part.text).join('');
  const rows: DiffPart[][] = [[]];
  let used = 0;
  let partIndex = 0;
  let offset = 0;
  for (const { segment } of graphemes.segment(text)) {
    const size = stringWidth(segment);
    if (used && used + size > width) {
      rows.push([]);
      used = 0;
    }
    const result = rows.at(-1)!;
    let left = segment.length;
    while (left && parts[partIndex]) {
      const part = parts[partIndex]!;
      const length = Math.min(left, part.text.length - offset);
      if (length) {
        const text = part.text.slice(offset, offset + length);
        const previous = result.at(-1);
        if (previous && previous.changed === part.changed) previous.text += text;
        else result.push({ ...part, text });
      }
      left -= length;
      offset += length;
      if (offset === part.text.length) {
        partIndex++;
        offset = 0;
      }
    }
    used += size;
  }
  return rows;
}

export function layoutPatch(patch: string, width: number) {
  const lines = parsePatch(patch).filter((line) => line.kind !== 'header');
  const oldWidth = lines.reduce(
    (size, line) => Math.max(size, String(line.oldLine ?? '').length),
    stringWidth(t('до')),
  );
  const newWidth = lines.reduce(
    (size, line) => Math.max(size, String(line.newLine ?? '').length),
    stringWidth(t('после')),
  );
  const gutterWidth = oldWidth + newWidth + 4;
  const codeWidth = Math.max(1, width - gutterWidth - 1);
  const rows = lines.flatMap((line): PatchRow[] => {
    const code = ['context', 'add', 'remove'].includes(line.kind);
    const source = code ? line.parts : [{ text: caption(line) }];
    return wrapParts(source, code ? codeWidth : Math.max(1, width - 2)).map((parts, index) => ({
      ...line,
      text: parts.map((part) => part.text).join(''),
      parts,
      continued: index > 0,
    }));
  });
  return { rows, oldWidth, newWidth, gutterWidth };
}

export function DiffStats({ file }: { file: GitFile }) {
  if (file.added === null || file.removed === null || file.binary) return <Text color={C.dim}>{fileStats(file)}</Text>;
  return (
    <Text>
      <Text color={C.ok}>+{file.added}</Text> <Text color={C.bad}>−{file.removed}</Text>
    </Text>
  );
}

export function PatchLineView(props: { row: PatchRow; width: number; oldWidth: number; newWidth: number }) {
  const { row, width, oldWidth, newWidth } = props;
  const added = row.kind === 'add';
  const removed = row.kind === 'remove';
  const code = added || removed || row.kind === 'context';
  const color = added ? C.ok : removed ? C.bad : row.kind === 'hunk' ? C.review : C.dim;
  if (!code)
    return (
      <Text color={color} backgroundColor={row.kind === 'hunk' ? C.diffHunkBg : undefined} wrap="truncate-end">
        {row.continued ? '  ' : '⋯ '}
        {row.text}
        {' '.repeat(Math.max(0, width - stringWidth(row.text) - 2))}
      </Text>
    );
  const gutter = `${String(row.continued ? '' : (row.oldLine ?? '')).padStart(oldWidth)} ${String(row.continued ? '' : (row.newLine ?? '')).padStart(newWidth)} │ `;
  const background = added ? C.diffAddedBg : removed ? C.diffRemovedBg : undefined;
  const emphasis = added ? C.diffAddedWordBg : C.diffRemovedWordBg;
  return (
    <Text wrap="truncate-end">
      <Text color={C.dim}>{gutter}</Text>
      <Text color={added || removed ? color : undefined} backgroundColor={background}>
        <Text bold={added || removed}>{row.continued ? '↪' : added ? '+' : removed ? '−' : ' '}</Text>
        {row.parts.map((part, index) => (
          <Text
            key={String(index)}
            bold={part.changed}
            color={part.changed ? C.diffWordText : undefined}
            backgroundColor={part.changed ? emphasis : undefined}
          >
            {part.text}
          </Text>
        ))}
        {' '.repeat(Math.max(0, width - stringWidth(gutter) - 1 - stringWidth(row.text)))}
      </Text>
    </Text>
  );
}

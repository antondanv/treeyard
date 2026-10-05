/** The project's documents from the root: the list → reading with Markdown drawn → the built-in editor. */
import { Box, Text, useInput } from 'ink';
import { useEffect, useMemo, useState } from 'react';
import stringWidth from 'string-width';

import { type DocFile, lineCount, linesLabel, projectDocs, readDoc, TREE_DOC } from '../docs.js';
import { t } from '../i18n/i18n.js';
import { ago } from '../model/time.js';
import { Frame, type KeyHint, useLatest } from './components/controls.js';
import { DocEditor } from './doc-editor.js';
import { shortcutKey } from './keys.js';
import { layoutMarkdown, type MdRow } from './markdown.js';
import { Clickable } from './mouse.js';
import { C, theme } from './theme.js';

type Page =
  | { kind: 'list' }
  | { kind: 'view'; path: string }
  /** `top` — the first row of the reading view to come back to. */
  | { kind: 'edit'; path: string; line: number; top?: number };

export interface DocsOpen {
  path: string;
  edit?: boolean;
}

function footerRows(hints: KeyHint[], width: number): number {
  let rows = 1;
  let used = 0;
  for (const [index, hint] of hints.entries()) {
    const size = stringWidth([hint.key, hint.label].filter(Boolean).join(' ')) + (index ? 3 : 0);
    if (used && used + size > width) {
      rows += 1;
      used = size;
    } else used += size;
  }
  return rows;
}

export function MdLine(props: { row: MdRow }) {
  if (!props.row.spans.length) return <Text> </Text>;
  return (
    <Text wrap="truncate-end">
      {props.row.spans.map((span, index) => (
        <Text
          // biome-ignore lint/suspicious/noArrayIndexKey: spans are positions in a row.
          key={index}
          color={span.color}
          bold={span.bold}
          italic={span.italic}
          underline={span.underline}
          strikethrough={span.strike}
        >
          {span.text}
        </Text>
      ))}
    </Text>
  );
}

export function DocsDialog(props: {
  dir: string;
  project: string;
  width: number;
  height: number;
  /** Straight to one document, from the root's menu. */
  open?: DocsOpen;
  /** Writes a document; throws with a message the editor shows. */
  onSave: (path: string, text: string, crlf: boolean) => void;
  onClose: () => void;
}) {
  const [page, setPage, pageRef] = useLatest<Page>(
    props.open
      ? props.open.edit
        ? { kind: 'edit', path: props.open.path, line: 0 }
        : { kind: 'view', path: props.open.path }
      : { kind: 'list' },
  );
  const [cursor, setCursor, cursorRef] = useLatest(0);
  const [top, setTop] = useLatest(0);
  const [docs, setDocs] = useState<DocFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [text, setText] = useState('');
  const [mtime, setMtime] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision re-reads the list after an edit or r.
  useEffect(() => {
    let active = true;
    setLoading(true);
    projectDocs(props.dir)
      .then((list) => {
        if (!active) return;
        setDocs(list);
        setError('');
      })
      .catch((error: Error) => {
        if (active) setError(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [props.dir, revision]);

  // The document being read: read again each time the page opens it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision re-reads the file after an edit or r.
  useEffect(() => {
    if (page.kind !== 'view') return;
    try {
      const doc = readDoc(props.dir, page.path);
      setText(doc.text);
      setMtime(doc.mtime);
      setError('');
    } catch (error) {
      setText('');
      setError((error as Error).message);
    }
  }, [props.dir, page, revision]);

  const inner = Math.max(10, props.width - 4);
  // biome-ignore lint/correctness/useExhaustiveDependencies: colours come from the theme at layout time.
  const rows = useMemo(() => layoutMarkdown(text, inner), [text, inner, theme()]);
  const at = Math.min(cursor, Math.max(0, docs.length - 1));

  const list = () => {
    const path = pageRef.current.kind === 'list' ? undefined : pageRef.current.path;
    const index = path ? docs.findIndex((doc) => doc.path === path) : -1;
    setPage({ kind: 'list' });
    if (index >= 0) setCursor(index);
    setError('');
  };
  const view = (path: string, from = 0) => {
    setPage({ kind: 'view', path });
    setTop(from);
    setError('');
  };
  const edit = (path: string, line: number, from?: number) =>
    setPage({ kind: 'edit', path, line, ...(from !== undefined ? { top: from } : {}) });

  const footer: KeyHint[] =
    page.kind === 'view'
      ? [
          { key: '↑ ↓', label: t('листать'), press: ['\u001b[A', '\u001b[B'] },
          { key: 'PgUp PgDn', label: t('страница'), press: ['\u001b[5~', '\u001b[6~'] },
          { key: 'e', label: t('править') },
          { key: 'esc', label: t('к списку') },
        ]
      : [
          { key: '↑ ↓', label: t('выбрать'), press: ['\u001b[A', '\u001b[B'] },
          { key: '⏎', label: t('читать') },
          { key: 'e', label: t('править') },
          { key: 'r', label: t('обновить') },
          { key: 'esc', label: t('закрыть') },
          { label: `${docs.length ? at + 1 : 0}/${docs.length}` },
        ];
  const room = Math.max(1, props.height - 6 - footerRows(footer, inner) - (error ? 1 : 0));
  const maxTop = Math.max(0, rows.length - room);
  const shownTop = Math.min(top, maxTop);
  const first = Math.max(0, Math.min(at - Math.floor(room / 2), docs.length - room));

  useInput(
    (raw, key) => {
      const input = shortcutKey(raw);
      const current = pageRef.current;
      if (current.kind === 'edit') return;
      if (current.kind === 'view') {
        if (key.escape || input === 'q' || key.leftArrow) return list();
        const scroll = (to: number) => setTop(Math.max(0, Math.min(maxTop, to)));
        const by = (step: number) => setTop((value) => Math.max(0, Math.min(maxTop, Math.min(value, maxTop) + step)));
        if (key.downArrow || input === 'j') return by(1);
        if (key.upArrow || input === 'k') return by(-1);
        if (key.pageDown || input === ' ') return by(room);
        if (key.pageUp) return by(-room);
        if (key.home) return scroll(0);
        if (key.end) return scroll(maxTop);
        if (input === 'r') return setRevision((value) => value + 1);
        if (input === 'e') return edit(current.path, rows[shownTop]?.line ?? 0, shownTop);
        return;
      }
      if (key.escape || input === 'q') return props.onClose();
      if (input === 'r') return setRevision((value) => value + 1);
      if (loading || !docs.length) return;
      const pick = docs[Math.min(cursorRef.current, docs.length - 1)];
      if ((key.return || key.rightArrow) && pick) return view(pick.path);
      if (input === 'e' && pick) return edit(pick.path, 0);
      const step = (by: number) => setCursor((value) => Math.max(0, Math.min(docs.length - 1, value + by)));
      if (key.downArrow || input === 'j') return step(1);
      if (key.upArrow || input === 'k') return step(-1);
      if (key.pageDown || input === ' ') return step(room);
      if (key.pageUp) return step(-room);
      if (key.home) return setCursor(0);
      if (key.end) return setCursor(docs.length - 1);
    },
    { isActive: page.kind !== 'edit' },
  );

  if (page.kind === 'edit') {
    return (
      <DocEditor
        key={page.path}
        dir={props.dir}
        path={page.path}
        line={page.line}
        width={props.width}
        height={props.height}
        onSave={(value, crlf) => {
          props.onSave(page.path, value, crlf);
          setRevision((value) => value + 1);
        }}
        onExit={() => view(page.path, page.top ?? 0)}
      />
    );
  }

  if (page.kind === 'view') {
    const lines = lineCount(text);
    return (
      <Frame
        title={page.path}
        width={props.width}
        footer={[...footer, { label: `${Math.min(shownTop + 1, rows.length)}/${rows.length}` }]}
      >
        <Text color={C.faint} wrap="truncate-end">
          {t('{lines} стр. · изменён {when}', { lines, when: ago(mtime) || '—' })}
          {page.path === TREE_DOC ? t(' · корень дерева: цель, правила, решения') : ''}
        </Text>
        {error ? (
          <Text color={C.warn} wrap="truncate-end">
            {error}
          </Text>
        ) : null}
        <Box height={room} flexDirection="column" overflow="hidden">
          {rows.slice(shownTop, shownTop + room).map((row, index) => (
            <MdLine key={String(shownTop + index)} row={row} />
          ))}
        </Box>
      </Frame>
    );
  }

  return (
    <Frame title={t('Документы · {project}', { project: props.project })} width={props.width} footer={footer}>
      <Text color={C.faint} wrap="truncate-end">
        {loading && !docs.length
          ? t('ищу .md проекта…')
          : t('{n} .md проекта — из Git, без игнорируемых файлов и узлов дерева', { n: docs.length })}
      </Text>
      {error ? (
        <Text color={C.warn} wrap="truncate-end">
          {error}
        </Text>
      ) : null}
      <Box height={room} flexDirection="column" overflow="hidden">
        {docs.slice(first, first + room).map((doc, offset, shown) => {
          const index = first + offset;
          const mine = index === at;
          const detail = [
            doc.path === TREE_DOC ? t('корень дерева: цель, правила, решения') : undefined,
            linesLabel(doc.lines),
            ago(doc.mtime),
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <Clickable
              key={doc.path}
              width={inner}
              onClick={(click) => {
                setCursor(index);
                if (click.double) view(doc.path);
              }}
            >
              {/* Paths in one column, as wide as the longest one: the details stay next to their file. */}
              <Box
                width={Math.min(Math.max(...shown.map((item) => stringWidth(item.path))) + 3, Math.max(12, inner - 24))}
                flexShrink={0}
              >
                <Text color={mine ? C.brand : undefined} bold={mine} wrap="truncate-end">
                  {mine ? '› ' : '  '}
                  {doc.path}
                </Text>
              </Box>
              <Text color={C.faint} wrap="truncate-end">
                {' '}
                · {detail}
              </Text>
            </Clickable>
          );
        })}
        {!loading && !docs.length && !error ? <Text color={C.faint}>{t('В проекте нет .md файлов')}</Text> : null}
      </Box>
    </Frame>
  );
}

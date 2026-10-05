/** The node's commits → files → patch, with shared working changes kept separate. */
import { Box, Text, useInput } from 'ink';
import { useEffect, useMemo, useState } from 'react';
import stringWidth from 'string-width';
import wrapAnsi from 'wrap-ansi';
import {
  type DiffSource,
  diffText,
  fileLabel,
  fileStats,
  type GitCommit,
  type GitFile,
  type GitRepository,
  gitRepository,
} from '../git.js';
import { t } from '../i18n/i18n.js';
import type { TreeNode } from '../model/types.js';
import { Frame, type KeyHint, useLatest } from './components/controls.js';
import { DiffStats, layoutPatch, PatchLineView } from './diff-patch.js';
import { shortcutKey } from './keys.js';
import { Clickable } from './mouse.js';
import { C } from './theme.js';

type FilesPage = { kind: 'files'; commit?: GitCommit; from: number };
type Page =
  | { kind: 'sources' }
  | { kind: 'pick' }
  | FilesPage
  | { kind: 'patch'; source: DiffSource; file: GitFile; back: FilesPage; from: number };

interface Item {
  key: string;
  label: string;
  detail?: string;
  ref?: string;
  commit?: GitCommit;
  file?: GitFile;
  source?: DiffSource;
  error?: string;
}

const commitLabel = (commit: GitCommit) => `${commit.sha.slice(0, 8)} · ${diffText(commit.subject)}`;

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

export function DiffsDialog(props: {
  dir: string;
  node: TreeNode;
  width: number;
  height: number;
  onAttach: (sha: string) => boolean;
  onDetach: (sha: string) => boolean;
  onClose: () => void;
}) {
  const [repo, setRepo] = useState<GitRepository>();
  const [repoAttempt, setRepoAttempt] = useState(0);
  const [page, setPage, pageRef] = useLatest<Page>({ kind: 'sources' });
  const [cursor, setCursor, cursorRef] = useLatest(0);
  const [top, setTop] = useLatest(0);
  const [items, setItems] = useState<Item[]>([]);
  const [patch, setPatch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [skip, setSkip] = useState(0);
  const [more, setMore] = useState(false);
  const refs = props.node.commits ?? [];
  const commitKey = refs.join('|');

  // biome-ignore lint/correctness/useExhaustiveDependencies: r retries discovery after a repository is created.
  useEffect(() => {
    let active = true;
    setRepo(undefined);
    setError('');
    setLoading(true);
    gitRepository(props.dir)
      .then((repo) => {
        if (active) setRepo(repo);
      })
      .catch((error: Error) => {
        if (active) {
          setError(error.message);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [props.dir, repoAttempt]);

  // Only the visible page is read; leaving it cancels its pending state updates.
  // biome-ignore lint/correctness/useExhaustiveDependencies: commitKey is the stable signature of node.commits.
  useEffect(() => {
    if (!repo) return;
    let active = true;
    setLoading(true);
    setError('');
    const read = async () => {
      if (page.kind === 'patch') {
        setPatch('');
        const text = await repo.patch(page.source, page.file);
        if (active) setPatch(text);
        return;
      }
      let next: Item[];
      if (page.kind === 'sources') {
        next = await Promise.all(
          [...refs].reverse().map(async (ref): Promise<Item> => {
            try {
              const commit = await repo.commit(ref);
              return { key: ref, ref, commit, label: commitLabel(commit), detail: commit.date };
            } catch (error) {
              return {
                key: ref,
                ref,
                label: `${ref.slice(0, 8)} · ${t('коммит недоступен')}`,
                error: (error as Error).message,
              };
            }
          }),
        );
        next.push({ key: 'working', label: t('Текущие изменения проекта'), detail: t('общие для всех узлов') });
      } else if (page.kind === 'pick') {
        const commits = await repo.recent(100, skip);
        next = commits.map((commit) => ({
          key: commit.sha,
          ref: commit.sha,
          commit,
          label: commitLabel(commit),
          detail: refs.includes(commit.sha) ? t('уже привязан') : commit.date,
        }));
        if (active) setMore(commits.length === 100);
      } else if (page.commit) {
        const source: DiffSource = { kind: 'commit', commit: page.commit };
        next = (await repo.files(source)).map((file) => ({
          key: file.path,
          label: `${file.status} ${fileLabel(file)}`,
          file,
          source,
        }));
      } else {
        const working = await repo.working();
        const labels = { staged: t('индекс'), unstaged: t('рабочая папка'), untracked: '' };
        next = (['staged', 'unstaged', 'untracked'] as const).flatMap((kind) =>
          working[kind].map((file) => ({
            key: `${kind}:${file.path}`,
            label: `${file.status} ${fileLabel(file)}`,
            detail: labels[kind],
            file,
            source: { kind },
          })),
        );
      }
      if (active) setItems((before) => (page.kind === 'pick' && skip ? [...before, ...next] : next));
    };
    void read()
      .catch((error: Error) => {
        if (active) setError(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [repo, page, commitKey, revision, skip]);

  const go = (page: Page, at = 0) => {
    setPage(page);
    setCursor(at);
    setTop(0);
    setError('');
    setLoading(true);
    if (page.kind === 'patch') setPatch('');
  };
  const back = () => {
    const page = pageRef.current;
    if (page.kind === 'sources') return props.onClose();
    if (page.kind === 'patch') return go(page.back, page.from);
    return go({ kind: 'sources' }, page.kind === 'files' ? page.from : 0);
  };
  const pick = (index: number) => {
    const page = pageRef.current;
    const item = items[index];
    if (!item || loading) return;
    if (item.error) return setError(item.error);
    if (page.kind === 'sources')
      return go({ kind: 'files', from: index, ...(item.commit ? { commit: item.commit } : {}) });
    if (page.kind === 'pick' && item.commit) {
      try {
        if (props.onAttach(item.commit.sha) === false) return setError(t('не удалось сохранить привязку коммита'));
        return go({ kind: 'sources' });
      } catch (error) {
        return setError((error as Error).message);
      }
    }
    if (page.kind === 'files' && item.file && item.source)
      go({ kind: 'patch', file: item.file, source: item.source, back: page, from: index });
  };

  const inner = Math.max(10, props.width - 4);
  const layout = useMemo(() => layoutPatch(patch, inner), [patch, inner]);
  const lines = layout.rows;
  const selected = items[Math.min(cursor, Math.max(0, items.length - 1))];
  const footer: KeyHint[] =
    page.kind === 'patch'
      ? [
          { key: '↑ ↓', label: t('листать'), press: ['\u001b[A', '\u001b[B'] },
          { key: 'PgUp PgDn', label: t('страница'), press: ['\u001b[5~', '\u001b[6~'] },
          { key: 'r', label: t('обновить') },
          { key: 'esc', label: t('к файлам') },
          { label: `${Math.min(top + 1, lines.length)}/${lines.length}` },
        ]
      : [
          { key: '↑ ↓', label: t('выбрать'), press: ['\u001b[A', '\u001b[B'] },
          { key: '⏎', label: page.kind === 'pick' ? t('привязать') : t('открыть') },
          ...(page.kind === 'sources'
            ? [
                { key: 'a', label: t('привязать коммит') },
                ...(selected?.ref ? [{ key: 'D', label: t('убрать привязку') }] : []),
              ]
            : []),
          ...(page.kind === 'pick' && more ? [{ key: 'n', label: t('ещё 100') }] : []),
          ...(page.kind !== 'pick' ? [{ key: 'r', label: t('обновить') }] : []),
          { key: 'esc', label: page.kind === 'sources' ? t('закрыть') : t('назад') },
        ];
  const note =
    error ||
    (page.kind === 'sources' && !refs.length
      ? t('Коммиты к узлу пока не привязаны · a — выбрать из Git-журнала')
      : page.kind === 'files' && !page.commit
        ? t('Текущие правки общие для всех узлов')
        : '');
  const notices = note ? wrapAnsi(diffText(note), inner, { hard: true }).split('\n').slice(0, 2) : [];
  const room = Math.max(
    1,
    props.height - 6 - footerRows(footer, inner) - notices.length - (page.kind === 'patch' ? 1 : 0),
  );
  const maxTop = Math.max(0, lines.length - room);
  const at = Math.min(cursor, Math.max(0, items.length - 1));
  const first = Math.max(0, Math.min(at - Math.floor(room / 2), items.length - room));

  useInput((raw, key) => {
    const input = shortcutKey(raw);
    if (key.escape || input === 'q' || key.leftArrow) return back();
    const page = pageRef.current;
    if (page.kind === 'sources' && input === 'a') {
      if (!repo) return;
      setSkip(0);
      return go({ kind: 'pick' });
    }
    if (loading) return;
    if (input === 'r' && page.kind !== 'pick') {
      if (!repo) return setRepoAttempt((value) => value + 1);
      return setRevision((value) => value + 1);
    }
    if (page.kind === 'patch') {
      if (key.downArrow || input === 'j') return setTop((value) => Math.min(maxTop, value + 1));
      if (key.upArrow || input === 'k') return setTop((value) => Math.max(0, Math.min(maxTop, value) - 1));
      if (key.pageDown || input === ' ') return setTop((value) => Math.min(maxTop, value + room));
      if (key.pageUp) return setTop((value) => Math.max(0, Math.min(maxTop, value) - room));
      if (key.home) return setTop(0);
      if (key.end) return setTop(maxTop);
      return;
    }
    if (page.kind === 'sources' && input === 'D' && selected?.ref) {
      try {
        if (props.onDetach(selected.ref) === false) return setError(t('не удалось сохранить привязку коммита'));
        setRevision((value) => value + 1);
      } catch (error) {
        setError((error as Error).message);
      }
      return;
    }
    if (page.kind === 'pick' && input === 'n' && more) return setSkip((value) => value + 100);
    if (key.return || key.rightArrow) return pick(Math.min(cursorRef.current, items.length - 1));
    const step = (by: number) => setCursor((value) => Math.max(0, Math.min(items.length - 1, value + by)));
    if (key.downArrow || input === 'j') return step(1);
    if (key.upArrow || input === 'k') return step(-1);
    if (key.pageDown || input === ' ') return step(room);
    if (key.pageUp) return step(-room);
    if (key.home) return setCursor(0);
    if (key.end) return setCursor(Math.max(0, items.length - 1));
  });

  const heading =
    page.kind === 'sources'
      ? t('Связанные коммиты · {n}', { n: refs.length })
      : page.kind === 'pick'
        ? t('Выбери коммит для узла')
        : page.kind === 'patch'
          ? fileLabel(page.file)
          : page.commit
            ? commitLabel(page.commit)
            : t('Текущие изменения проекта');
  return (
    <Frame title={t('Дифы · {title}', { title: props.node.title })} width={props.width} footer={footer}>
      <Text color={page.kind === 'patch' ? undefined : C.dim} bold={page.kind === 'patch'} wrap="truncate-end">
        {heading}
        {page.kind === 'patch' ? (
          <Text>
            {' '}
            · <DiffStats file={page.file} />
          </Text>
        ) : null}
      </Text>
      {page.kind === 'patch' ? (
        <Text color={C.dim} wrap="truncate-end">
          {t('до').padStart(layout.oldWidth)} {t('после').padStart(layout.newWidth)} │{' '}
          <Text color={C.ok}>+ {t('добавлено')}</Text>
          {'  '}
          <Text color={C.bad}>− {t('удалено')}</Text>
        </Text>
      ) : null}
      {notices.map((line, index) => (
        <Text key={String(index)} color={error ? C.warn : C.faint}>
          {line}
        </Text>
      ))}
      <Box height={room} flexDirection="column" overflow="hidden">
        {loading ? (
          <Text color={C.faint}>{t('читаю Git…')}</Text>
        ) : page.kind === 'patch' ? (
          lines.length ? (
            lines
              .slice(Math.min(top, maxTop), Math.min(top, maxTop) + room)
              .map((row, index) => (
                <PatchLineView
                  key={String(Math.min(top, maxTop) + index)}
                  row={row}
                  width={inner}
                  oldWidth={layout.oldWidth}
                  newWidth={layout.newWidth}
                />
              ))
          ) : error ? null : (
            <Text color={C.dim}>{t('Содержимое не изменилось')}</Text>
          )
        ) : items.length ? (
          items.slice(first, first + room).map((item, offset) => {
            const detail = [item.detail, item.file ? fileStats(item.file) : ''].filter(Boolean).join(' · ');
            return (
              <Clickable
                key={item.key}
                width={inner}
                onClick={(click) => {
                  setCursor(first + offset);
                  if (click.double) pick(first + offset);
                }}
              >
                <Box width={inner - (detail ? Math.min(30, stringWidth(detail)) + 3 : 0)} flexShrink={0}>
                  <Text
                    color={item.error ? C.warn : at === first + offset ? C.brand : undefined}
                    bold={at === first + offset}
                    wrap="truncate-end"
                  >
                    {at === first + offset ? '› ' : '  '}
                    {item.file ? (
                      <Text
                        color={
                          item.file.status[0] === 'D'
                            ? C.bad
                            : ['A', '?'].includes(item.file.status[0]!)
                              ? C.ok
                              : C.accent
                        }
                      >
                        {item.file.status}
                      </Text>
                    ) : null}
                    {item.file ? ` ${fileLabel(item.file)}` : item.label}
                  </Text>
                </Box>
                {detail ? (
                  <Text color={C.faint} wrap="truncate-end">
                    {' '}
                    · {item.detail}
                    {item.detail && item.file && fileStats(item.file) ? ' · ' : ''}
                    {item.file ? <DiffStats file={item.file} /> : null}
                  </Text>
                ) : null}
              </Clickable>
            );
          })
        ) : error ? null : (
          <Text color={C.faint}>{page.kind === 'pick' ? t('В Git пока нет коммитов') : t('изменений нет')}</Text>
        )}
      </Box>
    </Frame>
  );
}

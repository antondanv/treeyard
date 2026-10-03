/**
 * The right-hand pane: everything about the selected node — what "done"
 * means, how to check it, its sessions and the latest of its journal — cut to
 * the height there is.
 */
import type { SessionInfo } from '@antondanv/brainyard';
import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import wrapAnsi from 'wrap-ansi';

import { BRAIN_SHORT } from '../agents/launch.js';
import { t } from '../i18n/i18n.js';
import { description, journalEntries } from '../model/journal.js';
import { STATUS_LABEL, WHO_LABEL } from '../model/ops.js';
import { GLYPH } from '../model/overview.js';
import { ago } from '../model/time.js';
import { childrenOf, heldBy, pathTo, progress } from '../model/tree.js';
import type { SessionRef, Tree, TreeNode } from '../model/types.js';
import { liveLabel } from './rows.js';
import { C, SPINNER, STATUS_COLOR } from './theme.js';

interface LineSpec {
  key: string;
  node: ReactNode;
}

export function NodeDetails(props: {
  tree: Tree;
  node: TreeNode | undefined;
  width: number;
  height: number;
  live: Map<string, SessionInfo>;
  frame: number;
}) {
  const { tree, node, width } = props;
  const inner = Math.max(10, width - 2);
  if (!node) {
    return (
      <Pane width={width} height={props.height}>
        <Text color={C.faint}>{t('Пусто. Нажми a, чтобы добавить первый узел.')}</Text>
      </Pane>
    );
  }
  const lines: LineSpec[] = [];
  let n = 0;
  const push = (content: ReactNode) => lines.push({ key: String(n++), node: content });
  const wrap = (text: string, color?: string, indent = 0) => {
    for (const line of wrapAnsi(text, inner - indent, { hard: true, trim: false }).split('\n')) {
      push(
        <Text color={color} wrap="truncate-end">
          {' '.repeat(indent)}
          {line}
        </Text>,
      );
    }
  };
  const gap = () => push(<Text> </Text>);
  const heading = (text: string) =>
    push(
      <Text color={C.faint} bold>
        {text}
      </Text>,
    );

  // Title and status line.
  wrap(`${GLYPH[node.status]} ${node.title}`, STATUS_COLOR[node.status] ?? undefined);
  const meta: string[] = [STATUS_LABEL[node.status]];
  if (node.who)
    meta.push(
      t('делает: {p1}', {
        p1: WHO_LABEL[node.who],
      }),
    );
  meta.push(node.id);
  if (node.updated)
    meta.push(
      t('обновлён {p1}', {
        p1: ago(node.updated),
      }),
    );
  push(
    <Text color={C.dim} wrap="truncate-end">
      {meta.join(' · ')}
    </Text>,
  );
  const path = pathTo(tree, node.id);
  if (path.length > 1) {
    push(
      <Text color={C.faint} wrap="truncate-end">
        {path
          .slice(0, -1)
          .map((step) => step.title)
          .join(' › ')}
      </Text>,
    );
  }
  const held = heldBy(tree, node.id);
  if (held) {
    push(
      <Text color={C.warn} wrap="truncate-end">
        {t('ветка выше: ')}
        {STATUS_LABEL[held.status]} — «{held.title}»
      </Text>,
    );
  }

  if (node.status === 'waiting') {
    gap();
    heading(t('ЖДЁТ'));
    wrap(node.waiting ?? t('причина не записана'), C.warn);
    if (node.until)
      wrap(
        t('вернуться, когда: {until}', {
          until: node.until,
        }),
        C.dim,
      );
  }

  gap();
  heading(t('ГОТОВО, КОГДА'));
  if (node.doneWhen) wrap(node.doneWhen);
  else wrap(t('не задано — e, чтобы задать'), C.faint);
  if (node.check) {
    push(
      <Text wrap="truncate-end">
        <Text color={C.faint}>$ </Text>
        <Text color={C.accent}>{node.check}</Text>
      </Text>,
    );
  }

  const kids = childrenOf(tree, node.id);
  if (kids.length > 0) {
    const { done, total } = progress(tree, node.id);
    gap();
    heading(
      t('ВНУТРИ · {done}/{total}', {
        done,
        total,
      }),
    );
    for (const kid of kids.slice(0, 8)) {
      push(
        <Text wrap="truncate-end">
          <Text color={STATUS_COLOR[kid.status]}>{GLYPH[kid.status]} </Text>
          <Text color={kid.status === 'done' ? C.dim : undefined}>{kid.title}</Text>
        </Text>,
      );
    }
    if (kids.length > 8)
      wrap(
        t('… и ещё {p1}', {
          p1: kids.length - 8,
        }),
        C.faint,
      );
  }

  const sessions = sessionList(node.sessions, props.live);
  gap();
  heading(
    t('СЕССИИ{p1}', {
      p1: node.sessions.length ? ` · ${node.sessions.length}` : '',
    }),
  );
  if (sessions.length === 0) wrap(t('пока нет — ⏎ или c, чтобы начать'), C.faint);
  for (const { ref, live } of sessions.slice(0, 5)) {
    let mark = <Text color={C.faint}>○</Text>;
    if (live?.live?.status === 'busy') mark = <Text color={C.agent}>{SPINNER[props.frame % SPINNER.length]}</Text>;
    else if (live?.live?.status === 'waiting') mark = <Text color={C.you}>?</Text>;
    else if (live?.live) mark = <Text color={C.ok}>●</Text>;
    const state = live ? liveLabel(live) : ago(ref.opened ?? ref.started);
    push(
      <Text wrap="truncate-end">
        {mark}
        <Text color={C.dim}> {BRAIN_SHORT[ref.brain].padEnd(6)} </Text>
        <Text>{shortName(ref, props.tree)}</Text>
        <Text color={live?.live?.status === 'waiting' ? C.you : C.faint}> · {state}</Text>
      </Text>,
    );
  }
  if (sessions.length > 5)
    wrap(
      t('… и ещё {p1}', {
        p1: sessions.length - 5,
      }),
      C.faint,
    );

  const about = description(node.body);
  if (about) {
    gap();
    heading(t('ОПИСАНИЕ'));
    for (const paragraph of about.split('\n').slice(0, 30)) wrap(plain(paragraph), C.text);
  }

  const journal = journalEntries(node.body);
  if (journal.length > 0) {
    gap();
    heading(t('ЖУРНАЛ'));
    for (const entry of journal.slice(-6).reverse()) wrap(entry.replace(/^\d{4}-(\d\d)-(\d\d)/, '$2.$1'), C.dim);
  }

  return (
    <Pane width={width} height={props.height}>
      {lines.slice(0, props.height).map((line) => (
        <Box key={line.key} width={inner}>
          {line.node}
        </Box>
      ))}
    </Pane>
  );
}

export function SessionDetails(props: {
  session: SessionInfo | undefined;
  sleeping?: boolean;
  owner: TreeNode | undefined;
  width: number;
  height: number;
}) {
  const { session } = props;
  if (!session) {
    return (
      <Pane width={props.width} height={props.height}>
        <Text color={C.faint}>{t('Сессий в этой папке пока нет.')}</Text>
      </Pane>
    );
  }
  const resume =
    session.brain === 'claude'
      ? `claude --resume ${session.id}`
      : session.brain === 'codex'
        ? `codex resume ${session.id}`
        : `agy --conversation ${session.id}`;
  return (
    <Pane width={props.width} height={props.height}>
      <Text bold wrap="truncate-end">
        {session.title ?? t('без названия')}
      </Text>
      <Text color={C.dim} wrap="truncate-end">
        {BRAIN_SHORT[session.brain]} · {session.id.slice(0, 8)}
        {session.background ? t(' · в фоне') : ''}
      </Text>
      {session.live ? (
        <Text color={session.live.status === 'waiting' ? C.you : C.agent} wrap="truncate-end">
          {liveLabel(session)}
        </Text>
      ) : props.sleeping ? (
        <Text color={C.faint}>☾ {t('спит')}</Text>
      ) : null}
      <Text> </Text>
      <Text color={C.faint} bold>
        {t('УЗЕЛ')}
      </Text>
      {props.owner ? (
        <Text wrap="truncate-end">
          <Text color={STATUS_COLOR[props.owner.status]}>{GLYPH[props.owner.status]} </Text>
          {props.owner.title}
        </Text>
      ) : (
        <Text color={C.faint} wrap="truncate-end">
          {t('не привязана — l, чтобы привязать к узлу')}
        </Text>
      )}
      <Text> </Text>
      <Text color={C.faint} bold>
        {t('ВРЕМЯ')}
      </Text>
      <Text color={C.dim}>
        {t('начата ')}
        {ago(session.startedAt) || '—'}
      </Text>
      <Text color={C.dim}>
        {t('последнее ')}
        {ago(session.updatedAt) || '—'}
      </Text>
      <Text> </Text>
      <Text color={C.faint} bold>
        {t('ВРУЧНУЮ')}
      </Text>
      <Text color={C.accent} wrap="truncate-end">
        {resume}
      </Text>
    </Pane>
  );
}

function Pane(props: { width: number; height: number; children: ReactNode }) {
  return (
    <Box flexDirection="column" width={props.width} height={props.height} paddingLeft={1} overflow="hidden">
      {props.children}
    </Box>
  );
}

function sessionList(refs: SessionRef[], live: Map<string, SessionInfo>) {
  return refs
    .map((ref) => ({ ref, live: live.get(ref.id) }))
    .sort((a, b) => {
      const rank = (x: { live: SessionInfo | undefined }) =>
        x.live?.live?.status === 'waiting' ? 0 : x.live?.live?.status === 'busy' ? 1 : x.live?.live ? 2 : 3;
      return (
        rank(a) - rank(b) || (b.ref.opened ?? b.ref.started ?? '').localeCompare(a.ref.opened ?? a.ref.started ?? '')
      );
    });
}

function shortName(ref: SessionRef, tree: Tree): string {
  const name = ref.name ?? ref.id.slice(0, 8);
  const prefix = `${tree.project.title} · `;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

/** Markdown marks that read as noise in a terminal. */
function plain(text: string): string {
  return text
    .replace(/^#{1,6}\s+/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

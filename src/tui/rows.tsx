/**
 * Lines of the lists: a tree row with guides, a flat row for the other
 * views, and the badges on the right — a running agent, what a branch waits
 * for, how far along it is.
 */
import type { SessionInfo } from '@antondanv/brainyard';
import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import stringWidth from 'string-width';
import { BRAIN_SHORT } from '../agents/launch.js';
import { formatMemory, type Pane } from '../agents/panes.js';
import { t } from '../i18n/i18n.js';
import type { Link } from '../model/links.js';
import { GLYPH } from '../model/overview.js';
import { ago, duration } from '../model/time.js';
import type { Progress, Row } from '../model/tree.js';
import type { BrainId, TreeNode } from '../model/types.js';

import { marquee, overflows } from './marquee.js';
import { C, SPINNER, STATUS_COLOR } from './theme.js';

export interface Badges {
  /** Running sessions of this node (Claude Code reports them). */
  live: SessionInfo[];
  progress?: Progress;
  frame: number;
  /** The brain of a session that runs in a pane. */
  pane?: BrainId | undefined;
  /** Nodes of other projects it waits for. */
  needs?: Link[];
}

const RIGHT = 24;

/** Columns before the title of a tree row: guides and the branch marker. */
export function treePrefix(row: Row): number {
  return row.depth > 0 ? 2 + (row.depth - 1) * 4 + 2 + 2 : 2;
}

/**
 * The selected title that does not fit its line: what would run, in how
 * many columns. Undefined when it fits.
 */
export function rowOverflow(
  node: TreeNode,
  width: number,
  prefix: number,
  badges: Badges,
  dim?: boolean,
): { text: string; width: number } | undefined {
  const closed = node.status === 'done' || node.status === 'dropped';
  const who = node.who === 'human' && !closed ? stringWidth(t(' · ты')) : 0;
  const badge = badgeFor(node, badges, dim) ? RIGHT : 0;
  // A space of gutter, the pill's two spaces, the status mark and its space.
  const room = Math.max(4, width - 1 - prefix - 2 - 2 - who - badge);
  return overflows(node.title, room) ? { text: node.title, width: room } : undefined;
}

export function TreeRow(props: { row: Row; selected: boolean; width: number; badges: Badges; tick?: number }) {
  const { row, selected } = props;
  const { node } = row;
  let lead = '';
  if (row.depth > 0) {
    lead = '  ';
    for (let level = 1; level < row.depth; level++) lead += row.guides[level] ? '│   ' : '    ';
    lead += row.last ? '└─' : '├─';
  }
  const marker = row.hasChildren ? (row.expanded ? '▾' : '▸') : row.depth > 0 ? '─' : ' ';
  return (
    <Line
      selected={selected}
      width={props.width}
      node={node}
      badges={props.badges}
      dim={row.held || !row.match}
      prefix={treePrefix(row)}
      tick={props.tick ?? 0}
    >
      <Text color={C.rule}>{lead}</Text>
      <Text color={row.hasChildren ? (selected ? C.brand : C.dim) : C.rule}>{marker} </Text>
    </Line>
  );
}

export function ListRow(props: {
  node: TreeNode;
  selected: boolean;
  width: number;
  badges: Badges;
  /** Shown under the title, dimmed. */
  note?: string;
  indent?: number;
  tick?: number;
}) {
  return (
    <Box flexDirection="column">
      <Line
        selected={props.selected}
        width={props.width}
        node={props.node}
        badges={props.badges}
        prefix={props.indent ?? 0}
        tick={props.tick ?? 0}
      >
        <Text>{' '.repeat(props.indent ?? 0)}</Text>
      </Line>
      {props.note ? (
        <Box marginLeft={2 + (props.indent ?? 0) + 2} width={props.width - 6}>
          <Text color={C.faint} wrap="truncate-end">
            {props.note}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

function Line(props: {
  selected: boolean;
  width: number;
  node: TreeNode;
  badges: Badges;
  dim?: boolean;
  /** Columns the children take before the title. */
  prefix: number;
  tick: number;
  children?: ReactNode;
}) {
  const { node, selected } = props;
  const running = selected ? rowOverflow(node, props.width, props.prefix, props.badges, props.dim) : undefined;
  const closed = node.status === 'done' || node.status === 'dropped';
  const color = STATUS_COLOR[node.status];
  const titleColor = props.dim ? C.faint : closed ? C.dim : selected ? C.brand : undefined;
  const badge = badgeFor(node, props.badges, props.dim);
  return (
    <Box width={props.width}>
      <Text> </Text>
      <Box flexGrow={1} flexShrink={1} overflow="hidden">
        <Text wrap="truncate-end">
          {props.children}
          {selected ? (
            // The same pill as in the graph: the selection reads at a glance.
            <Text color={C.pillText} backgroundColor={C.pill} bold>
              {` ${GLYPH[node.status]} ${running ? marquee(running.text, running.width, props.tick) : node.title} `}
            </Text>
          ) : (
            <>
              <Text color={props.dim ? C.faint : color}>{GLYPH[node.status]} </Text>
              <Text color={titleColor} strikethrough={node.status === 'dropped'}>
                {node.title}
              </Text>
            </>
          )}
          {node.who === 'human' && !closed ? <Text color={props.dim ? C.faint : C.you}>{t(' · ты')}</Text> : null}
        </Text>
      </Box>
      {badge ? (
        <Box width={RIGHT} flexShrink={0} justifyContent="flex-end">
          {badge}
        </Box>
      ) : null}
    </Box>
  );
}

/** What goes on the right of a row, or null — then the title gets the whole line. */
function badgeFor(node: TreeNode, badges: Badges, dim: boolean | undefined): ReactNode {
  const props = { dim };
  const waiting = badges.live.find((session) => session.live?.status === 'waiting');
  const busy = badges.live.find((session) => session.live?.status === 'busy');
  if (waiting) {
    return (
      <Text color={C.you} wrap="truncate-end">
        ? {BRAIN_SHORT[waiting.brain]}
        {t(' ждёт тебя')}
      </Text>
    );
  }
  if (busy) {
    return (
      <Text color={C.agent} wrap="truncate-end">
        {SPINNER[badges.frame % SPINNER.length]} {BRAIN_SHORT[busy.brain]}
        {t(' работает')}
      </Text>
    );
  }
  if (badges.pane) {
    return (
      <Text color={C.ok} wrap="truncate-end">
        ▣ {BRAIN_SHORT[badges.pane]}
      </Text>
    );
  }
  if (badges.needs?.length) {
    // The first one not done yet speaks for all; when all are done, the work can go on.
    const open = badges.needs.filter((link) => link.node?.status !== 'done');
    const shown = open[0] ?? badges.needs[0]!;
    const mark = shown.node ? GLYPH[shown.node.status] : '?';
    const color = props.dim
      ? C.faint
      : open.length === 0
        ? C.ok
        : shown.node
          ? (STATUS_COLOR[shown.node.status] ?? C.warn)
          : C.faint;
    return (
      <Text color={color} wrap="truncate-end">
        → {shown.project} {mark}
        {open.length > 1 ? ` +${open.length - 1}` : ''}
      </Text>
    );
  }
  if (node.status === 'waiting') {
    return (
      <Text color={props.dim ? C.faint : C.warn} wrap="truncate-end">
        {t('ждёт')}
        {node.waiting ? `: ${node.waiting}` : ''}
      </Text>
    );
  }
  if (badges.progress && badges.progress.total > 0) {
    const { done, total } = badges.progress;
    const cells = 6;
    const filled = Math.round((done / total) * cells);
    const complete = done === total;
    return (
      <Text wrap="truncate-end">
        <Text color={C.faint}>
          {done}/{total}{' '}
        </Text>
        <Text color={props.dim ? C.faint : complete ? C.ok : C.brandDim}>{'━'.repeat(filled)}</Text>
        <Text color={C.rule}>{'━'.repeat(cells - filled)}</Text>
      </Text>
    );
  }
  const open = badges.live.find((session) => session.live);
  if (open) {
    return (
      <Text color={C.faint} wrap="truncate-end">
        ● {BRAIN_SHORT[open.brain]}
        {t(' открыт')}
      </Text>
    );
  }
  return null;
}

/** How a pane is doing, in one word and a colour: works, waits for you, free, quiet. */
export interface PaneState {
  mark: string;
  color: string;
  text: string;
}

export function paneState(pane: Pane, session: SessionInfo | undefined, frame: number, now = Date.now()): PaneState {
  const status = session?.live?.status;
  if (status === 'busy') return { mark: SPINNER[frame % SPINNER.length]!, color: C.agent, text: t('работает') };
  if (status === 'waiting')
    return {
      mark: '?',
      color: C.you,
      text: t('ждёт тебя{p1}', {
        p1: session?.live?.waitingFor ? `: ${session.live.waitingFor}` : '',
      }),
    };
  const quietMs = pane.activityAt ? now - Date.parse(pane.activityAt) : 0;
  const quiet =
    quietMs >= 60_000
      ? t('тихо {ago}', {
          ago: ago(pane.activityAt, now),
        })
      : '';
  if (status === 'idle') return { mark: '●', color: C.ok, text: quiet ? `${t('свободна')} · ${quiet}` : t('свободна') };
  return { mark: '●', color: C.ok, text: quiet || t('в панели') };
}

/** A session in the sessions view. */
export function SessionRow(props: {
  session: SessionInfo;
  selected: boolean;
  width: number;
  frame: number;
  owner?: string;
  /** No node holds it: opened past the tree. */
  offTree?: boolean;
  pane?: Pane;
  sleeping?: boolean;
  /** Under its CLI's heading: no brain column. */
  grouped?: boolean;
  /** The project's name: «Factoyard · Узел» inside Factoyard is just «Узел». */
  project?: string;
}) {
  const { session, selected } = props;
  const status = session.live?.status;
  const state = props.pane ? paneState(props.pane, session, props.frame) : undefined;
  let mark = <Text color={C.faint}>○</Text>;
  if (state) mark = <Text color={state.color}>{state.mark}</Text>;
  else if (status === 'busy') mark = <Text color={C.agent}>{SPINNER[props.frame % SPINNER.length]}</Text>;
  else if (status === 'waiting') mark = <Text color={C.you}>?</Text>;
  else if (session.live) mark = <Text color={C.ok}>●</Text>;
  else if (props.sleeping) mark = <Text color={C.faint}>☾</Text>;
  const right = props.pane
    ? `▣ ${formatMemory(props.pane.memory) || t('панель')}`
    : props.sleeping
      ? t('спит')
      : status === 'busy'
        ? t('работает')
        : ago(session.updatedAt ?? session.startedAt);
  const full = session.title ?? t('без названия');
  const prefix = props.project ? `${props.project} · ` : '';
  const title = prefix && full.startsWith(prefix) && full.length > prefix.length ? full.slice(prefix.length) : full;
  // Claude sessions are named after their node already; others get it after the title.
  const owner = props.owner && !title.includes(props.owner) ? props.owner : undefined;
  return (
    <Box width={props.width}>
      <Box width={3} flexShrink={0}>
        <Text>
          <Text color={C.brand}>{selected ? '❯' : ' '}</Text>
          {mark}
        </Text>
      </Box>
      {props.grouped ? null : (
        <Box width={8} flexShrink={0}>
          <Text color={C.dim}>{BRAIN_SHORT[session.brain]}</Text>
        </Box>
      )}
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text wrap="truncate-end" bold={selected} color={selected ? C.brand : undefined}>
          {title}
          {session.background ? <Text color={C.faint}>{t(' · фон')}</Text> : null}
          {owner ? <Text color={C.faint}> · {owner}</Text> : null}
        </Text>
      </Box>
      {/* Outside the title so a long one never truncates the mark away. */}
      {props.offTree ? (
        <Box flexShrink={0}>
          <Text color={C.warn}>{t(' · без узла')}</Text>
        </Box>
      ) : null}
      <Box width={12} flexShrink={0} justifyContent="flex-end">
        <Text color={props.pane ? C.dim : C.faint} wrap="truncate-end">
          {right}
        </Text>
      </Box>
    </Box>
  );
}

export function liveLabel(session: SessionInfo): string {
  if (session.live?.status === 'busy')
    return t('работает{p1}', {
      p1: session.startedAt ? ` · ${duration(session.startedAt)}` : '',
    });
  if (session.live?.status === 'waiting')
    return t('ждёт тебя{p1}', {
      p1: session.live.waitingFor ? `: ${session.live.waitingFor}` : '',
    });
  if (session.live) return t('открыт');
  return '';
}

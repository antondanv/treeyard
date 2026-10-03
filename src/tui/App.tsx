/**
 * The tree in the terminal.
 *
 * Top: the mark, the project, its goal and progress, the tabs. Middle: the
 * tree — a graph or a list — or a list built from it. Bottom: where the
 * selection is and what "done" means for it, then keys, prompts and news.
 *
 * A session in the terminal needs the whole terminal, so the app does not
 * run it itself: it hands an action to the runner (`run.tsx`), which leaves
 * the full-screen mode, gives the terminal to the CLI and comes back here
 * when the person exits it. Everything else — agents' small jobs, checks —
 * runs in the background while you keep working.
 */
import { spawnSync } from 'node:child_process';

import type { SessionInfo } from '@antondanv/brainyard';
import { Box, type Key, Text, useAnimation, useApp, useInput, useWindowSize } from 'ink';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ASSIST_EFFORT,
  type AssistChoice,
  type AssistJob,
  proposeCriterion,
  proposeSteps,
  type Step,
} from '../agents/assist.js';
import { type CheckResult, runCheck } from '../agents/check.js';
import { contextText, START_HINT, START_LABEL, sessionPlan } from '../agents/context.js';
import {
  BRAIN_LABEL,
  BRAIN_SHORT,
  type LaunchOptions,
  launch,
  liveById,
  projectSessions,
  sessionOwners,
  sleepBackground,
} from '../agents/launch.js';
import { withPaneIdle } from '../agents/pane-idle.js';
import {
  formatMemory,
  launchInPane,
  nodePane,
  type Pane,
  paneFor,
  paneInProject,
  panesAvailable,
  panesToSleep,
  readPanes,
  settlePending,
  sleepingRef,
  sleepPane,
  wakeInPane,
} from '../agents/panes.js';
import { boardOf, ensureHub, hubNode, linkBoard, offerShown, setOffer, syncBoard } from '../github.js';
import { labels, plural, t } from '../i18n/i18n.js';
import { activity, type Event } from '../model/activity.js';
import { description } from '../model/journal.js';
import { linkLabel, linksOf } from '../model/links.js';
import { homeShort, notesFolder } from '../model/notes.js';
import {
  addNode,
  attachSession,
  deleteNode,
  detachSession,
  indent,
  logToNode,
  outdent,
  STATUS_LABEL,
  setStatus,
  shift,
  updateNode,
  WHO_LABEL,
} from '../model/ops.js';
import { GLYPH, writeOverview } from '../model/overview.js';
import { loadTree, treeStamp, writeProject } from '../model/store.js';
import { ago, duration } from '../model/time.js';
import {
  actionable,
  childrenOf,
  descendants,
  ideaNodes,
  offTree,
  offTreeLine,
  offTreeTally,
  parents,
  pathTo,
  progress,
  type Row,
  STATUS_ORDER_NAMES,
  type StatusOrderName,
  statusOrder,
  summarize,
  waitingNodes,
} from '../model/tree.js';
import {
  type BrainId,
  ROOT,
  type SessionRef,
  type StartMode,
  type Status,
  type Tree,
  type TreeNode,
} from '../model/types.js';
import { MAX_PANES, type Settings, SLEEP_AFTER, settings, updateSettings } from '../settings.js';
import { catalogHint, effortOptions, effortsFor, fitChoice, fitEffort, modelOptions, useCatalog } from './catalogs.js';
import { editText, type KeyHint, KeyHints, PromptLine, promptLayout } from './components/controls.js';
import { NodeDetails, SessionDetails } from './details.js';
import {
  CheckDialog,
  ConfirmAssist,
  ConfirmDelete,
  ConfirmLaunch,
  type ConfirmRow,
  CriterionDialog,
  HelpDialog,
  LaunchForm,
  NodeForm,
  NodeMenu,
  NodePicker,
  type NodeValues,
  Palette,
  type PaletteItem,
  type SessionChoice,
  type SettingRow,
  SettingsDialog,
  StatusMenu,
  StatusOrderDialog,
  StepsDialog,
  TextViewer,
  WaitingForm,
} from './dialogs.js';
import { type AgentTask, GithubConnect } from './github-connect.js';
import { follow, Graph, type GraphStyle, layoutGraph, neighbour, selectedOverflow, type Viewport } from './graph.js';
import { History } from './history.js';
import { shortcutKey } from './keys.js';
import { Logo, logoSize, WORDMARK } from './logo.js';
import { MARQUEE_TICK, marquee } from './marquee.js';
import { type Click, Clickable, MouseProvider, usePress } from './mouse.js';
import { ListRow, paneState, rowOverflow, SessionRow, TreeRow, treePrefix } from './rows.js';
import { TerminalPane } from './terminal.js';
import { C, SPINNER, STATUS_COLOR } from './theme.js';
import {
  doneGroupId,
  doneGroupParent,
  doneGroupsOnPath,
  isDoneGroup,
  isGithubOffer,
  treeViewRows,
} from './tree-view.js';
import { saveUi, type UiState, VIEWS, type View } from './ui-state.js';

/** What the runner does after the app steps aside. */
export type Action =
  | { type: 'quit' }
  | { type: 'launch'; node: string; options: LaunchOptions }
  | { type: 'resume'; node: string; ref: SessionRef }
  | { type: 'resume-loose'; session: SessionInfo }
  | { type: 'attach-pane'; pane: string }
  | { type: 'editor'; node: string }
  /** gh asks its own questions (a login): it gets the terminal, then the tree is back. */
  | { type: 'gh'; args: string[] };

export interface Toast {
  text: string;
  color?: string;
}

type Modal =
  | { kind: 'add'; parent: string; after?: string; title?: string }
  | { kind: 'edit'; node: string; doneWhen?: string; check?: string }
  | { kind: 'waiting'; node: string }
  | { kind: 'status'; node: string }
  | { kind: 'menu'; node: string }
  | { kind: 'launch'; node: string; options?: LaunchOptions }
  | { kind: 'delete'; node: string }
  | { kind: 'context'; node: string }
  | { kind: 'link'; session: SessionInfo }
  | { kind: 'palette' }
  | { kind: 'steps'; node: string; steps: Step[] }
  | { kind: 'criterion'; node: string; doneWhen: string; check?: string }
  | { kind: 'check'; node: string; result: CheckResult }
  | { kind: 'confirm'; intent: Intent }
  | { kind: 'settings'; at?: string }
  | { kind: 'statusOrder' }
  | { kind: 'help' }
  | { kind: 'github' }
  | { kind: 'problems' };

/** Something that starts a session or spends an agent's time: asked about first, unless turned off. */
type Intent =
  | { kind: 'new'; node: string; options: LaunchOptions }
  | { kind: 'resume'; node: string; ref: SessionRef }
  | { kind: 'loose'; session: SessionInfo }
  | { kind: AssistJob; node: string; choice: AssistChoice };

/** A one-line input in the footer: quick add and rename without a form. */
interface Prompt {
  kind: 'add' | 'rename';
  label: string;
  value: string;
  cursor: number;
  node?: string;
  parent?: string;
  after?: string;
}

/** A small job an agent or a command does in the background. */
interface Job {
  label: string;
  /** The latest thing it did. */
  detail?: string;
}

const VIEW_LABEL: Record<View, string> = labels(() => ({
  tree: t('Дерево'),
  now: t('Сейчас'),
  waiting: t('Ждёт'),
  ideas: t('Идеи'),
  sessions: t('Сессии'),
  journal: t('Журнал'),
}));

export interface AppProps {
  dir: string;
  ui: UiState;
  toast?: Toast;
  onAction: (action: Action) => void;
  /** Do not ask the CLIs about sessions (tests, snapshots). */
  offline?: boolean;
  /** Remember the view and selection in `.tree/.local/`. Default true. */
  persist?: boolean;
  /** The planting conversation has no task node yet. */
  plantingPane?: Pane;
  plantingFocused?: boolean;
}

export function App(props: AppProps) {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const treeRef = useRef<Tree>(loadTree(props.dir));
  const historyRef = useRef(new History(props.dir));
  const initialized = useRef(false);
  const stampRef = useRef(treeStamp(props.dir));
  const viewportRef = useRef<Viewport>({ x: 0, y: 0 });
  const [, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const tree = treeRef.current;

  const [view, setView] = useState<View>(props.ui.view);
  const [selected, setSelected] = useState<string | undefined>(props.ui.selected);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(props.ui.expanded));
  const [showClosed, setShowClosed] = useState(props.ui.showClosed);
  const [inspector, setInspector] = useState(props.ui.inspector ?? false);
  const [treeMode, setTreeMode] = useState<'graph' | 'list'>(props.ui.treeMode ?? 'graph');
  const [graphStyle, setGraphStyle] = useState<GraphStyle>(props.ui.graphStyle ?? 'line');
  const [cardWidth] = useState(props.ui.cardWidth ?? 28);
  const [filter, setFilter] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchCursor, setSearchCursor] = useState(0);
  const [modal, setModal] = useState<Modal | undefined>();
  const [pending, setPending] = useState<Modal | undefined>();
  const [prompt, setPrompt] = useState<Prompt | undefined>();
  const [live, setLive] = useState<Map<string, SessionInfo>>(new Map());
  const [panes, setPanes] = useState<Pane[]>(props.plantingPane ? [props.plantingPane] : []);
  const [showPane, setShowPane] = useState(true);
  /** How much of the width the session on the right takes; `<` `>` change it. */
  const [split, setSplit] = useState(props.ui.split ?? 0.58);
  const [paneFocused, setPaneFocused] = useState(props.plantingFocused ?? false);
  /** A pane chosen in the menu, when the node has several. */
  const [pinnedPane, setPinnedPane] = useState<string | undefined>();
  const watchedPane = useRef<string | undefined>(undefined);
  const hasPanes = !props.offline && panesAvailable();
  const [allSessions, setAllSessions] = useState<SessionInfo[] | undefined>();
  /** The selected session by `brain:id`: the list re-sorts as sessions come alive, the selection stays. */
  const [sessionKey, setSessionKey] = useState<string | undefined>();
  const [listIndex, setListIndex] = useState<Record<string, number>>({});
  const [toast, setToast] = useState<Toast | undefined>(props.toast);
  const [job, setJob] = useState<Job | undefined>();
  const [branch, setBranch] = useState<string | undefined>();
  /** The models of the project's CLI, asked once the settings open. */
  const catalog = useCatalog(tree.project.brain ?? 'claude', modal?.kind === 'settings');

  const anyBusy = useMemo(() => [...live.values()].some((s) => s.live?.status === 'busy'), [live]);
  const { frame } = useAnimation({ interval: 90, isActive: settings().animation && (anyBusy || Boolean(job)) });

  const ui = useCallback(
    (): UiState => ({
      view,
      ...(selected ? { selected } : {}),
      expanded: [...expanded],
      showClosed,
      inspector,
      cardWidth,
      treeMode,
      graphStyle,
      split,
    }),
    [view, selected, expanded, showClosed, inspector, cardWidth, treeMode, graphStyle, split],
  );

  // First run: open what is in work, select the first thing to do.
  useEffect(() => {
    if (initialized.current) return;
    if (props.plantingPane && tree.nodes.size === 0) return;
    initialized.current = true;
    if (props.ui.expanded.length === 0 && !props.ui.selected) {
      const top = childrenOf(tree, ROOT);
      setExpanded(
        new Set(top.filter((node) => !['done', 'dropped', 'idea'].includes(node.status)).map((node) => node.id)),
      );
      const first = actionable(tree)[0] ?? top[0];
      if (first) {
        setSelected(first.id);
        setExpanded(
          (set) =>
            new Set([
              ...set,
              ...pathTo(tree, first.id)
                .slice(0, -1)
                .map((node) => node.id),
            ]),
        );
      }
    }
  }, [props.ui.expanded.length, props.ui.selected, props.plantingPane, tree]);

  useEffect(() => {
    if (props.persist !== false) saveUi(props.dir, ui());
  }, [props.persist, props.dir, ui]);

  useEffect(() => {
    const got = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: props.dir, encoding: 'utf8' });
    if (got.status === 0 && got.stdout.trim() && got.stdout.trim() !== 'HEAD') setBranch(got.stdout.trim());
  }, [props.dir]);

  // An agent edits `.tree/` too: notice it and reload.
  useEffect(() => {
    const timer = setInterval(() => {
      const stamp = treeStamp(props.dir);
      if (stamp !== stampRef.current) {
        stampRef.current = stamp;
        treeRef.current = loadTree(props.dir);
        bump();
      }
    }, 700);
    return () => clearInterval(timer);
  }, [props.dir, bump]);

  // Poll metadata and live status for all panes, but never their screens.
  const watching = !props.offline && settings().live;
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const [map, list] = await Promise.all([
          watching ? liveById() : new Map<string, SessionInfo>(),
          hasPanes ? readPanes() : [],
        ]);
        if (stop) return;
        if (await settlePending(treeRef.current, list)) {
          stampRef.current = treeStamp(props.dir);
          bump();
        }
        if (stop) return;
        const states = watching ? await withPaneIdle(list, map) : map;
        if (stop) return;
        setLive(states);
        // Without live status, automatic sleep cannot protect working agents.
        const sleeping = watching
          ? panesToSleep(list, {
              dir: props.dir,
              rules: settings(),
              live: states,
              watched: watchedPane.current,
            })
          : [];
        const slept: Pane[] = [];
        for (const { pane } of sleeping) {
          if (stop) return;
          // Selection may have changed while another pane was being closed.
          if (pane.pane === watchedPane.current) continue;
          if ((await sleepPane(treeRef.current, pane)) !== 'failed') slept.push(pane);
        }
        if (slept.length && !stop) {
          const freed = slept.reduce((sum, pane) => sum + (pane.memory ?? 0), 0);
          setToast({
            text: t('усыпил: {names}{freed} · f на узле — разбудить', {
              names: slept.map((pane) => `«${pane.label ?? pane.pane}»`).join(', '),
              freed: freed
                ? t(' — освободил {memory}', {
                    memory: formatMemory(freed),
                  })
                : '',
            }),
          });
        }
        if (!stop) setPanes(sleeping.length ? await readPanes() : list);
      } catch {
        // Failed status discovery never leads to automatic sleep.
      }
      if (!stop) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [watching, hasPanes, props.dir, bump]);

  useEffect(() => {
    if (view !== 'sessions') return;
    if (props.offline) {
      setAllSessions([]);
      return;
    }
    let stop = false;
    const load = async () => {
      try {
        const list = await projectSessions(treeRef.current);
        if (!stop) setAllSessions(list);
      } catch {
        if (!stop) setAllSessions([]);
      }
    };
    void load();
    const timer = setInterval(load, 15_000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [view, props.offline]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(undefined), 7000);
    return () => clearTimeout(timer);
  }, [toast]);

  // A proposal that came while a dialog was open waits for it to close.
  useEffect(() => {
    if (!modal && pending) {
      setModal(pending);
      setPending(undefined);
    }
  }, [modal, pending]);

  // ── What is on screen ─────────────────────────────────────────────────────

  // Recomputed on every render: the tree is mutated in place, and a few
  // hundred nodes flatten in well under a millisecond.
  const treeRows: Row[] = treeViewRows(tree, { expanded, showClosed, filter });
  const nowList = actionable(tree);
  const waitingList = waitingNodes(tree);
  const ideasList = ideaNodes(tree);
  const events = view === 'journal' ? activity(tree) : [];
  const owners = sessionOwners(tree);
  const sessionList: SessionInfo[] = (allSessions ?? []).map((session) => ({
    ...session,
    live: watching ? live.get(session.id)?.live : session.live,
  }));
  // Include panes and sleeping references even before the CLI lists them.
  for (const node of tree.nodes.values())
    for (const ref of node.sessions) {
      if (
        (ref.mode === 'pane' || ref.mode === 'background') &&
        !sessionList.some((s) => s.brain === ref.brain && s.id === ref.id)
      ) {
        sessionList.push({
          brain: ref.brain,
          id: ref.id,
          title: ref.name ?? node.title,
          startedAt: ref.started,
          interactive: true,
          live: live.get(ref.id)?.live,
          ...(ref.mode === 'background' ? { background: true } : {}),
        });
      }
    }
  for (const pane of panes) {
    const id = pane.sessionId ?? `pane:${pane.pane}`;
    if (
      paneInProject(pane, props.dir) &&
      pane.brain &&
      !sessionList.some((s) => s.brain === pane.brain && s.id === id)
    ) {
      sessionList.unshift({ brain: pane.brain, id, title: pane.label, startedAt: pane.startedAt, interactive: true });
    }
  }
  // One group per CLI; in each, the live ones first, then the most recent.
  const liveRank = (session: SessionInfo) => (paneFor(session, panes) ? 0 : session.live ? 1 : 2);
  const recency = (session: SessionInfo) => Date.parse(session.updatedAt ?? session.startedAt ?? '') || 0;
  sessionList.sort(
    (a, b) =>
      BRAIN_ORDER.indexOf(a.brain) - BRAIN_ORDER.indexOf(b.brain) ||
      liveRank(a) - liveRank(b) ||
      recency(b) - recency(a),
  );
  const keyOf = (session: SessionInfo) => `${session.brain}:${session.id}`;
  const sessionSleeping = (session: SessionInfo) =>
    !session.live &&
    !paneFor(session, panes) &&
    Boolean(
      session.background ||
        tree.nodes
          .get(owners.get(session.id) ?? '')
          ?.sessions.some((ref) => ref.id === session.id && (ref.mode === 'pane' || ref.mode === 'background')),
    );
  const sessionIndex = Math.max(
    0,
    sessionList.findIndex((session) => keyOf(session) === sessionKey),
  );
  const summary = summarize(tree);

  const listFor = (v: View): TreeNode[] => {
    if (v === 'now') return nowList;
    if (v === 'waiting') return waitingList;
    if (v === 'ideas') return ideasList;
    if (v === 'journal') return events.map((event) => event.node);
    return treeRows.map((row) => row.node);
  };

  const nodesInView = view === 'sessions' ? [] : listFor(view);
  let cursor = 0;
  if (view === 'tree') {
    cursor = Math.max(
      0,
      treeRows.findIndex((row) => row.node.id === selected),
    );
  } else if (view === 'journal') {
    cursor = Math.min(listIndex.journal ?? 0, Math.max(0, events.length - 1));
  } else if (view !== 'sessions') {
    const byId = nodesInView.findIndex((node) => node.id === selected);
    cursor = byId >= 0 ? byId : Math.min(listIndex[view] ?? 0, Math.max(0, nodesInView.length - 1));
  }
  const currentItem = view === 'sessions' ? undefined : nodesInView[cursor];
  const current = currentItem ? tree.nodes.get(currentItem.id) : undefined;
  const currentGroup = view === 'tree' && isDoneGroup(currentItem?.id) ? currentItem : undefined;
  const currentOffer = view === 'tree' && isGithubOffer(currentItem?.id);

  // A node that just became done moves into its folded group; keep the selection nearby.
  useEffect(() => {
    if (view !== 'tree' || filter || !selected || treeRows.some((row) => row.node.id === selected)) return;
    const path = pathTo(tree, isDoneGroup(selected) ? doneGroupParent(selected) : selected).reverse();
    for (const node of path) {
      const group = node.status === 'done' ? doneGroupId(node.parent) : undefined;
      const target = [group, node.id].find((id) => id && treeRows.some((row) => row.node.id === id));
      if (target) {
        setSelected(target);
        return;
      }
    }
    if (treeRows[0]) setSelected(treeRows[0].node.id);
  });
  const currentSession = view === 'sessions' ? sessionList[Math.min(sessionIndex, sessionList.length - 1)] : undefined;
  const pinned = pinnedPane ? panes.find((p) => p.pane === pinnedPane) : undefined;
  const planting = panes.find((p) => p.pane === props.plantingPane?.pane);
  const selectedPane = currentSession
    ? paneFor(currentSession, panes)
    : ((pinned && current?.sessions.some((ref) => paneFor(ref, [pinned])) ? pinned : undefined) ??
      nodePane(current, panes)?.pane ??
      planting);
  const terminalVisible = Boolean(showPane && selectedPane && !modal && !prompt && !searching);
  watchedPane.current = terminalVisible ? selectedPane?.pane : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new selection restores its pane and returns focus to the tree.
  useEffect(() => {
    setShowPane(true);
    if (!props.plantingPane) setPaneFocused(false);
    setPinnedPane(undefined);
  }, [selected, view, sessionKey]);
  useEffect(() => {
    if (!terminalVisible) setPaneFocused(false);
  }, [terminalVisible]);

  const select = (index: number) => {
    if (view === 'sessions') {
      const at = sessionList[Math.max(0, Math.min(index, sessionList.length - 1))];
      if (at) setSessionKey(keyOf(at));
      return;
    }
    const list = nodesInView;
    if (list.length === 0) return;
    const clamped = Math.max(0, Math.min(index, list.length - 1));
    setSelected(list[clamped]!.id);
    setListIndex((all) => ({ ...all, [view]: clamped }));
  };

  // ── Layout ────────────────────────────────────────────────────────────────

  // The last column stays empty. Autowrap is off while the tree is up (run.tsx): a row the
  // terminal draws wider than Ink measured piles into that column, and Ink's erase-to-end
  // of the row clears it, instead of a wrap shifting the whole frame.
  const width = Math.max(40, columns - 1);
  const height = Math.max(14, rows);
  const compact = height < 26;
  const mark = logoSize(compact);
  const headerHeight = mark.rows + 1;
  // The journal is text: it gets the whole width, the strip below says which node.
  const side =
    columns >= 100 && (terminalVisible || Boolean(modal) || (view === 'tree' ? inspector : view !== 'journal'));
  const wide = modal && ['add', 'edit', 'waiting', 'launch', 'delete', 'steps', 'criterion'].includes(modal.kind);
  const rightWidth = side
    ? terminalVisible
      ? Math.max(50, Math.min(width - 30, Math.floor(width * split)))
      : wide
        ? Math.min(86, Math.max(60, Math.floor(width * 0.58)))
        : Math.min(66, Math.max(40, Math.floor(width * 0.4)))
    : 0;
  const leftWidth = width - rightWidth - (side ? 1 : 0);
  const strip = (view === 'tree' || view === 'journal') && !side ? 2 : view === 'sessions' ? 0 : 1;
  // A long line typed at the bottom shows all of itself: it takes the strip's
  // rows first, then the tree's — never a session pane's, whose size is the agent's screen.
  const promptMax = terminalVisible ? strip + 1 : Math.max(strip + 1, Math.min(8, Math.floor(height / 4)));
  const footerPrompt = paneFocused
    ? undefined
    : prompt
      ? promptLayout({
          lead: `${prompt.kind === 'add' ? '＋ ' : '✎ '}${prompt.label}:`,
          value: prompt.value,
          cursor: prompt.cursor,
          hints: `⏎ ${prompt.kind === 'add' ? t('добавить · tab с критерием') : t('сохранить')}${t(' · esc отмена')}`,
          width: width - 2,
          max: promptMax,
        })
      : searching
        ? promptLayout({
            lead: '/',
            value: filter,
            cursor: searchCursor,
            hints: `${t('найдено узлов: ')}${treeRows.filter((row) => row.match).length}${t(' · ⏎ готово · esc сбросить')}`,
            width: width - 2,
            max: promptMax,
          })
        : undefined;
  const footerHeight = footerPrompt?.rows.length ?? 1;
  const stripShown = Math.max(0, strip - (footerHeight - 1));
  const bodyHeight = height - headerHeight - stripShown - footerHeight;
  const fullModal =
    modal &&
    [
      'context',
      'help',
      'link',
      'problems',
      'palette',
      'check',
      'settings',
      'statusOrder',
      'confirm',
      'github',
    ].includes(modal.kind);
  const listHeight = bodyHeight;
  const paneSize = { width: Math.max(20, (rightWidth || width) - 2), height: Math.max(5, bodyHeight - 4) };
  const graphWidth =
    graphStyle === 'card' ? cardWidth : Math.min(46, Math.max(20, Math.floor((leftWidth - 18) / 2) - 5));
  const graphLayout =
    view === 'tree' && treeMode === 'graph'
      ? layoutGraph(treeRows, { style: graphStyle, width: graphWidth, tree })
      : undefined;
  if (graphLayout) {
    viewportRef.current = follow(graphLayout, currentItem?.id, { x: leftWidth, y: bodyHeight }, viewportRef.current);
  }

  const paneNodes = useMemo(() => {
    const ids = new Set<string>();
    if (panes.length) for (const node of tree.nodes.values()) if (nodePane(node, panes)) ids.add(node.id);
    return ids;
  }, [panes, tree]);

  const badgesFor = (node: TreeNode) => {
    const sessions = node.sessions.map((ref) => live.get(ref.id)).filter((s): s is SessionInfo => Boolean(s?.live));
    const kids = childrenOf(tree, node.id);
    return {
      live: sessions,
      frame,
      pane: nodePane(node, panes)?.pane.brain,
      ...(kids.length > 0 ? { progress: progress(tree, node.id) } : {}),
      ...(node.needs ? { needs: linksOf(tree, node).needs } : {}),
    };
  };

  // The selected title runs when it does not fit — the clock ticks only then.
  const running = (() => {
    if (!current || modal || prompt || !settings().marquee) return undefined;
    if (view === 'tree' && graphLayout) return selectedOverflow(graphLayout, tree, current.id);
    if (view === 'tree') {
      const row = treeRows[cursor];
      return row
        ? rowOverflow(current, leftWidth, treePrefix(row), badgesFor(current), row.held || !row.match)
        : undefined;
    }
    if (view === 'now' || view === 'waiting' || view === 'ideas')
      return rowOverflow(current, leftWidth, 0, badgesFor(current));
    return undefined;
  })();
  const { time: tick, reset: resetTick } = useAnimation({ interval: MARQUEE_TICK, isActive: Boolean(running) });
  const tickedFor = useRef<string | undefined>(undefined);
  const tickKey = `${view}:${current?.id}`;
  if (tickedFor.current !== tickKey) {
    tickedFor.current = tickKey;
    // A new selection starts its title from the beginning.
    queueMicrotask(resetTick);
  }

  // ── Changing things ───────────────────────────────────────────────────────

  const say = (text: string, color?: string) => setToast({ text, ...(color ? { color } : {}) });
  const reload = () => {
    treeRef.current = loadTree(props.dir);
    stampRef.current = treeStamp(props.dir);
    bump();
  };
  /** Every change goes through here: it can be undone, and a failure is a message, not a crash. */
  const change = (label: string, fn: () => void): boolean => {
    try {
      historyRef.current.record(label, fn);
      stampRef.current = treeStamp(props.dir);
      bump();
      return true;
    } catch (error) {
      say((error as Error).message, C.bad);
      return false;
    }
  };
  const undo = () => {
    const done = historyRef.current.undo();
    if (!done) return say(t('отменять нечего'));
    reload();
    say(
      t('↶ отменено: {label}{p2}', {
        label: done.label,
        p2: done.skipped ? ` · ${done.skipped} файл(а) с тех пор менял кто-то ещё — их не трогал` : '',
      }),
    );
  };
  const handOver = (action: Action) => {
    if (job && action.type !== 'quit')
      return say(
        t('подожди: {label}', {
          label: job.label,
        }),
        C.warn,
      );
    saveUi(props.dir, ui());
    props.onAction(action);
    exit();
  };
  const reveal = (id: string) => {
    const node = tree.nodes.get(id);
    if (!node) return;
    setExpanded(
      (set) =>
        new Set([
          ...set,
          ...pathTo(tree, id)
            .slice(0, -1)
            .map((step) => step.id),
          ...doneGroupsOnPath(pathTo(tree, id)),
        ]),
    );
    if (!showClosed && (node.status === 'done' || node.status === 'dropped')) setShowClosed(true);
    setFilter('');
    setView('tree');
    setSelected(id);
  };

  /** The project's brain and its model for agent jobs; the confirmation may pick another one for this job. */
  const assistChoice = (job: AssistJob): AssistChoice => ({
    brain: tree.project.brain ?? 'claude',
    ...(tree.project.assistModel ? { model: tree.project.assistModel } : {}),
    effort: ASSIST_EFFORT[job],
  });

  const defaults = (): LaunchOptions => ({
    brain: tree.project.brain ?? 'claude',
    start: tree.project.start ?? 'plan',
    pane: hasPanes && settings().open === 'pane',
  });

  /** The project's model and effort, when the session runs on the project's own CLI and chose none itself. */
  const withProject = (options: LaunchOptions): LaunchOptions => {
    const p = tree.project;
    if (options.brain !== (p.brain ?? 'claude')) return options;
    const out = { ...options };
    if (!out.model && p.model) out.model = p.model;
    if (!out.effort && p.effort) out.effort = p.effort;
    return out;
  };

  /** Every session and every agent job goes through here: confirmed first, unless the person turned that off. */
  const request = (intent: Intent) => {
    if (settings().confirm) return setModal({ kind: 'confirm', intent });
    perform(intent);
  };
  const perform = (intent: Intent) => {
    const node = 'node' in intent ? tree.nodes.get(intent.node) : undefined;
    if (intent.kind === 'new') return startSession(intent.node, intent.options);
    if (intent.kind === 'resume') {
      const pane = paneFor(intent.ref, panes);
      if (pane) return handOver({ type: 'attach-pane', pane: pane.pane });
      if (intent.ref.mode === 'pane') return wakeSession(intent.node, intent.ref);
      return handOver({ type: 'resume', node: intent.node, ref: intent.ref });
    }
    if (intent.kind === 'loose') {
      const pane = paneFor(intent.session, panes);
      if (pane) {
        setShowPane(true);
        setPaneFocused(true);
        return;
      }
      const owner = owners.get(intent.session.id);
      const ref = owner ? tree.nodes.get(owner)?.sessions.find((s) => s.id === intent.session.id) : undefined;
      if (owner && ref?.mode === 'pane') return wakeSession(owner, ref);
      if (owner && ref) return handOver({ type: 'resume', node: owner, ref });
      return handOver({ type: 'resume-loose', session: intent.session });
    }
    if (!node) return;
    if (intent.kind === 'split') return splitNode(node, intent.choice);
    askCriterion(node, intent.choice);
  };

  const startSession = (nodeId: string, options: LaunchOptions) => {
    if (options.pane && !options.background) {
      if (job) return say(t('подожди: {label}', { label: job.label }), C.warn);
      setJob({ label: t('запускаю сессию в панели') });
      void launchInPane(treeRef.current, nodeId, options, paneSize)
        .then(async ({ warnings }) => {
          reload();
          setPanes(await readPanes());
          reveal(nodeId);
          setShowPane(true);
          if (warnings.length) say(warnings.join(' · '), C.warn);
        })
        .catch((error: Error) => say(error.message, C.bad))
        .finally(() => setJob(undefined));
      return;
    }
    if (!options.background) return handOver({ type: 'launch', node: nodeId, options });
    if (job)
      return say(
        t('подожди: {label}', {
          label: job.label,
        }),
        C.warn,
      );
    const node = tree.nodes.get(nodeId);
    setJob({
      label: t('запускаю {p1} в фоне', {
        p1: BRAIN_LABEL[options.brain],
      }),
    });
    void launch(treeRef.current, nodeId, options)
      .then(({ result }) => {
        reload();
        if (result.ok)
          say(
            t('{p1} работает в фоне над «{title}» · ⏎ — открыть', {
              p1: BRAIN_LABEL[options.brain],
              title: node?.title,
            }),
            C.agent,
          );
        else say(result.error?.message ?? t('не запустилось'), C.bad);
      })
      .catch((error: Error) => say(error.message, C.bad))
      .finally(() => setJob(undefined));
  };

  const wakeSession = (nodeId: string, ref: SessionRef) => {
    if (job) return say(t('подожди: {label}', { label: job.label }), C.warn);
    setJob({ label: t('пробуждаю сессию') });
    void wakeInPane(treeRef.current, nodeId, ref, paneSize)
      .then(async () => {
        reload();
        setPanes(await readPanes());
        if (view !== 'sessions') reveal(nodeId);
        setShowPane(true);
      })
      .catch((error: Error) => say(error.message, C.bad))
      .finally(() => setJob(undefined));
  };

  /** `f`: type into the session on the right; a sleeping one wakes first (asked like any session). */
  const focusPane = () => {
    if (selectedPane) {
      setShowPane(true);
      return setPaneFocused(true);
    }
    const ref = view === 'sessions' ? undefined : sleepingRef(current, panes);
    if (ref && current) return request({ kind: 'resume', node: current.id, ref });
    say(t('у узла нет сессии в панели · o — запустить, ⏎ — все сессии узла'), C.warn);
  };

  const sleepOne = (pane: Pane) => {
    if (pane.attached) return say(t('сессия открыта во весь экран'), C.warn);
    setPaneFocused(false);
    void sleepPane(treeRef.current, pane)
      .then(async (result) => {
        reload();
        setPanes(await readPanes());
        const freed = pane.memory
          ? t(' — освободил {memory}', {
              memory: formatMemory(pane.memory),
            })
          : '';
        if (result === 'slept')
          say(
            t('сессия спит{freed} · f — разбудить', {
              freed,
            }),
          );
        else if (result === 'closed')
          say(
            t('в сессии не было ни одного сообщения — закрыл её{freed}, продолжать нечего', {
              freed,
            }),
          );
        else say(t('tmux не закрыл сессию'), C.bad);
      })
      .catch((error: Error) => say(error.message, C.bad));
  };

  const sleepVisible = () => (selectedPane ? sleepOne(selectedPane) : say(t('у узла нет живой сессии'), C.warn));

  const SPLITS = [0.42, 0.5, 0.58, 0.66, 0.74];
  const resizeSplit = (step: number) => {
    if (!selectedPane) return say(t('у узла нет живой сессии'), C.warn);
    // From the latest value: a held key may deliver several presses before a render.
    setSplit((now) => {
      const at = SPLITS.reduce(
        (best, value, index) => (Math.abs(value - now) < Math.abs(SPLITS[best]! - now) ? index : best),
        0,
      );
      return SPLITS[Math.max(0, Math.min(SPLITS.length - 1, at + step))]!;
    });
  };

  const putToSleep = (ref: SessionRef | SessionInfo) => {
    if (view === 'sessions') setSessionKey(`${ref.brain}:${ref.id}`);
    const pane = paneFor(ref, panes);
    if (pane) return sleepOne(pane);
    const state = live.get(ref.id) ?? ('live' in ref ? ref : undefined);
    const background =
      ('mode' in ref && ref.mode === 'background') ||
      ('background' in ref && ref.background) ||
      state?.live?.kind === 'background';
    if (ref.brain !== 'claude' || !background)
      return say(
        state?.live ? t('сессия открыта в другом терминале — закрой её там') : t('сессия уже закрыта · ⏎ — продолжить'),
        C.warn,
      );
    if (job) return say(t('подожди: {label}', { label: job.label }), C.warn);
    setJob({ label: t('усыпляю сессию') });
    void sleepBackground(treeRef.current, ref)
      .then(async () => {
        const [map, list] = await Promise.all([liveById(), projectSessions(treeRef.current)]);
        setLive(map);
        setAllSessions(list);
        say(t('сессия спит · ⏎ — продолжить'));
      })
      .catch((error: Error) => say(error.message, C.bad))
      .finally(() => setJob(undefined));
  };

  /** A proposal or a result: shown now, or as soon as the open dialog closes. */
  const offer = (next: Modal) => {
    if (modal) {
      setPending(next);
      say(t('готово — откроется, как только закроешь этот диалог'), C.agent);
    } else setModal(next);
  };

  const feed = (event: { feed: boolean; summary: string; kind: string }) => {
    if (event.feed && event.kind !== 'message')
      setJob((current) => (current ? { ...current, detail: event.summary } : current));
  };

  const splitNode = (node: TreeNode, choice: AssistChoice) => {
    if (job)
      return say(
        t('подожди: {label}', {
          label: job.label,
        }),
        C.warn,
      );
    setJob({
      label: t('{p1} разбивает «{title}» на шаги', {
        p1: BRAIN_SHORT[choice.brain],
        title: node.title,
      }),
    });
    void fitChoice(choice)
      .then((fitted) => proposeSteps(treeRef.current, node.id, { ...fitted, onEvent: feed }))
      .then((steps) => offer({ kind: 'steps', node: node.id, steps }))
      .catch((error: Error) => say(error.message, C.bad))
      .finally(() => setJob(undefined));
  };

  const askCriterion = (node: TreeNode, choice: AssistChoice) => {
    if (job)
      return say(
        t('подожди: {label}', {
          label: job.label,
        }),
        C.warn,
      );
    setJob({
      label: t('{p1} формулирует «готово, когда» для «{title}»', {
        p1: BRAIN_SHORT[choice.brain],
        title: node.title,
      }),
    });
    void fitChoice(choice)
      .then((fitted) => proposeCriterion(treeRef.current, node.id, { ...fitted, onEvent: feed }))
      .then((criterion) =>
        offer({
          kind: 'criterion',
          node: node.id,
          doneWhen: criterion.doneWhen,
          ...(criterion.check ? { check: criterion.check } : {}),
        }),
      )
      .catch((error: Error) => say(error.message, C.bad))
      .finally(() => setJob(undefined));
  };

  const check = (node: TreeNode) => {
    if (!node.check) return say(t('у узла нет команды проверки — e, поле «Проверка»'), C.warn);
    if (job)
      return say(
        t('подожди: {label}', {
          label: job.label,
        }),
        C.warn,
      );
    setJob({
      label: t('проверка: {check}', {
        check: node.check,
      }),
    });
    void runCheck(node.check, tree.project.dir)
      .then((result) => {
        reload();
        const verdict = result.ok
          ? t('проверка прошла')
          : t('проверка не прошла (код {p1})', {
              p1: result.code ?? '—',
            });
        // The journal keeps the evidence, not only the verdict.
        change(
          t('проверка «{title}»', {
            title: node.title,
          }),
          () => logToNode(treeRef.current, node.id, `${verdict}: \`${result.command}\``, 'treeyard'),
        );
        offer({ kind: 'check', node: node.id, result });
      })
      .catch((error: Error) => say(error.message, C.bad))
      .finally(() => setJob(undefined));
  };

  const onMenu = (nodeId: string, choice: SessionChoice) => {
    setModal(undefined);
    const node = tree.nodes.get(nodeId);
    if (!node) return;
    if (choice.kind === 'configure') return setModal({ kind: 'launch', node: nodeId });
    if (choice.kind === 'new') return request({ kind: 'new', node: nodeId, options: withProject(choice.options) });
    if (choice.kind === 'split' || choice.kind === 'criterion')
      return request({ kind: choice.kind, node: nodeId, choice: assistChoice(choice.kind) });
    if (choice.kind === 'check') return check(node);
    if (choice.kind === 'context') return setModal({ kind: 'context', node: nodeId });
    if (choice.kind === 'raise' || choice.kind === 'lower') return prioritize(node, choice.kind === 'raise' ? -1 : 1);
    if (choice.kind === 'sleep') return putToSleep(choice.ref);
    if (choice.kind === 'show' || choice.kind === 'fullscreen') {
      const pane = paneFor(choice.ref, panes);
      if (!pane) return say(t('сессия уже закрылась'), C.warn);
      if (choice.kind === 'fullscreen') return handOver({ type: 'attach-pane', pane: pane.pane });
      setPinnedPane(pane.pane);
      setShowPane(true);
      return setPaneFocused(true);
    }
    if (choice.kind === 'forget') {
      change(t('сессия убрана из узла'), () => detachSession(tree, nodeId, choice.ref.id));
      return say(t('сессия убрана из узла (в самом CLI она осталась)'));
    }
    request({ kind: 'resume', node: nodeId, ref: choice.ref });
  };

  const quickAdd = (node: TreeNode | undefined, sibling: boolean) => {
    if (!node) return setPrompt({ kind: 'add', label: t('Новая ветка'), value: '', cursor: 0, parent: ROOT });
    // A long branch name would take the line from what you type; the marquee at rest cuts it with an ellipsis.
    const short = (title = '') => marquee(title, Math.max(12, Math.floor(width / 5)), 0);
    if (sibling) {
      const parent = node.parent === ROOT ? tree.project.title : tree.nodes.get(node.parent)?.title;
      return setPrompt({
        kind: 'add',
        label: t('Рядом, в «{parent}»', {
          parent: short(parent),
        }),
        value: '',
        cursor: 0,
        parent: node.parent,
        after: node.id,
      });
    }
    setPrompt({
      kind: 'add',
      label: t('Внутрь «{title}»', {
        title: short(node.title),
      }),
      value: '',
      cursor: 0,
      parent: node.id,
    });
  };

  const addFromForm = (values: NodeValues, parent: string, after?: string) => {
    let created: TreeNode | undefined;
    change(
      t('новый узел «{title}»', {
        title: values.title,
      }),
      () => {
        created = addNode(tree, {
          title: values.title,
          parent,
          status: values.status,
          ...(values.who ? { who: values.who } : {}),
          doneWhen: values.doneWhen,
          check: values.check,
          ...(after ? { after } : {}),
        });
      },
    );
    if (created) {
      if (parent !== ROOT) setExpanded((set) => new Set(set).add(parent));
      setSelected(created.id);
      if (view !== 'tree' && !listFor(view).some((n) => n.id === created!.id)) setView('tree');
    }
    return created;
  };

  /** G: connect a board when there is none, otherwise check the tree against it. */
  const github = () => {
    if (job) return say(t('подожди: {label}', { label: job.label }), C.warn);
    const board = boardOf(treeRef.current);
    if (!board) return setModal({ kind: 'github' });
    githubJob(t('сверяюсь с доской {board}', { board: `${board.owner}/${board.number}` }), async (current) => {
      const result = await syncBoard(current);
      return t('доска: новых {added} · с доски {pulled} · на доску {pushed}', {
        added: result.added.length,
        pulled: result.pulled.length,
        pushed: result.pushed.length + (result.failed.length ? ` · ✗ ${result.failed.length}` : ''),
      });
    });
  };

  const connectGithub = (ref: string) => {
    githubJob(t('подключаю доску {ref}', { ref }), async (current) => {
      const board = await linkBoard(current, ref);
      const result = await syncBoard(current);
      if (board.parent) {
        setExpanded((set) => new Set(set).add(board.parent!));
        setSelected(board.parent);
      }
      return t('доска {board} подключена · узлов с доски: {n}', {
        board: `${board.owner}/${board.number}`,
        n: result.added.length,
      });
    });
  };

  /** Creating a repository or a board is an agent's job on its own node under «GitHub». */
  const githubAgent = (task: AgentTask) => {
    setModal(undefined);
    let created: TreeNode | undefined;
    change(t('узел для агента: GitHub'), () => {
      const hub = ensureHub(tree);
      created =
        task.kind === 'repo'
          ? addNode(tree, {
              title: t('Создать репозиторий на GitHub и подключить его'),
              parent: hub.id,
              doneWhen: t('git remote -v показывает репозиторий на github.com; без push, пока человек не попросит'),
              body: t(
                'Спроси человека имя и видимость (по умолчанию приватный), создай через gh repo create --source . --remote origin. Потом в treeyard: G на узле GitHub — выбрать или создать доску.',
              ),
            })
          : addNode(tree, {
              title: t('Создать доску GitHub Project и подключить её'),
              parent: hub.id,
              doneWhen: t('treeyard github показывает подключённую доску {owner}/<номер>', { owner: task.repo.owner }),
              body: t(
                'Создай доску у {owner} (gh project create), привяжи к {repo} (gh project link), настрой колонки поля Status под статусы дерева — Backlog, Todo, In Progress, Review, Done — и подключи: treeyard github link {owner}/<номер>, потом treeyard github sync.',
                { owner: task.repo.owner, repo: `${task.repo.owner}/${task.repo.name}` },
              ),
            });
    });
    if (!created) return;
    setExpanded((set) => new Set(set).add(created!.parent));
    setSelected(created.id);
    request({ kind: 'new', node: created.id, options: withProject({ ...defaults(), start: 'do' }) });
  };

  const githubJob = (label: string, work: (tree: Tree) => Promise<string>) => {
    setJob({ label });
    void work(treeRef.current)
      .then((text) => say(text))
      .catch((error: Error) => say(error.message.split('\n')[0] ?? '', C.bad))
      .finally(() => {
        // What `gh` brought in is on disk already: read it back as an agent's edit would be.
        reload();
        setJob(undefined);
      });
  };

  const submitPrompt = (full: boolean) => {
    if (!prompt) return;
    const value = prompt.value.trim();
    setPrompt(undefined);
    if (prompt.kind === 'rename') {
      if (!value || !prompt.node) return;
      const node = tree.nodes.get(prompt.node);
      if (node && value !== node.title)
        change(
          t('переименование «{title}»', {
            title: node.title,
          }),
          () => updateNode(tree, node.id, { title: value }),
        );
      return;
    }
    if (full) {
      return setModal({
        kind: 'add',
        parent: prompt.parent ?? ROOT,
        ...(prompt.after ? { after: prompt.after } : {}),
        title: value,
      });
    }
    if (!value) return;
    addFromForm(
      { title: value, doneWhen: '', check: '', who: '', status: 'todo' },
      prompt.parent ?? ROOT,
      prompt.after,
    );
  };

  const submitForm = (values: NodeValues) => {
    if (!modal) return;
    if (modal.kind === 'add') addFromForm(values, modal.parent, modal.after);
    else if (modal.kind === 'edit') {
      const saved = change(
        t('изменение «{title}»', {
          title: values.title,
        }),
        () => {
          // A journal entry may arrive while the form is open, before the next poll.
          const latest = loadTree(props.dir);
          updateNode(latest, modal.node, {
            title: values.title,
            who: values.who || null,
            doneWhen: values.doneWhen,
            check: values.check,
            description: values.description,
          });
          treeRef.current = latest;
        },
      );
      if (!saved) return;
    }
    setModal(undefined);
  };

  const toggleDone = (node: TreeNode) => {
    const done = node.status === 'done';
    change(
      done
        ? t('«{title}» снова в работе', {
            title: node.title,
          })
        : t('«{title}» готово', {
            title: node.title,
          }),
      () => setStatus(tree, node.id, done ? 'todo' : 'done'),
    );
    say(
      done
        ? t('«{title}» снова к работе · u — отменить', {
            title: node.title,
          })
        : t('✓ «{title}» готово · u — отменить', {
            title: node.title,
          }),
      done ? undefined : C.ok,
    );
  };

  const expandTo = (id: string, open: boolean) =>
    setExpanded((set) => {
      const copy = new Set(set);
      if (open) copy.add(id);
      else copy.delete(id);
      return copy;
    });

  const prioritize = (node: TreeNode, step: -1 | 1) => {
    const peers = childrenOf(tree, node.parent).filter((peer) => peer.status === node.status);
    const index = peers.findIndex((peer) => peer.id === node.id);
    if (!peers[index + step]) return say(t('Узел уже на краю среди соседей этого статуса'));
    const label = step < 0 ? t('«{title}» выше', { title: node.title }) : t('«{title}» ниже', { title: node.title });
    if (change(label, () => shift(tree, node.id, step))) say(t('{label} · u — отменить', { label }));
  };

  // ── Keys ──────────────────────────────────────────────────────────────────

  /** Named actions: the keyboard and the palette both go through these. */
  const actions: Record<string, { label: string; keys: string; run: () => void; needs?: 'node' }> = {
    open: {
      label: t('Всё про узел: сессии, агент, проверка'),
      keys: '⏎',
      needs: 'node',
      run: () => current && setModal({ kind: 'menu', node: current.id }),
    },
    claude: {
      label: t('Claude Code по узлу'),
      keys: 'c',
      needs: 'node',
      run: () =>
        current && request({ kind: 'new', node: current.id, options: withProject({ ...defaults(), brain: 'claude' }) }),
    },
    background: {
      label: t('Claude Code в фоне'),
      keys: 'b',
      needs: 'node',
      run: () => {
        if (!current) return;
        const start = defaults().start;
        request({
          kind: 'new',
          node: current.id,
          options: withProject({ brain: 'claude', start: start === 'chat' ? 'do' : start, background: true }),
        });
      },
    },
    launch: {
      label: t('Настроить запуск сессии'),
      keys: 'o',
      needs: 'node',
      run: () => current && setModal({ kind: 'launch', node: current.id }),
    },
    split: {
      label: t('Разбить на шаги (агент)'),
      keys: 'S',
      needs: 'node',
      run: () => current && request({ kind: 'split', node: current.id, choice: assistChoice('split') }),
    },
    criterion: {
      label: t('Сформулировать «готово, когда» (агент)'),
      keys: '⏎ k',
      needs: 'node',
      run: () => current && request({ kind: 'criterion', node: current.id, choice: assistChoice('criterion') }),
    },
    check: { label: t('Запустить проверку узла'), keys: 't', needs: 'node', run: () => current && check(current) },
    add: {
      label: t('Новый узел внутрь'),
      keys: 'a',
      run: () => quickAdd(current ?? tree.nodes.get(currentGroup?.parent ?? ''), false),
    },
    sibling: {
      label: t('Новый узел рядом'),
      keys: 'A',
      run: () => quickAdd(current ?? tree.nodes.get(currentGroup?.parent ?? ''), !currentGroup),
    },
    rename: {
      label: t('Переименовать'),
      keys: 'r',
      needs: 'node',
      run: () =>
        current &&
        setPrompt({
          kind: 'rename',
          label: t('Название'),
          value: current.title,
          cursor: current.title.length,
          node: current.id,
        }),
    },
    edit: {
      label: t('Изменить поля узла'),
      keys: 'e',
      needs: 'node',
      run: () => current && setModal({ kind: 'edit', node: current.id }),
    },
    raise: {
      label: t('Поднять приоритет среди соседей этого статуса'),
      keys: 'K · ⇧↑',
      needs: 'node',
      run: () => current && prioritize(current, -1),
    },
    lower: {
      label: t('Опустить приоритет среди соседей этого статуса'),
      keys: 'J · ⇧↓',
      needs: 'node',
      run: () => current && prioritize(current, 1),
    },
    editor: {
      label: t('Открыть узел в редакторе'),
      keys: 'E',
      needs: 'node',
      run: () => current && handOver({ type: 'editor', node: current.id }),
    },
    done: { label: t('Готово / снова к работе'), keys: 'd', needs: 'node', run: () => current && toggleDone(current) },
    waiting: {
      label: t('Ждёт — с причиной'),
      keys: 'w',
      needs: 'node',
      run: () => current && setModal({ kind: 'waiting', node: current.id }),
    },
    status: {
      label: t('Статус…'),
      keys: 's',
      needs: 'node',
      run: () => current && setModal({ kind: 'status', node: current.id }),
    },
    context: {
      label: t('Что получит агент'),
      keys: '⏎ p',
      needs: 'node',
      run: () => current && setModal({ kind: 'context', node: current.id }),
    },
    remove: {
      label: t('Удалить узел'),
      keys: 'D',
      needs: 'node',
      run: () => current && setModal({ kind: 'delete', node: current.id }),
    },
    copy: {
      label: t('Скопировать id узла'),
      keys: 'y',
      needs: 'node',
      run: () => {
        if (!current) return;
        copy(current.id);
        say(
          t('id {id} скопирован', {
            id: current.id,
          }),
        );
      },
    },
    undo: { label: t('Отменить последнее изменение'), keys: 'u', run: undo },
    mode: {
      label: t('Граф ↔ список'),
      keys: 'v',
      run: () => {
        setView('tree');
        setTreeMode((mode) => (mode === 'graph' ? 'list' : 'graph'));
      },
    },
    style: {
      label: t('Граф: строки ↔ карточки'),
      keys: 'z',
      run: () => {
        setView('tree');
        setTreeMode('graph');
        setGraphStyle((style) => (style === 'line' ? 'card' : 'line'));
      },
    },
    inspector: { label: t('Панель деталей'), keys: 'i', run: () => setInspector((value) => !value) },
    pane: { label: t('Показать или скрыть сессию справа'), keys: 'p', run: () => setShowPane((value) => !value) },
    paneFocus: { label: t('Печатать в сессию справа (или разбудить)'), keys: 'f', run: () => focusPane() },
    paneFull: {
      label: t('Сессию во весь экран'),
      keys: 'F',
      run: () =>
        selectedPane ? handOver({ type: 'attach-pane', pane: selectedPane.pane }) : say(t('у узла нет живой сессии')),
    },
    paneSleep: {
      label: t('Усыпить выбранную сессию'),
      keys: 'x',
      run: () => (currentSession ? putToSleep(currentSession) : sleepVisible()),
    },
    paneWider: { label: t('Сессия справа шире'), keys: '⇧← <', run: () => resizeSplit(1) },
    paneNarrower: { label: t('Сессия справа уже'), keys: '⇧→ >', run: () => resizeSplit(-1) },
    closed: {
      label: t('Показать или скрыть готовое'),
      keys: '.',
      run: () => {
        setShowClosed((value) => !value);
        say(showClosed ? t('готовое и отказы скрыты — . чтобы показать') : t('готовое снова видно'));
      },
    },
    expandAll: {
      label: t('Раскрыть всё'),
      keys: '+',
      run: () => setExpanded(new Set([...parents(tree), ...doneGroupsOnPath([...tree.nodes.values()])])),
    },
    collapseAll: {
      label: t('Свернуть всё'),
      keys: '−',
      run: () => {
        setExpanded(new Set());
        const top = current ? pathTo(tree, current.id)[0] : undefined;
        if (top) setSelected(top.id);
      },
    },
    search: {
      label: t('Фильтр по названию'),
      keys: '/',
      run: () => {
        setSearching(true);
        setSearchCursor(filter.length);
        setView('tree');
      },
    },
    github: { label: t('GitHub: подключить доску или свериться с ней'), keys: 'G', run: github },
    help: { label: t('Все клавиши'), keys: '?', run: () => setModal({ kind: 'help' }) },
    settings: { label: t('Настройки'), keys: ',', run: () => setModal({ kind: 'settings' }) },
    reload: {
      label: t('Перечитать дерево с диска'),
      keys: '⌃R',
      run: () => {
        reload();
        say(t('перечитал дерево'));
      },
    },
    quit: { label: t('Выйти'), keys: 'q', run: () => handOver({ type: 'quit' }) },
  };

  const KEY_ACTIONS: Record<string, string> = {
    c: 'claude',
    b: 'background',
    o: 'launch',
    S: 'split',
    t: 'check',
    a: 'add',
    A: 'sibling',
    r: 'rename',
    K: 'raise',
    J: 'lower',
    e: 'edit',
    E: 'editor',
    d: 'done',
    w: 'waiting',
    s: 'status',
    p: 'pane',
    f: 'paneFocus',
    F: 'paneFull',
    x: 'paneSleep',
    '<': 'paneWider',
    '>': 'paneNarrower',
    D: 'remove',
    G: 'github',
    y: 'copy',
    u: 'undo',
    v: 'mode',
    z: 'style',
    i: 'inspector',
    '.': 'closed',
    '+': 'expandAll',
    '=': 'expandAll',
    '-': 'collapseAll',
    _: 'collapseAll',
    '/': 'search',
    '?': 'help',
    ',': 'settings',
    q: 'quit',
  };

  /** ⏎ in the list: a node's actions, a session, the node of a journal entry. */
  const enter = () => {
    if (currentGroup) return expandTo(currentGroup.id, !expanded.has(currentGroup.id));
    if (currentOffer || (current && current.id === hubNode(tree)?.id && !boardOf(tree))) return github();
    if (view === 'sessions') {
      const session = currentSession;
      if (!session) return;
      // A live pane is shown, not resumed: nothing to confirm.
      if (paneFor(session, panes)) return focusPane();
      return request({ kind: 'loose', session });
    }
    if (view === 'journal') {
      const event = events[cursor];
      if (event) reveal(event.node.id);
      return;
    }
    actions.open!.run();
  };

  // ── Mouse: a click selects, a double click is ⏎ ─────────────────────────
  const press = usePress();
  /** The keys of the list work now: no dialog, no prompt, no search, no typing into a session. */
  const listKeys = !modal && !searching && !prompt && !paneFocused;
  /** Clicks that only select: they also take the keyboard back from a session. */
  const clicks = !modal && !prompt;
  const clickRow = (index: number, click: Click) => {
    if (click.double) return enter();
    setSearching(false);
    select(index);
  };
  const clickTreeRow = (row: Row, index: number, click: Click) => {
    // The ▸ ▾ of a branch, with a column of slack on each side.
    const marker = treePrefix(row) - 1;
    if (row.hasChildren && click.x >= marker - 1 && click.x <= marker + 1) {
      if (!click.double) expandTo(row.node.id, !row.expanded);
      return;
    }
    clickRow(index, click);
  };
  const graphClick = useRef<{ node: string; fold: boolean } | undefined>(undefined);
  const clickGraph = (hit: { node: string; fold: boolean } | undefined, click: Click) => {
    if (click.double) {
      // The layout may have moved under the pointer: the first click says what was meant.
      if (graphClick.current && !graphClick.current.fold) enter();
      return;
    }
    graphClick.current = hit;
    if (!hit) return;
    setSearching(false);
    setSelected(hit.node);
    const row = treeRows.find((item) => item.node.id === hit.node);
    if (hit.fold && row && isDoneGroup(row.node.id)) return expandTo(row.node.id, !row.expanded);
    if (!hit.fold || !row?.hasChildren || row.expanded) return;
    // The ›4 of a closed branch: open it and step in, as → does.
    const opened = new Set(expanded).add(row.node.id);
    setExpanded(opened);
    const layout = layoutGraph(treeViewRows(tree, { expanded: opened, showClosed, filter }), {
      style: graphStyle,
      width: graphWidth,
      tree,
    });
    const next = neighbour(layout, row.node.id, 'right');
    if (next) setSelected(next);
  };

  const moveCursor = (delta: number) => select(cursorIndex() + delta);
  const cursorIndex = () => (view === 'sessions' ? sessionIndex : cursor);
  const count = view === 'sessions' ? sessionList.length : view === 'journal' ? events.length : nodesInView.length;

  // Footer prompt: quick add and rename.
  useInput(
    (input, key) => {
      if (!prompt) return;
      if (key.escape) return setPrompt(undefined);
      if (key.return) return submitPrompt(false);
      if (key.tab && prompt.kind === 'add') return submitPrompt(true);
      const next = editText(prompt.value, prompt.cursor, input, key);
      if (next) setPrompt({ ...prompt, value: next.value, cursor: next.cursor });
    },
    { isActive: Boolean(prompt) && !modal },
  );

  // Filter: typing narrows the tree.
  useInput(
    (input, key) => {
      if (key.escape || key.return) {
        if (key.escape) setFilter('');
        setSearching(false);
        return;
      }
      if (key.upArrow || key.downArrow) {
        setSearching(false);
        return moveCursor(key.upArrow ? -1 : 1);
      }
      const next = editText(filter, searchCursor, input, key);
      if (!next) return;
      setSearchCursor(next.cursor);
      setFilter(next.value);
      if (view !== 'tree') setView('tree');
    },
    { isActive: searching && !modal && !prompt },
  );

  const arrows = (input: string, key: Key): boolean => {
    const node = current;
    // ← → walk the tree; with Shift they move the border of the session on the right.
    if (key.shift && !key.meta && (key.leftArrow || key.rightArrow)) {
      resizeSplit(key.leftArrow ? 1 : -1);
      return true;
    }
    if (view !== 'tree') {
      if (key.upArrow || input === 'k') {
        moveCursor(-1);
        return true;
      }
      if (key.downArrow || input === 'j') {
        moveCursor(1);
        return true;
      }
      return false;
    }
    const row = treeRows[cursor];
    if (input === 'j') {
      moveCursor(1);
      return true;
    }
    if (input === 'k') {
      moveCursor(-1);
      return true;
    }
    if (graphLayout && key.meta && (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow)) {
      viewportRef.current = {
        x: Math.max(0, viewportRef.current.x + (key.leftArrow ? -10 : key.rightArrow ? 10 : 0)),
        y: Math.max(0, viewportRef.current.y + (key.upArrow ? -5 : key.downArrow ? 5 : 0)),
      };
      bump();
      return true;
    }
    if (key.shift && (key.upArrow || key.downArrow)) {
      if (node) prioritize(node, key.upArrow ? -1 : 1);
      return true;
    }
    if (graphLayout && (key.upArrow || key.downArrow)) {
      const next = neighbour(graphLayout, currentItem?.id, key.upArrow ? 'up' : 'down');
      if (next) setSelected(next);
      return true;
    }
    if (key.upArrow) {
      moveCursor(-1);
      return true;
    }
    if (key.downArrow) {
      moveCursor(1);
      return true;
    }
    if (key.rightArrow || input === 'l') {
      if (!row) return true;
      if (row.hasChildren && !row.expanded) {
        const opened = new Set(expanded).add(row.node.id);
        setExpanded(opened);
        if (graphLayout) {
          // Step into the branch as it opens: one key, not two.
          const layout = layoutGraph(treeViewRows(tree, { expanded: opened, showClosed, filter }), {
            style: graphStyle,
            width: graphWidth,
            tree,
          });
          const next = neighbour(layout, row.node.id, 'right');
          if (next) setSelected(next);
        }
        return true;
      }
      if (graphLayout) {
        const next = neighbour(graphLayout, row.node.id, 'right');
        if (next) setSelected(next);
      } else if (row.expanded) moveCursor(1);
      return true;
    }
    if (key.leftArrow || input === 'h') {
      if (!row) return true;
      if (!graphLayout && row.expanded) {
        expandTo(row.node.id, false);
        return true;
      }
      if (row.node.parent !== ROOT) setSelected(row.node.parent);
      return true;
    }
    if (input === ' ' && row?.hasChildren) {
      expandTo(row.node.id, !row.expanded);
      return true;
    }
    if (input === 'f' && graphLayout && !selectedPane && !sleepingRef(current, panes)) {
      viewportRef.current = { x: 0, y: 0 };
      bump();
      return true;
    }
    if (key.tab && node) {
      change(
        key.shift
          ? t('«{title}» на уровень выше', {
              title: node.title,
            })
          : t('«{title}» вложен', {
              title: node.title,
            }),
        () => (key.shift ? outdent(tree, node.id) : indent(tree, node.id)),
      );
      const moved = tree.nodes.get(node.id);
      if (moved && moved.parent !== ROOT) expandTo(moved.parent, true);
      return true;
    }
    return false;
  };

  useInput(
    (input, key) => {
      input = shortcutKey(input);
      if (key.pageUp) return moveCursor(-Math.max(1, listHeight - 2));
      if (key.pageDown) return moveCursor(Math.max(1, listHeight - 2));
      if (key.home) return select(0);
      if (key.end) return select(count - 1);
      if (input === ':' || (key.ctrl && input === 'k') || (key.ctrl && input === 'p'))
        return setModal({ kind: 'palette' });
      if (key.ctrl && input === 'r') return actions.reload!.run();
      if (key.ctrl && input === 'c') return handOver({ type: 'quit' });
      const n = Number(input);
      if (input && n >= 1 && n <= VIEWS.length && !key.ctrl && !key.meta) return setView(VIEWS[n - 1]!);
      if (key.escape && filter) return setFilter('');
      if (input === '!' && tree.problems.length > 0) return setModal({ kind: 'problems' });

      if (view === 'sessions') {
        if (key.upArrow || input === 'k') return moveCursor(-1);
        if (key.downArrow || input === 'j') return moveCursor(1);
        if (key.shift && (key.leftArrow || key.rightArrow)) return resizeSplit(key.leftArrow ? 1 : -1);
        if (key.leftArrow || key.rightArrow)
          return select(nextGroup(sessionList, sessionIndex, key.rightArrow ? 1 : -1));
        const session = currentSession;
        if (input === 'q') return handOver({ type: 'quit' });
        if (input === '?') return setModal({ kind: 'help' });
        if (input === ',') return setModal({ kind: 'settings' });
        if (!session) return;
        if (input === 'p') return setShowPane((value) => !value);
        if (input === 'f') return focusPane();
        if (input === 'F' || input === '<' || input === '>') return actions[KEY_ACTIONS[input]!]!.run();
        if (input === 'x') return putToSleep(session);
        if (key.return) return enter();
        if (input === 'l') return setModal({ kind: 'link', session });
        return;
      }
      if (view === 'journal') {
        if (key.upArrow || input === 'k') return select(cursor - 1);
        if (key.downArrow || input === 'j') return select(cursor + 1);
        if (key.return) return enter();
      }

      if (arrows(input, key)) return;
      if (key.return) return enter();
      if (key.delete) return actions.remove!.run();
      const name = KEY_ACTIONS[input];
      if (name) actions[name]!.run();
    },
    { isActive: listKeys },
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const body = (): ReactNode => {
    if (view === 'sessions') {
      if (!allSessions && !sessionList.length)
        return <Text color={C.faint}>{t(' ищу сессии Claude Code, Codex и Antigravity этой папки…')}</Text>;
      if (sessionList.length === 0) return <Text color={C.faint}>{t(' в этой папке ещё не было сессий')}</Text>;
      const lines = sessionLines(sessionList);
      const at = lines.findIndex((line) => line.kind === 'row' && line.index === sessionIndex);
      const tally = offTreeTally(sessionList, owners);
      const summary = (
        <Text key="off-tree" wrap="truncate-end" color={tally.off ? C.warn : C.faint}>
          {` ${offTreeLine(tally)}`}
        </Text>
      );
      return [summary].concat(
        windowed(lines, Math.max(0, at), Math.max(1, listHeight - 1)).map(({ item: line }) => {
          if (line.kind === 'gap') return <Text key={`gap:${line.brain}`}> </Text>;
          if (line.kind === 'header') {
            const group = sessionList.filter((session) => session.brain === line.brain);
            const inPanes = group
              .map((session) => paneFor(session, panes))
              .filter((pane): pane is Pane => Boolean(pane));
            const memory = inPanes.reduce((sum, pane) => sum + (pane.memory ?? 0), 0);
            const busy = group.filter((session) => session.live?.status === 'busy').length;
            const waiting = group.filter((session) => session.live?.status === 'waiting').length;
            const mine = currentSession?.brain === line.brain;
            const first = sessionList.findIndex((session) => session.brain === line.brain);
            return (
              <Clickable
                key={`head:${line.brain}`}
                width={leftWidth}
                active={clicks && first >= 0}
                onClick={(click) => clickRow(first, click)}
              >
                <Text wrap="truncate-end">
                  <Text color={mine ? C.brand : C.dim}>{mine ? '▌' : '▏'}</Text>
                  <Text bold color={mine ? C.brand : undefined}>
                    {BRAIN_LABEL[line.brain]}
                  </Text>
                  <Text color={C.faint}>{`  ${group.length}`}</Text>
                  {inPanes.length ? (
                    <Text color={C.ok}>
                      {t('  ▣ {n} в панели', {
                        n: inPanes.length,
                      })}
                      {memory ? ` · ${formatMemory(memory)}` : ''}
                    </Text>
                  ) : null}
                  {busy ? (
                    <Text color={C.agent}>
                      {t('  {n} работает', {
                        n: busy,
                      })}
                    </Text>
                  ) : null}
                  {waiting ? (
                    <Text color={C.you}>
                      {t('  ? {n} ждёт тебя', {
                        n: waiting,
                      })}
                    </Text>
                  ) : null}
                </Text>
              </Clickable>
            );
          }
          if (line.kind === 'empty')
            return (
              <Text key={`empty:${line.brain}`} color={C.faint}>
                {t('   нет сессий в этой папке')}
              </Text>
            );
          const item = sessionList[line.index]!;
          const index = line.index;
          return (
            <Clickable key={keyOf(item)} active={clicks} onClick={(click) => clickRow(index, click)}>
              <SessionRow
                session={item}
                selected={line.index === sessionIndex}
                width={leftWidth}
                frame={frame}
                grouped
                project={tree.project.title}
                pane={paneFor(item, panes)}
                sleeping={sessionSleeping(item)}
                offTree={offTree(item, owners)}
                {...(owners.get(item.id) ? { owner: tree.nodes.get(owners.get(item.id)!)?.title ?? '' } : {})}
              />
            </Clickable>
          );
        }),
      );
    }
    if (view === 'journal') return journal(events, cursor, leftWidth, listHeight, clicks, clickRow);
    if (view === 'tree') {
      if (treeRows.length === 0) {
        return (
          <Box flexDirection="column" paddingX={2} paddingY={1}>
            <Text color={C.faint}>
              {filter
                ? t('ничего не найдено по «{filter}»', {
                    filter,
                  })
                : t('Дерево пустое.')}
            </Text>
            {!filter ? <Text color={C.faint}>{t('a — первая ветка · ? — все клавиши')}</Text> : null}
          </Box>
        );
      }
      if (graphLayout) {
        return (
          <Graph
            tree={tree}
            layout={graphLayout}
            selected={currentItem?.id}
            width={leftWidth}
            height={bodyHeight}
            offset={viewportRef.current}
            live={live}
            panes={paneNodes}
            frame={frame}
            tick={tick}
            active={clicks}
            onClick={clickGraph}
          />
        );
      }
      return windowed(treeRows, cursor, listHeight).map(({ item, index }) => (
        <Clickable key={item.node.id} active={clicks} onClick={(click) => clickTreeRow(item, index, click)}>
          <TreeRow tick={tick} row={item} selected={index === cursor} width={leftWidth} badges={badgesFor(item.node)} />
        </Clickable>
      ));
    }
    const nodes = nodesInView;
    if (nodes.length === 0) {
      const empty: Record<string, string> = {
        now: t('Нечего делать прямо сейчас — всё готово, ждёт или в идеях.'),
        waiting: t('Ничего не ждёт. Упёрся во внешнее — w на узле, и работай в другой ветке.'),
        ideas: t('Идей нет. Всплыла по ходу — a, потом s → идея.'),
      };
      return (
        <Box paddingX={2} paddingY={1}>
          <Text color={C.faint}>{empty[view]}</Text>
        </Box>
      );
    }
    const half = Math.max(1, Math.floor(listHeight / 2));
    return windowed(nodes, cursor, half).map(({ item, index }) => {
      const path = pathTo(tree, item.id)
        .slice(0, -1)
        .map((step) => step.title)
        .join(' › ');
      let note = path || t('верхний уровень');
      if (view === 'now' && item.status === 'waiting')
        note = t('можно продолжать: всё, чего ждал, готово · {path}', { path: note });
      if (view === 'waiting') {
        note = t('{p1}{p2} · ждёт {p3}', {
          p1: item.waiting ?? 'причина не записана',
          p2: item.until ? ` → вернуться, когда: ${item.until}` : '',
          p3: duration(item.updated),
        });
      }
      return (
        <Clickable key={item.id} active={clicks} onClick={(click) => clickRow(index, click)}>
          <ListRow
            tick={tick}
            node={item}
            selected={index === cursor}
            width={leftWidth}
            badges={badgesFor(item)}
            note={note}
          />
        </Clickable>
      );
    });
  };

  const modalNode = modal && 'node' in modal ? tree.nodes.get(modal.node) : undefined;
  const dialog = (): ReactNode => {
    if (!modal) return null;
    const w = fullModal
      ? Math.min(width - 2, modal.kind === 'help' ? 112 : 100)
      : Math.max(36, rightWidth || width - 2);
    const close = () => setModal(undefined);
    switch (modal.kind) {
      case 'confirm': {
        const intent = modal.intent;
        if (intent.kind === 'split' || intent.kind === 'criterion') {
          const node = tree.nodes.get(intent.node);
          if (!node) return null;
          const run = (choice: AssistChoice) => {
            setModal(undefined);
            perform({ ...intent, choice });
          };
          return (
            <ConfirmAssist
              job={intent.kind}
              node={node}
              defaults={intent.choice}
              width={Math.min(width - 2, 96)}
              onCancel={close}
              onConfirm={run}
              onNever={(choice) => {
                updateSettings({ confirm: false });
                say(t('больше не спрашиваю перед запуском · вернуть — «,» → «Подтверждать запуск»'));
                run(choice);
              }}
            />
          );
        }
        const view = confirmView(intent);
        if (!view) return null;
        return (
          <ConfirmLaunch
            title={view.title}
            rows={view.rows}
            prompt={view.prompt}
            note={view.note}
            width={Math.min(width - 2, 96)}
            configurable={intent.kind === 'new'}
            onCancel={close}
            onConfirm={() => {
              setModal(undefined);
              perform(intent);
            }}
            onConfigure={() =>
              intent.kind === 'new' && setModal({ kind: 'launch', node: intent.node, options: intent.options })
            }
            onNever={() => {
              updateSettings({ confirm: false });
              setModal(undefined);
              say(t('больше не спрашиваю перед запуском · вернуть — «,» → «Подтверждать запуск»'));
              perform(intent);
            }}
          />
        );
      }
      case 'settings':
        return (
          <SettingsDialog
            rows={settingRows()}
            width={Math.min(width - 2, 100)}
            height={bodyHeight}
            {...(modal.at ? { at: modal.at } : {})}
            onClose={close}
            onChange={changeSetting}
          />
        );
      case 'statusOrder':
        return (
          <StatusOrderDialog
            order={statusOrder()}
            width={Math.min(width - 2, 72)}
            onSave={(order) => {
              changeStatusOrder({ statusOrder: 'custom', customOrder: order });
              setModal({ kind: 'settings', at: 'statusOrder' });
            }}
            onCancel={() => setModal({ kind: 'settings', at: 'statusOrder' })}
          />
        );
      case 'help':
        return <HelpDialog width={w} height={bodyHeight} onClose={close} />;
      case 'github':
        return (
          <GithubConnect
            dir={props.dir}
            width={w}
            height={bodyHeight}
            onLink={(ref) => {
              close();
              connectGithub(ref);
            }}
            onAgent={githubAgent}
            onGh={(args) => {
              close();
              handOver({ type: 'gh', args });
            }}
            onCancel={close}
          />
        );
      case 'problems':
        return (
          <TextViewer
            title={t('Что не так с файлами дерева')}
            text={tree.problems.join('\n')}
            width={w}
            height={bodyHeight}
            onClose={close}
          />
        );
      case 'palette':
        return (
          <Palette
            items={paletteItems()}
            width={w}
            height={bodyHeight}
            onCancel={close}
            onPick={(key) => {
              setModal(undefined);
              if (key.startsWith('node:')) return reveal(key.slice(5));
              if (key.startsWith('view:')) return setView(key.slice(5) as View);
              actions[key.slice(4)]?.run();
            }}
          />
        );
      case 'add': {
        const place = modal.parent === ROOT ? undefined : tree.nodes.get(modal.parent)?.title;
        return (
          <NodeForm
            mode="add"
            {...(place ? { place } : {})}
            initial={{ title: modal.title ?? '', doneWhen: '', check: '', who: '', status: 'todo' }}
            width={w}
            onSubmit={submitForm}
            onCancel={close}
          />
        );
      }
      case 'edit':
        if (!modalNode) return null;
        return (
          <NodeForm
            mode="edit"
            initial={{
              title: modalNode.title,
              description: description(modalNode.body),
              doneWhen: modal.doneWhen ?? modalNode.doneWhen ?? '',
              check: modal.check ?? modalNode.check ?? '',
              who: modalNode.who ?? '',
              status: modalNode.status,
            }}
            width={w}
            height={bodyHeight}
            onSubmit={submitForm}
            onCancel={close}
          />
        );
      case 'waiting':
        if (!modalNode) return null;
        return (
          <WaitingForm
            node={modalNode}
            width={w}
            onCancel={close}
            onSubmit={(waiting, until) => {
              change(
                t('«{title}» ждёт', {
                  title: modalNode.title,
                }),
                () => setStatus(tree, modalNode.id, 'waiting', { waiting, until }),
              );
              setModal(undefined);
              say(
                t('‖ «{title}» ждёт — остальное, что можно делать, во вкладке 2 «Сейчас»', {
                  title: modalNode.title,
                }),
                C.warn,
              );
            }}
          />
        );
      case 'status':
        if (!modalNode) return null;
        return (
          <StatusMenu
            node={modalNode}
            width={w}
            onCancel={close}
            onPick={(status: Status) => {
              if (status === 'waiting') return setModal({ kind: 'waiting', node: modalNode.id });
              change(
                t('статус «{title}»', {
                  title: modalNode.title,
                }),
                () => setStatus(tree, modalNode.id, status),
              );
              setModal(undefined);
              say(
                t('«{title}»: {p2} · u — отменить', {
                  title: modalNode.title,
                  p2: STATUS_LABEL[status],
                }),
              );
            }}
          />
        );
      case 'menu':
        if (!modalNode) return null;
        return (
          <NodeMenu
            node={modalNode}
            width={w}
            height={bodyHeight}
            defaults={defaults()}
            live={live}
            panes={panes}
            frame={frame}
            canRaise={
              childrenOf(tree, modalNode.parent).filter((node) => node.status === modalNode.status)[0]?.id !==
              modalNode.id
            }
            canLower={
              childrenOf(tree, modalNode.parent)
                .filter((node) => node.status === modalNode.status)
                .at(-1)?.id !== modalNode.id
            }
            onCancel={close}
            onChoose={(choice) => onMenu(modalNode.id, choice)}
          />
        );
      case 'launch':
        if (!modalNode) return null;
        return (
          <LaunchForm
            node={modalNode}
            width={w}
            defaults={
              modal.options ?? {
                brain: defaults().brain,
                start: defaults().start,
                pane: defaults().pane,
                ...(tree.project.model ? { model: tree.project.model } : {}),
                ...(tree.project.effort ? { effort: tree.project.effort } : {}),
              }
            }
            onCancel={close}
            onSubmit={(options) => {
              setModal(undefined);
              // A configured launch is confirmed like any other: what, where, the first message.
              request({ kind: 'new', node: modalNode.id, options });
            }}
          />
        );
      case 'delete':
        if (!modalNode) return null;
        return (
          <ConfirmDelete
            node={modalNode}
            count={descendants(tree, modalNode.id).length}
            width={w}
            onCancel={close}
            onConfirm={(withChildren) => {
              const parent = modalNode.parent;
              change(
                t('удаление «{title}»', {
                  title: modalNode.title,
                }),
                () => deleteNode(tree, modalNode.id, withChildren),
              );
              setModal(undefined);
              setSelected(parent === ROOT ? undefined : parent);
              say(
                t('«{title}» удалён · u — вернуть', {
                  title: modalNode.title,
                }),
              );
            }}
          />
        );
      case 'context': {
        if (!modalNode) return null;
        const plan = sessionPlan(tree, modalNode.id, defaults().start, defaults().brain);
        const text = t('{p1}\n\n# Первое сообщение ({start})\n\n{p3}', {
          p1: contextText(tree, modalNode.id),
          start: plan.start,
          p3: plan.prompt ?? '—',
        });
        return (
          <TextViewer
            title={t('Что получит агент · {title}', {
              title: modalNode.title,
            })}
            text={text}
            width={w}
            height={bodyHeight}
            onClose={close}
          />
        );
      }
      case 'steps':
        if (!modalNode) return null;
        return (
          <StepsDialog
            node={modalNode}
            steps={modal.steps}
            width={w}
            height={bodyHeight}
            onCancel={close}
            onAccept={(steps) => {
              setModal(undefined);
              if (steps.length === 0) return;
              change(
                t('шаги для «{title}»', {
                  title: modalNode.title,
                }),
                () => {
                  for (const step of steps) {
                    addNode(tree, {
                      title: step.title,
                      parent: modalNode.id,
                      ...(step.who ? { who: step.who } : {}),
                      ...(step.doneWhen ? { doneWhen: step.doneWhen } : {}),
                      ...(step.note ? { body: step.note } : {}),
                    });
                  }
                },
              );
              expandTo(modalNode.id, true);
              say(
                t('+ {length} {steps} в «{title}» · u — отменить', {
                  steps: plural(steps.length, ['шаг', 'шага', 'шагов'], ['step', 'steps']),
                  length: steps.length,
                  title: modalNode.title,
                }),
                C.ok,
              );
            }}
          />
        );
      case 'criterion':
        if (!modalNode) return null;
        return (
          <CriterionDialog
            node={modalNode}
            doneWhen={modal.doneWhen}
            {...(modal.check ? { check: modal.check } : {})}
            width={w}
            onCancel={close}
            onEdit={() =>
              setModal({
                kind: 'edit',
                node: modalNode.id,
                doneWhen: modal.doneWhen,
                ...(modal.check ? { check: modal.check } : {}),
              })
            }
            onAccept={() => {
              setModal(undefined);
              change(
                t('критерий «{title}»', {
                  title: modalNode.title,
                }),
                () =>
                  updateNode(tree, modalNode.id, {
                    doneWhen: modal.doneWhen,
                    ...(modal.check ? { check: modal.check } : {}),
                  }),
              );
              say(t('◎ критерий записан · u — отменить'), C.ok);
            }}
          />
        );
      case 'check':
        if (!modalNode) return null;
        return (
          <CheckDialog
            node={modalNode}
            command={modal.result.command}
            ok={modal.result.ok}
            code={modal.result.code}
            seconds={Math.round(modal.result.durationMs / 100) / 10}
            output={modal.result.output}
            width={w}
            height={bodyHeight}
            onClose={close}
            onStatus={(status) => {
              setModal(undefined);
              change(
                t('статус «{title}»', {
                  title: modalNode.title,
                }),
                () => setStatus(tree, modalNode.id, status, { note: t('проверка прошла') }),
              );
              say(`«${modalNode.title}»: ${STATUS_LABEL[status]}`, C.ok);
            }}
          />
        );
      case 'link': {
        const all: { node: TreeNode; depth: number }[] = [];
        const walk = (parent: string, depth: number) => {
          for (const kid of childrenOf(tree, parent)) {
            all.push({ node: kid, depth });
            walk(kid.id, depth + 1);
          }
        };
        walk(ROOT, 0);
        const session = modal.session;
        return (
          <NodePicker
            title={t('Привязать «{p1}» к узлу', {
              p1: session.title ?? session.id.slice(0, 8),
            })}
            nodes={all}
            width={w}
            height={bodyHeight}
            onCancel={close}
            onPick={(id) => {
              change(t('сессия привязана к узлу'), () =>
                attachSession(
                  tree,
                  id,
                  {
                    brain: session.brain,
                    id: session.id,
                    ...(session.title ? { name: session.title } : {}),
                    ...(session.startedAt ? { started: session.startedAt } : {}),
                  },
                  t('сессия привязана к узлу'),
                ),
              );
              setModal(undefined);
              say(
                t('сессия привязана к «{title}»', {
                  title: tree.nodes.get(id)?.title,
                }),
              );
            }}
          />
        );
      }
    }
  };

  /** What the confirmation says: who starts, where, how, with which first message. */
  const confirmView = (
    intent: Intent,
  ): { title: string; rows: ConfirmRow[]; prompt?: string; note?: string } | undefined => {
    const node = 'node' in intent ? tree.nodes.get(intent.node) : undefined;
    const nodeRow = (n: TreeNode): ConfirmRow => ({
      label: t('Узел'),
      value: `${GLYPH[n.status]} ${n.title}`,
      color: STATUS_COLOR[n.status],
    });
    if (intent.kind === 'new') {
      if (!node) return undefined;
      const { options } = intent;
      const plan = sessionPlan(tree, node.id, options.start, options.brain);
      const rows: ConfirmRow[] = [
        nodeRow(node),
        {
          label: t('Кто'),
          value: `${BRAIN_LABEL[options.brain]} · ${options.background ? t('в фоне, сам по себе') : options.pane ? t('в панели') : t('в этом терминале')}`,
          color: C.agent,
        },
        { label: t('Как начать'), value: `${START_LABEL[plan.start]} — ${START_HINT[plan.start]}` },
        {
          label: t('Модель'),
          value: `${options.model ?? t('по умолчанию CLI')} · ${t('усилие')} ${options.effort ?? t('по умолчанию')}`,
        },
      ];
      if (options.worktree) rows.push({ label: 'Worktree', value: t('отдельный git worktree') });
      const note = options.background
        ? t('Claude будет работать без тебя и тратить лимит подписки; статус — на узле, открыть — ⏎.')
        : options.pane
          ? t('Сессия откроется рядом с деревом · f — ввод · ⌃Q — обратно.')
          : t('Терминал перейдёт к {brain}; выйдешь из сессии — вернёшься в дерево.', {
              brain: BRAIN_LABEL[options.brain],
            });
      return {
        title: t('Запустить сессию?'),
        rows,
        ...(plan.prompt ? { prompt: plan.prompt } : {}),
        note,
      };
    }
    if (intent.kind === 'resume') {
      if (!node) return undefined;
      const state = live.get(intent.ref.id);
      const waking = intent.ref.mode === 'pane';
      return {
        title: waking ? t('Разбудить сессию?') : t('Продолжить сессию?'),
        rows: [
          nodeRow(node),
          { label: t('Кто'), value: BRAIN_LABEL[intent.ref.brain], color: C.agent },
          { label: t('Сессия'), value: intent.ref.name ?? intent.ref.id },
          { label: t('Последний раз'), value: ago(intent.ref.opened ?? intent.ref.started) || '—' },
        ],
        note:
          intent.ref.mode === 'pane'
            ? t(
                'Тот же разговор откроется в панели рядом с деревом: CLI снова займёт память, токены не тратятся, пока ты не напишешь.',
              )
            : state?.live
              ? t('Сессия сейчас открыта — терминал подключится прямо к ней.')
              : t('Терминал перейдёт к {brain}; выйдешь из сессии — вернёшься в дерево.', {
                  brain: BRAIN_LABEL[intent.ref.brain],
                }),
      };
    }
    if (intent.kind === 'loose') {
      return {
        title: t('Продолжить сессию?'),
        rows: [
          { label: t('Кто'), value: BRAIN_LABEL[intent.session.brain], color: C.agent },
          { label: t('Сессия'), value: intent.session.title ?? intent.session.id },
          { label: t('Последний раз'), value: ago(intent.session.updatedAt ?? intent.session.startedAt) || '—' },
        ],
        note: t('Сессия не привязана к узлу — после неё нажми l, чтобы привязать.'),
      };
    }
    // Agent jobs are confirmed by ConfirmAssist: there the agent is chosen too.
    return undefined;
  };

  const settingRows = (): SettingRow[] => {
    const s = settings();
    const yesNo = [
      { value: 'on', label: t('да') },
      { value: 'off', label: t('нет') },
    ];
    const p = tree.project;
    const brain = p.brain ?? 'claude';
    return [
      {
        key: 'lang',
        section: t('ДЛЯ ВСЕХ ПРОЕКТОВ  ~/.treeyard/settings.json'),
        label: t('Язык'),
        options: [
          { value: 'ru', label: 'Русский' },
          { value: 'en', label: 'English' },
        ],
        value: s.lang,
        hint: t('интерфейс, шаблоны и то, что получают агенты'),
      },
      {
        key: 'confirm',
        label: t('Подтверждать запуск'),
        options: yesNo,
        value: s.confirm ? 'on' : 'off',
        hint: t('спрашивать перед каждой сессией и задачей агента'),
      },
      {
        key: 'theme',
        label: t('Тема'),
        options: [
          { value: 'dark', label: t('тёмная') },
          { value: 'light', label: t('светлая') },
        ],
        value: s.theme,
        hint: t('под цвет терминала'),
      },
      {
        key: 'animation',
        label: t('Анимация'),
        options: yesNo,
        value: s.animation ? 'on' : 'off',
        hint: t('спиннеры и мигающий лист, пока работает агент'),
      },
      {
        key: 'marquee',
        label: t('Бегущее название'),
        options: yesNo,
        value: s.marquee ? 'on' : 'off',
        hint: t('длинное название выбранного узла прокручивается, чтобы прочитать целиком'),
      },
      {
        key: 'statusOrder',
        label: t('Порядок статусов'),
        options: [
          { value: 'active-first', label: t('в работе сверху') },
          { value: 'done-first', label: t('готовые сверху') },
          { value: 'active-last', label: t('в работе снизу') },
          { value: 'custom', label: t('свой') },
        ],
        value: s.statusOrder,
        // The order itself: short words, so it fits a narrow terminal.
        hint: statusOrder()
          .map((status) => (status === 'review' ? t('проверка') : STATUS_LABEL[status]))
          .join(' → '),
        enter: { label: t('свой порядок'), run: () => setModal({ kind: 'statusOrder' }) },
      },
      {
        key: 'live',
        label: t('Живые статусы сессий'),
        options: yesNo,
        value: s.live ? 'on' : 'off',
        hint: t('каждые 3 с: кто из Claude Code, Codex и Antigravity работает, а кто ждёт тебя'),
      },
      {
        key: 'open',
        label: t('Где открывать сессии'),
        options: [
          { value: 'pane', label: t('в панели') },
          { value: 'terminal', label: t('в терминале') },
        ],
        value: s.open,
        hint: t('для панелей нужен tmux; сессии продолжают работать после выхода'),
      },
      {
        key: 'sleepAfter',
        label: t('Усыплять после простоя'),
        options: SLEEP_AFTER.map((n) => ({ value: String(n), label: n ? t('{n} мин', { n }) : t('выкл') })),
        value: String(s.sleepAfter),
        hint: t('работающие, ожидающие тебя и видимая панель не засыпают'),
      },
      {
        key: 'maxPanes',
        label: t('Лимит живых панелей'),
        options: MAX_PANES.map((n) => ({ value: String(n), label: n ? String(n) : t('без предела') })),
        value: String(s.maxPanes),
        hint: t('при превышении засыпает самая давно простаивающая'),
      },
      {
        key: 'notes',
        label: t('Куда падают замечания'),
        value: s.notes ? homeShort(s.notes) : '',
        placeholder: t('не задано'),
        hint: t('папка с деревом для treeyard note · «.» — этот · пусто — убрать'),
      },
      {
        key: 'brain',
        section: t('ЭТОТ ПРОЕКТ  .tree/tree.md'),
        label: t('Мозг по умолчанию'),
        options: (['claude', 'codex', 'antigravity'] as BrainId[]).map((id) => ({ value: id, label: BRAIN_LABEL[id] })),
        value: p.brain ?? 'claude',
        hint: t('для c, ⏎ → новая сессия и задач агента · модель и усилие у каждого CLI свои'),
      },
      {
        key: 'start',
        label: t('Как начинать сессию'),
        options: (['plan', 'do', 'goal', 'chat'] as StartMode[]).map((mode) => ({
          value: mode,
          label: START_LABEL[mode],
        })),
        value: p.start ?? 'plan',
        hint: START_HINT[p.start ?? 'plan'],
      },
      {
        key: 'model',
        label: t('Модель сессий'),
        options: modelOptions(catalog, p.model),
        value: p.model ?? '',
        hint: catalogHint(brain, catalog, p.model),
      },
      {
        key: 'effort',
        label: t('Усилие'),
        options: effortOptions(catalog, p.model, p.effort),
        value: p.effort ?? '',
        hint:
          effortsFor(catalog, p.model)?.length === 0
            ? t('у этой модели усилие не настраивается')
            : t('* — по умолчанию у модели; больше усилия — дольше и дороже'),
      },
      {
        key: 'assistModel',
        label: t('Модель для задач агента'),
        options: modelOptions(catalog, p.assistModel),
        value: p.assistModel ?? '',
        hint: t('для «разбить на шаги» и критерия — можно дешевле и быстрее'),
      },
      boardOf(tree)
        ? {
            key: 'github',
            label: t('Доска GitHub'),
            options: [{ value: 'linked', label: `${boardOf(tree)!.owner}/${boardOf(tree)!.number}` }],
            value: 'linked',
            hint: t('G — свериться с доской · колонки — в .tree/tree.md, github.columns'),
          }
        : {
            key: 'github',
            label: t('Узел GitHub'),
            options: [
              { value: 'on', label: t('показывать') },
              { value: 'off', label: t('скрыть') },
            ],
            value: offerShown(tree) ? 'on' : 'off',
            hint: t('пока доска не подключена, узел в дереве предлагает подключить доску и issues'),
          },
      {
        key: 'view',
        section: t('ВИД'),
        label: t('Дерево'),
        options: [
          { value: 'line', label: t('граф') },
          { value: 'card', label: t('карточки') },
          { value: 'list', label: t('список') },
        ],
        value: treeMode === 'list' ? 'list' : graphStyle,
      },
      { key: 'closed', label: t('Показывать готовое'), options: yesNo, value: showClosed ? 'on' : 'off' },
      { key: 'inspector', label: t('Панель деталей'), options: yesNo, value: inspector ? 'on' : 'off' },
    ];
  };

  const changeStatusOrder = (patch: Partial<Pick<Settings, 'statusOrder' | 'customOrder'>>) => {
    updateSettings(patch);
    // The overview in git follows the order you see.
    writeOverview(tree);
    stampRef.current = treeStamp(props.dir);
  };

  const changeSetting = (key: string, value: string) => {
    const on = value === 'on';
    if (key === 'lang' && (value === 'ru' || value === 'en')) updateSettings({ lang: value });
    else if (key === 'confirm') updateSettings({ confirm: on });
    else if (key === 'theme' && (value === 'dark' || value === 'light')) updateSettings({ theme: value });
    else if (key === 'animation') updateSettings({ animation: on });
    else if (key === 'marquee') updateSettings({ marquee: on });
    else if (key === 'statusOrder' && STATUS_ORDER_NAMES.includes(value as StatusOrderName))
      changeStatusOrder({ statusOrder: value as StatusOrderName });
    else if (key === 'live') updateSettings({ live: on });
    else if (key === 'open' && (value === 'pane' || value === 'terminal')) updateSettings({ open: value });
    else if (key === 'sleepAfter') updateSettings({ sleepAfter: Number(value) });
    else if (key === 'maxPanes') updateSettings({ maxPanes: Number(value) });
    else if (key === 'github') {
      if (value !== 'linked') change(t('узел GitHub'), () => setOffer(tree, on));
    } else if (key === 'notes') {
      try {
        const dir = notesFolder(value, props.dir);
        updateSettings({ notes: dir });
        say(dir ? t('замечания — в дерево {dir}', { dir: homeShort(dir) }) : t('куда падают замечания — не задано'));
      } catch (error) {
        say((error as Error).message, C.bad);
      }
    } else if (key === 'view') {
      if (value === 'list') setTreeMode('list');
      else {
        setTreeMode('graph');
        setGraphStyle(value as GraphStyle);
      }
    } else if (key === 'closed') setShowClosed(on);
    else if (key === 'inspector') setInspector(on);
    else {
      // Project settings live in tree.md, next to the tree.
      const project = tree.project;
      if (key === 'brain') {
        // Models belong to one CLI: a name of another one would not start.
        project.brain = value as BrainId;
        project.model = undefined;
        project.effort = undefined;
        project.assistModel = undefined;
      } else if (key === 'start') project.start = value as StartMode;
      else if (key === 'model') {
        project.model = value || undefined;
        project.effort = fitEffort(catalog, value, project.effort ?? '') || undefined;
      } else if (key === 'effort') project.effort = value || undefined;
      else if (key === 'assistModel') project.assistModel = value || undefined;
      change(t('настройки проекта'), () => writeProject(project));
    }
    bump();
  };

  const paletteItems = (): PaletteItem[] => {
    const items: PaletteItem[] = [];
    for (const [name, action] of Object.entries(actions)) {
      if (action.needs === 'node' && !current) continue;
      items.push({ key: `act:${name}`, label: action.label, detail: action.keys, mark: '›', markColor: C.accent });
    }
    VIEWS.forEach((v, index) => {
      items.push({
        key: `view:${v}`,
        label: t('Вкладка «{p1}»', {
          p1: VIEW_LABEL[v],
        }),
        detail: String(index + 1),
        mark: '›',
        markColor: C.accent,
      });
    });
    const walk = (parent: string, trail: string[]) => {
      for (const node of childrenOf(tree, parent)) {
        items.push({
          key: `node:${node.id}`,
          label: node.title,
          ...(trail.length ? { detail: trail.join(' › ') } : {}),
          mark: GLYPH[node.status],
          markColor: STATUS_COLOR[node.status],
        });
        walk(node.id, [...trail, node.title]);
      }
    };
    walk(ROOT, []);
    return items;
  };

  // ── The frame ─────────────────────────────────────────────────────────────

  const goal = tree.project.goal;
  const percent = summary.total > 0 ? Math.round((summary.done / summary.total) * 100) : 0;
  const busyAgents = [...live.values()].filter((s) => s.live?.status === 'busy' && owners.has(s.id)).length;
  const waitingYou = [...live.values()].filter((s) => s.live?.status === 'waiting' && owners.has(s.id)).length;
  const ownPanes = panes.filter((p) => paneInProject(p, props.dir));
  const paneBytes = ownPanes.reduce((sum, p) => sum + (p.memory ?? 0), 0);
  const infoWidth = width - mark.columns - 4;
  const barWidth = Math.max(8, Math.min(24, Math.floor(infoWidth / 6)));
  const filled = summary.total > 0 ? Math.round((summary.done / summary.total) * barWidth) : 0;
  const counts: Record<View, number | undefined> = {
    tree: undefined,
    now: nowList.length,
    waiting: waitingList.length,
    ideas: ideasList.length,
    sessions: sessionList.length || undefined,
    journal: undefined,
  };

  const titleLine = (
    <Box width={infoWidth}>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="truncate-end">
          <Text color={C.brand} bold>
            {WORDMARK}
          </Text>
          <Text color={C.faint}> · </Text>
          <Text bold>{tree.project.title}</Text>
          {branch ? <Text color={C.faint}>{`  ⎇ ${branch}`}</Text> : null}
        </Text>
      </Box>
      <Box flexShrink={0}>
        <Text>
          {ownPanes.length > 0 ? (
            <Text color={C.dim}>
              {'▣ '}
              {plural(ownPanes.length, ['сессия', 'сессии', 'сессий'], ['session', 'sessions']).replace(
                /^/,
                `${ownPanes.length} `,
              )}
              {paneBytes ? ` · ${formatMemory(paneBytes)}` : ''}
              {'  '}
            </Text>
          ) : null}
          {busyAgents > 0 ? (
            <Text color={C.agent}>
              {SPINNER[frame % SPINNER.length]}
              {t(' работает агентов: ')}
              {busyAgents}
              {'  '}
            </Text>
          ) : null}
          {waitingYou > 0 ? (
            <Text color={C.you}>
              {t('? ждут тебя: ')}
              {waitingYou}{' '}
            </Text>
          ) : null}
        </Text>
        {tree.problems.length ? (
          <Clickable active={listKeys} onClick={(click) => click.double || press('!')}>
            <Text color={C.bad}>
              {t('! проблем в файлах: ')}
              {tree.problems.length} (!){'  '}
            </Text>
          </Clickable>
        ) : null}
        {infoWidth >= 72 ? (
          <>
            <Clickable active={listKeys} onClick={(click) => click.double || press(',')}>
              <Text>
                <Text color={C.accent} inverse bold>
                  {' , '}
                </Text>
                <Text color={C.dim}>{t(' настройки')}</Text>
              </Text>
            </Clickable>
            <Text color={C.faint}>{'  '}</Text>
            {/* ? closes the help too: its own footer may be below a short screen. */}
            <Clickable active={listKeys || modal?.kind === 'help'} onClick={(click) => click.double || press('?')}>
              <Text>
                <Text color={C.accent} inverse bold>
                  {' ? '}
                </Text>
                <Text color={C.dim}>{t(' клавиши')}</Text>
              </Text>
            </Clickable>
          </>
        ) : null}
      </Box>
    </Box>
  );
  const goalLine = (
    <Text wrap="truncate-end">
      <Text color={C.faint}>{t('цель  ')}</Text>
      <Text color={goal ? undefined : C.faint}>{goal || t('не записана — в .tree/tree.md, поле goal')}</Text>
    </Text>
  );
  const progressLine = (
    <Text wrap="truncate-end">
      <Text color={C.brand}>{'━'.repeat(filled)}</Text>
      <Text color={C.rule}>{'━'.repeat(barWidth - filled)}</Text>
      <Text color={C.dim}>
        {'  '}
        {percent}% · {summary.done}/{summary.total}
        {t(' готово')}
      </Text>
      <Text color={C.faint}>{'    '}</Text>
      <Text color={C.accent}>◐ {summary.active}</Text>
      <Text color={C.faint}>{t(' в работе ')}</Text>
      <Text color={C.review}>◎ {summary.review}</Text>
      <Text color={C.faint}>{t(' на проверке ')}</Text>
      <Text color={C.warn}>‖ {summary.waiting}</Text>
      <Text color={C.faint}>{t(' ждут ')}</Text>
      <Text color={C.idea}>◇ {summary.ideas}</Text>
      <Text color={C.faint}>{t(' идей')}</Text>
    </Text>
  );
  const tabs = (
    <Box width={infoWidth} overflow="hidden">
      {VIEWS.map((v, index) => {
        const active = v === view;
        const n = counts[v];
        return (
          <Clickable
            key={v}
            marginRight={columns < 90 ? 1 : 3}
            flexShrink={0}
            active={clicks}
            onClick={() => {
              setSearching(false);
              setView(v);
            }}
          >
            <Text>
              <Text color={active ? C.brand : C.faint}>{index + 1} </Text>
              <Text color={active ? C.brand : C.dim} bold={active} underline={active}>
                {VIEW_LABEL[v]}
              </Text>
              {n !== undefined && n > 0 ? <Text color={active ? C.brand : C.faint}> {n}</Text> : null}
            </Text>
          </Clickable>
        );
      })}
      {view === 'tree' ? (
        <Box flexGrow={1} justifyContent="flex-end">
          <Text color={C.faint}>
            {treeMode === 'graph' ? (graphStyle === 'line' ? t('граф') : t('карточки')) : t('список')}
            {filter || searching ? '' : ' · '}
          </Text>
          {filter || searching ? null : (
            <KeyHints hints={[{ key: 'v z', press: ['v', 'z'] }]} keyColor={C.faint} active={listKeys} />
          )}
        </Box>
      ) : null}
    </Box>
  );

  return (
    <MouseProvider>
      <Box flexDirection="column" width={width} height={height}>
        {/* Header: the mark, the project, the tabs. */}
        <Box width={width} height={mark.rows} paddingX={1}>
          <Logo compact={compact} {...(busyAgents > 0 ? { pulse: frame } : {})} />
          <Box flexDirection="column" marginLeft={2} width={infoWidth}>
            {titleLine}
            {compact ? null : goalLine}
            {progressLine}
            {tabs}
          </Box>
        </Box>
        <Box width={width} paddingX={1}>
          <Text color={C.rule}>{'─'.repeat(Math.max(0, width - 2))}</Text>
        </Box>

        {/* Body */}
        <Box width={width} height={bodyHeight}>
          {fullModal ? (
            <Box width={width} height={bodyHeight} justifyContent="center" alignItems="flex-start">
              {dialog()}
            </Box>
          ) : (
            <>
              {!side && (modal || terminalVisible) ? null : (
                <Box flexDirection="column" width={leftWidth} height={bodyHeight} overflow="hidden">
                  {body()}
                </Box>
              )}
              {side ? (
                <Box width={1} height={bodyHeight} flexDirection="column" overflow="hidden">
                  {/* The session pane and dialogs draw their own frames: a rule next to them would double the line. */}
                  {terminalVisible || modal ? null : <Text color={C.rule}>{'│\n'.repeat(bodyHeight).trimEnd()}</Text>}
                </Box>
              ) : null}
              {modal ? (
                <Box width={side ? rightWidth : width} height={bodyHeight} flexDirection="column">
                  {dialog()}
                </Box>
              ) : terminalVisible && selectedPane ? (
                <TerminalPane
                  key={selectedPane.pane}
                  pane={selectedPane}
                  title={
                    selectedPane === planting
                      ? (selectedPane.label ?? '')
                      : (current?.title ?? selectedPane.label ?? currentSession?.title ?? '')
                  }
                  state={paneState(selectedPane, live.get(selectedPane.sessionId ?? ''), frame)}
                  width={side ? rightWidth : width}
                  height={bodyHeight}
                  focused={paneFocused}
                  onFocus={() => setPaneFocused(true)}
                  onBlur={() => setPaneFocused(false)}
                  onGone={() => {
                    setPanes((list) => list.filter((p) => p.pane !== selectedPane.pane));
                    setPaneFocused(false);
                  }}
                  onError={(message) => say(message, C.bad)}
                />
              ) : side ? (
                view === 'sessions' ? (
                  <SessionDetails
                    session={currentSession}
                    sleeping={Boolean(currentSession && sessionSleeping(currentSession))}
                    owner={
                      currentSession && owners.get(currentSession.id)
                        ? tree.nodes.get(owners.get(currentSession.id)!)
                        : undefined
                    }
                    width={rightWidth}
                    height={bodyHeight}
                  />
                ) : currentOffer ? (
                  <GithubOffer />
                ) : currentGroup ? (
                  <Box flexDirection="column" paddingX={2} paddingY={1}>
                    <Text color={C.ok} bold>
                      {currentGroup.title}
                    </Text>
                    <Text color={C.faint}>{t('space — раскрыть или свернуть · ⏎ на узле — сессии и действия')}</Text>
                  </Box>
                ) : (
                  <NodeDetails
                    tree={tree}
                    node={current}
                    width={rightWidth}
                    height={bodyHeight}
                    live={live}
                    frame={frame}
                  />
                )
              ) : null}
            </>
          )}
        </Box>

        {/* Where you are, and what done means here. */}
        {stripShown > 0 ? (
          <SelectionStrip
            tree={tree}
            node={current}
            group={currentGroup}
            offer={currentOffer}
            width={width}
            full={stripShown === 2}
            live={live}
            frame={frame}
          />
        ) : null}

        {/* Footer: a prompt, a job, news or keys. */}
        <Box width={width} paddingX={1}>
          {paneFocused ? (
            <Text color={C.agent} wrap="truncate-end">
              {t('✎ печатаешь в {brain} · ⌃Q или клик по дереву — обратно', {
                brain: selectedPane?.brain ? BRAIN_LABEL[selectedPane.brain] : 'CLI',
              })}
            </Text>
          ) : footerPrompt ? (
            <PromptLine layout={footerPrompt} />
          ) : job ? (
            <Text color={C.agent} wrap="truncate-end">
              {SPINNER[frame % SPINNER.length]} {job.label}
              {job.detail ? <Text color={C.faint}> · {job.detail}</Text> : null}
            </Text>
          ) : toast ? (
            <Text color={toast.color ?? C.brand} wrap="truncate-end">
              {toast.text}
            </Text>
          ) : (
            <Hints
              view={view}
              has={Boolean(current)}
              group={Boolean(currentGroup)}
              offer={currentOffer}
              filter={filter}
              pane={!terminalVisible && current && sleepingRef(current, panes) ? 'sleeping' : undefined}
              active={listKeys}
            />
          )}
        </Box>
      </Box>
    </MouseProvider>
  );
}

/** Two lines under the tree: the path to the selection, and its "done" or what it waits for. */
function SelectionStrip(props: {
  tree: Tree;
  node: TreeNode | undefined;
  group?: TreeNode | undefined;
  offer?: boolean;
  width: number;
  full: boolean;
  live: Map<string, SessionInfo>;
  frame: number;
}) {
  const { tree, node } = props;
  if (props.offer) {
    return (
      <Box flexDirection="column" width={props.width} paddingX={1}>
        <Text color={C.brand} wrap="truncate-end">
          {`${tree.project.title} › GitHub`}
        </Text>
        {props.full ? (
          <Text color={C.faint} wrap="truncate-end">
            {t('не подключено · ⏎ — подключить доску · скрыть — в настройках «,»')}
          </Text>
        ) : null}
      </Box>
    );
  }
  if (props.group) {
    const path = [tree.project.title, ...pathTo(tree, props.group.parent).map((step) => step.title), props.group.title];
    return (
      <Box flexDirection="column" width={props.width} paddingX={1}>
        <Text color={C.ok} wrap="truncate-end">
          {path.join(' › ')}
        </Text>
        {props.full ? (
          <Text color={C.faint} wrap="truncate-end">
            {t('space — раскрыть или свернуть · ⏎ на узле — сессии и действия')}
          </Text>
        ) : null}
      </Box>
    );
  }
  if (!node) {
    return (
      <Box width={props.width} paddingX={1} height={props.full ? 2 : 1}>
        <Text color={C.faint}> </Text>
      </Box>
    );
  }
  const path = pathTo(tree, node.id);
  const meta = [STATUS_LABEL[node.status], node.who ? WHO_LABEL[node.who] : undefined, node.id]
    .filter(Boolean)
    .join(' · ');
  const sessions = node.sessions.map((ref) => props.live.get(ref.id)).filter((s): s is SessionInfo => Boolean(s?.live));
  const busy = sessions.find((s) => s.live?.status === 'busy');
  const waiting = sessions.find((s) => s.live?.status === 'waiting');
  let agents: ReactNode = (
    <Text color={C.faint}>
      {node.sessions.length
        ? t('сессий: {length} · ⏎', {
            length: node.sessions.length,
          })
        : t('сессий нет · c — начать')}
    </Text>
  );
  if (waiting)
    agents = (
      <Text color={C.you}>
        ? {BRAIN_SHORT[waiting.brain]}
        {t(' ждёт тебя · ⏎')}
      </Text>
    );
  else if (busy) {
    agents = (
      <Text color={C.agent}>
        {SPINNER[props.frame % SPINNER.length]} {BRAIN_SHORT[busy.brain]}
        {t(' работает · ⏎')}
      </Text>
    );
  }
  let second: ReactNode;
  const links = linksOf(tree, node);
  // Another project's node speaks first: it is what this one waits for, or what it is for.
  const link = links.needs.find((item) => item.node?.status !== 'done') ?? links.needs[0] ?? links.neededBy[0];
  if (link) {
    const waits = links.needs.includes(link);
    second = (
      <Text wrap="truncate-end">
        <Text color={waits ? C.warn : C.faint}>{waits ? t('ждёт: ') : t('нужен для: ')}</Text>
        {link.node ? (
          <>
            <Text color={STATUS_COLOR[link.node.status]}>{GLYPH[link.node.status]} </Text>
            <Text>{linkLabel(link)}</Text>
            <Text color={C.dim}> · {STATUS_LABEL[link.node.status]}</Text>
          </>
        ) : (
          <Text color={C.faint}>{linkLabel(link)}</Text>
        )}
        {(waits ? links.needs : links.neededBy).length > 1 ? (
          <Text color={C.faint}> +{(waits ? links.needs : links.neededBy).length - 1}</Text>
        ) : null}
      </Text>
    );
  } else if (node.status === 'waiting') {
    second = (
      <Text color={C.warn} wrap="truncate-end">
        {t('‖ ждёт: ')}
        {node.waiting ?? t('причина не записана')}
        {node.until ? (
          <Text color={C.dim}>
            {t(' → вернуться, когда: ')}
            {node.until}
          </Text>
        ) : null}
      </Text>
    );
  } else if (node.doneWhen) {
    second = (
      <Text wrap="truncate-end">
        <Text color={C.faint}>{t('готово, когда  ')}</Text>
        <Text>{node.doneWhen}</Text>
        {node.check ? <Text color={C.accent}>{`   $ ${node.check}`}</Text> : null}
      </Text>
    );
  } else {
    second = (
      <Text color={C.faint} wrap="truncate-end">
        {t('готово, когда — не задано · e задать · ⏎ k — предложит агент')}
      </Text>
    );
  }
  return (
    <Box flexDirection="column" width={props.width} paddingX={1}>
      <Box width={props.width - 2}>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end">
            <Text color={C.faint}>{tree.project.title} › </Text>
            {path.slice(0, -1).map((step) => (
              <Text key={step.id} color={C.faint}>
                {step.title} ›{' '}
              </Text>
            ))}
            <Text color={STATUS_COLOR[node.status]}>{GLYPH[node.status]} </Text>
            <Text bold>{node.title}</Text>
          </Text>
        </Box>
        <Box flexShrink={0} marginLeft={2}>
          <Text color={C.faint}>{meta}</Text>
        </Box>
      </Box>
      {props.full ? (
        <Box width={props.width - 2}>
          <Box flexGrow={1} flexShrink={1}>
            {second}
          </Box>
          <Box flexShrink={0} marginLeft={2}>
            {agents}
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}

function Hints(props: {
  view: View;
  has: boolean;
  group: boolean;
  offer?: boolean;
  filter: string;
  pane?: 'sleeping' | undefined;
  active: boolean;
}) {
  // The session on the right comes first: it is what the person looks at.
  // A sleeping session is one key away; a live one shows its own keys in its panel.
  const pane: [string, string][] = props.pane === 'sleeping' ? [['f', t('разбудить сессию')]] : [];
  const keys: [string, string][] =
    props.view === 'sessions'
      ? [
          ...pane,
          ['⏎', t('открыть')],
          ['x', t('усыпить')],
          ['← →', t('к другому CLI')],
          ['l', t('привязать к узлу')],
          ['1–6', t('вкладки')],
          [',', t('настройки')],
          ['?', t('клавиши')],
        ]
      : props.view === 'journal'
        ? [
            ['⏎', t('к узлу')],
            ['1–6', t('вкладки')],
            [':', t('найти')],
            [',', t('настройки')],
            ['?', t('клавиши')],
          ]
        : props.offer
          ? [
              ['⏎', t('подключить доску GitHub')],
              [',', t('настройки — скрыть узел')],
              ['?', t('клавиши')],
              ['q', t('выход')],
            ]
          : props.group
            ? [
                ['space', t('раскрыть или свернуть готовые')],
                [':', t('найти')],
                ['.', t('скрыть готовое')],
                ['?', t('клавиши')],
              ]
            : !props.has
              ? [
                  ['a', t('добавить')],
                  [':', t('найти')],
                  [',', t('настройки')],
                  ['?', t('клавиши')],
                  ['q', t('выход')],
                ]
              : [
                  ...pane,
                  ['⏎', t('действия')],
                  ['K J', t('приоритет')],
                  [',', t('настройки')],
                  ['c', 'claude'],
                  ['a', t('добавить')],
                  ['r', t('имя')],
                  ['d', t('готово')],
                  ['w', t('ждёт')],
                  ['S', t('разбить')],
                  ['u', t('отмена')],
                  [':', t('найти')],
                  ['?', t('всё')],
                ];
  const hints: KeyHint[] = keys.map(([key, label]) => ({
    key,
    label,
    ...(key === 'K J' ? { press: ['K', 'J'] } : {}),
  }));
  return (
    <Box>
      {props.filter ? (
        <Box flexShrink={0}>
          <Text color={C.brand}>
            / {props.filter}
            <Text color={C.faint}> (esc){'   '}</Text>
          </Text>
        </Box>
      ) : null}
      <KeyHints hints={hints} active={props.active} />
    </Box>
  );
}

function journal(
  events: Event[],
  cursor: number,
  width: number,
  height: number,
  active: boolean,
  onClick: (index: number, click: Click) => void,
): ReactNode {
  if (events.length === 0) {
    return (
      <Box paddingX={2} paddingY={1}>
        <Text color={C.faint}>{t('Журнал пуст. Сюда попадает всё, что пишут в узлы — ты, агенты и сессии.')}</Text>
      </Box>
    );
  }
  return windowed(events, cursor, height).map(({ item, index }) => {
    const selected = index === cursor;
    const when =
      item.when.length > 10
        ? `${item.when.slice(8, 10)}.${item.when.slice(5, 7)} ${item.when.slice(11)}`
        : `${item.when.slice(8, 10)}.${item.when.slice(5, 7)}`;
    const agent = !['ты', 'you', 'treeyard'].includes(item.who);
    return (
      <Clickable
        key={`${item.node.id}:${item.time}`}
        width={width}
        active={active}
        onClick={(click) => onClick(index, click)}
      >
        <Text color={C.brand}>{selected ? '❯' : ' '}</Text>
        <Box width={12} flexShrink={0}>
          <Text color={C.faint}>{when}</Text>
        </Box>
        <Box width={9} flexShrink={0}>
          <Text color={agent ? C.agent : C.dim} wrap="truncate-end">
            {item.who}
          </Text>
        </Box>
        <Box width={Math.min(34, Math.floor(width / 3))} flexShrink={0} marginRight={2}>
          <Text wrap="truncate-end" bold={selected} color={selected ? C.brand : undefined}>
            <Text color={STATUS_COLOR[item.node.status]}>{GLYPH[item.node.status]} </Text>
            {item.node.title}
          </Text>
        </Box>
        <Box flexGrow={1} flexShrink={1}>
          <Text color={C.dim} wrap="truncate-end">
            {item.text}
          </Text>
        </Box>
      </Clickable>
    );
  });
}

/** The slice of a long list that keeps the cursor in view, a little above the middle. */
const BRAIN_ORDER: readonly BrainId[] = ['claude', 'codex', 'antigravity'];

type SessionLine =
  | { kind: 'header'; brain: BrainId }
  | { kind: 'row'; index: number }
  | { kind: 'empty'; brain: BrainId }
  | { kind: 'gap'; brain: BrainId };

/** The sessions view, one group per CLI, every CLI shown even without sessions. The list is sorted by brain. */
export function sessionLines(list: readonly SessionInfo[]): SessionLine[] {
  const lines: SessionLine[] = [];
  for (const brain of BRAIN_ORDER) {
    if (lines.length) lines.push({ kind: 'gap', brain });
    lines.push({ kind: 'header', brain });
    let any = false;
    list.forEach((session, index) => {
      if (session.brain !== brain) return;
      lines.push({ kind: 'row', index });
      any = true;
    });
    if (!any) lines.push({ kind: 'empty', brain });
  }
  return lines;
}

/** The first session of the next (or previous) CLI that has any. */
export function nextGroup(list: readonly SessionInfo[], index: number, step: 1 | -1): number {
  const here = BRAIN_ORDER.indexOf(list[index]?.brain ?? 'claude');
  for (let at = here + step; at >= 0 && at < BRAIN_ORDER.length; at += step) {
    const first = list.findIndex((session) => session.brain === BRAIN_ORDER[at]);
    if (first >= 0) return first;
  }
  return index;
}

function windowed<T>(items: T[], cursor: number, size: number): { item: T; index: number }[] {
  if (items.length <= size) return items.map((item, index) => ({ item, index }));
  const start = Math.max(0, Math.min(cursor - Math.floor(size / 3), items.length - size));
  return items.slice(start, start + size).map((item, offset) => ({ item, index: start + offset }));
}

function copy(text: string): void {
  try {
    if (process.platform === 'darwin') spawnSync('pbcopy', { input: text });
    else spawnSync('xclip', ['-selection', 'clipboard'], { input: text });
  } catch {
    // No clipboard: the id is on screen anyway.
  }
}

/** The «GitHub» node of a tree with no board: what connecting one gives. */
function GithubOffer() {
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text color={C.brand} bold>
        GitHub
      </Text>
      <Text color={C.faint}>{t('не подключено')}</Text>
      <Text> </Text>
      <Text wrap="wrap">
        {t(
          'Если задачи проекта лежат на доске GitHub Project, подключи её: карточки станут узлами здесь, колонки — статусами, в обе стороны.',
        )}
      </Text>
      <Text> </Text>
      <Text wrap="wrap">
        <Text color={C.brand}>⏎</Text>{' '}
        {t('подключить: gh → репозиторий → доска (выбрать или создать — самому или агентом)')}
      </Text>
      <Text wrap="wrap" color={C.faint}>
        {t('Issues репозитория без доски — скоро. Не нужно — скрой узел в настройках «,».')}
      </Text>
    </Box>
  );
}

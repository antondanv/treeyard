/**
 * Dialogs: add and edit a node, mark it waiting, pick a status, start or
 * resume a session, confirm a delete, help, and a reader for long text.
 */
import type { Catalog, SessionInfo } from '@antondanv/brainyard';
import { Box, Text, useInput } from 'ink';
import { useRef, useState } from 'react';
import wrapAnsi from 'wrap-ansi';

import { START_HINT, START_LABEL } from '../agents/context.js';
import { BRAIN_LABEL, BRAIN_SHORT, type LaunchOptions } from '../agents/launch.js';
import { formatMemory, isPending, type Pane, paneFor, panesAvailable } from '../agents/panes.js';
import { plural, t } from '../i18n/i18n.js';
import { STATUS_LABEL, WHO_LABEL } from '../model/ops.js';
import { GLYPH } from '../model/overview.js';
import { ago } from '../model/time.js';
import {
  type BrainId,
  type SessionRef,
  START_MODES,
  STATUSES,
  type StartMode,
  type Status,
  type TreeNode,
  WHO,
  type Who,
} from '../model/types.js';
import { catalogHint, effortOptions, effortsFor, fitEffort, modelOptions, useCatalog } from './catalogs.js';
import {
  Choice,
  Field,
  Frame,
  type KeyHint,
  KeyHints,
  Menu,
  type MenuItem,
  Options,
  TextField,
  useLatest,
} from './components/controls.js';
import { shortcutKey } from './keys.js';
import { Clickable } from './mouse.js';
import { liveLabel, paneState } from './rows.js';
import { C, STATUS_COLOR } from './theme.js';

// ── Node form ───────────────────────────────────────────────────────────────

export interface NodeValues {
  title: string;
  doneWhen: string;
  check: string;
  who: Who | '';
  status: Status;
}

export function NodeForm(props: {
  mode: 'add' | 'edit';
  /** Where the new node goes, for the title of the dialog. */
  place?: string;
  initial: NodeValues;
  width: number;
  onSubmit: (values: NodeValues) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<NodeValues>(props.initial);
  const fields = props.mode === 'add' ? 5 : 4;
  const [focus, setFocus] = useState(0);
  const set = <K extends keyof NodeValues>(key: K, value: NodeValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));
  useInput((_input, key) => {
    if (key.escape) return props.onCancel();
    if (key.return) {
      if (!values.title.trim()) return setFocus(0);
      return props.onSubmit(values);
    }
    if (key.tab && key.shift) return setFocus((f) => (f - 1 + fields) % fields);
    if (key.tab || key.downArrow) return setFocus((f) => (f + 1) % fields);
    if (key.upArrow) return setFocus((f) => (f - 1 + fields) % fields);
  });
  const width = props.width - 4;
  const inputWidth = Math.max(10, width - 20);
  return (
    <Frame
      title={
        props.mode === 'add'
          ? t('Новый узел{p1}', {
              p1: props.place ? ` · в «${props.place}»` : '',
            })
          : t('Изменить узел')
      }
      width={props.width}
      footer={[
        { key: '⏎', label: t('сохранить') },
        { key: 'tab/↓', label: t('дальше'), press: '\t' },
        { key: '←→', label: t('выбор') },
        { key: 'esc', label: t('отмена') },
        { label: t('описание — E в редакторе') },
      ]}
    >
      <Field label={t('Название')} active={focus === 0}>
        <TextField
          value={values.title}
          onChange={(v) => set('title', v)}
          active={focus === 0}
          width={inputWidth}
          placeholder={t('что сделать')}
          lines={5}
        />
      </Field>
      <Field label={t('Готово, когда')} active={focus === 1}>
        <TextField
          value={values.doneWhen}
          onChange={(v) => set('doneWhen', v)}
          active={focus === 1}
          width={inputWidth}
          placeholder={t('что можно увидеть или запустить')}
          lines={5}
        />
      </Field>
      <Field label={t('Проверка')} active={focus === 2}>
        <TextField
          value={values.check}
          onChange={(v) => set('check', v)}
          active={focus === 2}
          width={inputWidth}
          placeholder={t('команда, например npm test')}
          lines={3}
        />
      </Field>
      <Field label={t('Делает')} active={focus === 3}>
        <Choice<Who | ''>
          options={[
            { value: '', label: t('не важно') },
            ...WHO.filter((who) => who !== 'any').map((who) => ({ value: who, label: WHO_LABEL[who] })),
          ]}
          value={values.who}
          active={focus === 3}
          onChange={(v) => set('who', v)}
        />
      </Field>
      {props.mode === 'add' ? (
        <Field label={t('Статус')} active={focus === 4}>
          <Choice<Status>
            options={(['todo', 'idea', 'active', 'waiting'] as Status[]).map((status) => ({
              value: status,
              label: `${GLYPH[status]} ${STATUS_LABEL[status]}`,
            }))}
            value={values.status}
            active={focus === 4}
            onChange={(v) => set('status', v)}
          />
        </Field>
      ) : null}
    </Frame>
  );
}

// ── Waiting ─────────────────────────────────────────────────────────────────

export function WaitingForm(props: {
  node: TreeNode;
  width: number;
  onSubmit: (waiting: string, until: string) => void;
  onCancel: () => void;
}) {
  const [waiting, setWaiting] = useState(props.node.waiting ?? '');
  const [until, setUntil] = useState(props.node.until ?? '');
  const [focus, setFocus] = useState(0);
  useInput((_input, key) => {
    if (key.escape) return props.onCancel();
    if (key.return) return props.onSubmit(waiting, until);
    if (key.tab || key.downArrow || key.upArrow) setFocus((f) => 1 - f);
  });
  const inputWidth = Math.max(10, props.width - 24);
  return (
    <Frame
      title={t('«{title}» ждёт', {
        title: props.node.title,
      })}
      width={props.width}
      color={C.warn}
      footer={[
        { key: '⏎', label: t('сохранить') },
        { key: 'tab', label: t('дальше') },
        { key: 'esc', label: t('отмена') },
        { label: t('остальные ветки дерева остаются в работе') },
      ]}
    >
      <Field label={t('Что мешает')} active={focus === 0}>
        <TextField
          value={waiting}
          onChange={setWaiting}
          active={focus === 0}
          width={inputWidth}
          placeholder={t('нет сервера, ждём юриста, нет доступа к API…')}
          lines={3}
        />
      </Field>
      <Field label={t('Вернуться, когда')} active={focus === 1}>
        <TextField
          value={until}
          onChange={setUntil}
          active={focus === 1}
          width={inputWidth}
          placeholder={t('появится VPS, юрист пришлёт тексты…')}
          lines={3}
        />
      </Field>
    </Frame>
  );
}

// ── Status ──────────────────────────────────────────────────────────────────

const STATUS_KEYS: Record<Status, string> = {
  idea: 'i',
  todo: 't',
  active: 'a',
  waiting: 'w',
  review: 'r',
  done: 'd',
  dropped: 'x',
};

export function StatusMenu(props: {
  node: TreeNode;
  width: number;
  onPick: (status: Status) => void;
  onCancel: () => void;
}) {
  const items: MenuItem[] = STATUSES.map((status) => ({
    key: status,
    hotkey: STATUS_KEYS[status],
    label: (
      <Text>
        <Text color={STATUS_COLOR[status]}>{GLYPH[status]} </Text>
        <Text bold={status === props.node.status}>{STATUS_LABEL[status]}</Text>
        {status === props.node.status ? <Text color={C.faint}>{t(' · сейчас')}</Text> : null}
      </Text>
    ),
  }));
  return (
    <Frame
      title={t('Статус · {title}', {
        title: props.node.title,
      })}
      width={props.width}
      footer={[{ key: '⏎', label: t('выбрать') }, { label: t('буква — сразу') }, { key: 'esc', label: t('отмена') }]}
    >
      <Menu items={items} active onPick={(key) => props.onPick(key as Status)} onCancel={props.onCancel} />
    </Frame>
  );
}

// ── Everything you can do with a node ───────────────────────────────────────

export type SessionChoice =
  | { kind: 'new'; options: LaunchOptions }
  | { kind: 'configure' }
  | { kind: 'resume'; ref: SessionRef }
  | { kind: 'show'; ref: SessionRef }
  | { kind: 'fullscreen'; ref: SessionRef }
  | { kind: 'sleep'; ref: SessionRef }
  | { kind: 'forget'; ref: SessionRef }
  | { kind: 'split' }
  | { kind: 'criterion' }
  | { kind: 'check' }
  | { kind: 'raise' }
  | { kind: 'lower' }
  | { kind: 'context' };

export function NodeMenu(props: {
  node: TreeNode;
  width: number;
  height: number;
  defaults: LaunchOptions;
  live: Map<string, SessionInfo>;
  panes: readonly Pane[];
  frame: number;
  canRaise?: boolean;
  canLower?: boolean;
  onChoose: (choice: SessionChoice) => void;
  onCancel: () => void;
}) {
  const { node, defaults } = props;
  const start = defaults.start;
  const sorted = [...node.sessions].sort((a, b) =>
    (b.opened ?? b.started ?? '').localeCompare(a.opened ?? a.started ?? ''),
  );
  const items: MenuItem[] = [];
  let firstPane = true;
  sorted.forEach((ref, index) => {
    const live = props.live.get(ref.id);
    const pane = paneFor(ref, props.panes);
    const sleeping = !pane && ref.mode === 'pane';
    const state = pane ? paneState(pane, live, props.frame) : undefined;
    const name = shortSessionName(ref.name, node.title);
    const status = state
      ? `▣ ${t('в панели')} · ${state.text}${pane?.memory ? ` · ${formatMemory(pane.memory)}` : ''}`
      : sleeping
        ? t('спит — разбудить в панели')
        : live?.live
          ? liveLabel(live)
          : '';
    items.push({
      key: `resume:${ref.id}`,
      section: index === 0 ? t('Сессии узла') : undefined,
      hint: pane
        ? t('⏎ — справа от дерева, печатать в неё · del — убрать из узла')
        : sleeping
          ? t('⏎ — тот же разговор в новой панели · del — убрать из узла')
          : t('⏎ — продолжить · del — убрать из узла (в самом CLI сессия останется)'),
      disabled: !pane && isPending(ref),
      label: (
        <Text wrap="truncate-end">
          <Text color={state?.color ?? (live?.live ? C.agent : C.faint)}>
            {state?.mark ?? (sleeping ? '☾' : live?.live ? '●' : '○')}{' '}
          </Text>
          <Text color={C.dim}>{BRAIN_SHORT[ref.brain].padEnd(7)}</Text>
          {name ? <Text>{name} · </Text> : null}
          <Text color={C.faint}>{ago(ref.opened ?? ref.started)}</Text>
          {status ? <Text color={state?.color ?? C.faint}> · {status}</Text> : null}
        </Text>
      ),
    });
    if (pane) {
      items.push(
        {
          key: `fullscreen:${ref.id}`,
          hotkey: firstPane ? 'F' : undefined,
          label: t('  ⤢ Во весь экран'),
          hint: t('весь терминал — этой сессии; ⌃Q — обратно в дерево'),
        },
        {
          key: `sleep:${ref.id}`,
          hotkey: firstPane ? 'z' : undefined,
          label: t('  ☾ Усыпить'),
          disabled: isPending(ref) || pane.attached,
          hint: t('закрыть CLI и освободить память; разговор останется, ⏎ — разбудить'),
        },
      );
      firstPane = false;
    }
  });
  items.push(
    {
      key: 'new:claude',
      hotkey: 'c',
      section: t('Новая сессия'),
      label: `▶ Claude Code · ${START_LABEL[start]}`,
      hint: t('сессия по узлу — {p1}', {
        p1: START_HINT[start],
      }),
    },
    {
      key: 'new:claude:bg',
      hotkey: 'b',
      label: t('▶ Claude Code в фоне · {p1}', {
        p1: START_LABEL[start === 'chat' ? 'do' : start],
      }),
      hint: t('работает сам, а ты — в дереве; на узле появится индикатор'),
    },
    { key: 'new:codex', hotkey: 'x', label: `▶ Codex · ${START_LABEL[start === 'goal' ? 'do' : start]}` },
    { key: 'new:antigravity', hotkey: 'g', label: `▶ Antigravity · ${START_LABEL[start === 'goal' ? 'do' : start]}` },
    {
      key: 'configure',
      hotkey: 'o',
      label: t('⚙ Настроить запуск…'),
      hint: t('мозг, модель, усилие, как начать, worktree'),
    },
    {
      key: 'split',
      hotkey: 's',
      section: t('Агент без сессии'),
      label: t('✂ Разбить на шаги'),
      hint: t('агент читает проект и предлагает 3–7 подзадач с критериями — ты выбираешь, какие добавить'),
    },
    {
      key: 'criterion',
      hotkey: 'k',
      label: t('◎ Сформулировать «готово, когда»'),
      hint: node.doneWhen
        ? t('сейчас: {doneWhen}', {
            doneWhen: node.doneWhen,
          })
        : t('у узла нет критерия — агент предложит проверяемый'),
    },
    {
      key: 'check',
      hotkey: 't',
      label: node.check
        ? t('$ Запустить проверку · {check}', {
            check: node.check,
          })
        : t('$ Запустить проверку'),
      disabled: !node.check,
      hint: t('команда из поля «проверка», в папке проекта'),
    },
    { key: 'context', hotkey: 'p', label: t('☰ Что получит агент'), hint: t('контекст, с которым стартует сессия') },
    {
      key: 'raise',
      section: t('Приоритет'),
      hotkey: 'K',
      label: t('↑ Поднять приоритет'),
      hint: t('Соседи одного статуса · ⇧↑'),
      disabled: props.canRaise === false,
    },
    {
      key: 'lower',
      hotkey: 'J',
      label: t('↓ Опустить приоритет'),
      hint: t('Соседи одного статуса · ⇧↓'),
      disabled: props.canLower === false,
    },
  );
  const pick = (key: string) => {
    if (
      key === 'configure' ||
      key === 'split' ||
      key === 'criterion' ||
      key === 'check' ||
      key === 'context' ||
      key === 'raise' ||
      key === 'lower'
    ) {
      return props.onChoose({ kind: key });
    }
    if (key.startsWith('resume:')) {
      const ref = node.sessions.find((session) => session.id === key.slice('resume:'.length));
      // A live pane is shown, not resumed: nothing new starts.
      if (ref) props.onChoose({ kind: paneFor(ref, props.panes) ? 'show' : 'resume', ref });
      return;
    }
    for (const kind of ['sleep', 'fullscreen'] as const) {
      if (!key.startsWith(`${kind}:`)) continue;
      const ref = node.sessions.find((session) => session.id === key.slice(kind.length + 1));
      if (ref) props.onChoose({ kind, ref });
      return;
    }
    const [, brain, bg] = key.split(':') as [string, BrainId, string | undefined];
    const background = bg === 'bg';
    let mode: StartMode = start;
    if (brain !== 'claude' && mode === 'goal') mode = 'do';
    if (background && mode === 'chat') mode = 'do';
    props.onChoose({ kind: 'new', options: { brain, start: mode, background, pane: defaults.pane && !background } });
  };
  return (
    <Frame
      title={node.title}
      width={props.width}
      footer={[{ key: '⏎', label: t('выбрать') }, { label: t('буква — сразу') }, { key: 'esc', label: t('закрыть') }]}
      color={C.brand}
    >
      <Menu
        items={items}
        active
        onPick={pick}
        onCancel={props.onCancel}
        // Section headings and the selected hint also need room inside the frame.
        maxRows={Math.max(3, props.height - 9 - items.filter((item) => item.section).length * 2)}
        onKey={(_input, key, current) => {
          if ((key.delete || key.backspace) && current?.startsWith('resume:')) {
            const ref = node.sessions.find((session) => session.id === current.slice('resume:'.length));
            if (ref) props.onChoose({ kind: 'forget', ref });
            return true;
          }
          return false;
        }}
      />
    </Frame>
  );
}

/** «Factoyard · Медиа-цех» shown inside «Медиа-цех» is just noise before the point. */
function shortSessionName(name: string | undefined, title: string): string | undefined {
  if (!name) return undefined;
  const cut = name.indexOf(' · ');
  const rest = cut >= 0 ? name.slice(cut + 3) : name;
  return rest === title ? undefined : rest;
}

// ── Launch options ──────────────────────────────────────────────────────────

type Where = 'pane' | 'terminal' | 'background';

interface LaunchDraft {
  brain: BrainId;
  where: Where;
  start: StartMode;
  model: string;
  effort: string;
  worktree: boolean;
  focus: number;
}

interface LaunchField {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  /** Shown instead of the options when the field does not apply. */
  note?: string;
  set: (draft: LaunchDraft, value: string) => LaunchDraft;
}

function launchFields(draft: LaunchDraft, catalog: Catalog | undefined, panes: boolean): LaunchField[] {
  const claude = draft.brain === 'claude';
  const starts = START_MODES.filter((mode) => mode !== 'goal' || claude);
  const noEffort = effortsFor(catalog, draft.model)?.length === 0;
  return [
    {
      label: t('Мозг'),
      options: (['claude', 'codex', 'antigravity'] as BrainId[]).map((id) => ({ value: id, label: BRAIN_LABEL[id] })),
      value: draft.brain,
      set: (d, value) => {
        const brain = value as BrainId;
        // Models belong to one CLI: another brain starts from its own default.
        const next = { ...d, brain, model: '', effort: '' };
        if (brain !== 'claude' && d.where === 'background') next.where = panes ? 'pane' : 'terminal';
        if (brain !== 'claude' && d.start === 'goal') next.start = 'do';
        if (brain !== 'claude') next.worktree = false;
        return next;
      },
    },
    {
      label: t('Где'),
      options: [
        ...(panes ? [{ value: 'pane', label: t('в панели рядом с деревом') }] : []),
        { value: 'terminal', label: t('в этом терминале') },
        ...(claude ? [{ value: 'background', label: t('в фоне') }] : []),
      ],
      value: draft.where,
      set: (d, value) => ({
        ...d,
        where: value as Where,
        start: value === 'background' && d.start === 'chat' ? 'do' : d.start,
      }),
    },
    {
      label: t('Как начать'),
      options: starts.map((mode) => ({ value: mode, label: START_LABEL[mode] })),
      value: starts.includes(draft.start) ? draft.start : 'do',
      set: (d, value) => ({ ...d, start: value as StartMode }),
    },
    {
      label: t('Модель'),
      options: modelOptions(catalog, draft.model),
      value: draft.model,
      set: (d, value) => ({ ...d, model: value, effort: fitEffort(catalog, value, d.effort) }),
    },
    {
      label: t('Усилие'),
      options: effortOptions(catalog, draft.model, draft.effort),
      value: draft.effort,
      ...(noEffort ? { note: t('у этой модели не настраивается') } : {}),
      set: (d, value) => ({ ...d, effort: value }),
    },
    {
      label: 'Worktree',
      options: [
        { value: 'no', label: t('нет') },
        { value: 'yes', label: t('отдельный git worktree') },
      ],
      value: draft.worktree ? 'yes' : 'no',
      ...(claude ? {} : { note: t('только Claude Code') }),
      set: (d, value) => ({ ...d, worktree: value === 'yes' }),
    },
  ];
}

export function LaunchForm(props: {
  node: TreeNode;
  width: number;
  defaults: LaunchOptions;
  onSubmit: (options: LaunchOptions) => void;
  onCancel: () => void;
}) {
  const panes = panesAvailable();
  const [draft, setDraft, latest] = useLatest<LaunchDraft>(() => ({
    brain: props.defaults.brain,
    where: props.defaults.background ? 'background' : props.defaults.pane && panes ? 'pane' : 'terminal',
    start: props.defaults.start,
    model: props.defaults.model ?? '',
    effort: props.defaults.effort ?? '',
    worktree: Boolean(props.defaults.worktree),
    focus: 0,
  }));
  const catalog = useCatalog(draft.brain);
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  const done = useRef(false);
  const fields = launchFields(draft, catalog, panes);
  useInput((input, key) => {
    if (done.current) return;
    const d = latest.current;
    const all = launchFields(d, catalogRef.current, panes);
    if (key.escape) {
      done.current = true;
      return props.onCancel();
    }
    if (key.return) {
      done.current = true;
      const claude = d.brain === 'claude';
      const options: LaunchOptions = {
        brain: d.brain,
        start: all[2]!.value as StartMode,
        background: claude && d.where === 'background',
        pane: d.where === 'pane',
      };
      if (d.model) options.model = d.model;
      if (d.effort && !all[4]!.note) options.effort = d.effort;
      if (claude && d.worktree) options.worktree = true;
      return props.onSubmit(options);
    }
    const move = key.tab && key.shift ? -1 : key.tab || key.downArrow ? 1 : key.upArrow ? -1 : 0;
    if (move) return setDraft((before) => ({ ...before, focus: (before.focus + move + all.length) % all.length }));
    const step = key.leftArrow ? -1 : key.rightArrow || input === ' ' ? 1 : 0;
    const field = all[d.focus];
    if (!step || !field || field.note || field.options.length === 0) return;
    const at = Math.max(
      0,
      field.options.findIndex((option) => option.value === field.value),
    );
    const next = field.options[(at + step + field.options.length) % field.options.length]!;
    setDraft(field.set(d, next.value));
  });
  const row = (index: number) => {
    const field = fields[index]!;
    const active = draft.focus === index;
    return (
      <Field label={field.label} active={active}>
        {field.note ? (
          <Text color={C.faint}>{field.note}</Text>
        ) : (
          <Options
            labels={field.options.map((option) => option.label)}
            index={Math.max(
              0,
              field.options.findIndex((option) => option.value === field.value),
            )}
            active={active}
            width={Math.max(10, props.width - 24)}
          />
        )}
      </Field>
    );
  };
  const hint = (text: string) => (
    <Box marginLeft={18}>
      <Text color={C.faint} wrap="truncate-end">
        {text}
      </Text>
    </Box>
  );
  const startMode = fields[2]!.value as StartMode;
  return (
    <Frame
      title={t('Запуск · {title}', {
        title: props.node.title,
      })}
      width={props.width}
      color={C.agent}
      footer={[
        { key: '⏎', label: t('дальше — к подтверждению') },
        { key: '↑↓', label: t('поле') },
        { key: '←→', label: t('выбор') },
        { key: 'esc', label: t('отмена') },
      ]}
    >
      {row(0)}
      {row(1)}
      {draft.focus === 1
        ? hint(
            draft.where === 'pane'
              ? t('сессия живёт в tmux: видна справа от дерева, переживёт закрытие treeyard')
              : draft.where === 'background'
                ? t('Claude работает сам; открыть — ⏎ на узле')
                : t('терминал перейдёт к CLI; выйдешь — вернёшься в дерево'),
          )
        : null}
      {row(2)}
      {hint(
        START_HINT[startMode] +
          (startMode === 'goal' && !props.node.doneWhen ? t(' — у узла нет критерия, будет «делать»') : ''),
      )}
      {row(3)}
      {row(4)}
      {draft.focus === 3 || draft.focus === 4 ? hint(catalogHint(draft.brain, catalog, draft.model)) : null}
      {row(5)}
    </Frame>
  );
}

// ── Delete ──────────────────────────────────────────────────────────────────

export function ConfirmDelete(props: {
  node: TreeNode;
  count: number;
  width: number;
  onConfirm: (withChildren: boolean) => void;
  onCancel: () => void;
}) {
  useInput((input, key) => {
    const shortcut = shortcutKey(input);
    if (key.escape || shortcut === 'n') return props.onCancel();
    if (props.count === 0 && (key.return || shortcut === 'y' || input === 'д')) return props.onConfirm(false);
    if (props.count > 0 && (shortcut === 'u' || input === 'п')) return props.onConfirm(false);
    if (props.count > 0 && (shortcut === 'a' || input === 'в')) return props.onConfirm(true);
  });
  return (
    <Frame
      title={t('Удалить «{title}»?', {
        title: props.node.title,
      })}
      width={props.width}
      color={C.bad}
    >
      {props.count === 0 ? (
        <KeyHints
          wrap
          hints={[
            { key: '⏎', label: t('удалить'), color: C.bad },
            { key: 'esc', label: t('оставить'), color: C.dim },
          ]}
        />
      ) : (
        <Box flexDirection="column">
          <Text>
            {t('Внутри: {count} {nodes}.', {
              count: props.count,
              nodes: plural(props.count, ['узел', 'узла', 'узлов'], ['node', 'nodes']),
            })}
          </Text>
          <KeyHints
            wrap
            hints={[
              { key: 'u', label: t('поднять их на уровень выше'), color: C.brand },
              { key: 'a', label: t('удалить всё'), color: C.bad },
              { key: 'esc', label: t('оставить'), color: C.dim },
            ]}
          />
          <Text color={C.faint}>{t('Отказаться от узла без удаления — статус «отказ» (s, x).')}</Text>
        </Box>
      )}
    </Frame>
  );
}

// ── Pick a node ─────────────────────────────────────────────────────────────

export function NodePicker(props: {
  title: string;
  nodes: { node: TreeNode; depth: number }[];
  width: number;
  height: number;
  onPick: (id: string) => void;
  onCancel: () => void;
}) {
  const items: MenuItem[] = props.nodes.map(({ node, depth }) => ({
    key: node.id,
    label: (
      <Text wrap="truncate-end">
        {'  '.repeat(depth)}
        <Text color={STATUS_COLOR[node.status]}>{GLYPH[node.status]} </Text>
        {node.title}
      </Text>
    ),
  }));
  return (
    <Frame
      title={props.title}
      width={props.width}
      footer={[
        { key: '⏎', label: t('выбрать') },
        { key: 'esc', label: t('отмена') },
      ]}
    >
      <Menu
        items={items}
        active
        onPick={props.onPick}
        onCancel={props.onCancel}
        maxRows={Math.max(5, props.height - 8)}
      />
    </Frame>
  );
}

// ── Reading long text ───────────────────────────────────────────────────────

export function TextViewer(props: { title: string; text: string; width: number; height: number; onClose: () => void }) {
  const lines = wrapAnsi(props.text, Math.max(20, props.width - 4), { hard: true, trim: false }).split('\n');
  const rows = Math.max(5, props.height - 6);
  const [top, setTop] = useState(0);
  const max = Math.max(0, lines.length - rows);
  useInput((input, key) => {
    input = shortcutKey(input);
    if (key.escape || input === 'q' || key.return) return props.onClose();
    if (key.downArrow || input === 'j') setTop((t) => Math.min(max, t + 1));
    if (key.upArrow || input === 'k') setTop((t) => Math.max(0, t - 1));
    if (key.pageDown || input === ' ') setTop((t) => Math.min(max, t + rows));
    if (key.pageUp) setTop((t) => Math.max(0, t - rows));
  });
  return (
    <Frame
      title={props.title}
      width={props.width}
      footer={[
        { key: '↑↓', label: t('листать') },
        { key: 'space', label: t('страница') },
        { key: 'esc', label: t('закрыть') },
        { label: `${Math.min(lines.length, top + rows)}/${lines.length}` },
      ]}
    >
      {lines.slice(top, top + rows).map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines of a text are positions, not items.
        <Text key={`${top + index}`} color={line.startsWith('#') ? C.brand : undefined} wrap="truncate-end">
          {line || ' '}
        </Text>
      ))}
    </Frame>
  );
}

// ── Help ────────────────────────────────────────────────────────────────────

const help = (): [string, [string, string][]][] => [
  [
    t('Ходить'),
    [
      ['↑ ↓', t('по колонке · j k — подряд')],
      ['← →', t('к родителю · к детям')],
      ['space', t('свернуть или раскрыть ветку')],
      ['+  −', t('раскрыть всё · свернуть всё')],
      [': ⌃K', t('палитра: найти узел или действие')],
      ['/', t('фильтр по названию · esc сбросить')],
      ['1 … 6', t('вкладки')],
      ['← →', t('в «Сессиях»: Claude · Codex · Antigravity')],
    ],
  ],
  [
    t('Вид'),
    [
      ['v', t('граф ↔ список')],
      ['z', t('в графе: строки ↔ карточки')],
      ['i', t('панель деталей')],
      ['.', t('показать или скрыть готовое')],
      [t('⌥ стрелки'), t('сдвинуть граф · f — к выбранному')],
      [',', t('настройки: язык, подтверждения, тема')],
    ],
  ],
  [
    t('Сессия справа'),
    [
      ['f', t('печатать в неё (клик — тоже) · спящую — разбудить')],
      ['⌃Q', t('обратно к дереву (клик по дереву — тоже)')],
      ['F', t('во весь экран · ⌃Q — назад')],
      ['x', t('усыпить: CLI закрыт, память свободна')],
      ['p', t('показать или скрыть')],
      ['⇧← ⇧→  < >', t('шире · уже')],
      [t('колесо'), t('история · PgUp PgDn, End — к вводу')],
    ],
  ],
  [
    t('Менять'),
    [
      ['a  A', t('новый узел внутрь · рядом')],
      ['r', t('переименовать')],
      ['e  E', t('поля узла · узел в редакторе')],
      ['d  w  s', t('готово · ждёт с причиной · любой статус')],
      ['tab ⇧tab', t('вложить · поднять на уровень')],
      ['K J · ⇧↑↓', t('приоритет среди соседей одного статуса')],
      ['u', t('отменить последнее изменение')],
      ['D', t('удалить')],
    ],
  ],
  [
    t('Агенты'),
    [
      ['⏎', t('сессии, агент, проверка')],
      ['c  b', t('Claude Code в панели · в фоне')],
      ['S', t('агент разбивает узел на шаги')],
      ['t', t('запустить проверку узла')],
      ['⏎ p', t('что получит агент')],
      ['y', t('скопировать id узла')],
    ],
  ],
];

export function HelpDialog(props: { width: number; height: number; onClose: () => void }) {
  useInput((input, key) => {
    input = shortcutKey(input);
    if (key.escape || key.return || input === '?' || input === 'q') props.onClose();
  });
  const twoColumns = props.width >= 96;
  const columnWidth = twoColumns ? Math.floor((props.width - 6) / 2) : props.width - 4;
  const section = ([title, rows]: [string, [string, string][]]) => (
    <Box key={title} flexDirection="column" width={columnWidth} marginBottom={1}>
      <Text color={C.brand} bold>
        {title}
      </Text>
      {rows.map(([keys, what]) => (
        <Box key={keys}>
          <Box width={11} flexShrink={0}>
            <Text color={C.accent}>{keys}</Text>
          </Box>
          <Text wrap="truncate-end">{what}</Text>
        </Box>
      ))}
    </Box>
  );
  return (
    <Frame
      title={t('Клавиши')}
      width={props.width}
      footer={[
        { key: 'esc', label: t('закрыть') },
        { label: t('дерево — это md-файлы в .tree/, правь их чем угодно') },
      ]}
    >
      {twoColumns ? (
        <Box>
          <Box flexDirection="column" marginRight={2}>
            {help().slice(0, 3).map(section)}
          </Box>
          <Box flexDirection="column">{help().slice(3).map(section)}</Box>
        </Box>
      ) : (
        <Box flexDirection="column">{help().map(section)}</Box>
      )}
    </Frame>
  );
}

// ── Palette ─────────────────────────────────────────────────────────────────

export interface PaletteItem {
  key: string;
  label: string;
  /** Shown dimmed after the label: a path, a shortcut. */
  detail?: string;
  /** Glyph in front, with its colour. */
  mark?: string;
  markColor?: string | undefined;
}

/**
 * Every word of the query somewhere in the text, in any order: «мастер
 * чист» finds «Установка с нуля на чистой машине… мастер». A match at the
 * start of a word, and earlier in the text, ranks higher. Letters scattered
 * across unrelated words do not count — they find everything.
 */
export function fuzzyScore(text: string, query: string): number {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const hay = text.toLowerCase();
  let score = 0;
  for (const word of words) {
    const at = hay.indexOf(word);
    if (at < 0) return -1;
    const wordStart = at === 0 || /[\s«"(—\-/·:]/.test(hay[at - 1]!);
    score += (wordStart ? 100 : 40) - Math.min(at, 60) / 2;
  }
  return score;
}

export function Palette(props: {
  items: PaletteItem[];
  width: number;
  height: number;
  onPick: (key: string) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const matches = query
    ? props.items
        .map((item) => ({ item, score: fuzzyScore(`${item.label} ${item.detail ?? ''}`, query) }))
        .filter((entry) => entry.score >= 0)
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.item)
    : props.items;
  const rows = Math.max(4, props.height - 8);
  const at = Math.min(index, Math.max(0, matches.length - 1));
  useInput((_input, key) => {
    if (key.escape) return props.onCancel();
    if (key.return) {
      const item = matches[at];
      if (item) props.onPick(item.key);
      return;
    }
    if (key.upArrow) return setIndex(Math.max(0, at - 1));
    if (key.downArrow) return setIndex(Math.min(matches.length - 1, at + 1));
  });
  const first = Math.max(0, Math.min(at - Math.floor(rows / 2), matches.length - rows));
  return (
    <Frame
      title={t('Найти узел или действие')}
      width={props.width}
      footer={[
        { key: '↑↓', label: t('выбор') },
        { key: '⏎', label: t('перейти или сделать') },
        { key: 'esc', label: t('закрыть') },
      ]}
    >
      <Box marginBottom={1}>
        <Text color={C.brand}>❯ </Text>
        <TextField
          value={query}
          onChange={(value) => {
            setQuery(value);
            setIndex(0);
          }}
          active
          width={props.width - 8}
          placeholder={t('начни печатать: название узла, «claude», «готово»…')}
        />
      </Box>
      {matches.length === 0 ? <Text color={C.faint}>{t('ничего не нашлось')}</Text> : null}
      {matches.slice(first, first + rows).map((item, offset) => {
        const selected = first + offset === at;
        return (
          <Clickable
            key={item.key}
            onClick={(click) => (click.double ? props.onPick(item.key) : setIndex(first + offset))}
          >
            <Box width={2} flexShrink={0}>
              <Text color={selected ? C.brand : C.faint}>{selected ? '❯' : ' '}</Text>
            </Box>
            {item.mark ? (
              <Box width={2} flexShrink={0}>
                <Text color={item.markColor}>{item.mark}</Text>
              </Box>
            ) : null}
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="truncate-end" bold={selected} color={selected ? C.brand : undefined}>
                {item.label}
                {item.detail ? <Text color={C.faint}> {item.detail}</Text> : null}
              </Text>
            </Box>
          </Clickable>
        );
      })}
    </Frame>
  );
}

// ── An agent's proposal: steps ──────────────────────────────────────────────

export interface ProposedStep {
  title: string;
  doneWhen?: string;
  who?: Who;
  note?: string;
}

export function StepsDialog(props: {
  node: TreeNode;
  steps: ProposedStep[];
  width: number;
  height: number;
  onAccept: (steps: ProposedStep[]) => void;
  onCancel: () => void;
}) {
  const [chosen, setChosen] = useState<boolean[]>(() => props.steps.map(() => true));
  const [index, setIndex] = useState(0);
  useInput((input, key) => {
    if (key.escape) return props.onCancel();
    if (key.return) return props.onAccept(props.steps.filter((_, i) => chosen[i]));
    input = shortcutKey(input);
    if (key.upArrow || input === 'k') return setIndex((i) => Math.max(0, i - 1));
    if (key.downArrow || input === 'j') return setIndex((i) => Math.min(props.steps.length - 1, i + 1));
    if (input === ' ') return setChosen((all) => all.map((value, i) => (i === index ? !value : value)));
    if (input === 'a') return setChosen((all) => all.map(() => !all.every(Boolean)));
  });
  const count = chosen.filter(Boolean).length;
  const inner = props.width - 8;
  return (
    <Frame
      title={t('Шаги для «{title}»', {
        title: props.node.title,
      })}
      width={props.width}
      color={C.agent}
      footer={[
        { key: 'space', label: t('отметить') },
        { key: 'a', label: t('все') },
        { key: '⏎', label: t('добавить {count}', { count }) },
        { key: 'esc', label: t('выбросить') },
      ]}
    >
      {props.steps.map((step, i) => {
        const selected = i === index;
        return (
          <Box key={step.title} flexDirection="column">
            <Box>
              <Text color={selected ? C.brand : C.faint}>{selected ? '❯ ' : '  '}</Text>
              <Text color={chosen[i] ? C.ok : C.faint}>{chosen[i] ? '◉ ' : '○ '}</Text>
              <Text bold={selected} color={chosen[i] ? undefined : C.faint} wrap="truncate-end">
                {step.title}
                {step.who === 'human' ? <Text color={C.you}>{t(' · ты')}</Text> : null}
              </Text>
            </Box>
            {selected && (step.doneWhen || step.note) ? (
              <Box flexDirection="column" marginLeft={4} width={inner}>
                {step.doneWhen ? (
                  <Text color={C.dim} wrap="wrap">
                    {t('готово, когда: ')}
                    {step.doneWhen}
                  </Text>
                ) : null}
                {step.note ? (
                  <Text color={C.faint} wrap="wrap">
                    {step.note}
                  </Text>
                ) : null}
              </Box>
            ) : null}
          </Box>
        );
      })}
    </Frame>
  );
}

// ── An agent's proposal: the criterion ──────────────────────────────────────

export function CriterionDialog(props: {
  node: TreeNode;
  doneWhen: string;
  check?: string;
  width: number;
  onAccept: () => void;
  onEdit: () => void;
  onCancel: () => void;
}) {
  useInput((input, key) => {
    if (key.escape) return props.onCancel();
    if (key.return) return props.onAccept();
    input = shortcutKey(input);
    if (input === 'e') return props.onEdit();
  });
  return (
    <Frame
      title={t('«Готово, когда» для «{title}»', {
        title: props.node.title,
      })}
      width={props.width}
      color={C.agent}
      footer={[
        { key: '⏎', label: t('принять') },
        { key: 'e', label: t('поправить') },
        { key: 'esc', label: t('выбросить') },
      ]}
    >
      <Text color={C.faint}>{t('предлагает агент')}</Text>
      <Text wrap="wrap">{props.doneWhen}</Text>
      {props.check ? (
        <Box marginTop={1}>
          <Text color={C.faint}>{t('проверка ')}</Text>
          <Text color={C.accent}>{props.check}</Text>
        </Box>
      ) : null}
      {props.node.doneWhen ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={C.faint}>{t('было')}</Text>
          <Text color={C.dim} wrap="wrap">
            {props.node.doneWhen}
          </Text>
        </Box>
      ) : null}
    </Frame>
  );
}

// ── The result of a check ───────────────────────────────────────────────────

export function CheckDialog(props: {
  node: TreeNode;
  command: string;
  ok: boolean;
  code: number | null;
  seconds: number;
  output: string;
  width: number;
  height: number;
  onStatus: (status: Status) => void;
  onClose: () => void;
}) {
  const lines = wrapAnsi(props.output.trimEnd() || t('(команда ничего не вывела)'), Math.max(20, props.width - 4), {
    hard: true,
    trim: false,
  }).split('\n');
  const rows = Math.max(4, props.height - 8);
  const [top, setTop] = useState(Math.max(0, lines.length - rows));
  const max = Math.max(0, lines.length - rows);
  useInput((input, key) => {
    input = shortcutKey(input);
    if (key.escape || input === 'q') return props.onClose();
    if (props.ok && input === 'r') return props.onStatus('review');
    if (props.ok && input === 'd') return props.onStatus('done');
    if (key.downArrow || input === 'j') setTop((t) => Math.min(max, t + 1));
    if (key.upArrow || input === 'k') setTop((t) => Math.max(0, t - 1));
    if (key.pageDown || input === ' ') setTop((t) => Math.min(max, t + rows));
    if (key.pageUp) setTop((t) => Math.max(0, t - rows));
  });
  return (
    <Frame
      title={`${props.ok ? t('✓ Проверка прошла') : t('✗ Проверка не прошла')} · ${props.node.title}`}
      width={props.width}
      color={props.ok ? C.ok : C.bad}
      footer={[
        ...(props.ok
          ? [
              { key: 'r', label: t('на проверку') },
              { key: 'd', label: t('готово') },
            ]
          : []),
        { key: '↑↓', label: t('листать') },
        { key: 'esc', label: t('закрыть') },
      ]}
    >
      <Text color={C.dim} wrap="truncate-end">
        $ {props.command}
        {t(' · код ')}
        {props.code ?? '—'} · {props.seconds}
        {t(' с')}
      </Text>
      {lines.slice(top, top + rows).map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines of output are positions.
        <Text key={`${top + index}`} wrap="truncate-end">
          {line || ' '}
        </Text>
      ))}
    </Frame>
  );
}

// ── Confirm before a session or an agent's job ──────────────────────────────

export interface ConfirmRow {
  label: string;
  value: string;
  color?: string | undefined;
}

/** How long a fresh confirmation ignores Enter. */
export const CONFIRM_GUARD_MS = 300;

export function ConfirmLaunch(props: {
  title: string;
  rows: ConfirmRow[];
  /** The first message the agent gets, when there is one. */
  prompt?: string | undefined;
  note?: string | undefined;
  width: number;
  /** Offer `o` — change the launch before it starts. */
  configurable: boolean;
  onConfirm: () => void;
  onConfigure: () => void;
  onNever: () => void;
  onCancel: () => void;
}) {
  // The Enter that opened this question must not also answer it: a double tap
  // (or a burst) would start a session nobody looked at.
  const opened = useRef(Date.now());
  const answered = useRef(false);
  useInput((input, key) => {
    if (answered.current) return;
    const shortcut = shortcutKey(input);
    const answer = (act: () => void) => {
      answered.current = true;
      act();
    };
    if (key.escape || shortcut === 'n') return answer(props.onCancel);
    if (key.return || shortcut === 'y' || input === 'д') {
      if (Date.now() - opened.current < CONFIRM_GUARD_MS) return;
      return answer(props.onConfirm);
    }
    if (props.configurable && shortcut === 'o') return answer(props.onConfigure);
    if (input === '!') return answer(props.onNever);
  });
  const inner = props.width - 6;
  const labelWidth = Math.min(18, Math.max(...props.rows.map((row) => row.label.length)) + 2);
  const promptLines = props.prompt
    ? wrapAnsi(props.prompt, inner - 2, { hard: true, trim: true })
        .split('\n')
        .slice(0, 5)
    : [];
  const footer: KeyHint[] = [
    { key: '⏎', label: t('запустить') },
    ...(props.configurable ? [{ key: 'o', label: t('настроить') }] : []),
    { key: 'esc', label: t('отмена') },
    { key: '!', label: t('больше не спрашивать') },
  ];
  return (
    <Frame title={props.title} width={props.width} color={C.agent} footer={footer}>
      {props.rows.map((row) => (
        <Box key={row.label}>
          <Box width={labelWidth} flexShrink={0}>
            <Text color={C.dim}>{row.label}</Text>
          </Box>
          <Text color={row.color} wrap="truncate-end">
            {row.value}
          </Text>
        </Box>
      ))}
      {promptLines.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={C.dim}>{t('Первое сообщение')}</Text>
          {promptLines.map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines of one text.
            <Text key={index} color={C.faint} wrap="truncate-end">
              {'  '}
              {line}
            </Text>
          ))}
        </Box>
      ) : null}
      {props.note ? (
        <Box marginTop={1}>
          <Text color={C.warn} wrap="wrap">
            {props.note}
          </Text>
        </Box>
      ) : null}
    </Frame>
  );
}

// ── Settings ────────────────────────────────────────────────────────────────

export interface SettingRow {
  key: string;
  /** A heading above the row. */
  section?: string | undefined;
  label: string;
  /** Choices cycle with ←→; without choices the row is a text field. */
  options?: { value: string; label: string }[] | undefined;
  value: string;
  placeholder?: string | undefined;
  hint?: string | undefined;
  /** What ⏎ does on this row instead of closing the settings. */
  enter?: { label: string; run: () => void } | undefined;
}

export function SettingsDialog(props: {
  rows: SettingRow[];
  width: number;
  height: number;
  /** The row to start on, by key. */
  at?: string;
  onChange: (key: string, value: string) => void;
  onClose: () => void;
}) {
  // Read through refs: a burst of keys arrives before the next render (see useLatest).
  const [index, setIndex, indexRef] = useLatest(() =>
    Math.max(
      0,
      props.rows.findIndex((row) => row.key === props.at),
    ),
  );
  const [draft, setDraft, draftRef] = useLatest<Record<string, string>>({});
  const chosen = useRef<Record<string, string>>({});
  const closed = useRef(false);
  /** Text fields save when you leave them, not on every key. */
  const commit = () => {
    const at = props.rows[indexRef.current]!;
    const typed = draftRef.current[at.key];
    if (!at.options && typed !== undefined && typed !== at.value) props.onChange(at.key, typed.trim());
  };
  useInput((input, key) => {
    if (closed.current) return;
    const n = props.rows.length;
    if (key.escape || key.return) {
      commit();
      closed.current = true;
      const enter = key.return ? props.rows[indexRef.current]?.enter : undefined;
      return enter ? enter.run() : props.onClose();
    }
    if (key.upArrow || (key.tab && key.shift)) {
      commit();
      return setIndex((i) => (i - 1 + n) % n);
    }
    if (key.downArrow || key.tab) {
      commit();
      return setIndex((i) => (i + 1) % n);
    }
    const at = props.rows[indexRef.current]!;
    if (at.options && (key.leftArrow || key.rightArrow || input === ' ')) {
      const value = chosen.current[at.key] ?? at.value;
      const from = Math.max(
        0,
        at.options.findIndex((option) => option.value === value),
      );
      const step = key.leftArrow ? -1 : 1;
      const next = at.options[(from + step + at.options.length) % at.options.length]!;
      chosen.current[at.key] = next.value;
      props.onChange(at.key, next.value);
    }
  });
  // Once the parent shows a value, it is the truth again.
  for (const item of props.rows) if (chosen.current[item.key] === item.value) delete chosen.current[item.key];
  const labelWidth = Math.min(30, Math.max(...props.rows.map((item) => item.label.length)) + 3);
  const fieldWidth = Math.max(12, props.width - labelWidth - 8);
  // Keep the selected setting visible, including its heading and hint.
  const budget = Math.max(3, props.height - 6);
  const cost = (start: number, end: number) =>
    props.rows
      .slice(start, end)
      .reduce(
        (sum, item, offset) =>
          sum + 1 + (item.section ? (offset ? 2 : 1) : 0) + (start + offset === index && item.hint ? 1 : 0),
        0,
      );
  let first = 0;
  while (first < index && cost(first, index + 1) > budget) first++;
  let last = index + 1;
  while (last < props.rows.length && cost(first, last + 1) <= budget) last++;
  return (
    <Frame
      title={t('Настройки')}
      width={props.width}
      footer={[
        { key: '↑↓', label: t('выбор') },
        { key: '←→', label: t('изменить') },
        { key: '⏎', label: props.rows[index]?.enter?.label ?? t('готово') },
        ...(props.rows[index]?.enter ? [{ key: 'esc', label: t('готово') }] : []),
        { label: t('сохраняется сразу') },
      ]}
    >
      {props.rows.slice(first, last).map((item, offset) => {
        const i = first + offset;
        const selected = i === index;
        return (
          <Box key={item.key} flexDirection="column">
            {item.section ? (
              <Box marginTop={offset === 0 ? 0 : 1}>
                <Text color={C.faint} bold>
                  {item.section}
                </Text>
              </Box>
            ) : null}
            <Box>
              <Text color={selected ? C.brand : C.faint}>{selected ? '❯ ' : '  '}</Text>
              <Box width={labelWidth} flexShrink={0}>
                <Text color={selected ? C.brand : undefined} bold={selected}>
                  {item.label}
                </Text>
              </Box>
              {item.options ? (
                <Options
                  labels={item.options.map((option) => option.label)}
                  index={Math.max(
                    0,
                    item.options.findIndex((option) => option.value === item.value),
                  )}
                  active={selected}
                  width={fieldWidth}
                />
              ) : (
                <TextField
                  value={draft[item.key] ?? item.value}
                  onChange={(value) => setDraft((all) => ({ ...all, [item.key]: value }))}
                  active={selected}
                  width={fieldWidth}
                  placeholder={item.placeholder ?? ''}
                />
              )}
            </Box>
            {selected && item.hint ? (
              <Box marginLeft={2 + labelWidth}>
                <Text color={C.faint} wrap="truncate-end">
                  {item.hint}
                </Text>
              </Box>
            ) : null}
          </Box>
        );
      })}
    </Frame>
  );
}

// ── Your own order of statuses ──────────────────────────────────────────────

/** Statuses top to bottom: move one with K/J or Shift+arrows, ⏎ keeps the order. */
export function StatusOrderDialog(props: {
  order: readonly Status[];
  width: number;
  onSave: (order: Status[]) => void;
  onCancel: () => void;
}) {
  const [order, setOrder, orderRef] = useLatest<Status[]>(() => [...props.order]);
  const [index, setIndex, indexRef] = useLatest(0);
  const done = useRef(false);
  const move = (step: -1 | 1) => {
    const from = indexRef.current;
    const to = from + step;
    if (to < 0 || to >= orderRef.current.length) return;
    const next = [...orderRef.current];
    [next[from], next[to]] = [next[to]!, next[from]!];
    setOrder(next);
    setIndex(to);
  };
  useInput((input, key) => {
    if (done.current) return;
    input = shortcutKey(input);
    const n = orderRef.current.length;
    if (key.escape) {
      done.current = true;
      return props.onCancel();
    }
    if (key.return) {
      done.current = true;
      return props.onSave(orderRef.current);
    }
    if ((key.shift && key.upArrow) || input === 'K') return move(-1);
    if ((key.shift && key.downArrow) || input === 'J') return move(1);
    if (key.upArrow || input === 'k') return setIndex((i) => (i - 1 + n) % n);
    if (key.downArrow || input === 'j') return setIndex((i) => (i + 1) % n);
  });
  return (
    <Frame
      title={t('Свой порядок статусов')}
      width={props.width}
      footer={[
        { key: '↑↓', label: t('выбор') },
        { key: 'K J', label: t('выше · ниже'), press: ['K', 'J'] },
        { key: '⏎', label: t('сохранить') },
        { key: 'esc', label: t('отмена') },
      ]}
    >
      <Text color={C.dim} wrap="wrap">
        {t('У каждого родителя сверху вниз. Готовые собраны в группу «Готовые · N» там, где стоит «готово».')}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {order.map((status, i) => {
          const selected = i === index;
          return (
            <Box key={status}>
              <Text color={selected ? C.brand : C.faint}>{selected ? '❯ ' : '  '}</Text>
              <Text color={C.faint}>{`${i + 1}  `}</Text>
              <Text color={STATUS_COLOR[status]}>{`${GLYPH[status]} `}</Text>
              <Text color={selected ? C.brand : undefined} bold={selected}>
                {STATUS_LABEL[status]}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Frame>
  );
}

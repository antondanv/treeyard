/**
 * Connecting GitHub, one step at a time: gh is there and logged in, the
 * project has a repository (pick one of yours or create it), then a board
 * (pick one or create it). Creating is yours to do here, or an agent's in a
 * session on its own node.
 */
import { basename } from 'node:path';
import { Box, Text, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';

import {
  type BoardInfo,
  connectRepo,
  createBoard,
  createRepo,
  type GhState,
  ghReady,
  ghState,
  listBoards,
  listRepos,
  type Repo,
  repoOf,
} from '../github.js';
import { t } from '../i18n/i18n.js';
import { Frame, type KeyHint, Menu, type MenuItem, TextField } from './components/controls.js';
import { C } from './theme.js';

export type AgentTask = { kind: 'repo' } | { kind: 'board'; repo: Repo };

type Step =
  | { kind: 'loading'; label: string }
  | { kind: 'gh'; state: GhState }
  | { kind: 'repo' }
  | { kind: 'repos'; list: { nameWithOwner: string; isPrivate: boolean }[] }
  | { kind: 'repoName'; name: string; isPrivate: boolean }
  | { kind: 'boards'; repo: Repo; list: BoardInfo[] }
  | { kind: 'boardName'; repo: Repo; title: string }
  | { kind: 'error'; message: string; retry: () => void };

export function GithubConnect(props: {
  dir: string;
  width: number;
  height: number;
  /** A board is chosen: link it and bring its cards in. */
  onLink: (ref: string) => void;
  /** Give the job to an agent: a node and a session for it. */
  onAgent: (task: AgentTask) => void;
  /** Run gh in this terminal (it asks questions), then come back. */
  onGh: (args: string[]) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<Step>({ kind: 'loading', label: t('проверяю gh') });
  // The steps behind the one shown, for going back; loading and errors are never in it.
  const trail = useRef<Step[]>([]);
  const shown = useRef<Step | undefined>(undefined);
  // Going back makes an answer still on its way from gh stale.
  const ticket = useRef(0);

  /** A step you can stand on: the one you leave goes on the trail, unless it is the same step changing. */
  const show = (next: Step) => {
    if (shown.current && shown.current.kind !== next.kind) trail.current.push(shown.current);
    shown.current = next;
    setStep(next);
  };

  /** Work with gh: a loading line now, then `done` — unless the person went back meanwhile. */
  const wait = <T,>(label: string, work: Promise<T>, done: (value: T) => void, retry: () => void) => {
    const mine = ++ticket.current;
    setStep({ kind: 'loading', label });
    work.then(
      (value) => mine === ticket.current && done(value),
      (error: unknown) =>
        mine === ticket.current &&
        setStep({ kind: 'error', message: (error as Error).message.split('\n')[0] ?? '', retry }),
    );
  };

  /** esc or ←: from loading or an error to the step it started from, else one step back; from the first one, out. */
  const back = () => {
    ticket.current++;
    if (step.kind === 'loading' || step.kind === 'error') {
      if (shown.current) return setStep(shown.current);
      return props.onCancel();
    }
    const previous = trail.current.pop();
    if (!previous) return props.onCancel();
    shown.current = previous;
    setStep(previous);
  };
  const canGoBack =
    step.kind === 'loading' || step.kind === 'error' ? Boolean(shown.current) : trail.current.length > 0;

  const check = () =>
    wait(
      t('проверяю gh'),
      ghState(),
      (state) => {
        if (!ghReady(state)) return show({ kind: 'gh', state });
        const repo = repoOf(props.dir);
        if (repo) return boards(repo);
        show({ kind: 'repo' });
      },
      check,
    );

  const startOver = () => {
    trail.current = [];
    shown.current = undefined;
    check();
  };

  const boards = (repo: Repo) =>
    wait(
      t('ищу доски {owner}', { owner: repo.owner }),
      listBoards(repo.owner),
      (list) => show({ kind: 'boards', repo, list }),
      () => boards(repo),
    );

  const repos = () => wait(t('ищу твои репозитории'), listRepos(), (list) => show({ kind: 'repos', list }), repos);

  const makeRepo = (name: string, isPrivate: boolean) =>
    wait(
      isPrivate
        ? t('создаю приватный репозиторий {name}', { name })
        : t('создаю публичный репозиторий {name}', { name }),
      createRepo(props.dir, name, isPrivate),
      (repo) => {
        // The repository exists now: there is no going back to making it.
        trail.current = [];
        shown.current = undefined;
        boards(repo);
      },
      () => makeRepo(name, isPrivate),
    );

  const makeBoard = (repo: Repo, title: string) =>
    wait(
      t('создаю доску «{title}»', { title }),
      createBoard(repo, title),
      (board) => props.onLink(`${board.owner}/${board.number}`),
      () => makeBoard(repo, title),
    );

  // biome-ignore lint/correctness/useExhaustiveDependencies: the check runs once, when the dialog opens.
  useEffect(check, []);

  const escHint = canGoBack
    ? { key: 'esc ←', label: t('назад'), press: '\u001b' }
    : { key: 'esc', label: t('закрыть') };

  const frame = (
    title: string,
    body: React.ReactNode,
    items?: MenuItem[],
    onPick?: (key: string) => void,
    why = false,
  ) => (
    <Frame
      title={title}
      width={props.width}
      footer={items ? [{ key: '⏎', label: t('выбрать') }, { label: t('буква — сразу') }, escHint] : [escHint]}
    >
      {why
        ? note(
            t(
              'Зачем: задачи с доски GitHub становятся узлами дерева, а статус ходит в обе стороны — сдвинул карточку на GitHub, узел сменил статус; поставил узлу «в работе» или «готово» здесь — карточка переехала в свою колонку. Одна картина работы и в дереве, и на GitHub, без ручного переноса.',
            ),
            C.faint,
          )
        : null}
      {body}
      {items && onPick ? (
        <Menu
          items={items}
          active
          onPick={onPick}
          onCancel={back}
          onKey={(_, key) => {
            if (!key.leftArrow) return false;
            back();
            return true;
          }}
          maxRows={Math.max(5, props.height - 12)}
        />
      ) : null}
    </Frame>
  );

  const note = (text: string, color?: string) => (
    <Box marginBottom={1}>
      <Text color={color} wrap="wrap">
        {text}
      </Text>
    </Box>
  );

  switch (step.kind) {
    case 'loading':
      return <Waiting width={props.width} label={step.label} hint={escHint} onBack={back} />;
    case 'error':
      return frame(
        t('GitHub · не вышло'),
        note(step.message, C.bad),
        [
          { key: 'retry', hotkey: 'r', label: <Text>{t('Попробовать снова')}</Text> },
          { key: 'start', hotkey: 's', label: <Text>{t('Начать сначала')}</Text> },
        ],
        (key) => (key === 'retry' ? step.retry() : startOver()),
      );
    case 'gh': {
      const { state } = step;
      const items: MenuItem[] = [];
      let text: string;
      if (!state.installed) {
        text = t('Нужен gh — GitHub CLI: через него treeyard видит репозитории и доски. Поставь: brew install gh');
      } else if (!state.user) {
        text = t('gh есть, но вход не выполнен.');
        items.push({
          key: 'login',
          hotkey: 'l',
          label: <Text>{t('Войти: gh auth login — здесь, в терминале')}</Text>,
          hint: t('с доступом к доскам (scope project)'),
        });
      } else {
        text = t('gh вошёл как {user}, но без доступа к доскам (scope project).', { user: state.user });
        items.push({
          key: 'refresh',
          hotkey: 'l',
          label: <Text>{t('Дать доступ: gh auth refresh -s project')}</Text>,
        });
      }
      items.push({ key: 'again', hotkey: 'r', label: <Text>{t('Проверить снова')}</Text> });
      return frame(
        t('GitHub · шаг 1 из 3 — gh'),
        note(text, C.text),
        items,
        (key) => {
          if (key === 'login') return props.onGh(['auth', 'login', '--scopes', 'project']);
          if (key === 'refresh') return props.onGh(['auth', 'refresh', '--scopes', 'project']);
          // The same step again, not a step forward.
          trail.current = [];
          shown.current = undefined;
          check();
        },
        true,
      );
    }
    case 'repo':
      return frame(
        t('GitHub · шаг 2 из 3 — репозиторий'),
        note(
          t(
            'У проекта нет репозитория на GitHub (git remote). Он нужен, чтобы узнать аккаунт: доска GitHub Project принадлежит не репозиторию, а аккаунту — тебе или организации. По репозиторию мастер покажет доски этого аккаунта, а новую доску привяжет к репозиторию.',
          ),
          C.text,
        ),
        [
          { key: 'pick', hotkey: 'p', label: <Text>{t('Выбрать из моих репозиториев')}</Text> },
          {
            key: 'self',
            hotkey: 'n',
            section: t('Создать новый'),
            label: <Text>{t('Сам — с именем папки, приватный или публичный')}</Text>,
            hint: t('gh repo create · ничего не пушится'),
          },
          {
            key: 'agent',
            hotkey: 'a',
            label: <Text>{t('Агентом — узел и сессия: спросит имя и видимость, создаст и подключит')}</Text>,
          },
        ],
        (key) => {
          if (key === 'pick') return repos();
          if (key === 'self') return show({ kind: 'repoName', name: basename(props.dir), isPrivate: true });
          props.onAgent({ kind: 'repo' });
        },
        true,
      );
    case 'repos':
      return frame(
        t('GitHub · шаг 2 из 3 — выбери репозиторий'),
        step.list.length ? null : note(t('репозиториев не нашлось'), C.faint),
        step.list.map((repo) => ({
          key: repo.nameWithOwner,
          label: (
            <Text wrap="truncate-end">
              {repo.nameWithOwner}
              {repo.isPrivate ? <Text color={C.faint}>{t(' · приватный')}</Text> : null}
            </Text>
          ),
        })),
        (key) => {
          try {
            boards(connectRepo(props.dir, key));
          } catch (error) {
            setStep({ kind: 'error', message: (error as Error).message.split('\n')[0] ?? '', retry: repos });
          }
        },
      );
    case 'repoName':
      return (
        <NameStep
          width={props.width}
          title={t('GitHub · новый репозиторий')}
          label={t('Имя')}
          value={step.name}
          onChange={(name) => show({ ...step, name })}
          onSubmit={(name) => makeRepo(name, step.isPrivate)}
          visibility={{ isPrivate: step.isPrivate, onToggle: () => show({ ...step, isPrivate: !step.isPrivate }) }}
          onBack={back}
        />
      );
    case 'boards': {
      const { repo } = step;
      const items: MenuItem[] = step.list.map((board, index) => ({
        key: `${board.owner}/${board.number}`,
        ...(index === 0 ? { section: t('Подключить') } : {}),
        label: (
          <Text wrap="truncate-end">
            {board.title}
            <Text color={C.faint}>{` · #${board.number}`}</Text>
          </Text>
        ),
      }));
      items.push(
        {
          key: 'self',
          hotkey: 'n',
          section: t('Создать доску'),
          label: <Text>{t('Сам — «{title}», колонки по умолчанию', { title: repo.name })}</Text>,
          hint: t('Todo · In Progress · Done; поправить можно на GitHub'),
        },
        {
          key: 'agent',
          hotkey: 'a',
          label: <Text>{t('Агентом — узел и сессия: колонки под статусы дерева, подключит сам')}</Text>,
        },
      );
      return frame(
        t('GitHub · шаг 3 из 3 — доска'),
        note(
          step.list.length
            ? t('Репозиторий {repo}. Выбери доску — её карточки станут узлами в «GitHub».', {
                repo: `${repo.owner}/${repo.name}`,
              })
            : t('Репозиторий {repo}. Досок у {owner} пока нет.', {
                repo: `${repo.owner}/${repo.name}`,
                owner: repo.owner,
              }),
          C.text,
        ),
        items,
        (key) => {
          if (key === 'self') return show({ kind: 'boardName', repo, title: repo.name });
          if (key === 'agent') return props.onAgent({ kind: 'board', repo });
          props.onLink(key);
        },
        true,
      );
    }
    case 'boardName':
      return (
        <NameStep
          width={props.width}
          title={t('GitHub · новая доска у {owner}', { owner: step.repo.owner })}
          label={t('Название')}
          value={step.title}
          onChange={(title) => show({ ...step, title })}
          onSubmit={(title) => makeBoard(step.repo, title)}
          onBack={back}
        />
      );
  }
}

function Waiting(props: { width: number; label: string; hint: KeyHint; onBack: () => void }) {
  useInput((_, key) => {
    if (key.escape || key.leftArrow) props.onBack();
  });
  return (
    <Frame title="GitHub" width={props.width} footer={[props.hint]}>
      <Text color={C.agent}>… {props.label}</Text>
    </Frame>
  );
}

function NameStep(props: {
  width: number;
  title: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onBack: () => void;
  /** A new repository: private or public, tab switches. */
  visibility?: { isPrivate: boolean; onToggle: () => void };
}) {
  useInput((_, key) => {
    if (key.escape) props.onBack();
    else if (key.tab && props.visibility) props.visibility.onToggle();
    else if (key.return && props.value.trim()) props.onSubmit(props.value.trim());
  });
  const visibility = props.visibility;
  return (
    <Frame
      title={props.title}
      width={props.width}
      footer={[
        { key: '⏎', label: t('создать') },
        ...(visibility ? [{ key: 'tab', label: t('видимость') }] : []),
        { key: 'esc', label: t('назад') },
      ]}
    >
      <Box>
        <Text color={C.dim}>{props.label} </Text>
        <TextField value={props.value} onChange={props.onChange} active width={props.width - 12} />
      </Box>
      {visibility ? (
        <Box marginTop={1}>
          <Text color={C.dim}>{t('Видимость')} </Text>
          <Text inverse={visibility.isPrivate} bold={visibility.isPrivate}>
            {` ${t('приватный')} `}
          </Text>
          <Text> </Text>
          <Text inverse={!visibility.isPrivate} bold={!visibility.isPrivate}>
            {` ${t('публичный')} `}
          </Text>
          <Text color={C.faint}>{t('  · публичный видят все; поменять можно и потом на GitHub')}</Text>
        </Box>
      ) : null}
    </Frame>
  );
}

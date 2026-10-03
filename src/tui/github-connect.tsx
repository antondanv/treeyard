/**
 * Connecting GitHub, one step at a time: gh is there and logged in, the
 * project has a repository (pick one of yours or create it), then a board
 * (pick one or create it). Creating is yours to do here, or an agent's in a
 * session on its own node.
 */
import { basename } from 'node:path';
import { Box, Text, useInput } from 'ink';
import { useEffect, useState } from 'react';

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
import { Frame, Menu, type MenuItem, TextField } from './components/controls.js';
import { C } from './theme.js';

export type AgentTask = { kind: 'repo' } | { kind: 'board'; repo: Repo };

type Step =
  | { kind: 'loading'; label: string }
  | { kind: 'gh'; state: GhState }
  | { kind: 'repo' }
  | { kind: 'repos'; list: { nameWithOwner: string; isPrivate: boolean }[] }
  | { kind: 'repoName'; name: string }
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

  const failed = (retry: () => void) => (error: unknown) =>
    setStep({ kind: 'error', message: (error as Error).message.split('\n')[0] ?? '', retry });

  const check = () => {
    setStep({ kind: 'loading', label: t('проверяю gh') });
    ghState().then((state) => {
      if (!ghReady(state)) return setStep({ kind: 'gh', state });
      const repo = repoOf(props.dir);
      if (repo) return boards(repo);
      setStep({ kind: 'repo' });
    }, failed(check));
  };

  const boards = (repo: Repo) => {
    setStep({ kind: 'loading', label: t('ищу доски {owner}', { owner: repo.owner }) });
    listBoards(repo.owner).then(
      (list) => setStep({ kind: 'boards', repo, list }),
      failed(() => boards(repo)),
    );
  };

  const repos = () => {
    setStep({ kind: 'loading', label: t('ищу твои репозитории') });
    listRepos().then((list) => setStep({ kind: 'repos', list }), failed(repos));
  };

  const makeRepo = (name: string) => {
    setStep({ kind: 'loading', label: t('создаю приватный репозиторий {name}', { name }) });
    createRepo(props.dir, name).then(
      boards,
      failed(() => makeRepo(name)),
    );
  };

  const makeBoard = (repo: Repo, title: string) => {
    setStep({ kind: 'loading', label: t('создаю доску «{title}»', { title }) });
    createBoard(repo, title).then(
      (board) => props.onLink(`${board.owner}/${board.number}`),
      failed(() => makeBoard(repo, title)),
    );
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: the check runs once, when the dialog opens.
  useEffect(check, []);

  const frame = (title: string, body: React.ReactNode, items?: MenuItem[], onPick?: (key: string) => void) => (
    <Frame
      title={title}
      width={props.width}
      footer={
        items
          ? [{ key: '⏎', label: t('выбрать') }, { label: t('буква — сразу') }, { key: 'esc', label: t('закрыть') }]
          : [{ key: 'esc', label: t('закрыть') }]
      }
    >
      {body}
      {items && onPick ? (
        <Menu items={items} active onPick={onPick} onCancel={props.onCancel} maxRows={Math.max(5, props.height - 12)} />
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
      return <Waiting width={props.width} label={step.label} onCancel={props.onCancel} />;
    case 'error':
      return frame(
        t('GitHub · не вышло'),
        note(step.message, C.bad),
        [
          { key: 'retry', hotkey: 'r', label: <Text>{t('Попробовать снова')}</Text> },
          { key: 'start', hotkey: 's', label: <Text>{t('Начать сначала')}</Text> },
        ],
        (key) => (key === 'retry' ? step.retry() : check()),
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
      return frame(t('GitHub · шаг 1 из 3 — gh'), note(text, C.text), items, (key) => {
        if (key === 'login') return props.onGh(['auth', 'login', '--scopes', 'project']);
        if (key === 'refresh') return props.onGh(['auth', 'refresh', '--scopes', 'project']);
        check();
      });
    }
    case 'repo':
      return frame(
        t('GitHub · шаг 2 из 3 — репозиторий'),
        note(t('У проекта нет репозитория на GitHub (git remote). Доски живут у владельца репозитория.'), C.text),
        [
          { key: 'pick', hotkey: 'p', label: <Text>{t('Выбрать из моих репозиториев')}</Text> },
          {
            key: 'self',
            hotkey: 'n',
            section: t('Создать новый'),
            label: <Text>{t('Сам — приватный, с именем папки')}</Text>,
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
          if (key === 'self') return setStep({ kind: 'repoName', name: basename(props.dir) });
          props.onAgent({ kind: 'repo' });
        },
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
            failed(repos)(error);
          }
        },
      );
    case 'repoName':
      return (
        <NameStep
          width={props.width}
          title={t('GitHub · новый приватный репозиторий')}
          label={t('Имя')}
          value={step.name}
          onChange={(name) => setStep({ kind: 'repoName', name })}
          onSubmit={(name) => makeRepo(name)}
          onBack={() => setStep({ kind: 'repo' })}
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
          if (key === 'self') return setStep({ kind: 'boardName', repo, title: repo.name });
          if (key === 'agent') return props.onAgent({ kind: 'board', repo });
          props.onLink(key);
        },
      );
    }
    case 'boardName':
      return (
        <NameStep
          width={props.width}
          title={t('GitHub · новая доска у {owner}', { owner: step.repo.owner })}
          label={t('Название')}
          value={step.title}
          onChange={(title) => setStep({ ...step, title })}
          onSubmit={(title) => makeBoard(step.repo, title)}
          onBack={() => boards(step.repo)}
        />
      );
  }
}

function Waiting(props: { width: number; label: string; onCancel: () => void }) {
  useInput((_, key) => {
    if (key.escape) props.onCancel();
  });
  return (
    <Frame title="GitHub" width={props.width} footer={[{ key: 'esc', label: t('закрыть') }]}>
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
}) {
  useInput((_, key) => {
    if (key.escape) props.onBack();
    else if (key.return && props.value.trim()) props.onSubmit(props.value.trim());
  });
  return (
    <Frame
      title={props.title}
      width={props.width}
      footer={[
        { key: '⏎', label: t('создать') },
        { key: 'esc', label: t('назад') },
      ]}
    >
      <Box>
        <Text color={C.dim}>{props.label} </Text>
        <TextField value={props.value} onChange={props.onChange} active width={props.width - 12} />
      </Box>
    </Frame>
  );
}

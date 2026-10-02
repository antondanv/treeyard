/**
 * The first run: the whole terminal, like the tree it is about to plant.
 *
 * Two ways to start. With an agent: Claude Code, Codex or Antigravity studies
 * the folder (or asks for everything you have in mind when it is empty),
 * leads you through short questions and plants the tree and a few short
 * documents — the evening of writing the same files for every new project,
 * done in a conversation. Or by yourself: pick a template, answer a couple
 * of questions, and the tree is there at once.
 */
import { existsSync } from 'node:fs';
import { basename, delimiter, join } from 'node:path';

import { BRAINS } from '@antondanv/brainyard';
import { Box, render, Text, useApp, useInput, useWindowSize } from 'ink';
import { type ReactNode, useRef, useState } from 'react';

import { BRAIN_LABEL } from '../agents/launch.js';
import { type FolderFacts, folderFacts } from '../agents/planting.js';
import { plural, t } from '../i18n/i18n.js';
import type { BrainId } from '../model/types.js';
import { addPointer, pointerTargets } from '../templates/pointer.js';
import { createTree, getTemplate, listTemplates, type Template } from '../templates/templates.js';
import { Choice, Menu, type MenuItem, TextField } from './components/controls.js';
import { CONFIRM_GUARD_MS } from './dialogs.js';
import { Logo, logoSize, WORDMARK } from './logo.js';
import { C } from './theme.js';

export interface InitResult {
  /** A tree was planted from a template. */
  created: boolean;
  /** Plant it with this agent instead: the caller opens the session. */
  agent?: BrainId;
}

export async function runInit(dir: string, templateId?: string): Promise<InitResult> {
  const result: InitResult = { created: false };
  const instance = render(
    <Wizard dir={dir} {...(templateId ? { templateId } : {})} onDone={(done) => Object.assign(result, done)} />,
    { alternateScreen: true, exitOnCtrlC: true, patchConsole: false },
  );
  await instance.waitUntilExit();
  if (process.stdin.isTTY) process.stdin.setRawMode?.(false);
  process.stdin.pause();
  return result;
}

const AGENTS: BrainId[] = ['claude', 'codex', 'antigravity'];

function installed(brain: BrainId): boolean {
  const bin = BRAINS[brain].binary;
  return (process.env.PATH ?? '').split(delimiter).some((dir) => dir && existsSync(join(dir, bin)));
}

type Step = 'start' | 'agent' | 'questions' | 'brain' | 'pointer' | 'done';

export function Wizard(props: { dir: string; templateId?: string; onDone: (result: InitResult) => void }) {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const templates = listTemplates();
  const preset = props.templateId ? getTemplate(props.templateId) : undefined;
  const [facts] = useState<FolderFacts>(() => folderFacts(props.dir));
  const [available] = useState(() => new Map(AGENTS.map((brain) => [brain, installed(brain)])));
  const [template, setTemplate] = useState<Template | undefined>(preset);
  const [agent, setAgent] = useState<BrainId>('claude');
  const [step, setStep] = useState<Step>(preset ? 'questions' : 'start');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [title, setTitle] = useState(basename(props.dir));
  const [question, setQuestion] = useState(-1); // -1: the project's title
  const [brain, setBrain] = useState<BrainId>('claude');
  const targets = pointerTargets(props.dir);
  const [pointer, setPointer] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const asked = useRef(0);

  const width = Math.max(40, columns);
  const height = Math.max(16, rows);
  const column = Math.min(96, width - 6);

  const finish = () => {
    if (!template) return;
    try {
      createTree(props.dir, template, { title, answers, brain });
      if (pointer) for (const file of targets) addPointer(join(props.dir, file));
      props.onDone({ created: true });
      setStep('done');
      setTimeout(() => exit(), 50);
    } catch (problem) {
      setError((problem as Error).message);
    }
  };

  useInput(
    (_input, key) => {
      if (step === 'agent') {
        if (key.escape) return setStep('start');
        // The Enter that chose the agent must not also start it.
        if (key.return && Date.now() - asked.current >= CONFIRM_GUARD_MS) {
          props.onDone({ created: false, agent });
          return exit();
        }
        return;
      }
      if (key.escape) return preset ? exit() : setStep('start');
      if (step === 'questions' && key.return) {
        const q = template?.questions[question];
        if (question === -1 && !title.trim()) return;
        if (q?.required && !answers[q.key]?.trim())
          return setError(t('без этого дерево не начать — одной фразой хватит'));
        setError(undefined);
        if (template && question + 1 < template.questions.length) return setQuestion(question + 1);
        return setStep('brain');
      }
      if (step === 'questions' && key.upArrow && question > -1) return setQuestion(question - 1);
      if (step === 'brain' && key.return) return targets.length > 0 ? setStep('pointer') : finish();
      if (step === 'pointer' && key.return) return finish();
    },
    { isActive: step !== 'start' && step !== 'done' },
  );

  // ── What the folder is, under the mark ─────────────────────────────────────
  const factsLine = [
    facts.git
      ? t('git · {n} {commits}', {
          n: facts.commits,
          commits: plural(facts.commits, ['коммит', 'коммита', 'коммитов'], ['commit', 'commits']),
        })
      : t('без git'),
    facts.empty
      ? t('папка почти пустая')
      : t('{n} в корне', {
          n: plural(facts.entries, ['файл', 'файла', 'файлов'], ['file', 'files']).replace(/^/, `${facts.entries} `),
        }),
    facts.docs.length
      ? t('документы: {list}', {
          list: facts.docs.slice(0, 4).join(', ') + (facts.docs.length > 4 ? '…' : ''),
        })
      : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const mark = logoSize(false);
  const header = (
    <Box width={width} paddingX={1}>
      <Logo />
      <Box flexDirection="column" marginLeft={2} justifyContent="center" flexShrink={1}>
        <Text wrap="truncate-end">
          <Text color={C.brand} bold>
            {WORDMARK}
          </Text>
          <Text color={C.faint}> · </Text>
          <Text bold>{facts.name}</Text>
          <Text color={C.dim}>{t('  новое дерево')}</Text>
        </Text>
        <Text color={C.faint} wrap="truncate-end">
          {factsLine}
        </Text>
        <Text color={C.faint} wrap="truncate-end">
          {t('цель у корня, ветки — этапы и направления, листья — задачи на одну сессию')}
        </Text>
      </Box>
    </Box>
  );

  const keys: [string, string][] =
    step === 'start'
      ? [
          ['↑↓', t('выбор')],
          ['⏎', t('дальше')],
          ['esc', t('выйти')],
        ]
      : step === 'agent'
        ? [
            ['⏎', t('начать')],
            ['esc', t('назад')],
          ]
        : step === 'questions'
          ? [
              ['⏎', t('дальше')],
              ['↑', t('назад')],
              ['esc', preset ? t('выйти') : t('к выбору')],
            ]
          : [
              ['←→', t('выбор')],
              ['⏎', step === 'pointer' || targets.length === 0 ? t('посадить дерево') : t('дальше')],
              ['esc', t('к выбору')],
            ];

  let body: ReactNode;
  if (step === 'done') {
    body = <Text color={C.brand}>{t('✓ дерево посажено в .tree/ — открываю…')}</Text>;
  } else if (step === 'start' || !template) {
    const items: MenuItem[] = [
      ...AGENTS.map((id, index) => ({
        key: `agent:${id}`,
        section:
          index === 0 ? t('С АГЕНТОМ — изучит папку, задаст вопросы, построит дерево и короткие документы') : undefined,
        disabled: !available.get(id),
        label: (
          <Text wrap="truncate-end">
            <Text color={available.get(id) ? C.agent : C.faint}>✦ </Text>
            <Text bold={available.get(id)} color={available.get(id) ? undefined : C.faint}>
              {BRAIN_LABEL[id]}
            </Text>
            {!available.get(id) ? <Text color={C.faint}>{t(' · не установлен')}</Text> : null}
          </Text>
        ),
        hint: facts.empty
          ? t('попросит выложить всё, что ты думаешь о проекте, и поведёт по вопросам')
          : t('прочитает код, документы и историю, даст короткий отчёт и поведёт по вопросам'),
      })),
      ...templates.map((item, index) => ({
        key: `template:${item.id}`,
        section: index === 0 ? t('САМ, ПО ШАБЛОНУ — пара вопросов, и дерево готово') : undefined,
        label: (
          <Text wrap="truncate-end">
            <Text color={C.accent}>▤ </Text>
            <Text bold>{item.name}</Text>
            <Text color={C.dim}> — {item.tagline}</Text>
          </Text>
        ),
        hint: item.for,
      })),
    ];
    body = (
      <Box flexDirection="column" width={column}>
        <Text bold color={C.brand}>
          {t('Как посадим дерево?')}
        </Text>
        <Menu
          items={items}
          active={step === 'start'}
          onCancel={() => exit()}
          maxRows={Math.max(6, height - mark.rows - 8)}
          onPick={(key) => {
            const [kind, id] = key.split(':') as [string, string];
            if (kind === 'agent') {
              setAgent(id as BrainId);
              asked.current = Date.now();
              return setStep('agent');
            }
            setTemplate(templates.find((item) => item.id === id));
            setQuestion(-1);
            setStep('questions');
          }}
        />
      </Box>
    );
  } else if (step === 'agent') {
    body = null;
  } else {
    const q = question >= 0 ? template.questions[question] : undefined;
    const total = template.questions.length + 1;
    body = (
      <Box flexDirection="column" width={column}>
        <Text wrap="truncate-end">
          <Text color={C.dim}>{t('шаблон ')}</Text>
          <Text bold color={C.brand}>
            {template.name}
          </Text>
          <Text color={C.faint}> — {template.tagline}</Text>
        </Text>
        <Box marginTop={1} flexDirection="column">
          {step === 'questions' ? (
            <>
              <Text wrap="truncate-end">
                <Text bold>{q ? q.label : t('Название')}</Text>
                <Text color={C.faint}>
                  {'   '}
                  {question + 2}/{total}
                </Text>
              </Text>
              <Text wrap="wrap">{q ? q.ask : t('Как называется проект?')}</Text>
              {q?.hint ? (
                <Text color={C.faint} wrap="wrap">
                  {t('например: ')}
                  {q.hint}
                </Text>
              ) : null}
              <Box marginTop={1}>
                <Text color={C.brand}>❯ </Text>
                {q ? (
                  <TextField
                    key={q.key}
                    value={answers[q.key] ?? ''}
                    onChange={(value) => setAnswers((all) => ({ ...all, [q.key]: value }))}
                    active
                    width={column - 4}
                  />
                ) : (
                  <TextField value={title} onChange={setTitle} active width={column - 4} />
                )}
              </Box>
            </>
          ) : null}
          {step === 'brain' ? (
            <>
              <Text bold>{t('Кто по умолчанию работает в сессиях')}</Text>
              <Box marginTop={1}>
                <Choice<BrainId>
                  options={AGENTS.map((id) => ({ value: id, label: BRAIN_LABEL[id] }))}
                  value={brain}
                  active
                  onChange={setBrain}
                />
              </Box>
              <Text color={C.faint} wrap="wrap">
                {t('В каждом узле можно выбрать любого — это только то, что запускается по c и ⏎.')}
              </Text>
            </>
          ) : null}
          {step === 'pointer' ? (
            <>
              <Text bold>{t('Сказать агентам про дерево?')}</Text>
              <Text wrap="wrap">
                {t('Допишу в ')}
                {targets.join(t(' и '))}
                {t(
                  ' короткий блок: где лежит дерево и как писать в него итог. Тогда и обычный запуск claude или codex в проекте будет знать про дерево.',
                )}
              </Text>
              <Box marginTop={1}>
                <Choice<boolean>
                  options={[
                    { value: true, label: t('да, дописать') },
                    { value: false, label: t('не трогать') },
                  ]}
                  value={pointer}
                  active
                  onChange={setPointer}
                />
              </Box>
            </>
          ) : null}
          {error ? <Text color={C.warn}>{error}</Text> : null}
        </Box>
      </Box>
    );
  }

  if (step === 'agent') {
    const how = facts.tree
      ? t('посмотрит дерево и проект и предложит, как дорастить — ничего не удалит')
      : facts.empty
        ? t('папка почти пустая: попросит выложить всё, что ты думаешь о проекте, — сплошным текстом, как получится')
        : t('изучит код, документы и историю, даст короткий отчёт о том, что реально работает и что висит');
    const row = (label: string, value: ReactNode) => (
      <Box>
        <Box width={12} flexShrink={0}>
          <Text color={C.dim}>{label}</Text>
        </Box>
        <Box flexShrink={1}>
          <Text wrap="wrap">{value}</Text>
        </Box>
      </Box>
    );
    body = (
      <Box flexDirection="column" width={column} borderStyle="round" borderColor={C.agent} paddingX={1}>
        <Text bold color={C.agent}>
          {t('Посадить дерево с {brain}?', {
            brain: BRAIN_LABEL[agent],
          })}
        </Text>
        <Box marginTop={1} flexDirection="column">
          {row(t('Где'), t('в этом терминале — выйдешь из сессии, и откроется дерево'))}
          {row(t('Сначала'), how)}
          {row(
            t('Потом'),
            t(
              'большая цель проекта; первая веха, которую можно проверить в жизни; путь к ней; что можешь сделать только ты',
            ),
          )}
          {row(t('Запишет'), t('дерево и короткие документы (docs/vision.md, AGENTS.md) — только после твоего «да»'))}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      {header}
      <Box width={width} paddingX={1}>
        <Text color={C.rule}>{'─'.repeat(Math.max(0, width - 2))}</Text>
      </Box>
      <Box flexGrow={1} flexDirection="column" alignItems="center" paddingTop={1} overflow="hidden">
        {body}
        {step === 'start' && !facts.git ? (
          <Box width={column} marginTop={1}>
            <Text color={C.faint} wrap="wrap">
              {t('Совет: дерево — это файлы; в git-репозитории его история сохраняется вместе с кодом.')}
            </Text>
          </Box>
        ) : null}
      </Box>
      <Box width={width} paddingX={1}>
        <Text wrap="truncate-end">
          {keys.map(([key, what], index) => (
            <Text key={key}>
              {index > 0 ? <Text color={C.rule}> · </Text> : null}
              <Text color={C.accent}>{key}</Text>
              <Text color={C.faint}> {what}</Text>
            </Text>
          ))}
        </Text>
      </Box>
    </Box>
  );
}

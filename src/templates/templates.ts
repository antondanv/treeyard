/**
 * Templates are ways to grow a tree: a method (how the tree is run), rules
 * for agents, a few questions and a starting skeleton. They are YAML files
 * in `templates/` — add your own next to them.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { lang, t } from '../i18n/i18n.js';
import { addNode } from '../model/ops.js';
import { writeOverview } from '../model/overview.js';
import { loadTree, TREE_DIR, writeProject } from '../model/store.js';
import { today } from '../model/time.js';
import { type BrainId, type Project, ROOT, type Status, type Tree, type Who } from '../model/types.js';

export interface TemplateQuestion {
  key: string;
  label: string;
  ask: string;
  hint?: string;
  required?: boolean;
}

export interface TemplateNode {
  title: string;
  who?: Who;
  status?: Status;
  done_when?: string;
  check?: string;
  body?: string;
  children?: TemplateNode[];
}

export interface Template {
  id: string;
  name: string;
  tagline: string;
  for: string;
  order: number;
  questions: TemplateQuestion[];
  method: string;
  rules: string;
  nodes: TemplateNode[];
  /** A question whose comma-separated answer replaces the skeleton's top level. */
  directionsFrom?: string;
  /** Where it came from: built in, or the user's own folder. */
  source: 'builtin' | 'user';
}

/** The templates shipped with treeyard: two levels up from this module, in `src/` and in `dist/` alike. */
export function builtinDir(): string {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates');
  // English templates live in `templates/en/`; Russian ones at the top.
  return lang() === 'en' ? join(root, 'en') : root;
}

/** Your own templates: `~/.treeyard/templates/*.yaml`. */
export function userDir(): string {
  return join(homedir(), '.treeyard', 'templates');
}

export function listTemplates(): Template[] {
  const found = new Map<string, Template>();
  for (const [dir, source] of [
    [builtinDir(), 'builtin'],
    [userDir(), 'user'],
  ] as const) {
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((file) => file.endsWith('.yaml') && !file.startsWith('_'));
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const template = readTemplate(join(dir, file), source);
        found.set(template.id, template);
      } catch {
        // A broken user template must not take the others down.
      }
    }
  }
  return [...found.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export function getTemplate(id: string): Template | undefined {
  return listTemplates().find((template) => template.id === id);
}

function readTemplate(path: string, source: 'builtin' | 'user'): Template {
  const data = parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const template: Template = {
    id: String(data.id ?? ''),
    name: String(data.name ?? data.id ?? ''),
    tagline: String(data.tagline ?? ''),
    for: String(data.for ?? ''),
    order: Number(data.order ?? 99),
    questions: Array.isArray(data.questions) ? (data.questions as TemplateQuestion[]) : [],
    method: String(data.method ?? '').trim(),
    rules: String(data.rules ?? '').trim(),
    nodes: Array.isArray(data.nodes) ? (data.nodes as TemplateNode[]) : [],
    source,
  };
  if (typeof data.directions_from === 'string') template.directionsFrom = data.directions_from;
  if (!template.id) throw new Error(`${path}: no id`);
  return template;
}

/** The rules every tree shares, whatever the template. */
export function commonText(): string {
  return readFileSync(join(builtinDir(), '_common.md'), 'utf8').trim();
}

/** Values for `{{…}}`: the answers plus phrases that read well when an answer is missing. */
export function variables(answers: Record<string, string>): Record<string, string> {
  const get = (key: string) => answers[key]?.trim() ?? '';
  const vars: Record<string, string> = { ...answers };
  vars.goal = get('goal');
  vars.loop_suffix = get('loop') ? ` («${get('loop')}»)` : '';
  vars.loop_done = get('loop')
    ? t('Сценарий «{p1}» проходит от начала до конца.', {
        p1: get('loop'),
      })
    : t('Главный сценарий проходит от начала до конца.');
  vars.check_or_default = get('check') ? `\`${get('check')}\`` : t('тесты проекта');
  vars.users_or_people = get('users')
    ? t('людей: {p1}', {
        p1: get('users'),
      })
    : t('людей');
  vars.preview_or_default = get('preview') || t('локальный стенд');
  vars.client_line = get('client')
    ? t('Заказчик: {p1}.', {
        p1: get('client'),
      })
    : '';
  return vars;
}

export function fill(text: string | undefined, vars: Record<string, string>): string {
  if (!text) return '';
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key: string) => vars[key] ?? '').trim();
}

export interface CreateOptions {
  title: string;
  answers: Record<string, string>;
  brain?: BrainId;
  /** Plant the template's starting nodes. False when the nodes come from elsewhere (import). */
  skeleton?: boolean;
}

/** Starts `.tree/` in `dir` from a template. Refuses to overwrite an existing tree. */
export function createTree(dir: string, template: Template, options: CreateOptions): Tree {
  const root = join(dir, TREE_DIR);
  if (existsSync(join(root, 'tree.md')))
    throw new Error(
      t('здесь уже есть дерево: {root}', {
        root,
      }),
    );
  mkdirSync(join(root, 'nodes'), { recursive: true });
  writeFileSync(join(root, '.gitignore'), '.local/\n');
  const vars = variables(options.answers);
  const project: Project = {
    dir,
    title: options.title.trim() || dir.split('/').pop() || t('Проект'),
    template: template.id,
    brain: options.brain ?? 'claude',
    start: 'plan',
    created: today(),
    body: projectBody(template, vars),
    extra: {},
  };
  const goal = vars.goal;
  if (goal) project.goal = goal;
  writeProject(project);

  const tree = loadTree(dir);
  if (options.skeleton === false) {
    writeOverview(tree);
    return tree;
  }
  let nodes = template.nodes;
  const listed = template.directionsFrom ? splitList(options.answers[template.directionsFrom]) : [];
  if (listed.length > 0) {
    // Your own directions replace the default ones; the ideas branch stays.
    nodes = [
      ...listed.map((title) => ({ title, who: 'any' as Who })),
      ...nodes.filter((node) => node.status === 'idea'),
    ];
  }
  const plant = (list: TemplateNode[], parent: string) => {
    for (const item of list) {
      const node = addNode(tree, {
        title: fill(item.title, vars) || t('Узел'),
        parent,
        status: item.status ?? 'todo',
        ...(item.who ? { who: item.who } : {}),
        ...(fill(item.done_when, vars) ? { doneWhen: fill(item.done_when, vars) } : {}),
        ...(fill(item.check, vars) ? { check: fill(item.check, vars) } : {}),
        ...(fill(item.body, vars) ? { body: fill(item.body, vars) } : {}),
      });
      if (item.children?.length) plant(item.children, node.id);
    }
  };
  plant(nodes, ROOT);
  writeOverview(tree);
  return tree;
}

function projectBody(template: Template, vars: Record<string, string>): string {
  const common = commonText();
  const method = fill(template.method, vars);
  const rules = fill(template.rules, vars);
  // The template's own rules go under the shared rules for agents.
  const withRules = rules
    ? common.replace(
        /(## (?:Правила для агентов|Rules for agents)\n\n(?:- .*\n)+)/,
        (section) => `${section}${rules}\n`,
      )
    : common;
  return `${t('## Метод: {name}', { name: template.name })}\n\n${method}\n\n${withRules}\n`;
}

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

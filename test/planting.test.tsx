import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from 'ink';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addDecisions } from '../src/agents/importer.js';
import {
  folderFacts,
  installSkill,
  plantingPrompt,
  SKILL,
  skillBody,
  skillPath,
  skillText,
} from '../src/agents/planting.js';
import { loadTree } from '../src/model/store.js';
import { DEFAULTS, resetSettings } from '../src/settings.js';
import { pointerTargets } from '../src/templates/pointer.js';
import { type InitResult, Wizard } from '../src/tui/init.js';
import { emptyTree, tempDir } from './helpers.js';

const root = fileURLToPath(new URL('..', import.meta.url));

beforeEach(() => resetSettings({ ...DEFAULTS }));
afterEach(() => resetSettings({ ...DEFAULTS }));

describe('the planting skill', () => {
  it('ships as one English skill any CLI can load', () => {
    const text = skillText();
    expect(skillPath()).toContain(join('skills', SKILL, 'SKILL.md'));
    expect(text).toMatch(/^---\nname: treeyard-init\ndescription: .{80,}\n---\n/);
    // It plants with one command, keeps the person's own steps in sight, speaks their language.
    expect(text).toContain('treeyard import --from-json -');
    expect(text).toContain('"who": "human"');
    expect(text).toContain('treeyard pointer');
    expect(text).toContain("The person's language");
    expect(text).not.toMatch(/[а-яё]/i);
  });

  it('goes to an agent without the front matter', () => {
    const body = skillBody();
    expect(body.startsWith("# Plant a project's tree")).toBe(true);
    expect(body).not.toContain('description:');
  });

  it('installs where Claude Code, Codex and Antigravity look, for the CLIs that are there', () => {
    const home = tempDir('treeyard-home-');
    const claude = join(home, '.claude');
    const codex = join(home, '.codex');
    mkdirSync(claude);
    mkdirSync(codex);
    const written = installSkill({ ...process.env, HOME: home, CLAUDE_CONFIG_DIR: claude, CODEX_HOME: codex });
    expect(written).toEqual([join(claude, 'skills', SKILL, 'SKILL.md'), join(codex, 'skills', SKILL, 'SKILL.md')]);
    expect(readFileSync(written[0]!, 'utf8')).toBe(skillText());
  });
});

describe('what the agent is told about the folder', () => {
  it('an empty folder: tell me everything first', () => {
    const facts = folderFacts(tempDir());
    expect(facts).toMatchObject({ empty: true, git: false, tree: false, docs: [] });
    expect(plantingPrompt(facts)).toContain('выложить всё');
  });

  it('a project: a review first, with the documents it should read', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, 'README.md'), '# x');
    writeFileSync(join(dir, 'ROADMAP.md'), '# plan');
    mkdirSync(join(dir, 'docs'));
    const facts = folderFacts(dir);
    expect(facts.empty).toBe(false);
    expect(facts.docs).toEqual(['README.md', 'ROADMAP.md', 'docs/']);
    expect(plantingPrompt(facts)).toContain('Начни с разбора');
  });

  it('a folder with a tree: grow it, delete nothing', () => {
    const tree = emptyTree();
    expect(plantingPrompt(folderFacts(tree.project.dir))).toContain('Ничего не удаляй');
  });
});

describe('planting from JSON, as the agent does', () => {
  const cli = (args: string[], cwd: string, input?: string) =>
    spawnSync(join(root, 'node_modules', '.bin', 'tsx'), [join(root, 'src', 'cli', 'main.ts'), ...args], {
      cwd,
      ...(input ? { input } : {}),
      env: { ...process.env, TREEYARD_HOME: tempDir('treeyard-home-'), TREEYARD_LANG: '', NO_COLOR: '1' },
      encoding: 'utf8',
    });

  it('one command from stdin: title, template, goal, decisions, checks and the person’s steps', () => {
    const dir = tempDir();
    const plan = {
      title: 'Канальный завод',
      template: 'stages',
      goal: 'Неделю веду канал только через бота',
      decisions: ['Python + FastAPI: стек уже выбран'],
      nodes: [
        {
          title: 'Ходячий скелет',
          status: 'active',
          done_when: 'тема → пост в тестовом канале',
          children: [{ title: 'Бот отдаёт черновик', check: 'pytest -q', done_when: 'черновик за 2 минуты' }],
        },
        { title: 'Арендовать VPS', who: 'human' },
        { title: 'Подключить площадку', status: 'waiting', waiting: 'нет доступа к API', until: 'ответит поддержка' },
      ],
    };
    const got = cli(['import', '--from-json', '-'], dir, JSON.stringify(plan));
    expect(got.status, got.stderr).toBe(0);
    const tree = loadTree(dir);
    expect(tree.project).toMatchObject({ title: 'Канальный завод', template: 'stages', goal: plan.goal });
    expect(tree.project.body).toMatch(/## Решения[\s\S]*- Python \+ FastAPI: стек уже выбран/);
    const byTitle = new Map([...tree.nodes.values()].map((node) => [node.title, node]));
    expect(byTitle.size).toBe(4);
    expect(byTitle.get('Бот отдаёт черновик')).toMatchObject({ check: 'pytest -q', doneWhen: 'черновик за 2 минуты' });
    expect(byTitle.get('Бот отдаёт черновик')!.parent).toBe(byTitle.get('Ходячий скелет')!.id);
    expect(byTitle.get('Арендовать VPS')!.who).toBe('human');
    expect(byTitle.get('Подключить площадку')).toMatchObject({ status: 'waiting', waiting: 'нет доступа к API' });
  });

  it('decisions land under their heading, before the next one', () => {
    const body = '## Метод\n\nтекст\n\n## Решения\n\nЗдесь — решения.\n\n## Ещё\n\nхвост\n';
    const next = addDecisions(body, ['Одно', 'Другое']);
    expect(next).toBe('## Метод\n\nтекст\n\n## Решения\n\nЗдесь — решения.\n\n- Одно\n- Другое\n\n## Ещё\n\nхвост\n');
    expect(addDecisions('# x\n', ['A'])).toBe('# x\n\n## Решения\n\n- A\n');
  });

  it('init --bare: the method and the goal, without the template’s example branches', () => {
    const dir = tempDir();
    const got = cli(['init', '--template', 'stages', '--goal', 'цель', '--bare'], dir);
    expect(got.status, got.stderr).toBe(0);
    expect(loadTree(dir).nodes.size).toBe(0);
  });
});

describe('the block about the tree', () => {
  it('skips a CLAUDE.md that only imports AGENTS.md: it gets the block through it', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'AGENTS.md'), '# Rules\n');
    writeFileSync(join(dir, 'CLAUDE.md'), '@AGENTS.md\n');
    expect(pointerTargets(dir)).toEqual(['AGENTS.md']);
    writeFileSync(join(dir, 'CLAUDE.md'), '@AGENTS.md\n\nClaude-only notes\n');
    expect(pointerTargets(dir)).toEqual(['CLAUDE.md', 'AGENTS.md']);
  });
});

describe('the first-run wizard', () => {
  class Out extends EventEmitter {
    isTTY = true;
    frame = '';
    constructor(
      readonly columns: number,
      readonly rows: number,
    ) {
      super();
    }
    write = (text: string) => {
      this.frame = text;
      return true;
    };
  }
  class In extends EventEmitter {
    isTTY = true;
    data: string | null = null;
    setRawMode() {}
    setEncoding() {}
    resume() {}
    pause() {}
    ref() {}
    unref() {}
    read = () => {
      const data = this.data;
      this.data = null;
      return data;
    };
    write(data: string) {
      this.data = data;
      this.emit('readable');
      this.emit('data', data);
    }
  }
  const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

  async function wizard(keys: string[], columns = 120, rows = 34) {
    const stdout = new Out(columns, rows);
    const stdin = new In();
    const result: InitResult = { created: false };
    const instance = render(<Wizard dir={tempDir()} onDone={(done) => Object.assign(result, done)} />, {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    await pause(80);
    for (const key of keys) {
      if (key === 'WAIT') await pause(350);
      else {
        stdin.write(key);
        await pause(60);
      }
    }
    await pause(80);
    const frame = stdout.frame;
    instance.unmount();
    instance.cleanup();
    return { frame, result };
  }

  it('fills the terminal: the mark on top, both ways in the middle, keys at the bottom', async () => {
    const { frame } = await wizard([], 120, 34);
    const lines = frame.split('\n');
    expect(lines.length).toBe(34);
    expect(frame).toContain('Как посадим дерево?');
    expect(frame).toContain('С АГЕНТОМ');
    expect(frame).toContain('САМ, ПО ШАБЛОНУ');
    expect(frame).toContain('папка почти пустая');
    expect(lines.at(-1)).toContain('↑↓ выбор');
  });

  it('an agent is confirmed first, and a quick second Enter does not start it', async () => {
    // The first available agent: whichever CLI this machine has.
    const fast = await wizard(['\r', '\r']);
    expect(fast.frame).toMatch(/Посадить дерево с .+\?/);
    expect(fast.result.agent).toBeUndefined();
    const confirmed = await wizard(['\r', 'WAIT', '\r']);
    expect(confirmed.result.agent).toBeDefined();
  });
});

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { addNode } from '../src/model/ops.js';
import { emptyTree, tempDir } from './helpers.js';

const run = promisify(execFile);
const fixture = fileURLToPath(new URL('./fixtures/tui-memory.ts', import.meta.url));

async function probe(args: string[], nodeEnv?: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TREEYARD_HOME: tempDir('treeyard-runtime-home-'),
    TREEYARD_LANG: '',
    NO_COLOR: '1',
  };
  delete env.NODE_ENV;
  delete env.FORCE_COLOR;
  delete env.CI;
  if (nodeEnv !== undefined) env.NODE_ENV = nodeEnv;
  const { stdout } = await run(process.execPath, ['--expose-gc', '--import', 'tsx', fixture, ...args], {
    env,
    timeout: 30_000,
  });
  return JSON.parse(stdout.split('\n').findLast((line) => line.startsWith('{'))!) as {
    nodeEnv: string;
    ownNodeEnv: boolean;
    developmentReact: boolean;
    heaps: number[];
    measuresBefore: number;
    measuresAfter: number;
    animationWrites: number;
    uiUnchanged: boolean;
    savedView: string;
  };
}

describe('CLI runtime', () => {
  it('loads production React by default, before the command imports Ink', async () => {
    // The production default is Treeyard's own: children (checks, sessions) are told so.
    expect(await probe(['startup'])).toMatchObject({
      nodeEnv: 'production',
      ownNodeEnv: true,
      developmentReact: false,
    });
  });

  it.each(['development', 'test', 'production'])('preserves an explicit NODE_ENV=%s', async (nodeEnv) => {
    expect(await probe(['startup'], nodeEnv)).toMatchObject({
      nodeEnv,
      ownNodeEnv: false,
      developmentReact: nodeEnv !== 'production',
    });
  });

  it('keeps marquee memory bounded and saves UI only when its state changes', async () => {
    const tree = emptyTree();
    const branch = addNode(tree, { title: 'Ветка' });
    const selected = addNode(tree, {
      title: 'Длинное название задачи, которое не помещается в колонку целиком и продолжает двигаться',
      parent: branch.id,
      status: 'active',
    });
    for (let i = 0; i < 20; i++) addNode(tree, { title: `Задача ${i}`, parent: branch.id });
    const result = await probe(['memory', tree.project.dir, selected.id]);
    expect(result.developmentReact).toBe(false);
    expect(result.animationWrites).toBeGreaterThan(15);
    expect(result.measuresBefore).toBe(0);
    expect(result.measuresAfter).toBe(0);
    // Allow renderer/JIT warmup, but catch the reported sustained MB/s growth.
    expect(Math.max(...result.heaps) - result.heaps[0]!).toBeLessThan(6 * 1024 * 1024);
    expect(result.uiUnchanged).toBe(true);
    expect(result.savedView).toBe('now');
  }, 35_000);
});

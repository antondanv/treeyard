import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emptyTree } from './helpers.js';

/** The modules fresh, so the «did we set it» flag starts clean under the NODE_ENV the test picked. */
async function load(nodeEnv: string | undefined) {
  if (nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;
  vi.resetModules();
  const env = await import('../src/node-env.js');
  const { runCheck } = await import('../src/agents/check.js');
  return { ...env, runCheck };
}

describe('NODE_ENV that Treeyard sets itself', () => {
  const saved = process.env.NODE_ENV;
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    process.env.NODE_ENV = saved;
  });

  it('is production for us and remembered as ours when the shell had none', async () => {
    const { defaultNodeEnv, ownNodeEnv, childEnv } = await load(undefined);
    expect(ownNodeEnv()).toBe(false);
    defaultNodeEnv();
    expect(process.env.NODE_ENV).toBe('production');
    expect(ownNodeEnv()).toBe(true);
    // Our own process keeps it; a child does not inherit it, and still gets what is passed.
    const child = childEnv({ CI: '1' });
    expect(child).not.toHaveProperty('NODE_ENV');
    expect(child.CI).toBe('1');
    expect(process.env.NODE_ENV).toBe('production');
  });

  it.each(['development', 'test', 'production'])('is not ours when the shell set %s', async (nodeEnv) => {
    const { defaultNodeEnv, ownNodeEnv, childEnv } = await load(nodeEnv);
    defaultNodeEnv();
    expect(process.env.NODE_ENV).toBe(nodeEnv);
    expect(ownNodeEnv()).toBe(false);
    expect(childEnv().NODE_ENV).toBe(nodeEnv);
  });

  it('is not ours any more once something else changes it', async () => {
    const { defaultNodeEnv, ownNodeEnv, childEnv } = await load(undefined);
    defaultNodeEnv();
    process.env.NODE_ENV = 'test';
    expect(ownNodeEnv()).toBe(false);
    expect(childEnv().NODE_ENV).toBe('test');
  });

  it('a node check does not inherit our default, but keeps the one from the shell', async () => {
    const dir = emptyTree().project.dir;
    const ours = await load(undefined);
    ours.defaultNodeEnv();
    expect((await ours.runCheck('echo "[$NODE_ENV]"', dir)).output).toContain('[]');
    const shells = await load('test');
    shells.defaultNodeEnv();
    expect((await shells.runCheck('echo "[$NODE_ENV]"', dir)).output).toContain('[test]');
    // Even when the shell asked for production itself.
    const production = await load('production');
    production.defaultNodeEnv();
    expect((await production.runCheck('echo "[$NODE_ENV]"', dir)).output).toContain('[production]');
  });
});

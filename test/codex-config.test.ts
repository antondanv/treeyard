import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type CodexSandbox,
  codexConfigFile,
  configLines,
  gitDirOf,
  parseSandbox,
  reach,
  readSandbox,
  sandboxArgs,
} from '../src/agents/codex-config.js';
import { tempDir } from './helpers.js';

// The person's git config (signing, a global hooks path) must not leak into the repositories made here.
const saved = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_SYSTEM };
beforeAll(() => {
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_SYSTEM = '/dev/null';
});
afterAll(() => {
  for (const [key, value] of [
    ['GIT_CONFIG_GLOBAL', saved.global],
    ['GIT_CONFIG_SYSTEM', saved.system],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const git = (dir: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', ...args], {
    cwd: dir,
    encoding: 'utf8',
  }).trim();

/** A repository with one commit; its `.git` by real path, as the code names it. */
function repo(): { dir: string; gitDir: string } {
  const dir = realpathSync(tempDir('treeyard-codex-repo-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'init');
  return { dir, gitDir: join(dir, '.git') };
}

/** A CODEX_HOME with this config.toml. */
function codexHome(config: string): NodeJS.ProcessEnv {
  const home = tempDir('treeyard-codex-home-');
  writeFileSync(join(home, 'config.toml'), config);
  return { CODEX_HOME: home };
}

describe('reading the sandbox out of config.toml', () => {
  it('finds nothing in a config that says nothing about it', () => {
    const text = [
      'model = "gpt-6"',
      'notify = ["/bin/x", "turn-ended"]',
      '',
      '[projects."/Users/a/Projects/X"]',
      'trust_level = "trusted"',
    ].join('\n');
    expect(parseSandbox(text)).toEqual({ roots: [] });
  });

  it('takes the top-level mode and the two keys of the workspace-write table, comments and long arrays included', () => {
    const text = [
      '# the sandbox',
      'sandbox_mode = "workspace-write"   # not read-only',
      'approval_policy = "on-request"',
      '',
      '[sandbox_workspace_write]',
      'network_access = true # tmux',
      'writable_roots = [',
      '  "/a/.git", # the first',
      "  '/b with # hash',",
      ']',
      'exclude_slash_tmp = false',
    ].join('\n');
    expect(parseSandbox(text)).toEqual({
      mode: 'workspace-write',
      network: true,
      roots: ['/a/.git', '/b with # hash'],
    });
  });

  it('reads a dotted key and an inline table the same way', () => {
    expect(parseSandbox('sandbox_workspace_write.network_access = true')).toEqual({ network: true, roots: [] });
    expect(parseSandbox('sandbox_workspace_write = { network_access = false, writable_roots = ["/x/.git"] }')).toEqual({
      network: false,
      roots: ['/x/.git'],
    });
  });

  it('does not take the keys of a profile or of another table for the defaults', () => {
    const text = [
      '[profiles.safe]',
      'sandbox_mode = "read-only"',
      '[profiles.safe.sandbox_workspace_write]',
      'network_access = true',
      '[other]',
      'network_access = true',
    ].join('\n');
    expect(parseSandbox(text)).toEqual({ roots: [] });
  });

  it('reads $CODEX_HOME/config.toml, and nothing from a home without one', () => {
    const env = codexHome('sandbox_mode = "read-only"\n');
    expect(codexConfigFile(env)).toBe(join(env.CODEX_HOME!, 'config.toml'));
    expect(readSandbox(env)).toMatchObject({ mode: 'read-only', roots: [] });
    const empty = tempDir('treeyard-codex-home-');
    expect(readSandbox({ CODEX_HOME: empty })).toEqual({ file: join(empty, 'config.toml'), roots: [] });
  });
});

describe('the project’s .git', () => {
  it('is the repository’s own folder; from a linked worktree it is still that one', () => {
    const { dir, gitDir } = repo();
    expect(gitDirOf(dir)).toBe(gitDir);
    const linked = join(realpathSync(tempDir('treeyard-codex-wt-')), 'wt');
    git(dir, 'worktree', 'add', '-q', '-b', 'side', linked);
    expect(gitDirOf(linked)).toBe(gitDir);
  });

  it('is nothing outside a repository', () => {
    expect(gitDirOf(tempDir('treeyard-codex-plain-'))).toBeUndefined();
  });
});

describe('what config.toml alone lets a Codex session do', () => {
  const sandbox = (over: Partial<CodexSandbox> = {}): CodexSandbox => ({ file: '/c/config.toml', roots: [], ...over });

  it('a bare config reaches neither tmux nor .git; the lines say what to add', () => {
    const { dir, gitDir } = repo();
    expect(reach(sandbox(), dir)).toEqual({ full: false, network: false, git: false, gitDir });
    expect(configLines(sandbox(), dir)).toEqual([
      '[sandbox_workspace_write]',
      'network_access = true',
      `writable_roots = ["${gitDir}"]`,
    ]);
  });

  it('asks only for what is missing, and keeps the person’s own roots', () => {
    const { dir, gitDir } = repo();
    expect(configLines(sandbox({ network: true }), dir)).toEqual([
      '[sandbox_workspace_write]',
      `writable_roots = ["${gitDir}"]`,
    ]);
    expect(configLines(sandbox({ roots: ['/data'] }), dir)).toEqual([
      '[sandbox_workspace_write]',
      'network_access = true',
      `writable_roots = ["/data","${gitDir}"]`,
    ]);
    expect(configLines(sandbox({ network: true, roots: [gitDir] }), dir)).toEqual([]);
  });

  it('a read-only mode is to be changed first; full access needs nothing; no repository, no .git to open', () => {
    const { dir, gitDir } = repo();
    expect(configLines(sandbox({ mode: 'read-only' }), dir)[0]).toBe('sandbox_mode = "workspace-write"');
    expect(configLines(sandbox({ mode: 'danger-full-access' }), dir)).toEqual([]);
    expect(reach(sandbox({ mode: 'danger-full-access' }), dir)).toMatchObject({ network: true, git: true });
    expect(reach(sandbox({ roots: [gitDir] }), dir).git).toBe(true);
    expect(configLines(sandbox(), tempDir('treeyard-codex-plain-'))).toEqual([
      '[sandbox_workspace_write]',
      'network_access = true',
    ]);
  });
});

describe('the flags of «sandbox + treeyard and git»', () => {
  it('workspace-write, the network, the project’s .git; approvals and the rest are left to config.toml', () => {
    const { dir, gitDir } = repo();
    const args = sandboxArgs(dir, codexHome('approval_policy = "on-request"\n'));
    expect(args).toEqual([
      '--sandbox',
      'workspace-write',
      '-c',
      'sandbox_workspace_write.network_access=true',
      '-c',
      `sandbox_workspace_write.writable_roots=["${gitDir}"]`,
    ]);
    expect(args.join(' ')).not.toMatch(/approval|model|danger/);
  });

  it('a -c array replaces the config’s own, so the person’s roots go along', () => {
    const { dir, gitDir } = repo();
    const env = codexHome('[sandbox_workspace_write]\nwritable_roots = ["/data/shared"]\n');
    expect(sandboxArgs(dir, env).at(-1)).toBe(`sandbox_workspace_write.writable_roots=["/data/shared","${gitDir}"]`);
    // Already there: not twice.
    const same = codexHome(`[sandbox_workspace_write]\nwritable_roots = ["${gitDir}"]\n`);
    expect(sandboxArgs(dir, same).at(-1)).toBe(`sandbox_workspace_write.writable_roots=["${gitDir}"]`);
  });

  it('from a linked worktree the root is the main repository’s .git, where its commits go', () => {
    const { dir, gitDir } = repo();
    const linked = join(realpathSync(tempDir('treeyard-codex-wt-')), 'wt');
    git(dir, 'worktree', 'add', '-q', '-b', 'side', linked);
    expect(sandboxArgs(linked, codexHome('')).at(-1)).toBe(`sandbox_workspace_write.writable_roots=["${gitDir}"]`);
  });

  it('outside a repository only the network is opened', () => {
    const args = sandboxArgs(tempDir('treeyard-codex-plain-'), codexHome(''));
    expect(args).toEqual(['--sandbox', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=true']);
  });

  it('a path with quotes and backslashes stays one valid TOML string', () => {
    const dir = realpathSync(tempDir('treeyard-codex-odd-'));
    const odd = join(dir, 'a "b" c');
    mkdirSync(odd);
    git(odd, 'init', '-q', '-b', 'main');
    expect(sandboxArgs(odd, codexHome('')).at(-1)).toBe(
      `sandbox_workspace_write.writable_roots=[${JSON.stringify(join(odd, '.git'))}]`,
    );
  });
});

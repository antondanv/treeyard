import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { addNode, setStatus } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import {
  closedWorktrees,
  ensureWorktree,
  isWorktreeCleanMerged,
  worktreeFor,
  worktreeParent,
} from '../src/worktree.js';
import { emptyTree, treeyardIn } from './helpers.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  }).trim();

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(worktreeParent(dir), { recursive: true, force: true });
});

function commitIn(dir: string, name: string): string {
  writeFileSync(join(dir, name), `${name}\n`);
  git(dir, 'add', name);
  git(dir, 'commit', '-q', '-m', `add ${name}`);
  return git(dir, 'rev-parse', 'HEAD');
}

function repo(titles: string[]) {
  const tree = emptyTree();
  const main = tree.project.dir;
  made.push(main);
  const ids = titles.map((title) => addNode(tree, { title, status: 'active' }).id);
  writeFileSync(join(main, 'app.txt'), 'код\n');
  writeFileSync(join(main, '.gitignore'), '.tree/.local/\n');
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'start');
  return { tree: loadTree(main), main, ids };
}

describe('worktree helpers for cleanup', () => {
  it('closedWorktrees returns only done and dropped nodes with standing worktrees', async () => {
    const { tree, main, ids } = repo(['Готовый', 'Отказанный', 'Активный', 'На проверке']);
    const [doneId, droppedId, activeId, reviewId] = ids as [string, string, string, string];
    for (const id of ids) await ensureWorktree(tree, id);
    setStatus(tree, doneId, 'done', { source: 'ты' });
    setStatus(tree, droppedId, 'dropped', { source: 'ты' });
    setStatus(tree, reviewId, 'review', { source: 'агент' });

    expect(
      closedWorktrees(loadTree(main))
        .map((wt) => wt.id)
        .sort(),
    ).toEqual([doneId, droppedId].sort());
    expect(isWorktreeCleanMerged(main, doneId)).toBe(true);
    expect(isWorktreeCleanMerged(main, activeId)).toBe(true);

    // Dirty file or unmerged commit turns clean-merged false.
    const wt = worktreeFor(main, doneId)!;
    writeFileSync(join(wt.dir, 'draft.txt'), 'draft\n');
    expect(isWorktreeCleanMerged(main, doneId)).toBe(false);
    commitIn(wt.dir, 'draft.txt');
    expect(isWorktreeCleanMerged(main, doneId)).toBe(false);
    git(main, 'merge', '-q', '--no-ff', '-m', 'merge', wt.branch);
    expect(isWorktreeCleanMerged(main, doneId)).toBe(true);
  });
});

describe('treeyard worktree rm with several ids', () => {
  it('removes clean worktrees, reports one line per node, keeps refused ones and exits 1', async () => {
    const { tree, main, ids } = repo(['Первый', 'Грязный', 'Невлитый', 'Без папки', 'Последний']);
    const [a, b, c, d, e] = ids as [string, string, string, string, string];
    const wtA = (await ensureWorktree(tree, a)).worktree;
    const wtB = (await ensureWorktree(tree, b)).worktree;
    const wtC = (await ensureWorktree(tree, c)).worktree;
    const wtE = (await ensureWorktree(tree, e)).worktree;

    const shaA = commitIn(wtA.dir, 'a.txt');
    git(main, 'merge', '-q', '--no-ff', '-m', 'merge a', wtA.branch);
    writeFileSync(join(wtB.dir, 'dirty.txt'), 'dirty\n');
    commitIn(wtC.dir, 'unmerged.txt');

    const cli = treeyardIn(main);

    // --dry-run touches nothing, prints one line per node, exits 1 when any is refused.
    const dry = await cli('worktree', 'rm', a, b, c, d, e, '--dry-run');
    expect(dry.code).toBe(1);
    expect(dry.stdout.trim().split('\n')).toHaveLength(2);
    expect(dry.stdout).toContain(`${a}  Первый · уберёт worktree, ветка treeyard/${a}`);
    expect(dry.stdout).toContain(`${e}  Последний · уберёт worktree, ветка treeyard/${e}`);
    expect(dry.stderr.trim().split('\n')).toHaveLength(3);
    expect(dry.stderr).toContain(`${b}  Грязный · не закоммичено файлов: 1 (dirty.txt)`);
    expect(dry.stderr).toContain(`${c}  Невлитый · не влито коммитов`);
    expect(dry.stderr).toContain(`${d}  Без папки · у узла нет worktree`);
    expect(existsSync(wtA.path)).toBe(true);
    expect(existsSync(wtE.path)).toBe(true);

    // Real run removes clean ones (a and e) despite refusals on b, c, d, and exits 1.
    const res = await cli('worktree', 'rm', a, b, c, d, e, 'zzzz');
    expect(res.code).toBe(1);
    expect(res.stdout.trim().split('\n')).toHaveLength(2);
    expect(res.stdout).toContain(`✓ ${a}  Первый · worktree убран, ветка treeyard/${a} удалена · коммитов у узла: 1`);
    expect(res.stdout).toContain(`✓ ${e}  Последний · worktree убран, ветка treeyard/${e} удалена`);
    expect(res.stderr.trim().split('\n')).toHaveLength(4);
    expect(res.stderr).toContain(`✗ ${b}  Грязный`);
    expect(res.stderr).toContain(`✗ ${c}  Невлитый`);
    expect(res.stderr).toContain(`✗ ${d}  Без папки`);
    expect(res.stderr).toContain('✗ zzzz');

    expect(existsSync(wtA.path)).toBe(false);
    expect(existsSync(wtE.path)).toBe(false);
    expect(git(main, 'branch', '--list', wtA.branch)).toBe('');
    expect(git(main, 'branch', '--list', wtE.branch)).toBe('');
    expect(loadTree(main).nodes.get(a)?.commits).toEqual([shaA]);

    expect(existsSync(wtB.path)).toBe(true);
    expect(existsSync(wtC.path)).toBe(true);

    // Clean up b and c so all succeed -> exit 0, JSON array works too.
    rmSync(join(wtB.dir, 'dirty.txt'));
    git(main, 'merge', '-q', '--no-ff', '-m', 'merge c', wtC.branch);
    const allOk = await cli('worktree', 'rm', b, c, '--json');
    expect(allOk.code, allOk.stderr).toBe(0);
    expect(JSON.parse(allOk.stdout)).toMatchObject([
      { node: b, title: 'Грязный', status: 'removed', attached: 0 },
      { node: c, title: 'Невлитый', status: 'removed', attached: 1 },
    ]);
    expect(existsSync(wtB.path)).toBe(false);
    expect(existsSync(wtC.path)).toBe(false);
  }, 90_000);
});

describe('treeyard worktree rm --done', () => {
  it('removes clean merged worktrees of done and dropped nodes, reports kept ones with reasons, and supports --dry-run', async () => {
    const { tree, main, ids } = repo([
      'Готов чистый',
      'Отказ чистый',
      'Готов грязный',
      'Отказ невлитый',
      'В работе чистый',
      'На проверке чистый',
    ]);
    const [doneClean, droppedClean, doneDirty, droppedUnmerged, activeClean, reviewClean] = ids as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];

    const wtDoneClean = (await ensureWorktree(tree, doneClean)).worktree;
    const wtDroppedClean = (await ensureWorktree(tree, droppedClean)).worktree;
    const wtDoneDirty = (await ensureWorktree(tree, doneDirty)).worktree;
    const wtDroppedUnmerged = (await ensureWorktree(tree, droppedUnmerged)).worktree;
    const wtActive = (await ensureWorktree(tree, activeClean)).worktree;
    const wtReview = (await ensureWorktree(tree, reviewClean)).worktree;

    const sha = commitIn(wtDoneClean.dir, 'done.txt');
    git(main, 'merge', '-q', '--no-ff', '-m', 'merge done', wtDoneClean.branch);
    writeFileSync(join(wtDoneDirty.dir, 'scratch.txt'), 'scratch\n');
    commitIn(wtDroppedUnmerged.dir, 'dropped.txt');

    setStatus(tree, doneClean, 'done', { source: 'ты' });
    setStatus(tree, droppedClean, 'dropped', { source: 'ты' });
    setStatus(tree, doneDirty, 'done', { source: 'ты' });
    setStatus(tree, droppedUnmerged, 'dropped', { source: 'ты' });
    setStatus(tree, reviewClean, 'review', { source: 'агент' });

    const cli = treeyardIn(main);

    // --dry-run only previews, touches nothing.
    const dry = await cli('worktree', 'rm', '--done', '--dry-run');
    expect(dry.code, dry.stderr).toBe(0);
    expect(dry.stdout).toContain(`${doneClean}  Готов чистый · уберёт worktree, ветка treeyard/${doneClean}`);
    expect(dry.stdout).toContain(`${droppedClean}  Отказ чистый · уберёт worktree, ветка treeyard/${droppedClean}`);
    expect(dry.stdout).toContain(`${doneDirty}  Готов грязный · оставит: не закоммичено файлов: 1 (scratch.txt)`);
    expect(dry.stdout).toContain(`${droppedUnmerged}  Отказ невлитый · оставит: не влито коммитов`);
    expect(dry.stdout).toContain('уберёт: 2 · оставит: 2');
    expect(dry.stdout).not.toContain('В работе чистый');
    expect(dry.stdout).not.toContain('На проверке чистый');
    for (const wt of [wtDoneClean, wtDroppedClean, wtDoneDirty, wtDroppedUnmerged, wtActive, wtReview]) {
      expect(existsSync(wt.path)).toBe(true);
    }

    // English --dry-run works cleanly too.
    const dryEn = await treeyardIn(main, { TREEYARD_LANG: 'en' })('worktree', 'rm', '--done', '--dry-run');
    expect(dryEn.code, dryEn.stderr).toBe(0);
    expect(dryEn.stdout).toContain(`would remove worktree, branch treeyard/${doneClean}`);
    expect(dryEn.stdout).toContain('would keep: files not committed: 1 (scratch.txt)');
    expect(dryEn.stdout).toContain('would remove: 2 · would keep: 2');

    // Real --done removes clean closed ones, keeps dirty/unmerged closed ones with reasons, leaves open ones alone.
    const run = await cli('worktree', 'rm', '--done');
    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toContain(
      `✓ ${doneClean}  Готов чистый · worktree убран, ветка treeyard/${doneClean} удалена · коммитов у узла: 1`,
    );
    expect(run.stdout).toContain(
      `✓ ${droppedClean}  Отказ чистый · worktree убран, ветка treeyard/${droppedClean} удалена`,
    );
    expect(run.stdout).toContain(`${doneDirty}  Готов грязный · оставлен: не закоммичено файлов: 1 (scratch.txt)`);
    expect(run.stdout).toContain(`${droppedUnmerged}  Отказ невлитый · оставлен: не влито коммитов`);
    expect(run.stdout).toContain('убрано: 2 · оставлено: 2');

    expect(existsSync(wtDoneClean.path)).toBe(false);
    expect(existsSync(wtDroppedClean.path)).toBe(false);
    expect(git(main, 'branch', '--list', wtDoneClean.branch)).toBe('');
    expect(git(main, 'branch', '--list', wtDroppedClean.branch)).toBe('');
    expect(loadTree(main).nodes.get(doneClean)?.commits).toEqual([sha]);

    expect(existsSync(wtDoneDirty.path)).toBe(true);
    expect(existsSync(wtDroppedUnmerged.path)).toBe(true);
    expect(existsSync(wtActive.path)).toBe(true);
    expect(existsSync(wtReview.path)).toBe(true);

    // Invalid combinations exit 2.
    expect((await cli('worktree', 'rm', '--done', activeClean)).code).toBe(2);
    expect((await cli('worktree', 'rm')).code).toBe(2);
    expect((await cli('worktree', 'add', activeClean, '--done')).code).toBe(2);
    expect((await cli('worktree', 'add', activeClean, '--dry-run')).code).toBe(2);
  }, 90_000);

  it('says when no closed nodes have a worktree', async () => {
    const { tree, main, ids } = repo(['Открытый']);
    const [activeId] = ids as [string];
    await ensureWorktree(tree, activeId);
    const cli = treeyardIn(main);
    const res = await cli('worktree', 'rm', '--done');
    expect(res.code, res.stderr).toBe(0);
    expect(res.stdout).toContain('закрытых узлов с worktree нет');
    expect(existsSync(worktreeFor(main, activeId)!.path)).toBe(true);
  }, 60_000);
});

describe('treeyard set status=done worktree cleanup hint', () => {
  it('hints treeyard worktree rm <id> only for merged clean worktrees when actually closed', async () => {
    const { tree, main, ids } = repo(['Влитый', 'Второй влитый', 'Грязный', 'Невлитый', 'Без worktree']);
    const [mergedA, mergedB, dirtyId, unmergedId, plainId] = ids as [string, string, string, string, string];

    const wtA = (await ensureWorktree(tree, mergedA)).worktree;
    const wtB = (await ensureWorktree(tree, mergedB)).worktree;
    const wtDirty = (await ensureWorktree(tree, dirtyId)).worktree;
    const wtUnmerged = (await ensureWorktree(tree, unmergedId)).worktree;

    commitIn(wtA.dir, 'merged.txt');
    git(main, 'merge', '-q', '--no-ff', '-m', 'merge a', wtA.branch);
    writeFileSync(join(wtDirty.dir, 'wip.txt'), 'wip\n');
    commitIn(wtUnmerged.dir, 'unmerged.txt');

    const cli = treeyardIn(main);

    // Agent calling status=done (demoted to review) does NOT get the cleanup hint.
    const demoted = await cli('set', mergedA, 'status=done');
    expect(demoted.code, demoted.stderr).toBe(0);
    expect(demoted.stdout).not.toContain('treeyard worktree rm');

    // Person closing merged + clean node gets the hint (RU).
    const closedA = await cli('set', mergedA, 'status=done', '--as', 'ты');
    expect(closedA.code, closedA.stderr).toBe(0);
    expect(closedA.stdout).toContain(`treeyard worktree rm ${mergedA}`);

    // Person closing merged + clean node in EN gets the English hint.
    const closedBEn = await treeyardIn(main, { TREEYARD_LANG: 'en' })('set', mergedB, 'status=done', '--as', 'you');
    expect(closedBEn.code, closedBEn.stderr).toBe(0);
    expect(closedBEn.stdout).toContain(`worktree is merged and clean — remove: treeyard worktree rm ${mergedB}`);

    // Several nodes closed together hint all clean merged ids in one command.
    const closedBoth = await cli('set', mergedA, mergedB, 'status=done', '--as', 'ты');
    expect(closedBoth.code, closedBoth.stderr).toBe(0);
    expect(closedBoth.stdout).toContain(`treeyard worktree rm ${mergedA} ${mergedB}`);

    // Dirty, unmerged, or no-worktree nodes get NO hint.
    for (const id of [dirtyId, unmergedId, plainId]) {
      const res = await cli('set', id, 'status=done', '--as', 'ты');
      expect(res.code, res.stderr).toBe(0);
      expect(res.stdout).not.toContain('treeyard worktree rm');
    }

    // Worktrees were only hinted, not removed automatically.
    expect(existsSync(wtA.path)).toBe(true);
    expect(existsSync(wtB.path)).toBe(true);
  }, 90_000);
});

describe('treeyard worktree --help', () => {
  it('documents multi-id rm, --done and --dry-run in both languages', async () => {
    const dir = emptyTree().project.dir;
    const ru = await treeyardIn(dir, { TREEYARD_LANG: 'ru' })('worktree', '--help');
    expect(ru.code, ru.stderr).toBe(0);
    expect(ru.stdout).toContain('treeyard worktree rm <id>…|--done [--dry-run] [--json]');
    expect(ru.stdout).toContain('--done');
    expect(ru.stdout).toContain('--dry-run');

    const en = await treeyardIn(dir, { TREEYARD_LANG: 'en' })('worktree', '--help');
    expect(en.code, en.stderr).toBe(0);
    expect(en.stdout).toContain('treeyard worktree rm <id>…|--done [--dry-run] [--json]');
    expect(en.stdout).toContain('--done');
    expect(en.stdout).toContain('--dry-run');
  }, 40_000);
});

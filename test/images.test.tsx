import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { cleanup, render } from 'ink-testing-library';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { contextText } from '../src/agents/context.js';
import {
  addImage,
  daysLeft,
  droppedPath,
  imagePath,
  imagesDir,
  KEEP_DAYS,
  listImages,
  purgeImages,
  removeImage,
  setImageNote,
} from '../src/model/images.js';
import { journalEntries } from '../src/model/journal.js';
import { NODE_VAR } from '../src/model/notes.js';
import { addNode, deleteNode, setStatus } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { DEFAULTS, resetSettings } from '../src/settings.js';
import { fitCells, halfBlocks } from '../src/tui/image-view.js';
import { appleTerminal, attachFromClipboard, ImagesDialog } from '../src/tui/images-dialog.js';
import { snapshot } from '../src/tui/snapshot.js';
import { emptyTree, tempDir } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;
const pause = (ms = 50) => new Promise((done) => setTimeout(done, ms));

/** A PNG `width × height`, each pixel from `color(x, y)` as [r, g, b, a]. */
function png(width: number, height: number, color: (x: number, y: number) => number[]): Buffer {
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = color(x, y);
      image.data.set([r!, g!, b!, a], (y * width + x) * 4);
    }
  }
  return PNG.sync.write(image);
}
const RED_OVER_BLUE = png(2, 2, (_x, y) => (y === 0 ? [255, 0, 0] : [0, 0, 255]));

beforeEach(() => {
  process.env.TREEYARD_HOME = tempDir('treeyard-home-');
  resetSettings({ ...DEFAULTS });
});

afterEach(() => {
  cleanup();
  resetSettings({ ...DEFAULTS });
});

describe('node pictures', () => {
  it('attaches PNG bytes and files, captions and removes them, out of git', () => {
    const tree = emptyTree();
    const { dir } = tree.project;
    const node = addNode(tree, { title: 'Экран входа' });
    const first = addImage(dir, node.id, RED_OVER_BLUE, '  кнопка съехала ');
    expect(first).toMatchObject({ file: '001.png', note: 'кнопка съехала' });
    const file = join(tempDir(), 'макет.png');
    writeFileSync(file, RED_OVER_BLUE);
    expect(addImage(dir, node.id, file).file).toBe('002.png');
    expect(imagesDir(dir, node.id)).toContain(join('.tree', '.local', 'images', node.id));

    setImageNote(dir, node.id, '002.png', 'так надо');
    expect(listImages(dir, node.id).map((image) => [image.file, image.note])).toEqual([
      ['001.png', 'кнопка съехала'],
      ['002.png', 'так надо'],
    ]);
    setImageNote(dir, node.id, '002.png', ' ');
    expect(listImages(dir, node.id)[1]!.note).toBeUndefined();

    removeImage(dir, node.id, '001.png');
    // Numbers are not reused: a caption in the journal keeps meaning one picture.
    expect(addImage(dir, node.id, RED_OVER_BLUE).file).toBe('003.png');
    removeImage(dir, node.id, '002.png');
    removeImage(dir, node.id, '003.png');
    expect(existsSync(imagesDir(dir, node.id))).toBe(false);
  });

  it('refuses what is not a picture and forgets a file deleted by hand', () => {
    const tree = emptyTree();
    const { dir } = tree.project;
    const node = addNode(tree, { title: 'Узел' });
    expect(() => addImage(dir, node.id, Buffer.from('hello'))).toThrow('PNG');
    const text = join(tempDir(), 'notes.txt');
    writeFileSync(text, 'hello');
    expect(() => addImage(dir, node.id, text)).toThrow('PNG');
    expect(() => addImage(dir, node.id, join(dir, 'нет.png'))).toThrow('нет файла');
    const image = addImage(dir, node.id, RED_OVER_BLUE);
    expect(listImages(dir, node.id)).toHaveLength(1);
    rmSync(imagePath(dir, node.id, image.file));
    expect(listImages(dir, node.id)).toEqual([]);
  });

  it('keeps pictures a week after done or dropped, and a week after the node is gone', () => {
    const tree = emptyTree();
    const { dir } = tree.project;
    const open = addNode(tree, { title: 'Открыт' });
    const done = addNode(tree, { title: 'Готов' });
    const gone = addNode(tree, { title: 'Удалят' });
    for (const node of [open, done, gone]) addImage(dir, node.id, RED_OVER_BLUE);
    setStatus(tree, done.id, 'done');
    const closed = Date.parse(tree.nodes.get(done.id)!.closed!);
    expect(daysLeft(tree.nodes.get(done.id)!, closed + 2 * DAY)).toBe(KEEP_DAYS - 2);
    expect(daysLeft(open)).toBeUndefined();

    expect(purgeImages(loadTree(dir), closed + 3 * DAY)).toEqual([]);
    // Undo puts the node back as it was: open again, its pictures are still there.
    setStatus(tree, done.id, 'active');
    expect(purgeImages(loadTree(dir), closed + 30 * DAY)).toEqual([]);
    setStatus(tree, done.id, 'done');
    expect(purgeImages(loadTree(dir), closed + (KEEP_DAYS + 1) * DAY)).toEqual([done.id]);

    deleteNode(tree, gone.id);
    const now = Date.now();
    expect(purgeImages(loadTree(dir), now)).toEqual([]);
    expect(purgeImages(loadTree(dir), now + 2 * DAY)).toEqual([]);
    expect(purgeImages(loadTree(dir), now + KEEP_DAYS * DAY)).toEqual([gone.id]);
    expect(listImages(dir, open.id)).toHaveLength(1);
  });

  it('reads a path dropped into the terminal, escaped or quoted', () => {
    const folder = tempDir();
    const file = join(folder, 'my shot.png');
    writeFileSync(file, RED_OVER_BLUE);
    expect(droppedPath(file.replaceAll(' ', '\\ '))).toBe(file);
    expect(droppedPath(`'${file}' `)).toBe(file);
    expect(droppedPath(`file://${encodeURI(file)}`)).toBe(file);
    expect(droppedPath('просто текст')).toBeUndefined();
    expect(droppedPath(join(folder, 'нет.png'))).toBeUndefined();
    writeFileSync(join(folder, 'a.txt'), 'x');
    expect(droppedPath(join(folder, 'a.txt'))).toBeUndefined();
  });
});

describe('pictures in text', () => {
  it('fits a picture into cells with square pixels', () => {
    expect(fitCells(200, 100, 40, 40)).toEqual({ cols: 40, rows: 10 });
    expect(fitCells(100, 400, 40, 10)).toEqual({ cols: 5, rows: 10 });
  });

  it('draws the upper pixel as the glyph and the lower as its background', () => {
    const decoded = PNG.sync.read(RED_OVER_BLUE);
    expect(halfBlocks(decoded, 1, 1)).toEqual(['\u001b[38;2;255;0;0;48;2;0;0;255m▀\u001b[39;49m']);
    const clear = PNG.sync.read(png(1, 2, (_x, y) => (y === 0 ? [0, 255, 0] : [0, 0, 0, 0])));
    expect(halfBlocks(clear, 1, 1)).toEqual(['\u001b[38;2;0;255;0m▀\u001b[39m']);
  });
});

describe('pictures in the TUI and for agents', () => {
  it('shows a thumbnail with its name and caption in the details', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Экран входа' });
    addImage(
      tree.project.dir,
      node.id,
      png(40, 20, (x) => [x * 6, 100, 200]),
      'кнопка съехала',
    );
    const frame = await snapshot(tree.project.dir, { columns: 130, rows: 36, ui: { inspector: true } });
    expect(frame).toContain('КАРТИНКИ · 1');
    expect(frame).toContain('001.png');
    expect(frame).toContain('кнопка съехала');
    expect(frame).toContain('▀');
  });

  it('gives the agent the paths and captions', () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Экран входа' });
    addImage(tree.project.dir, node.id, RED_OVER_BLUE, 'кнопка съехала');
    const text = contextText(tree, node.id);
    expect(text).toContain(`\`${imagePath(tree.project.dir, node.id, '001.png')}\` — кнопка съехала`);
    expect(text).toContain(`image ${node.id}`);
    expect(contextText(tree, addNode(tree, { title: 'Пусто' }).id)).not.toContain('Картинки узла');
  });

  it('pastes from the clipboard, captions and deletes in the dialog', async () => {
    const tree = emptyTree();
    const { dir } = tree.project;
    const node = addNode(tree, { title: 'Экран входа' });
    expect(attachFromClipboard(dir, node.id, () => undefined).error).toContain('в буфере нет картинки');
    expect(attachFromClipboard(dir, node.id, () => ({ kind: 'png', data: RED_OVER_BLUE })).image?.file).toBe('001.png');
    const changes: (string | undefined)[] = [];
    const view = render(
      <ImagesDialog
        dir={dir}
        node={node}
        width={100}
        height={30}
        onChange={(journal) => changes.push(journal)}
        onError={() => undefined}
        onClose={() => undefined}
        external={false}
      />,
    );
    await pause();
    expect(view.lastFrame()).toContain('001.png');
    view.stdin.write('n');
    await pause();
    view.stdin.write('кнопка съехала');
    await pause();
    view.stdin.write('\r');
    await pause();
    expect(listImages(dir, node.id)[0]!.note).toBe('кнопка съехала');
    expect(changes).toEqual(['подпись к 001.png: кнопка съехала']);
    view.stdin.write('\r');
    await pause();
    expect(view.lastFrame()).toContain('к списку');
    view.stdin.write('\u001b');
    await pause(80);
    view.stdin.write('D');
    await pause();
    expect(view.lastFrame()).toContain('Удалить 001.png?');
    view.stdin.write('y');
    await pause();
    expect(listImages(dir, node.id)).toEqual([]);
    expect(view.lastFrame()).toContain('Картинок пока нет');
  });
});

describe('pictures in Apple Terminal', () => {
  it('knows Apple Terminal, which can draw no pixels', () => {
    expect(appleTerminal({ TERM_PROGRAM: 'Apple_Terminal' })).toBe(true);
    expect(appleTerminal({ TERM_PROGRAM: 'iTerm.app' })).toBe(false);
    expect(appleTerminal({ TERM_PROGRAM: 'tmux' })).toBe(false);
  });

  it('offers the full-size picture on ⏎ instead of the mosaic', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Экран входа' });
    addImage(tree.project.dir, node.id, RED_OVER_BLUE);
    const props = {
      dir: tree.project.dir,
      node,
      width: 100,
      height: 30,
      onChange: () => undefined,
      onError: () => undefined,
      onClose: () => undefined,
    };
    const apple = render(<ImagesDialog {...props} external />);
    await pause();
    expect(apple.lastFrame()).toContain('открыть в полном размере');
    apple.unmount();
    const other = render(<ImagesDialog {...props} external={false} />);
    await pause();
    expect(other.lastFrame()).toContain('на весь экран');
    expect(other.lastFrame()).toContain('o в полном размере');
  });
});

describe('treeyard image', () => {
  const run = promisify(execFile);
  const cli = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url));
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

  it('attaches, captions, lists and removes, writing the journal', async () => {
    const tree = emptyTree();
    const { dir } = tree.project;
    const node = addNode(tree, { title: 'Экран входа' });
    const file = join(dir, 'shot.png');
    writeFileSync(file, RED_OVER_BLUE);
    mkdirSync(join(dir, 'sub'));
    const env: NodeJS.ProcessEnv = { ...process.env, TREEYARD_LANG: '', NO_COLOR: '1' };
    delete env[NODE_VAR];
    delete env.FORCE_COLOR;
    const treeyard = (...args: string[]) =>
      run(process.execPath, ['--import', tsx, cli, 'image', ...args], { cwd: join(dir, 'sub'), env, timeout: 30_000 });

    const added = await treeyard(node.id, file, '--note', 'кнопка съехала', '--as', 'claude');
    // The command finds the tree by its real path: /var is /private/var on macOS.
    expect(added.stdout.trim()).toMatch(/\/\.tree\/\.local\/images\/\w+\/001\.png — кнопка съехала$/);
    expect(added.stdout).toContain(join(node.id, '001.png'));
    await treeyard(node.id, '001.png', '--note', 'кнопка на месте');
    expect((await treeyard(node.id)).stdout).toContain('— кнопка на месте');
    await treeyard(node.id, '--rm', '001.png');
    expect((await treeyard(node.id)).stdout).toContain('картинок нет');
    const journal = journalEntries(readFileSync(join(dir, '.tree', 'nodes', `${node.id}.md`), 'utf8')).join('\n');
    expect(journal).toContain('claude · картинка добавлена: 001.png — кнопка съехала');
    expect(journal).toContain('подпись к 001.png: кнопка на месте');
    expect(journal).toContain('картинка удалена: 001.png');
  });
});

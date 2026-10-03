/**
 * Pictures of a node: screenshots, mockups — pasted from the clipboard or
 * dropped in as a file. They live next to the tree but out of git, in
 * `.tree/.local/images/<id>/`: a screenshot in git stays in its history for
 * good, and these are working material, not the record.
 *
 * A picture is kept while its node is open. When the node is done or dropped
 * the pictures stay for a week — undo brings the node back with them — and
 * then go. The same week is given to a node whose file is gone.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { t } from '../i18n/i18n.js';
import { atomicWrite, TREE_DIR } from './store.js';
import { nowIso } from './time.js';
import type { Tree, TreeNode } from './types.js';

export interface NodeImage {
  /** The file name inside the node's folder: `001.png`. */
  file: string;
  /** A caption: what to look at. */
  note?: string;
  /** ISO time. */
  added: string;
}

interface Index {
  images: NodeImage[];
  /** ISO time the node's file was first found gone: the week starts here. */
  gone?: string;
}

/** Days pictures outlive their node: done, dropped or deleted. */
export const KEEP_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** What `sips` on macOS turns into PNG. */
const CONVERTIBLE = new Set(['.jpg', '.jpeg', '.heic', '.heif', '.tif', '.tiff', '.gif', '.bmp', '.webp']);
export const IMAGE_EXTENSIONS = new Set(['.png', ...CONVERTIBLE]);

export function imagesRoot(dir: string): string {
  return join(dir, TREE_DIR, '.local', 'images');
}

export function imagesDir(dir: string, id: string): string {
  return join(imagesRoot(dir), id);
}

export function imagePath(dir: string, id: string, file: string): string {
  return join(imagesDir(dir, id), file);
}

function readIndex(dir: string, id: string): Index {
  try {
    const parsed = JSON.parse(readFileSync(join(imagesDir(dir, id), 'index.json'), 'utf8')) as Partial<Index>;
    return { images: Array.isArray(parsed.images) ? parsed.images : [], gone: parsed.gone };
  } catch {
    return { images: [] };
  }
}

function writeIndex(dir: string, id: string, index: Index): void {
  mkdirSync(imagesDir(dir, id), { recursive: true });
  atomicWrite(join(imagesDir(dir, id), 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
}

/** The node's pictures, oldest first; a file deleted by hand drops out. */
export function listImages(dir: string, id: string): NodeImage[] {
  return readIndex(dir, id).images.filter((image) => existsSync(imagePath(dir, id, image.file)));
}

export function isPng(data: Buffer): boolean {
  return data.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC);
}

/** A file that could be a picture, judging by its name: for paths dropped into the terminal. */
export function looksLikeImage(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(path).toLowerCase());
}

function nextName(dir: string, id: string): string {
  let top = 0;
  try {
    for (const name of readdirSync(imagesDir(dir, id))) {
      const number = Number.parseInt(name, 10);
      if (Number.isFinite(number)) top = Math.max(top, number);
    }
  } catch {
    // No folder yet.
  }
  return `${String(top + 1).padStart(3, '0')}.png`;
}

/**
 * Attaches a picture: PNG bytes, or a file. Everything is kept as PNG, so one
 * decoder shows them all; other formats are converted by `sips` on macOS.
 */
export function addImage(dir: string, id: string, source: Buffer | string, note?: string): NodeImage {
  const file = nextName(dir, id);
  const target = imagePath(dir, id, file);
  mkdirSync(imagesDir(dir, id), { recursive: true });
  if (typeof source !== 'string') {
    if (!isPng(source)) throw new Error(t('это не PNG'));
    writeFileSync(target, source);
  } else {
    const path = resolve(source);
    if (!existsSync(path)) throw new Error(t('нет файла {path}', { path }));
    const head = readFileSync(path).subarray(0, PNG_MAGIC.length);
    if (isPng(head)) copyFileSync(path, target);
    else convertToPng(path, target);
  }
  const image: NodeImage = { file, added: nowIso() };
  if (note?.trim()) image.note = note.trim();
  const index = readIndex(dir, id);
  index.images.push(image);
  writeIndex(dir, id, index);
  return image;
}

function convertToPng(path: string, target: string): void {
  if (process.platform !== 'darwin' || !CONVERTIBLE.has(extname(path).toLowerCase())) {
    throw new Error(t('картинка должна быть PNG: {path}', { path }));
  }
  const result = spawnSync('sips', ['-s', 'format', 'png', path, '--out', target], { encoding: 'utf8' });
  if (result.status !== 0 || !existsSync(target)) {
    rmSync(target, { force: true });
    throw new Error(t('не получилось перевести в PNG: {path}', { path }));
  }
}

export function setImageNote(dir: string, id: string, file: string, note: string): NodeImage {
  const index = readIndex(dir, id);
  const image = index.images.find((item) => item.file === file);
  if (!image) throw new Error(t('нет картинки {file}', { file }));
  if (note.trim()) image.note = note.trim();
  else delete image.note;
  writeIndex(dir, id, index);
  return image;
}

export function removeImage(dir: string, id: string, file: string): void {
  const index = readIndex(dir, id);
  index.images = index.images.filter((item) => item.file !== file);
  rmSync(imagePath(dir, id, file), { force: true });
  if (index.images.length === 0) rmSync(imagesDir(dir, id), { recursive: true, force: true });
  else writeIndex(dir, id, index);
}

/** Days left before a closed node's pictures go; undefined while the node is open. */
export function daysLeft(node: TreeNode, now = Date.now()): number | undefined {
  if (!node.closed || (node.status !== 'done' && node.status !== 'dropped')) return undefined;
  const since = (now - Date.parse(node.closed)) / DAY;
  return Math.max(0, Math.ceil(KEEP_DAYS - since));
}

/**
 * Removes pictures whose week is over: of nodes done or dropped more than
 * `KEEP_DAYS` ago, and of nodes gone that long. Cheap: one folder listing.
 */
export function purgeImages(tree: Tree, now = Date.now()): string[] {
  const { dir } = tree.project;
  let ids: string[] = [];
  try {
    ids = readdirSync(imagesRoot(dir));
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const id of ids) {
    const node = tree.nodes.get(id);
    const index = readIndex(dir, id);
    let expired = false;
    if (node) {
      expired = daysLeft(node, now) === 0;
      if (index.gone) {
        delete index.gone;
        writeIndex(dir, id, index);
      }
    } else if (!index.gone) {
      index.gone = new Date(now).toISOString();
      writeIndex(dir, id, index);
    } else expired = now - Date.parse(index.gone) >= KEEP_DAYS * DAY;
    if (expired) {
      rmSync(imagesDir(dir, id), { recursive: true, force: true });
      removed.push(id);
    }
  }
  return removed;
}

/** A path dropped into the terminal: quoted, or with spaces escaped by a backslash. */
export function droppedPath(text: string): string | undefined {
  let path = text.trim();
  if (!path || path.includes('\n')) return undefined;
  if (/^(['"]).*\1$/.test(path)) path = path.slice(1, -1);
  else path = path.replace(/\\(.)/g, '$1');
  if (path.startsWith('file://')) path = decodeURIComponent(path.slice('file://'.length));
  if (path.startsWith('~/')) path = join(process.env.HOME ?? '', path.slice(2));
  return looksLikeImage(path) && existsSync(path) ? path : undefined;
}

/** A scratch file for a picture on its way into a node. */
export function scratchFile(name: string): string {
  return join(tmpdir(), `treeyard-${process.pid}-${Date.now()}-${name}`);
}

/**
 * «Картинки узла»: the list with a preview beside it, one picture on the
 * whole screen, a caption. A screenshot comes from the clipboard (`v`) or as
 * a file dropped into the terminal — the terminal pastes its path.
 */
import { spawn, spawnSync } from 'node:child_process';
import { Box, Text, useInput, usePaste } from 'ink';
import { useState } from 'react';
import { t } from '../i18n/i18n.js';
import { type ClipboardImage, clipboardImage, forgetClipboard } from '../model/clipboard.js';
import {
  addImage,
  droppedPath,
  imagePath,
  listImages,
  type NodeImage,
  removeImage,
  setImageNote,
} from '../model/images.js';
import type { TreeNode } from '../model/types.js';
import { Frame, type KeyHint, TextField } from './components/controls.js';
import { Picture, pictureSize } from './image-view.js';
import { shortcutKey } from './keys.js';
import { C } from './theme.js';

/** Attaches what the clipboard holds; a message for the person either way. */
export function attachFromClipboard(
  dir: string,
  id: string,
  read: () => ClipboardImage | undefined = clipboardImage,
): { image?: NodeImage; error?: string } {
  const found = read();
  if (!found) return { error: t('в буфере нет картинки — скопируй скрин (⌘⇧⌃4) или перетащи файл в окно') };
  try {
    return { image: addImage(dir, id, found.kind === 'png' ? found.data : found.path) };
  } catch (error) {
    return { error: (error as Error).message };
  } finally {
    forgetClipboard(found);
  }
}

/** The journal line for a new picture. */
function added(image: NodeImage): string {
  return t('картинка добавлена: {file}', { file: image.file }) + (image.note ? ` — ${image.note}` : '');
}

/**
 * Apple Terminal has no way to draw pixels: a screenshot there is a mosaic.
 * Under tmux the outer terminal is known from tmux's global environment.
 */
export function appleTerminal(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.TERM_PROGRAM === 'Apple_Terminal') return true;
  if (env.TERM_PROGRAM !== 'tmux' || !env.TMUX) return false;
  const outer = spawnSync('tmux', ['show-environment', '-g', 'TERM_PROGRAM'], { encoding: 'utf8' });
  return outer.status === 0 && outer.stdout.trim() === 'TERM_PROGRAM=Apple_Terminal';
}

/** Opens a picture full size in the system viewer (Preview on a Mac); the TUI stays where it is. */
export function openPicture(path: string): string | undefined {
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  try {
    const child = spawn(command, [path], { detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
}

type Mode = 'list' | 'full' | 'note' | 'delete';

export function ImagesDialog(props: {
  dir: string;
  node: TreeNode;
  width: number;
  height: number;
  /** Tried once when the dialog opens on a node with no pictures. */
  pasteOnOpen?: boolean;
  /** A line for the node's journal and a message: something was added, captioned or removed. */
  onChange: (journal: string | undefined, message: string) => void;
  onError: (message: string) => void;
  onClose: () => void;
  /** ⏎ opens the system viewer instead of the full-screen mosaic; found out from the terminal when not given. */
  external?: boolean;
}) {
  const { dir, node } = props;
  const [images, setImages] = useState(() => {
    if (props.pasteOnOpen && listImages(dir, node.id).length === 0) {
      const { image } = attachFromClipboard(dir, node.id, clipboardImage);
      if (image) queueMicrotask(() => props.onChange(added(image), t('картинка из буфера добавлена')));
    }
    return listImages(dir, node.id);
  });
  const [cursor, setCursor] = useState(Math.max(0, images.length - 1));
  const [mode, setMode] = useState<Mode>('list');
  // Where a mosaic is all the terminal can do, ⏎ shows the real picture instead.
  const [external] = useState(() => props.external ?? appleTerminal());
  const [note, setNote] = useState('');
  const current = images[Math.min(cursor, images.length - 1)];
  const refresh = (select?: string) => {
    const list = listImages(dir, node.id);
    setImages(list);
    const at = select ? list.findIndex((image) => image.file === select) : -1;
    setCursor(at >= 0 ? at : Math.max(0, Math.min(cursor, list.length - 1)));
  };
  const paste = () => {
    const { image, error } = attachFromClipboard(dir, node.id);
    if (error) return props.onError(error);
    refresh(image!.file);
    props.onChange(added(image!), t('картинка из буфера добавлена'));
  };

  usePaste(
    (text) => {
      const path = droppedPath(text);
      if (!path) return props.onError(t('это не путь к картинке: перетащи файл PNG, JPG или HEIC'));
      try {
        const image = addImage(dir, node.id, path);
        refresh(image.file);
        props.onChange(added(image), t('картинка добавлена: {file}', { file: image.file }));
      } catch (error) {
        props.onError((error as Error).message);
      }
    },
    { isActive: mode !== 'note' },
  );

  useInput((raw, key) => {
    const input = shortcutKey(raw);
    if (mode === 'note') {
      if (key.escape) return setMode('list');
      if (key.return && current) {
        setImageNote(dir, node.id, current.file, note);
        refresh(current.file);
        setMode('list');
        return props.onChange(
          note.trim() ? t('подпись к {file}: {note}', { file: current.file, note: note.trim() }) : undefined,
          note.trim() ? t('подпись сохранена') : t('подпись убрана'),
        );
      }
      return;
    }
    if (mode === 'delete') {
      if ((input === 'y' || key.return) && current) {
        removeImage(dir, node.id, current.file);
        refresh();
        setMode('list');
        return props.onChange(
          t('картинка удалена: {file}', { file: current.file }),
          t('удалена {file}', { file: current.file }),
        );
      }
      return setMode('list');
    }
    if (key.escape || (input === 'q' && mode === 'list')) return mode === 'full' ? setMode('list') : props.onClose();
    if (input === 'v') return paste();
    if (!current) return;
    const step = (by: number) => setCursor((at) => Math.max(0, Math.min(images.length - 1, at + by)));
    if (key.upArrow || key.leftArrow || input === 'k' || input === 'h') return step(-1);
    if (key.downArrow || key.rightArrow || input === 'j' || input === 'l') return step(1);
    const show = () => {
      const error = openPicture(imagePath(dir, node.id, current.file));
      if (error) props.onError(error);
      else props.onChange(undefined, t('{file} открыта в полном размере', { file: current.file }));
    };
    if (input === 'o') return show();
    if (key.return && mode === 'list' && external) return show();
    if (key.return && mode === 'list') return setMode('full');
    if (key.return) return setMode('list');
    if (input === 'n') {
      setNote(current.note ?? '');
      return setMode('note');
    }
    if (input === 'D') return setMode('delete');
  });

  const inner = props.width - 4;
  // The frame: borders, title, footer and their gaps.
  const room = Math.max(4, props.height - 8);
  const footer: KeyHint[] =
    mode === 'note'
      ? [
          { key: '⏎', label: t('сохранить') },
          { key: 'esc', label: t('отмена') },
        ]
      : mode === 'delete'
        ? [
            { key: 'y', label: t('удалить') },
            { key: 'esc', label: t('оставить') },
          ]
        : [
            { key: 'v', label: t('из буфера') },
            ...(current
              ? [
                  // In Apple Terminal ⏎ does what o does: both are shown, so o is not a secret there.
                  external
                    ? { key: '⏎ o', label: t('открыть в полном размере'), press: 'o' }
                    : { key: '⏎', label: mode === 'full' ? t('к списку') : t('на весь экран'), press: '\r' },
                  ...(external ? [] : [{ key: 'o', label: t('в полном размере'), press: 'o' }]),
                  { key: '←→', label: t('листать') },
                  { key: 'n', label: t('подпись') },
                  { key: 'D', label: t('удалить') },
                ]
              : []),
            { key: 'esc', label: mode === 'full' ? t('к списку') : t('закрыть') },
            { label: t('или перетащи файл в окно') },
          ];
  const title = t('Картинки · {title}', { title: node.title });

  if (!current) {
    return (
      <Frame title={title} width={props.width} footer={footer}>
        <Text color={C.faint}>{t('Картинок пока нет.')}</Text>
        <Text color={C.dim}>
          {t('Скопируй скрин (⌘⇧⌃4 на Mac) и нажми v — или перетащи файл картинки в это окно.')}
        </Text>
        <Text color={C.dim}>
          {t('Картинки живут в .tree/.local/ (не в git) и уходят через неделю после «готово».')}
        </Text>
      </Frame>
    );
  }

  const path = imagePath(dir, node.id, current.file);
  const size = pictureSize(path);
  const captionLine = (
    <Text wrap="truncate-end">
      <Text color={C.accent}>{current.file}</Text>
      {size ? <Text color={C.faint}> · {`${size.width}×${size.height}`}</Text> : null}
      <Text color={C.faint}> · {`${cursor + 1}/${images.length}`}</Text>
      {current.note ? <Text color={C.text}> · {current.note}</Text> : null}
    </Text>
  );
  const bottom =
    mode === 'note' ? (
      <Box>
        <Text color={C.dim}>{t('подпись: ')}</Text>
        <TextField value={note} onChange={setNote} active width={inner - 10} placeholder={t('что здесь видно')} />
      </Box>
    ) : mode === 'delete' ? (
      <Text color={C.bad}>{t('Удалить {file}? Файл уйдёт насовсем.', { file: current.file })}</Text>
    ) : (
      captionLine
    );

  if (mode === 'full' || inner < 60) {
    return (
      <Frame title={title} width={props.width} footer={footer}>
        <Picture path={path} cols={inner} rows={room - 1} center />
        {bottom}
      </Frame>
    );
  }

  const listWidth = Math.min(36, Math.floor(inner * 0.4));
  const top = Math.max(0, Math.min(cursor - Math.floor(room / 4), images.length - Math.floor(room / 2)));
  const visible = images.slice(top, top + Math.max(1, Math.floor(room / 2)));
  return (
    <Frame title={title} width={props.width} footer={footer}>
      <Box height={room - 1}>
        <Box flexDirection="column" width={listWidth} marginRight={2}>
          {visible.map((image, offset) => {
            const selected = top + offset === cursor;
            return (
              <Box key={image.file} flexDirection="column">
                <Text color={selected ? C.brand : C.accent} bold={selected} wrap="truncate-end">
                  {selected ? '› ' : '  '}
                  {image.file}
                </Text>
                <Text color={image.note ? C.dim : C.faint} wrap="truncate-end">
                  {'  '}
                  {image.note ?? t('без подписи — n')}
                </Text>
              </Box>
            );
          })}
        </Box>
        <Picture path={path} cols={inner - listWidth - 2} rows={room - 1} center />
      </Box>
      {bottom}
    </Frame>
  );
}

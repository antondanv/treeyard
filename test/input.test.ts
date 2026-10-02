import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { captureMouse, TerminalInput, TerminalInputDecoder } from '../src/tui/input.js';

describe('terminal input ownership', () => {
  it('separates fragmented wheel reports from keys and ignores releases', () => {
    const decoder = new TerminalInputDecoder();
    expect(decoder.push('hello\u001b[<64;8')).toEqual([{ kind: 'input', data: 'hello', paste: false }]);
    expect(decoder.push('0;10M\u001b[<65;80;10m\u001b[5~')).toEqual([
      { kind: 'mouse', button: 64, x: 79, y: 9, release: false },
      { kind: 'mouse', button: 65, x: 79, y: 9, release: true },
      { kind: 'input', data: '\u001b[5~', paste: false },
    ]);
  });

  it('preserves bracketed paste even when mouse-looking content and delimiters arrive in fragments', () => {
    const decoder = new TerminalInputDecoder();
    const chunks = ['\u001b[20', '0~text\u001b[<64;80;10M\u001b[5~\u001b[20', '1~q'];
    const events = chunks.flatMap((chunk) => decoder.push(chunk));
    expect(events.every((event) => event.kind === 'input')).toBe(true);
    expect(events).toEqual([
      { kind: 'input', data: '\u001b[200~text\u001b[<64;80;10M\u001b[5~', paste: true },
      { kind: 'input', data: '\u001b[201~', paste: true },
      { kind: 'input', data: 'q', paste: false },
    ]);
  });

  it('flushes standalone Escape and drops truncated mouse input', () => {
    const decoder = new TerminalInputDecoder();
    decoder.push('\u001b');
    expect(decoder.flush()).toEqual([{ kind: 'input', data: '\u001b', paste: false }]);
    decoder.push('\u001b[<64;');
    expect(decoder.flush()).toEqual([]);
  });

  it('keeps UTF-8 bytes intact and releases the source without closing it', async () => {
    const source = new PassThrough();
    const raw = vi.fn();
    Object.assign(source, { isTTY: true, setRawMode: raw });
    const input = new TerminalInput(source as unknown as NodeJS.ReadStream);
    input.setEncoding('utf8');
    input.setRawMode(true);
    const keyboard: string[] = [];
    const mouse = vi.fn();
    input.on('data', (data: string) => keyboard.push(data));
    input.on('mouse', mouse);
    const text = Buffer.from('привет');
    source.write(text.subarray(0, 1));
    source.write(text.subarray(1));
    source.write('\u001b[<64;80;10M');
    await new Promise((done) => setTimeout(done, 20));
    expect(keyboard.join('')).toBe('привет');
    expect(mouse).toHaveBeenCalledOnce();
    expect(raw).toHaveBeenCalledWith(true);
    input.destroy();
    expect(source.listenerCount('readable')).toBe(0);
    expect(source.destroyed).toBe(false);
    source.destroy();
  });

  it('captures the wheel for the entire screen and restores mouse modes on exit', () => {
    const write = vi.fn();
    const release = captureMouse({ isTTY: true, write } as unknown as NodeJS.WriteStream);
    expect(write).toHaveBeenCalledWith('\u001b[?1000h\u001b[?1006h');
    release();
    expect(write).toHaveBeenLastCalledWith('\u001b[?1006l\u001b[?1000l');
    write.mockClear();
    captureMouse({ isTTY: false, write } as unknown as NodeJS.WriteStream)();
    expect(write).not.toHaveBeenCalled();
  });
});

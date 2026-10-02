/** Keep terminal mouse reports out of every Ink key handler, including dialogs. */
import { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

export type TerminalInputEvent =
  | { kind: 'input'; data: string; paste: boolean }
  | { kind: 'mouse'; button: number; x: number; y: number; release: boolean };
export type MouseEvent = Extract<TerminalInputEvent, { kind: 'mouse' }>;

const ESC = '\u001b';
const PASTE_START = `${ESC}[200~`;
const PASTE_END = `${ESC}[201~`;

/** Streaming parser: mouse reports and escape sequences may cross read boundaries. */
export class TerminalInputDecoder {
  private pending = '';
  private paste = false;

  get needsFlush(): boolean {
    return !!this.pending && !this.paste;
  }

  push(data: string): TerminalInputEvent[] {
    this.pending += data;
    const events: TerminalInputEvent[] = [];
    const input = (text: string, paste = false) => {
      if (!text) return;
      const last = events.at(-1);
      if (paste && last?.kind === 'input' && last.paste) last.data += text;
      else events.push({ kind: 'input', data: text, paste });
    };
    while (this.pending) {
      if (this.paste) {
        const end = this.pending.indexOf(PASTE_END);
        if (end >= 0) {
          input(this.pending.slice(0, end + PASTE_END.length), true);
          this.pending = this.pending.slice(end + PASTE_END.length);
          this.paste = false;
          continue;
        }
        let keep = 0;
        for (let n = 1; n < PASTE_END.length; n++) {
          if (this.pending.endsWith(PASTE_END.slice(0, n))) keep = n;
        }
        input(this.pending.slice(0, this.pending.length - keep), true);
        this.pending = this.pending.slice(this.pending.length - keep);
        break;
      }
      const at = this.pending.indexOf(ESC);
      if (at < 0) {
        input(this.pending);
        this.pending = '';
        break;
      }
      input(this.pending.slice(0, at));
      this.pending = this.pending.slice(at);
      if (this.pending.length === 1) break;
      let length = 2;
      if (this.pending[1] === '[') {
        // biome-ignore lint/suspicious/noControlCharactersInRegex: parse a complete CSI sequence.
        const csi = /^\u001b\[[0-?]*[ -/]*[@-~]/u.exec(this.pending);
        if (!csi) {
          // Hold a partial CSI, but let malformed escapes through without growing a buffer.
          if (/^[0-?]*[ -/]*$/u.test(this.pending.slice(2)) && this.pending.length < 128) break;
        } else length = csi[0].length;
      } else if (this.pending[1] === 'O') {
        if (this.pending.length < 3) break;
        length = 3;
      }
      const sequence = this.pending.slice(0, length);
      this.pending = this.pending.slice(length);
      // biome-ignore lint/suspicious/noControlCharactersInRegex: SGR mouse coordinates are one-based.
      const mouse = /^\u001b\[<(\d+);(\d+);(\d+)([Mm])$/u.exec(sequence);
      if (mouse) {
        events.push({
          kind: 'mouse',
          button: Number(mouse[1]),
          x: Number(mouse[2]) - 1,
          y: Number(mouse[3]) - 1,
          release: mouse[4] === 'm',
        });
      } else {
        if (sequence === PASTE_START) this.paste = true;
        input(sequence, this.paste);
      }
    }
    return events;
  }

  flush(): TerminalInputEvent[] {
    const data = this.pending;
    this.pending = '';
    // An incomplete mouse report must never become text in a prompt.
    return data && !data.startsWith(`${ESC}[<`) ? [{ kind: 'input', data, paste: this.paste }] : [];
  }
}

/** Ink reads keyboard bytes here; pane input and mouse events retain their boundaries. */
export class TerminalInput extends Readable {
  readonly isTTY: boolean;
  private readonly decoder = new TerminalInputDecoder();
  private readonly utf8 = new StringDecoder('utf8');
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly source: NodeJS.ReadStream) {
    super();
    this.isTTY = !!source.isTTY;
    source.on('readable', this.readSource);
  }

  override _read(): void {}

  setRawMode(enabled: boolean): this {
    this.source.setRawMode?.(enabled);
    return this;
  }

  ref(): this {
    this.source.ref?.();
    return this;
  }

  unref(): this {
    this.source.unref?.();
    return this;
  }

  override _destroy(error: Error | null, done: (error?: Error | null) => void): void {
    this.source.off('readable', this.readSource);
    clearTimeout(this.timer);
    done(error);
  }

  /** A click on a key hint: the key arrives exactly as if it were typed. */
  press(data: string): void {
    this.deliver([{ kind: 'input', data, paste: false }]);
  }

  private deliver(events: TerminalInputEvent[]): void {
    for (const event of events) {
      if (event.kind === 'mouse') this.emit('mouse', event);
      else {
        this.emit('terminal-input', event);
        this.push(event.data);
      }
    }
  }

  private readSource = (): void => {
    clearTimeout(this.timer);
    let chunk: Buffer | string | null = this.source.read();
    while (chunk !== null) {
      this.deliver(this.decoder.push(typeof chunk === 'string' ? chunk : this.utf8.write(chunk)));
      chunk = this.source.read();
    }
    if (this.decoder.needsFlush) this.timer = setTimeout(() => this.deliver(this.decoder.flush()), 30);
  };
}

/** The alternate screen belongs to Ink; mouse ownership prevents host scrollback on wheel input. */
export function captureMouse(stdout: NodeJS.WriteStream): () => void {
  if (!stdout.isTTY) return () => {};
  stdout.write(`${ESC}[?1000h${ESC}[?1006h`);
  return () => stdout.write(`${ESC}[?1006l${ESC}[?1000l`);
}

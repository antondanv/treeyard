import { EventEmitter } from 'node:events';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';

const [mode, dir, selected] = process.argv.slice(2);
process.argv = [process.execPath, 'treeyard', '--version'];

// Exercise the real entry before importing anything that can load React.
await import('../../src/cli/main.js');
const { default: React } = await import('react');
const { ownNodeEnv } = await import('../../src/node-env.js');
const startup = {
  nodeEnv: process.env.NODE_ENV,
  ownNodeEnv: ownNodeEnv(),
  developmentReact: '_store' in React.createElement('test'),
};

if (mode === 'startup') {
  process.stdout.write(`${JSON.stringify(startup)}\n`);
} else {
  if (!dir || !selected || !global.gc) throw new Error('A tree, selection and --expose-gc are required');
  const { render } = await import('ink');
  const { App } = await import('../../src/tui/App.js');
  const { defaultUi, loadUi } = await import('../../src/tui/ui-state.js');
  const { DEFAULTS, resetSettings } = await import('../../src/settings.js');
  const { loadTree } = await import('../../src/model/store.js');
  const { TerminalInput } = await import('../../src/tui/input.js');

  class Output extends Writable {
    readonly isTTY = true;
    readonly columns = 100;
    readonly rows = 30;
    writes = 0;
    override _write(_chunk: Buffer, _encoding: BufferEncoding, done: () => void) {
      this.writes++;
      done();
    }
  }

  class Input extends EventEmitter {
    readonly isTTY = true;
    data: string | null = null;
    setEncoding() {}
    setRawMode() {}
    resume() {}
    pause() {}
    ref() {}
    unref() {}
    read() {
      const data = this.data;
      this.data = null;
      return data;
    }
    write(data: string) {
      this.data = data;
      this.emit('readable');
      this.emit('data', data);
    }
  }

  resetSettings({ ...DEFAULTS, live: false, marquee: true });
  const stdout = new Output();
  const source = new Input();
  const stdin = new TerminalInput(source as unknown as NodeJS.ReadStream);
  const tree = loadTree(dir);
  const instance = render(
    React.createElement(App, {
      dir,
      ui: mode === 'profile' ? loadUi(dir) : { ...defaultUi(), selected, expanded: [...tree.nodes.keys()] },
      offline: true,
      onAction: () => undefined,
    }),
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      stderr: stdout as unknown as NodeJS.WriteStream,
      alternateScreen: true,
      exitOnCtrlC: false,
      patchConsole: false,
      maxFps: 30,
      incrementalRendering: true,
    },
  );
  const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
  const sample = () => {
    global.gc!();
    return process.memoryUsage().heapUsed;
  };
  const uiPath = join(dir, '.tree', '.local', 'ui.json');
  try {
    // Warm up the renderer before comparing retained memory across animation windows.
    await pause(2_000);
    const uiMtime = statSync(uiPath).mtimeMs;
    const writesBefore = stdout.writes;
    const measuresBefore = performance.getEntriesByType('measure').length;
    const heaps = [sample()];
    const cpuBefore = process.cpuUsage();
    const timeBefore = performance.now();
    await pause(6_000);
    heaps.push(sample());
    const cpu = process.cpuUsage(cpuBefore);
    const cpuPercent = (cpu.user + cpu.system) / ((performance.now() - timeBefore) * 10);
    await pause(6_000);
    heaps.push(sample());
    const measuresAfter = performance.getEntriesByType('measure').length;
    const animationWrites = stdout.writes - writesBefore;
    const uiUnchanged = statSync(uiPath).mtimeMs === uiMtime;
    let background: { cpuPercent: number; writes: number } | undefined;
    if (mode === 'profile') {
      source.write('\u001b[O');
      await pause(150);
      const cpuBefore = process.cpuUsage();
      const timeBefore = performance.now();
      const writesBefore = stdout.writes;
      await pause(6000);
      const cpu = process.cpuUsage(cpuBefore);
      background = {
        cpuPercent: (cpu.user + cpu.system) / ((performance.now() - timeBefore) * 10),
        writes: stdout.writes - writesBefore,
      };
      source.write('\u001b[I');
      await pause(100);
    }
    source.write('2');
    await pause(100);
    process.stdout.write(
      `${JSON.stringify({
        ...startup,
        heaps,
        cpuPercent,
        background,
        measuresBefore,
        measuresAfter,
        animationWrites,
        uiUnchanged,
        savedView: loadUi(dir).view,
      })}\n`,
    );
  } finally {
    instance.unmount();
    instance.cleanup();
    stdin.destroy();
  }
}

/**
 * Running a node's check: the command in its `check` field, in the project
 * folder, through the shell. The cheapest proof there is — no agent, no
 * tokens, the same answer every time.
 */
import { spawn } from 'node:child_process';

export interface CheckResult {
  command: string;
  code: number | null;
  ok: boolean;
  output: string;
  durationMs: number;
  timedOut: boolean;
}

const KEEP = 60_000;

export function runCheck(command: string, cwd: string, timeoutMs = 10 * 60_000): Promise<CheckResult> {
  const started = Date.now();
  return new Promise((done) => {
    let output = '';
    let timedOut = false;
    const child = spawn(command, { cwd, shell: true, env: { ...process.env, FORCE_COLOR: '0', CI: '1' } });
    const take = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      // The end of a long log is where the verdict is.
      if (output.length > KEEP * 2) output = output.slice(-KEEP);
    };
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    const finish = (code: number | null) => {
      clearTimeout(timer);
      done({
        command,
        code,
        ok: code === 0 && !timedOut,
        output: output.length > KEEP ? `…\n${output.slice(-KEEP)}` : output,
        durationMs: Date.now() - started,
        timedOut,
      });
    };
    child.once('error', (error) => {
      output += `${error.message}\n`;
      finish(null);
    });
    child.once('close', finish);
  });
}

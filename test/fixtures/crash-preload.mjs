// Loaded with --import into a treeyard under test: says its pid, and throws an error nobody
// catches once the test drops a file — an unexpected crash in the middle of the tree.
import { existsSync, writeFileSync } from 'node:fs';

const pidFile = process.env.TREEYARD_TEST_PID_FILE;
const crashFile = process.env.TREEYARD_TEST_CRASH_FILE;
if (pidFile) writeFileSync(pidFile, String(process.pid));
if (crashFile) {
  const timer = setInterval(() => {
    if (!existsSync(crashFile)) return;
    clearInterval(timer);
    throw new Error('проверка падения');
  }, 100);
  timer.unref();
}

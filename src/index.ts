import { createRequire } from 'node:module';

/**
 * Treeyard is a CLI (`treeyard`), not a library. This module exists so that
 * `import '@antondanv/treeyard'` resolves (package.json "exports") and does not
 * run anything: no CLI start, no side effects.
 */
const require = createRequire(import.meta.url);
/** src/ and dist/ both sit one level below package.json. */
export const version: string = (require('../package.json') as { version: string }).version;

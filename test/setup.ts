/**
 * The suite reads like the Russian screen: Russian is the source language and
 * the key of every `t()`. English is the default for people; that default is
 * checked in test/i18n.test.ts by a CLI run in a clean environment.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

import { setLang } from '../src/i18n/i18n.js';
import { DEFAULTS } from '../src/settings.js';

DEFAULTS.lang = 'ru';
setLang('ru');

// A home of its own for each test file: settings or a global launch memory saved by one file
// must not change what the TUI shows in a file that runs after it in the same worker.
const home = mkdtempSync(join(tmpdir(), 'treeyard-home-'));
process.env.TREEYARD_HOME = home;
afterAll(() => rmSync(home, { recursive: true, force: true }));
// GitHub's Ubuntu runners set XDG_CONFIG_HOME; a test that moves HOME expects ~/.config under it.
delete process.env.XDG_CONFIG_HOME;

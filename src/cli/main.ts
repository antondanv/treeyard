#!/usr/bin/env node

import { defaultNodeEnv } from '../node-env.js';

// React's development performance measures retain props on every animation frame.
// Before anything that can load React; a child process does not inherit this default.
defaultNodeEnv();
const { run } = await import('./commands.js');
run(process.argv.slice(2));

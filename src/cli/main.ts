#!/usr/bin/env node

// React's development performance measures retain props on every animation frame.
process.env.NODE_ENV ??= 'production';
await import('./commands.js');

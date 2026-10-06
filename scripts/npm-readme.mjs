// npm packs every README.* at the root, whatever `files` says, and the
// package page shows whichever one it picks first — at times the Russian one.
// So README.ru.md steps aside while the package is packed (prepack) and comes
// back afterwards (postpack).
import { existsSync, renameSync } from 'node:fs';

const RU = 'README.ru.md';
const ASIDE = '.README.ru.md.packing';

const step = process.argv[2];
if (step === 'hide' && existsSync(RU)) renameSync(RU, ASIDE);
else if (step === 'show' && existsSync(ASIDE)) renameSync(ASIDE, RU);
else if (step !== 'hide' && step !== 'show') {
  console.error('usage: npm-readme.mjs hide|show');
  process.exit(2);
}

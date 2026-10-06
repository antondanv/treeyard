---
id: vzyp
title: "NODE_ENV=production утекает из Treeyard в панели агентов: Treeyard ставит его себе (src/cli/main.ts:4 — без него React в dev-режиме держит props на каждом кадре, это оставить), но через process.env его наследуют tmux-сервер brainyard и все CLI в панелях — npm ci и npm install там молча пропускают devDependencies (в worktree Brainyard не поставились vitest, tsc, biome). Нужно: запомнить, что NODE_ENV поставил сам Treeyard, и не передавать его в open/startPane/run; уже запущенный сервер brainyard держит его глобально до перезапуска (tmux -L brainyard set-environment -g -u NODE_ENV — для новых панелей)"
parent: smug
order: 90
status: idea
created: 2026-10-04
updated: 2026-10-04T16:38:15+03:00
---

Откуда: Brainyard › «Два пакета: @antondanv/brainyard (API) и @antondanv/brainyard-cli (CLI и веб)» (xq8s)

## Журнал

- 2026-10-04 16:36 · агент · завёл узел

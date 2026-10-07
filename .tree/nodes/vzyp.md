---
id: vzyp
title: "NODE_ENV=production утекает из Treeyard в панели агентов: Treeyard ставит его себе (src/cli/main.ts:4 — без него React в dev-режиме держит props на каждом кадре, это оставить), но через process.env его наследуют tmux-сервер brainyard и все CLI в панелях — npm ci и npm install там молча пропускают devDependencies (в worktree Brainyard не поставились vitest, tsc, biome). Нужно: запомнить, что NODE_ENV поставил сам Treeyard, и не передавать его в open/startPane/run; уже запущенный сервер brainyard держит его глобально до перезапуска (tmux -L brainyard set-environment -g -u NODE_ENV — для новых панелей)"
parent: 8gtc
order: 410
status: waiting
done_when: в панели, открытой из treeyard, echo $NODE_ENV пусто (если его поставил сам Treeyard), npm install ставит devDependencies; check узла тоже без production
waiting: правка Brainyard (xh97, b833f83) не выпущена в npm
until: "выйдет @antondanv/brainyard с EnvOverrides — поднять зависимость, передать NODE_ENV: undefined"
needs:
  - ../Brainyard#xh97
commits:
  - f538a759940924dae56b0fb0d8ae44db0b859d7a
created: 2026-10-04
updated: 2026-10-07T15:36:30+03:00
---

Откуда: Brainyard › «Два пакета: @antondanv/brainyard (API) и @antondanv/brainyard-cli (CLI и веб)» (xq8s)

## Журнал

- 2026-10-04 16:36 · агент · завёл узел
- 2026-10-07 09:49 · агент · идея → к работе
- 2026-10-07 09:49 · агент · Разбор: подтвердилось — main.ts:4 ставит NODE_ENV, Treeyard передаёт в Brainyard только свой env, Brainyard берёт process.env целиком (open.ts:254, панели — panes.ts:133) и снимает только CLAUDE_CODE_*. Утекает и в check узла (agents/check.ts:24 — npm test идёт под production). Нужна правка в Brainyard: снять переменную через env (undefined → unset) — узел там заведён.
- 2026-10-07 09:49 · агент · ждёт: Brainyard › «open и панели: снять переменную окружения через env (значение undefined → delete в open(), unset в скрипте панели) — чтобы Treeyard не передавал свой NODE_ENV=production агентам» (xh97)
- 2026-10-07 15:36 · агент · привязан коммит f538a759940924dae56b0fb0d8ae44db0b859d7a
- 2026-10-07 15:36 · агент · Treeyard (f538a75): src/node-env.ts — ownNodeEnv() помнит, что NODE_ENV=production поставил сам Treeyard (сам Treeyard в production остаётся, утечку памяти gr8x это не трогает); check узла его больше не получает. Brainyard научился снимать переменную (xh97, b833f83) — осталось после релиза Brainyard поднять зависимость и передавать NODE_ENV: undefined в open/startPane/run.
- 2026-10-07 15:36 · агент · к работе → ждёт: правка Brainyard (xh97, b833f83) не выпущена в npm

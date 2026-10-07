---
id: vzyp
title: "NODE_ENV=production утекает из Treeyard в панели агентов: Treeyard ставит его себе (src/cli/main.ts:4 — без него React в dev-режиме держит props на каждом кадре, это оставить), но через process.env его наследуют tmux-сервер brainyard и все CLI в панелях — npm ci и npm install там молча пропускают devDependencies (в worktree Brainyard не поставились vitest, tsc, biome). Нужно: запомнить, что NODE_ENV поставил сам Treeyard, и не передавать его в open/startPane/run; уже запущенный сервер brainyard держит его глобально до перезапуска (tmux -L brainyard set-environment -g -u NODE_ENV — для новых панелей)"
parent: 8gtc
order: 410
status: review
done_when: в панели, открытой из treeyard, echo $NODE_ENV пусто (если его поставил сам Treeyard), npm install ставит devDependencies; check узла тоже без production
needs:
  - ../Brainyard#xh97
commits:
  - f538a759940924dae56b0fb0d8ae44db0b859d7a
  - 84c18c30b277f9c22416b38dc8c65e0df46cc510
created: 2026-10-04
updated: 2026-10-07T16:14:32+03:00
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
- 2026-10-07 16:14 · агент · привязан коммит 84c18c30b277f9c22416b38dc8c65e0df46cc510
- 2026-10-07 16:14 · агент · Сделано: Brainyard 0.3.0 в npm, Treeyard на ^0.3.0 (0ffe869). nodeEnv() в src/model/notes.ts передаёт NODE_ENV: undefined, если его поставил сам Treeyard (84c18c3); через неё идут все запуски агентов — в терминале, в фоне, в панели. Brainyard снимает его и в скрипте панели (unset), и при старте tmux-сервера. Сам Treeyard остаётся в production. Тесты: node-env.test.ts; настоящий tmux — в тестах Brainyard. Живую панель с агентом не открывал.
- 2026-10-07 16:14 · агент · ждёт → на проверке

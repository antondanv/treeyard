---
id: a3gp
title: Antigravity путает сессии при старте
parent: 9xem
order: 240
status: active
done_when: "treeyard open и queue нескольких узлов на Antigravity: каждая панель получает свой разговор — на Brainyard 0.3.3 (свои логи у запусков); проверено живьём на временной копии дерева: 3 узла одним open → 3 разных id, у каждого разговор своей папки, дерево показывает их состояние; неверно привязанную сессию узла можно исправить командой treeyard (справка на обоих языках), а не правкой .tree; тесты; npm run typecheck, npm test, lint, build"
needs:
  - ../Brainyard#5jrn
commits:
  - 46c4cb2a84f83ba44f51d6fa092915ac56d59b37
sessions:
  - brain: codex
    id: 01a213dd-ede5-7300-ab62-e7f472a32ad4
    name: Treeyard · Antigravity путает сессии при старте
    started: 2026-11-25T21:00:38+03:00
    opened: 2026-11-25T21:00:38+03:00
    mode: pane
    pane: codex-a7ca384d
created: 2026-11-25
updated: 2026-11-25T21:00:43+03:00
---

25.11, живьём: open wak4 b379 u285 xvxd --brain antigravity --pane --worktree запустил 4 agy в одну секунду (20:16:30). Antigravity пишет лог cli-<секунда>.log — четыре процесса писали в один файл, в нём уцелели workspaceDirs только папки xvxd и только разговор 46e97fab (на деле «Тихий выход на EPIPE»). У новых разговоров workspace_uris в conversation_summaries.db пустой, поэтому Brainyard (agyLogWorkspaces) сопоставил 46e97fab с папкой xvxd: узел «Мастер не видит агента по переменной» получил чужую сессию, три других остались pane:… без id, TUI видит «работает» только у одного. Верно по заголовкам: wak4 → 146cfeaa, b379 → ccd69399, u285 → 46e97fab, xvxd → 45038e85.

## Журнал

- 2026-11-25 20:26 · агент · завёл узел
- 2026-11-25 20:26 · агент · ждёт: Brainyard › «Запуск Antigravity в одну секунду» (5jrn)
- 2026-11-25 21:00 · агент · привязан коммит 46c4cb2a84f83ba44f51d6fa092915ac56d59b37
- 2026-11-25 21:00 · codex · новая сессия в панели (do)
- 2026-11-25 21:00 · codex · к работе → в работе

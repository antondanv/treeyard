---
id: a3gp
title: Antigravity путает сессии при старте
parent: 9xem
order: 240
status: todo
done_when: "treeyard open и queue нескольких узлов на Antigravity: каждая панель получает свой разговор — проверено живьём на временной копии дерева: 4 узла одним open → 4 разных id, у каждого разговор своей папки, дерево показывает «работает» у всех четырёх; неверно привязанную сессию узла можно исправить командой treeyard, а не правкой .tree; тесты; npm run typecheck, npm test, lint, build"
needs:
  - ../Brainyard#5jrn
created: 2026-11-25
updated: 2026-11-25T20:26:41+03:00
---

25.11, живьём: open wak4 b379 u285 xvxd --brain antigravity --pane --worktree запустил 4 agy в одну секунду (20:16:30). Antigravity пишет лог cli-<секунда>.log — четыре процесса писали в один файл, в нём уцелели workspaceDirs только папки xvxd и только разговор 46e97fab (на деле «Тихий выход на EPIPE»). У новых разговоров workspace_uris в conversation_summaries.db пустой, поэтому Brainyard (agyLogWorkspaces) сопоставил 46e97fab с папкой xvxd: узел «Мастер не видит агента по переменной» получил чужую сессию, три других остались pane:… без id, TUI видит «работает» только у одного. Верно по заголовкам: wak4 → 146cfeaa, b379 → ccd69399, u285 → 46e97fab, xvxd → 45038e85.

## Журнал

- 2026-11-25 20:26 · агент · завёл узел
- 2026-11-25 20:26 · агент · ждёт: Brainyard › «Запуск Antigravity в одну секунду» (5jrn)

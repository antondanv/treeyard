---
id: bybr
title: Sleep и peek видят send
parent: 5byq
order: 290
status: review
done_when: treeyard sleep не закрывает без --force панель, которой после её последнего законченного хода написали (treeyard send или письмо), пока CLI не подтвердил новый конец хода; treeyard peek у такой панели не пишет «закончила ход»; оба, как wait и deliver, передают в withPaneIdle since из ref.opened; тесты в test/sleep.test.ts и test/peek.test.ts; npm run typecheck, npm test, lint, build
commits:
  - 07768ed97b61c6b2e3f09770a24528f9071d5530
sessions:
  - brain: claude
    id: 7944e5a0-a263-42e0-8660-8195792e14cc
    name: Treeyard · Sleep и peek видят send
    started: 2026-11-25T19:58:06+03:00
    opened: 2026-11-25T19:58:06+03:00
    mode: pane
    pane: claude-ceb61708
    dir: /Users/antondanilov/Projects/Treeyard.worktrees/bybr
created: 2026-11-25
updated: 2026-11-25T20:09:04+03:00
---

Из ревью 25.11: DEFAULT_SLEEP_SOURCES (src/agents/panes.ts) и DEFAULT_PEEK_SOURCES (src/agents/peek.ts) теряют третий аргумент since. Ловушка: с одним since старая запись idle перестаёт считаться, состояние становится unknown, а sleep отказывает только на busy и waiting — значит, закроет всё равно; unknown тоже надо разобрать.

## Журнал

- 2026-11-25 19:57 · агент · завёл узел
- 2026-11-25 19:58 · claude · новая сессия в панели (do) в worktree treeyard/bybr
- 2026-11-25 19:58 · claude · к работе → в работе
- 2026-11-25 20:03 · claude · привязан коммит 07768ed97b61c6b2e3f09770a24528f9071d5530
- 2026-11-25 20:03 · claude · Sleep и peek теперь передают в withPaneIdle since из ref.opened (sessionSince) — DEFAULT_SLEEP_SOURCES и DEFAULT_PEEK_SOURCES пробрасывают третий аргумент, observe зовётся с since. sleep без --force отказывает и на состоянии unknown (новый статус unknown: «CLI не подтвердил конец хода панели»); peek у такой панели пишет «ещё не сказала, что делает», не «закончила ход». Тесты: test/sleep.test.ts, test/peek.test.ts (30 passed; проверяют since в withPaneIdle и отказ). typecheck, lint, build — ок; npm test: 1062 из 1063, падает test/open-many.test.ts (чужой файл, не трогал). Коммит в ветке treeyard/bybr.
- 2026-11-25 20:03 · claude · в работе → на проверке
- 2026-11-25 20:09 · агент · Принято (координатор): 07768ed влит в main (ef842c2); sleep и peek передают since из ref.opened, sleep без --force отказывает и на unknown (CLI не подтвердил конец хода), peek у такой панели не пишет «закончила ход»; тесты в test/sleep.test.ts и test/peek.test.ts. На main: typecheck, lint, build — чисто, npm test 1065/1065. Осталось: ничего.

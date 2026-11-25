---
id: ds4q
title: Antigravity мелькает idle между шагами
parent: 5byq
order: 260
status: done
done_when: treeyard wait и deliver не принимают работающую панель Antigravity за закончившую ход («idle») между шагами генерации/выполнения команд; исследована причина в conversation_summaries.db и экране панели; тесты и живая проверка на работающей панели Antigravity
commits:
  - 5bc3bc57466a07480f58bce0b213c4b3d0c0c96e
sessions:
  - brain: antigravity
    id: da3af5e8-b15c-484f-89f5-bf86c1434857
    name: Treeyard · Antigravity мелькает idle между шагами
    started: 2026-11-25T12:43:11+03:00
    opened: 2026-11-25T12:43:11+03:00
    mode: pane
    pane: agy-1c0822e8
    dir: /Users/antondanilov/Projects/Treeyard.worktrees/ds4q
created: 2026-11-24
updated: 2026-11-25T20:10:26+03:00
closed: 2026-11-25
---

Наблюдение 24.11 при координации панелей Antigravity: между шагами и генерацией в conversation_summaries.db кратковременно ставится status=IDLE, хотя на экране панели ещё крутится спиннер и «esc to cancel». Из-за этого treeyard wait иногда преждевременно возвращается с «закончила ход». Можно сверять экран панели (или выдерживать короткое подтверждение подряд двух опросов) перед тем как считать панель Antigravity свободной.

## Журнал

- 2026-11-24 18:41 · ты · завёл узел
- 2026-11-25 12:27 · ты · идея → к работе
- 2026-11-25 12:28 · ты · Находка координатора по живому дампу conversation_summaries.db (25.11): две причины ложного idle в wait/deliver. (1) pane-idle.ts сравнивает last_modified_time / timestamp с pane.startedAt, а не с max(pane.startedAt, ref.opened): после treeyard send старый IDLE от предыдущего хода (свежее startedAt, но старше opened) засчитывается как завершение нового хода, если CLI ещё не успел сбросить RUNNING в БД (у Antigravity задержка записи в SQLite может быть до минуты, как было 12:22:29 → 12:23:58). То же верно и для Codex/Claude после send! (2) Между шагами генерации Antigravity может показывать IDLE в БД, пока на экране панели ещё активно «esc to cancel» / спиннер (как codexPaneStates в Brainyard проверяет «esc to interrupt»).
- 2026-11-25 12:43 · antigravity · новая сессия в панели (do) в worktree treeyard/ds4q
- 2026-11-25 12:43 · antigravity · к работе → в работе
- 2026-11-25 12:43 · ты · разрешение подтверждено: доверие к папке — «1. Yes, I trust this folder»
- 2026-11-25 12:51 · antigravity · привязан коммит 5bc3bc57466a07480f58bce0b213c4b3d0c0c96e
- 2026-11-25 12:51 · antigravity · Исправлены обе причины ложного idle в wait/deliver (src/agents/pane-idle.ts, src/agents/wait.ts, src/agents/deliver.ts, test/wait-send.test.ts, docs/architecture.md): (1) withPaneIdle сравнивает метки завершения хода для Antigravity, Codex и Claude с max(pane.startedAt, ref.opened) через sessionSince(tree) в observe()/look()/deliverAll() — старый IDLE старше последнего treeyard send больше не засчитывается; (2) agyScreenBusy проверяет активный экран Antigravity (esc to cancel в футере или брайль-спиннер без ? for shortcuts и диалогов) и в observe() перебивает мелькающий IDLE из conversation_summaries.db в busy, не мешая диалогу доверия к папке. Проверено: npm run typecheck, vitest (wait-send/mail/reply/queue/panes — 5/5, 69/69), npm run lint (234 файла), npm run build, и живая проверка observe()+sessionSight() на работающей панели agy-1c0822e8 (esc to cancel в ANSI-футере даёт busy даже при подставленном IDLE из БД; conversation_summaries.db в WAL-режиме подтвердил задержку обновления >3 мин). Осталось: ничего.
- 2026-11-25 12:51 · antigravity · в работе → на проверке
- 2026-11-25 12:57 · ты · Принято (координатор): 5bc3bc5 влит в main; починены оба источника ложного idle (since = max(startedAt, opened) и agyScreenBusy); npm run typecheck, npm test 1013/1013 (1012/1013 + planting-tmux.test.ts 1/1), lint, build — чисто. Панель усыплена через treeyard sleep. Осталось: ничего.
- 2026-11-25 20:10 · ты · на проверке → готово

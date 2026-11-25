---
id: ev5s
title: Нестабильный тест мыши
parent: b9ke
order: 20
status: review
done_when: Причина нестабильности найдена и записана в журнал; тест проходит 50 прогонов подряд локально и в CI на Node 24 / macos-latest
commits:
  - 55bb91b22eb39b627fb62d2042ebfb6a6752a7f8
sessions:
  - brain: antigravity
    id: 9259e6d2-9e37-4b56-a401-0a9bbdb26696
    name: Treeyard · Нестабильный тест мыши
    started: 2026-11-25T23:52:59+03:00
    opened: 2026-11-25T23:52:59+03:00
    mode: pane
    pane: agy-30267e04
    dir: /Users/antondanilov/Projects/Treeyard.worktrees/ev5s
  - brain: claude
    id: 231a4d44-a8b5-4418-8c4b-3339b4027461
    name: Treeyard · Нестабильный тест мыши
    started: 2026-11-25T23:53:44+03:00
    opened: 2026-11-25T23:53:44+03:00
    mode: pane
    pane: claude-b66e5ff1
    dir: /Users/antondanilov/Projects/Treeyard.worktrees/ev5s
  - brain: claude
    id: fdd5d3ff-ced1-4111-9682-2ac418cfc040
    name: Treeyard · Нестабильный тест мыши
    started: 2026-11-26T00:31:32+03:00
    opened: 2026-11-26T00:31:32+03:00
    mode: pane
    pane: claude-16e1b4cd
    dir: /Users/antondanilov/Projects/Treeyard.worktrees/ev5s
created: 2026-10-10
updated: 2026-11-26T00:39:38+03:00
---

Тест mouse.test.tsx «presses the panel buttons without starting to type, and types after a click inside» упал в CI на Node 24 / macos-latest.

CI run 38047175313 на 1551d11 (2026-10-10): AssertionError: expected false to be true, тест шёл 9,2 с. Остальные три задания (Node 22 macos, Node 22 и 24 ubuntu) зелёные; коммиты этого push меняли только README, docs/, AGENTS.md и .tree — код и тесты не трогали. Похоже на гонку по времени, как в vqek.

## Журнал

- 2026-10-10 14:11 · агент · завёл узел
- 2026-11-16 00:42 · агент · идея → к работе
- 2026-11-25 23:52 · antigravity · новая сессия в панели (do) в worktree treeyard/ev5s
- 2026-11-25 23:52 · antigravity · к работе → в работе
- 2026-11-25 23:53 · claude · новая сессия в панели (do) в worktree treeyard/ev5s
- 2026-11-26 00:05 · агент · 26.11 ~00:01–00:03 сессия запустила десятки параллельных прогонов vitest (96 логов heavy*.log за 2 минуты), чтобы поймать нестабильность под нагрузкой; вместе с двумя соседними сессиями это повесило Mac. Логи удалены, кода не было. Дальше — только последовательные повторы одного файла, без параллельных копий.
- 2026-11-26 00:05 · агент · в работе → к работе
- 2026-11-26 00:31 · claude · новая сессия в панели (do) в worktree treeyard/ev5s
- 2026-11-26 00:31 · claude · к работе → в работе
- 2026-11-26 00:39 · claude · привязан коммит 55bb91b22eb39b627fb62d2042ebfb6a6752a7f8
- 2026-11-26 00:39 · claude · Причина: гонка в самом тесте, кода приложения она не касается. После клика по дереву кадр без «печатаешь в Claude Code» рисуется раньше, чем React возвращает дереву его клавиши (useInput с isActive подписывается в эффекте), поэтому нажатие «p скрыть», пришедшее сразу за кадром, терялось: панель не скрывалась и последний until(…без hello…) ждал свои 8 с (CI: 9,2 с, AssertionError: expected false to be true). Та же природа, что в vqek (там гонка после ⌃Q). Доказано без нагрузки: во временной копии теста нажатие в микрозадаче сразу после кадра — падение за 8,9 с с тем же AssertionError; то же нажатие через 100 мс — зелёный. Исправление (55bb91b, test/mouse.test.tsx): pause(100) перед кликом по «p скрыть», с комментарием. Доказательства: npx vitest run test/mouse.test.tsx --maxWorkers=1 — 50 прогонов подряд, по одному, перед каждым проверка load average: pass=50 fail=0; npm run typecheck и npm run lint чистые. Полный npm test и build не запускал — координатору. Осталось: CI на Node 24 / macos-latest без push не проверить — после push (его делает человек) убедиться, что задание зелёное.
- 2026-11-26 00:39 · claude · в работе → на проверке

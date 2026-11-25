---
id: c3bx
title: Просроченные окна в limits
parent: 5byq
order: 300
status: done
done_when: treeyard limits показывает окно, у которого время сброса уже прошло, как сброшенное («сброшено в 19:00», 0%), а не прежним процентом с «сброс в …» в прошлом; в --json у такого окна есть признак; тест с заданным now в test/models-limits.test.ts; справка на обоих языках, если меняется вывод; npm run typecheck, npm test, lint, build
commits:
  - 43f2ee62165540d5d85eab4610e3562c75ea831c
  - 4b0a78d54d7321619460d5ffdeb657846a44fdd8
sessions:
  - brain: claude
    id: 4fde3904-283b-40ae-af49-1a82183b8b76
    name: Treeyard · Просроченные окна в limits
    started: 2026-11-25T19:58:06+03:00
    opened: 2026-11-25T19:58:06+03:00
    mode: pane
    pane: claude-398af427
    dir: /Users/antondanilov/Projects/Treeyard.worktrees/c3bx
created: 2026-11-25
updated: 2026-11-25T20:10:26+03:00
closed: 2026-11-25
---

Из ревью 25.11, живьём в 19:54: Claude Code seven_day 100% · сброс в 19:00, Codex primary 11% · сброс в 14:02 — оба окна уже сбросились, координатор по таблице обошёл бы Claude.

## Журнал

- 2026-11-25 19:57 · агент · завёл узел
- 2026-11-25 19:58 · claude · новая сессия в панели (do) в worktree treeyard/c3bx
- 2026-11-25 19:58 · claude · к работе → в работе
- 2026-11-25 20:05 · claude · привязан коммит 43f2ee62165540d5d85eab4610e3562c75ea831c
- 2026-11-25 20:05 · claude · Окно с прошедшим resetsAt в limits теперь «0% · сброшено в 19:00» (settleExpired в models-text.ts, now передаётся в limitsText и limitsCommand); в --json у него expired:true, utilization:0, previousUtilization — прежнее значение. Тесты с заданным now в test/models-limits.test.ts, справка en/ru, строка в en.ts. typecheck, lint, build — ок; npm test: 29/29 в своём файле, падают чужие test/open-many.test.ts (другой координатор) и test/uninstall.test.ts (не мой код). Brainyard не менялся.
- 2026-11-25 20:05 · claude · в работе → на проверке
- 2026-11-25 20:06 · агент · привязан коммит 4b0a78d54d7321619460d5ffdeb657846a44fdd8
- 2026-11-25 20:09 · агент · Принято (координатор): 43f2ee6 влит в main (6c2832f); при приёмке 4b0a78d — ключи t() строками, чтобы их видела проверка переводов, и повторный settleExpired больше не затирает previousUtilization. Живьём: Codex primary «0% · сброшено в 14:02» вместо «11% · сброс в 14:02»; --json — expired: true. На main: typecheck, lint, build — чисто, npm test 1065/1065. Осталось: ничего.
- 2026-11-25 20:10 · ты · на проверке → готово

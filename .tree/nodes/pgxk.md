---
id: pgxk
title: Права агентов видны и настраиваются
parent: 9xem
order: 90
status: review
who: agent
done_when: Перед первым запуском агента с расширенными правами человек видит, какие права тот получает, и может выбрать обычный режим; выбор хранится в настройках и меняется в диалоге «,»; README и справочник RU/EN перечисляют права каждого агента; typecheck, тесты, lint и build проходят
commits:
  - 06c894a4d5a403e574ac2723a0b2b353e9d69128
sessions:
  - brain: claude
    id: abe62f7b-ea02-413c-97ae-587db32cf5bc
    name: Treeyard · Права агентов видны и настраиваются
    started: 2026-11-22T11:58:31+03:00
    opened: 2026-11-22T11:58:31+03:00
    mode: pane
    pane: claude-bceb8435
created: 2026-11-16
updated: 2026-11-22T12:21:52+03:00
---

Человек 16.11.2026 — в релиз 0.2.0. Сейчас Antigravity запускается с bypassPermissions — полный доступ без подтверждений (src/agents/context.ts), и человек этого нигде не видит.

## Журнал

- 2026-11-16 00:42 · агент · завёл узел
- 2026-11-22 11:58 · claude · новая сессия в панели (do)
- 2026-11-22 11:58 · claude · к работе → в работе
- 2026-11-22 12:21 · агент · привязан коммит 06c894a4d5a403e574ac2723a0b2b353e9d69128
- 2026-11-22 12:21 · агент · картинка добавлена: 001.png — Первый запуск Antigravity: окно «Какие права дать Antigravity?» (100×30)
- 2026-11-22 12:21 · агент · картинка добавлена: 002.png — Подтверждение запуска: строка «Права» — полный доступ выделен
- 2026-11-22 12:21 · агент · картинка добавлена: 003.png — Настройки «,»: строка «Права Antigravity»
- 2026-11-22 12:21 · агент · Antigravity больше не получает --dangerously-skip-permissions молча. Перед первым запуском, продолжением или пробуждением (TUI — даже с выключенным подтверждением; treeyard open и init --agent в терминале) — вопрос «Какие права дать Antigravity?»: полный доступ или обычный режим, esc/Enter — ничего не запускать. Выбор — antigravity_access в ~/.treeyard/settings.json, меняется в «,» → «Права Antigravity» и treeyard config antigravity_access full|normal|ask; пока не выбран — без лишних прав; open без терминала (агент) — код 2 с подсказкой. В подтверждении запуска (TUI и CLI) строка «Права» для каждого агента. README и справочник RU/EN: раздел «Что разрешено агентам» (Claude Code, Codex, OpenCode, Antigravity, задачи без сессии). Код: src/agents/access.ts, settings.ts, tui/dialogs.tsx (AccessDialog), App.tsx, cli/commands.ts. Проверки: typecheck ok, npm test 76 файлов / 715 тестов ok (новые: test/agent-access.test.tsx, templates.test.ts), lint ok, build ok; CLI в pty: Enter → «не запускаю», n → antigravity_access=normal, второй open без вопроса со строкой «Права»; скриншоты 001–003. Осталось: ничего; скилл treeyard-coordinate про отказ open не трогал — сообщение ошибки само говорит, что делать.
- 2026-11-22 12:21 · агент · в работе → на проверке

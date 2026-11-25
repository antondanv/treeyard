---
id: ah5m
title: Плагин писем для OpenCode
parent: 5byq
order: 130
status: done
done_when: проверено живьём на OpenCode (1.19+), доходит ли process.env.TREEYARD_NODE и работает ли контекст-хук плагина; при поддержке — treeyard hook opencode install|remove|status, отображение в status, уборка в uninstall, перенос в worktree, тесты, справка на обоих языках и живая проверка на временной копии (при ограничении CLI — статус waiting с доказательством)
commits:
  - a9ef2412779cf66cc569c73a4ca25b9d3cb2b8eb
  - 2d3b9fc2cb56c0fa2c62a9ee042279ed91d08acc
sessions:
  - brain: antigravity
    id: 5ee4d0fa-9456-4006-b8c9-4f64a17e98c9
    name: Treeyard · Плагин писем для OpenCode
    started: 2026-11-25T12:48:47+03:00
    opened: 2026-11-25T12:48:47+03:00
    mode: pane
    pane: agy-11c9c821
    dir: /Users/antondanilov/Projects/Treeyard.worktrees/ah5m
created: 2026-11-24
updated: 2026-11-25T20:10:26+03:00
closed: 2026-11-25
---

Из разбора 23.11: у OpenCode 1.18 хуков-команд нет, только плагины (.opencode/plugins/, ~/.config/opencode/plugins/); V2 API ctx.session.hook("context", …) правит контекст перед запросом. Доходит ли process.env сессии до плагина — не описано.

## Журнал

- 2026-11-24 03:22 · агент · завёл узел
- 2026-11-24 14:34 · ты · идея → к работе
- 2026-11-25 12:48 · antigravity · новая сессия в панели (do) в worktree treeyard/ah5m
- 2026-11-25 12:48 · antigravity · к работе → в работе
- 2026-11-25 12:49 · ты · разрешение подтверждено: доверие к папке — «1. Yes, I trust this folder»
- 2026-11-25 13:18 · antigravity · привязан коммит a9ef2412779cf66cc569c73a4ca25b9d3cb2b8eb
- 2026-11-25 13:18 · antigravity · Проверено живьём на OpenCode 1.19.6 и реализован плагин писем (src/agents/opencode-plugin.ts, src/agents/turn-hook.ts, src/cli/commands.ts, src/status.ts, src/cli/status-text.ts, src/uninstall.ts, src/worktree.ts, src/i18n/en.ts, docs/reference.md, docs/reference.ru.md, test/opencode-plugin.test.ts): OpenCode загружает .opencode/plugins/treeyard-mail.js и ~/.config/opencode/plugins/treeyard-mail.js с доступом к process.env.TREEYARD_NODE и TREEYARD_PROJECT; плагин проверяет existsSync(.tree/.local/mail/inbox/<node>) в процессе (0 вызовов treeyard без ждущих писем), пропускает субагенты (session.parentID) и доставляет письма через chat.message (синтетическая часть запроса, вместе с запросом) и tool.execute.after (<system-reminder>, посреди хода). Добавлены treeyard hook opencode install|remove|status [--user] и mail, строка в treeyard status, уборка в treeyard uninstall, копирование в git worktree и скрытие из git status через .git/info/exclude. Доказательства: npm run typecheck && npm run lint && npm run build — чисто; vitest (9 целевых файлов) — 109/109; живой прогон opencode run 1.19.6 во временном worktree — письмо №1 доставлено вместе с запросом, письмо №2 посреди хода, оба учтены моделью, на следующем ходу без писем 0 вызовов treeyard. Осталось: ничего.
- 2026-11-25 13:18 · antigravity · в работе → на проверке
- 2026-11-25 19:20 · агент · привязан коммит 2d3b9fc2cb56c0fa2c62a9ee042279ed91d08acc
- 2026-11-25 19:25 · ты · Принято (координатор): a9ef241 влит в main (2d3b9fc, конфликт импортов в commands.ts разрешён); живая проверка OpenCode 1.19.6 (доставка вместе с запросом и посреди хода, 0 вызовов treeyard без писем); npm run typecheck, npm test 1040/1040, lint, build — чисто. Панель усыплена через treeyard sleep. Осталось: ничего.
- 2026-11-25 20:10 · ты · на проверке → готово

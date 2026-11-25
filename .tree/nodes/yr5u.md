---
id: yr5u
title: Не фиксировать Claude в инструкциях
parent: 5byq
order: 230
status: done
done_when: В контексте сессий, скиллах, шаблонах и подсказках treeyard нигде жёстко не зашит Claude Code как основной или обязательный CLI (упоминается только специфика самого CLI наравне с Codex, Antigravity и OpenCode); выбор CLI по умолчанию и примеры нейтральны; тесты и справка на обоих языках
commits:
  - b19ae9e24867e920dd7b73cc10bef33f448be40f
  - 1069f3064ba0f21f881bfea777d2c1df866a8595
sessions:
  - brain: antigravity
    id: 27d82a55-a307-4d2d-b662-665b8536f31e
    name: Treeyard · Не фиксировать Claude в инструкциях
    started: 2026-11-25T19:38:00+03:00
    opened: 2026-11-25T19:38:00+03:00
    mode: pane
    pane: agy-e038273a
    dir: /Users/antondanilov/Projects/Treeyard.worktrees/yr5u
created: 2026-11-24
updated: 2026-11-25T20:10:26+03:00
closed: 2026-11-25
---

Человек 24.11: нигде в treeyard — ни в инструкциях, ни в коде подсказок/контекста/скиллов — не должно жёстко фиксироваться использование Claude Code.

## Журнал

- 2026-11-24 14:34 · ты · завёл узел
- 2026-11-25 19:38 · antigravity · новая сессия в панели (do) в worktree treeyard/yr5u
- 2026-11-25 19:38 · antigravity · к работе → в работе
- 2026-11-25 19:38 · ты · разрешение подтверждено: доверие к папке — «1. Yes, I trust this folder»
- 2026-11-25 19:48 · antigravity · привязан коммит b19ae9e24867e920dd7b73cc10bef33f448be40f
- 2026-11-25 19:48 · antigravity · Убрана жёсткая привязка к Claude Code по умолчанию во всех слоях (b19ae9e): добавлен нейтральный defaultBrain (project.brain → TREEYARD_AS → первый установленный CLI → fallback), createTree больше не зашивает brain: claude; в контексте (src/agents/context.ts), скиллах (treeyard, treeyard-coordinate, treeyard-init, other-projects.md), CLI-справке и подсказках (commands.ts, reply.ts, mail.ts), TUI (App.tsx, dialogs.tsx, init.tsx), словаре en.ts и docs/reference(.ru).md примеры и пути по умолчанию переведены на нейтральный --pane / --brain <cli>, а специфика Claude Code (--bg, /goal, claude attach) оставлена только там, где речь о самом CLI. Проверки: git grep -in claude по context/skills/templates без дефолтной фиксации; npm run typecheck — 0; vitest (16 файлов, 208/208); npm run lint — 0 (242 файла); npm run build — ок. Осталось: ничего.
- 2026-11-25 19:48 · antigravity · в работе → на проверке
- 2026-11-25 19:58 · агент · привязан коммит 1069f3064ba0f21f881bfea777d2c1df866a8595
- 2026-11-25 19:58 · ты · Принято (координатор): b19ae9e + поправка текста в test/open-many.test.ts на main; npm run typecheck, npm test 1070/1070 (1069/1070 + test/open-many.test.ts 1/1), lint, build — чисто; нейтральный defaultBrain и чистые контекст/скиллы/CLI/TUI/справка EN+RU. Панель усыплена через treeyard sleep. Осталось: ничего.
- 2026-11-25 20:10 · ты · на проверке → готово

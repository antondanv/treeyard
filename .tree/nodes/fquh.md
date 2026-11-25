---
id: fquh
title: Хук писем для Antigravity
parent: 5byq
order: 120
status: done
done_when: проверено живьём на Antigravity (agy 1.5+), доходит ли TREEYARD_NODE и работает ли PreInvocation/injectSteps; при поддержке — treeyard hook antigravity install|remove|status, отображение в status, уборка в uninstall, перенос в worktree, тесты, справка на обоих языках и живая проверка на временной копии (при ограничении CLI — статус waiting с доказательством)
commits:
  - a99c8e7dd0385b5ceea91d25fc2e316ddf73a2dd
sessions:
  - brain: antigravity
    id: 70059786-c804-480e-86c9-6b4b9d00fee3
    name: Treeyard · Хук писем для Antigravity
    started: 2026-11-24T18:37:38+03:00
    opened: 2026-11-25T12:22:35+03:00
    mode: pane
    pane: agy-fbb6fb37
    dir: /Users/antondanilov/Projects/Treeyard.worktrees/fquh
created: 2026-11-24
updated: 2026-11-25T20:10:26+03:00
closed: 2026-11-25
---

Из разбора 23.11: agy 1.5 — .agents/hooks.json в проекте или ~/.gemini/config/hooks.json; PostToolUse контекст не добавляет, PreInvocation (перед каждым запросом к модели) принимает {injectSteps:[{systemMessage:{systemMessage:"…"}}]}. Одобрение проектных хуков и окружение в документации не описаны — проверить живьём.

## Журнал

- 2026-11-24 03:22 · агент · завёл узел
- 2026-11-24 14:34 · ты · идея → к работе
- 2026-11-24 18:37 · antigravity · новая сессия в панели (do) в worktree treeyard/fquh
- 2026-11-24 18:37 · antigravity · к работе → в работе
- 2026-11-24 18:40 · ты · разрешение подтверждено: доверие к папке — «1. Yes, I trust this folder»
- 2026-11-25 12:22 · ты · письмо №91 от «Почта для мультиагентной работы»: «Квоты сбросились — продолжай работу с места остановки и доведи узел «Хук писем для Antigravity» до review: ты уже собрал данные живой пробы в /tmp/agy-hook-probe — заверши живую проверку, реализуй treeyard hook antigravity (src/agents/agy-hook.ts на базе deliverHookMail, status, uninstall, worktree…»
- 2026-11-25 12:39 · antigravity · привязан коммит a99c8e7dd0385b5ceea91d25fc2e316ddf73a2dd
- 2026-11-25 12:39 · antigravity · Проверено живьём на agy 1.5.16 и реализован хук писем для Antigravity (src/agents/agy-hook.ts на базе deliverHookMail): .agents/hooks.json и ~/.gemini/config/hooks.json читаются без ручного одобрения, TREEYARD_NODE и TREEYARD_PROJECT доходят в процесс хука, пустой stdout при отсутствии писем не вызывает ошибок, PreInvocation доставляет injectSteps.systemMessage с invocationNum=0 (вместе с запросом) и invocationNum>0 (посреди хода). Добавлены treeyard hook antigravity install|remove|status [--user] (алиас agy), скрытие из git status через .git/info/exclude, перенос .agents/hooks.json в worktree, строка в treeyard status, уборка в treeyard uninstall, переводы EN и справка в docs/reference.md и docs/reference.ru.md. Доказательства: npm run typecheck && vitest run (8 файлов, 101/101 тестов) && npm run lint && npm run build — зелёные; живой прогон на временной копии дерева с worktree и agy 1.5.16 (gemini-3.8-flash-low) доставил письмо №1 (prompt, КОСМОС-742) и письмо №2 (turn, ОРБИТА-918) с отметкой antigravity 272a854e. Осталось: ничего.
- 2026-11-25 12:39 · antigravity · в работе → на проверке
- 2026-11-25 12:48 · ты · Принято (координатор): a99c8e7 влит в main; живая проверка agy 1.5.16 подтвердила доставку PreInvocation injectSteps (prompt и turn в одном ходе без ручного одобрения); реализованы treeyard hook antigravity (алиас agy), status, uninstall, worktree, справка EN/RU; npm run typecheck, npm test 1011/1011, lint, build — чисто. Панель усыплена через treeyard sleep. Осталось: ничего.
- 2026-11-25 20:10 · ты · на проверке → готово

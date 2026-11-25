---
id: xvxd
title: Мастер не видит агента по переменной
parent: 9xem
order: 140
status: review
done_when: Мастер первого запуска считает агента установленным, если его бинарь задан через BRAINYARD_<ID>_BIN, как его ищет Brainyard, а не только по PATH; тест; typecheck, тесты, lint и build проходят
commits:
  - 3d9cf2b44dec4861bc6df7848d7281a1cd126cdd
sessions:
  - brain: antigravity
    id: 46e97fab-ca9e-4e2e-bf34-9d7f26490bff
    name: Treeyard · Мастер не видит агента по переменной
    started: 2026-11-25T20:16:30+03:00
    opened: 2026-11-25T20:16:30+03:00
    mode: pane
    pane: agy-61079002
    dir: /Users/antondanilov/Projects/Treeyard.worktrees/xvxd
created: 2026-10-07
updated: 2026-11-25T20:45:24+03:00
---

Мастер первого запуска не видит BRAINYARD_<ID>_BIN: installed() в src/tui/init.tsx ищет только имя бинаря в PATH, а Brainyard запускает агента по переменной.

## Журнал

- 2026-10-07 17:13 · агент · завёл узел
- 2026-11-16 00:49 · агент · идея → к работе
- 2026-11-25 20:16 · antigravity · новая сессия в панели (do) в worktree treeyard/xvxd
- 2026-11-25 20:16 · antigravity · к работе → в работе
- 2026-11-25 20:17 · ты · разрешение подтверждено: доверие к папке — «1. Yes, I trust this folder»
- 2026-11-25 20:40 · antigravity · привязан коммит 3d9cf2b44dec4861bc6df7848d7281a1cd126cdd
- 2026-11-25 20:40 · antigravity · isBrainInstalled в src/agents/launch.ts приведена в точное соответствие с resolveCommand/which из Brainyard (BRAINS[brain].envVar, проверка исполняемого файла, парсинг JSON-массива строк и пути/имени команды); добавлены тесты на isBrainInstalled (все 4 агента, путь, JSON-массив, имя в PATH, перекрытие отсутствующим бинарём, каталог/неисполняемый файл) и на мастер первого запуска Wizard в test/planting.test.tsx. Проверки: npm run typecheck — ок; npm run lint — 242 файла без ошибок; npm run build — ок; test/planting.test.tsx — 20/20; полный npm test прошёл по всем 105 файлам (100/105 в одном прогоне + 5/5 оставшихся отдельно, где раньше случались таймауты 20с при системной нагрузке load average ~188 от параллельных сессий). Осталось: ничего.
- 2026-11-25 20:40 · antigravity · в работе → на проверке
- 2026-11-25 20:45 · агент · Принято (координатор): 3d9cf2b влит в main; isBrainInstalled ищет CLI как Brainyard (BRAINS[].envVar, исполняемый файл, JSON-массив), тесты на неё и на мастер первого запуска. На main: typecheck, lint, build — чисто; npm test 1078/1079 (таймаут под нагрузкой, отдельно проходит). Сессия узла из-за одновременного запуска привязана к чужому разговору 46e97fab; её настоящий разговор по заголовку — 45038e85 (см. «Antigravity путает сессии при старте»). Осталось: ничего.

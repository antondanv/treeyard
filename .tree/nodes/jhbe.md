---
id: jhbe
title: Имя панели в open и sessions
parent: y5ss
order: 30
status: review
done_when: treeyard open <id> --pane --json печатает id сессии и имя панели tmux; у сессий в treeyard sessions --json есть поле pane; тесты; справка и docs RU/EN
commits:
  - 0ea21f74c853154c06de952386508d16592345eb
sessions:
  - brain: claude
    id: 90cf9eea-1516-4892-89e3-df410633be98
    name: Treeyard · Имя панели в open и sessions
    started: 2026-11-12T14:25:54+03:00
    opened: 2026-11-12T14:25:54+03:00
    mode: pane
    pane: claude-0a46abdb
created: 2026-11-11
updated: 2026-11-12T14:33:30+03:00
---

Чтобы веб знал, к какой панели tmux -L brainyard подключать терминал в браузере.

## Журнал

- 2026-11-11 11:37 · агент · завёл узел
- 2026-11-12 14:25 · claude · новая сессия в панели (do)
- 2026-11-12 14:25 · claude · к работе → в работе
- 2026-11-12 14:33 · агент · привязан коммит 0ea21f74c853154c06de952386508d16592345eb
- 2026-11-12 14:33 · агент · treeyard open <id> --pane --json печатает {node, brain, id, pane, startedAt, warnings}: id — id сессии (у Codex, Antigravity, OpenCode сначала null), pane — имя сессии tmux на сервере brainyard; --json без --pane — ошибка (код 2). treeyard sessions --json: у каждой сессии поле pane — живая панель или null; свежая панель Codex/Agy/OpenCode находится через хранилище CLI (sessionPanes в src/agents/panes.ts, только чтение), её сессия получает узел по pane:…; обычный sessions помечает ▣ <панель>. Тесты: panes.test.ts (sessionPanes), panes-tmux.test.ts (CLI open --pane --json и sessions --json/текст с Claude, панель закрыта → null; --json без --pane), opencode-tmux.test.ts (id null, sessions --json находит ses_… по панели и узел, дерево не меняется). Справка RU/EN, docs/reference(.ru).md, architecture.md. Проверка: typecheck, npm test 564/564, lint, build; вживую из dist на копии дерева (заменитель Claude, отдельный сокет): open nd77 --pane --json → pane claude-682ab318 = tmux list-sessions; sessions --json → pane claude-682ab318, node nd77; после закрытия → null. Осталось: ничего.
- 2026-11-12 14:33 · агент · в работе → на проверке

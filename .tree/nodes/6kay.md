---
id: 6kay
title: --json для open --bg
parent: "7997"
order: 70
status: review
done_when: treeyard open a b c --bg --json печатает в stdout JSON [{node, brain, id, startedAt, warnings, error}] по строке на узел (один узел — объект, как у --pane); не вставший — с error; код 0/1; тесты, справка и docs RU/EN
commits:
  - 0eb912f976f280d35a1087f346094a6405a7fa47
sessions:
  - brain: claude
    id: 00079359-5028-423e-a5cf-387f972b5a28
    name: Treeyard · --json для open --bg
    started: 2026-11-17T11:58:39+03:00
    opened: 2026-11-17T11:58:39+03:00
    mode: pane
    pane: claude-0e95a97b
created: 2026-11-17
updated: 2026-11-17T12:03:06+03:00
---

Машинный вывод treeyard open <id>… --bg --json: [{node, brain, id, startedAt, warnings, error}] — для программ и координаторов; сейчас --json только у --pane, а --bg печатает строки ✓/✗. Из узла ba3x (17.11.2026).

## Журнал

- 2026-11-17 11:39 · агент · завёл узел
- 2026-11-17 11:58 · claude · новая сессия в панели (plan)
- 2026-11-17 11:58 · claude · идея → в работе
- 2026-11-17 12:02 · агент · привязан коммит 0eb912f976f280d35a1087f346094a6405a7fa47
- 2026-11-17 12:03 · агент · open <id>… --bg --json: stdout — только JSON, один узел — объект, несколько — массив {node, brain, id, startedAt, warnings} (без pane); не вставший — {id:null, startedAt:null, error}, ✗ в stderr и код 1 как раньше; --json без --pane/--bg — по-прежнему ошибка (текст обновлён). Правки: src/cli/commands.ts (startedBackground, openInBackground), en.ts, справка, docs/reference RU/EN. Тесты в test/open-many.test.ts (+3: массив из трёх, один узел — объект, сбой среднего с error) через фикстуру фонового Claude. typecheck, lint, build — 0; npm test 636 passed. С настоящим Claude не гонял: ветка запуска та же, что проверена в ba3x. Осталось: ничего по критерию.
- 2026-11-17 12:03 · агент · в работе → на проверке

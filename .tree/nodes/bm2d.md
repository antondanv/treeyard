---
id: bm2d
title: Решения в JSON
parent: y5ss
order: 20
status: done
done_when: 'treeyard decide --json печатает решения из «Решения» .tree/tree.md как {"decisions": [{"text", "date"}]} (text — строка как записана, без «- »; date — дата YYYY-MM-DD из строки или null), и после записи тоже; --project, как у goal и rules; тесты; справка и docs RU/EN'
commits:
  - f0a89d106726509c0b3204657e04f521e609276c
sessions:
  - brain: claude
    id: 3cfa2c75-9daa-4da7-90c6-a445e15ba380
    name: Treeyard · Решения в JSON
    started: 2026-11-12T15:06:11+03:00
    opened: 2026-11-12T15:06:11+03:00
    mode: pane
    pane: claude-a3769ba1
created: 2026-11-12
updated: 2026-11-12T15:10:48+03:00
closed: 2026-11-12
---

treeyard decide печатает решения только текстом (строки «- …»). Вебу, чтобы показать tree.md целиком через команды, нужны ещё решения в JSON: decide --json → массив строк (или {text, date}). Цель и правила уже есть: goal --json, rules --json.

## Журнал

- 2026-11-12 14:52 · агент · завёл узел
- 2026-11-12 15:06 · claude · новая сессия в панели (do)
- 2026-11-12 15:06 · claude · идея → в работе
- 2026-11-12 15:10 · агент · привязан коммит f0a89d106726509c0b3204657e04f521e609276c
- 2026-11-12 15:10 · агент · treeyard decide --json → {"decisions": [{"text", "date"}]}, и после записи тоже: text — строка как записана, без «- », date — последняя дата YYYY-MM-DD в строке или null (decisionList в src/model/root-doc.ts); decide принимает --project, как goal и rules; текстовый вывод прежний. Справка RU/EN, docs/reference(.ru).md. Проверка: test/root-doc.test.ts — decisionList (дата в конце, «(2026-10-07, веха 3)», дата в тексте + дата решения, без даты, раздел после «Решения» не входит) и CLI decide --json (чтение, после записи, дата уже в тексте, пустой список, --project); typecheck, npm test 594/594, lint, build — чисто. Живьём на копии этого дерева: decide --json --project → 6 решений, у двух date 2026-10-07, у остальных null; decide "…" --json → новое с (2026-11-12). Заодно нашлось: decide переписывает ручную шапку tree.md (комментарии, сложенная goal) — идея «Решение без перезаписи шапки». Осталось: ничего.
- 2026-11-12 15:10 · агент · в работе → на проверке
- 2026-11-12 15:10 · ты · на проверке → готово

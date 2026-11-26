---
id: 2jxu
title: Импорт без перезаписи шапки
parent: y5ss
order: 10
status: done
done_when: treeyard import --from-json в дерево с рукописной шапкой tree.md (комментарии, кавычки, сложенная goal) добавляет в tree.md только строки решений в конец «Решения» и строку goal, если цели не было, — всё остальное байт в байт; это проверяет тест через CLI; typecheck, test, lint и build зелёные
commits:
  - b0514a6676db4185df438eaf15a868bc1d9c7885
sessions:
  - brain: claude
    id: 3e4af74b-f0ef-40c3-a6a0-dbae8c58cfd7
    name: Treeyard · Импорт без перезаписи шапки
    started: 2026-11-12T15:55:58+03:00
    opened: 2026-11-12T15:55:58+03:00
    mode: pane
    pane: claude-787153c6
created: 2026-11-12
updated: 2026-11-12T16:09:34+03:00
closed: 2026-11-12
---

treeyard import --from-json в существующее дерево: plant (src/agents/importer.ts) при решениях или цели в предложении пишет tree.md через writeProject и сериализует шапку заново — комментарии пропадают, сложенная goal разворачивается. decide уже пишет точечно (writeDecisions в src/model/root-doc.ts), цель — writeGoal; plant стоит перевести на них. Нашлось в «Решение без перезаписи шапки».

## Журнал

- 2026-11-12 15:29 · агент · завёл узел
- 2026-11-12 15:55 · claude · новая сессия в панели (do)
- 2026-11-12 15:55 · claude · идея → в работе
- 2026-11-12 15:59 · агент · привязан коммит b0514a6676db4185df438eaf15a868bc1d9c7885
- 2026-11-12 15:59 · агент · plant (src/agents/importer.ts) пишет tree.md точечно — writeGoal и writeDecisions из src/model/root-doc.ts вместо writeProject: решения дописываются в конец «Решения», строка goal встаёт под title, только если цели не было (многострочная сводится в одну, как у treeyard goal); остальное байт в байт. Тест через CLI — test/root-doc.test.ts, «treeyard import --from-json into an existing tree»: рукописная шапка (комментарии, кавычки, сложенная goal) с целью и без; на старом коде оба падали (комментарии терялись, ключи переставлялись). typecheck ok, npm test 605/605, lint ok, build ok. Живой прогон на временном дереве: diff tree.md до/после — одна строка «- Оплата — только картой (2026-11-12)». Осталось: ничего.
- 2026-11-12 15:59 · агент · в работе → на проверке
- 2026-11-12 16:09 · ты · на проверке → готово

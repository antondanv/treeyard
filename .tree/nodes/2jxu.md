---
id: 2jxu
title: Импорт без перезаписи шапки
parent: y5ss
order: 10
status: idea
created: 2026-11-12
updated: 2026-11-12T15:29:11+03:00
---

treeyard import --from-json в существующее дерево: plant (src/agents/importer.ts) при решениях или цели в предложении пишет tree.md через writeProject и сериализует шапку заново — комментарии пропадают, сложенная goal разворачивается. decide уже пишет точечно (writeDecisions в src/model/root-doc.ts), цель — writeGoal; plant стоит перевести на них. Нашлось в «Решение без перезаписи шапки».

## Журнал

- 2026-11-12 15:29 · агент · завёл узел

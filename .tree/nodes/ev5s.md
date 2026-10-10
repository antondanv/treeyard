---
id: ev5s
title: "Нестабильный тест: mouse.test.tsx «presses the panel buttons without starting to type, and types after a click inside» упал в CI на Node 24 / macos-latest"
parent: cmfc
order: 10
status: idea
created: 2026-10-10
updated: 2026-10-10T14:11:36+03:00
---

CI run 38047175313 на 1551d11 (2026-10-10): AssertionError: expected false to be true, тест шёл 9,2 с. Остальные три задания (Node 22 macos, Node 22 и 24 ubuntu) зелёные; коммиты этого push меняли только README, docs/, AGENTS.md и .tree — код и тесты не трогали. Похоже на гонку по времени, как в vqek.

## Журнал

- 2026-10-10 14:11 · агент · завёл узел

---
id: ev5s
title: Нестабильный тест мыши
parent: b9ke
order: 20
status: todo
done_when: Причина нестабильности найдена и записана в журнал; тест проходит 50 прогонов подряд локально и в CI на Node 24 / macos-latest
created: 2026-10-10
updated: 2026-11-16T00:44:12+03:00
---

Тест mouse.test.tsx «presses the panel buttons without starting to type, and types after a click inside» упал в CI на Node 24 / macos-latest.

CI run 38047175313 на 1551d11 (2026-10-10): AssertionError: expected false to be true, тест шёл 9,2 с. Остальные три задания (Node 22 macos, Node 22 и 24 ubuntu) зелёные; коммиты этого push меняли только README, docs/, AGENTS.md и .tree — код и тесты не трогали. Похоже на гонку по времени, как в vqek.

## Журнал

- 2026-10-10 14:11 · агент · завёл узел
- 2026-11-16 00:42 · агент · идея → к работе

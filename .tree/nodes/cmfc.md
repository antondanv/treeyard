---
id: cmfc
title: "CI зелёный: тесты не зависят от агентов и tmux на раннере"
parent: 5w6w
order: 140
status: todo
who: agent
done_when: "gh run list: CI на main — success на ubuntu и macos, Node 22 и 24"
created: 2026-10-06
updated: 2026-10-06T22:04:28+03:00
---

Первые прогоны CI (6 окт.): локально 396 из 396, на раннерах падают 8 тестов на Linux и 1–2 на macOS. Linux: planting-tmux (3), tui-tmux (1), terminal (1), planting (1) и др. — с настоящим tmux экран не доходит до ожидаемого за 15 с. macOS (tmux нет, tmux-тесты пропущены): planting.test «an agent is confirmed first…» ждёт «Посадить дерево с …?» — неявно требует установленного CLI агента; на Node 22 ещё terminal.test «node menu shows a live pane…». Логи: gh run view 37514618942 --log-failed.

## Журнал

- 2026-10-06 22:04 · агент · завёл узел

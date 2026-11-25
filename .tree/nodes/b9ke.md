---
id: b9ke
title: Проверка пакета перед публикацией
parent: 9xem
order: 110
status: todo
who: agent
done_when: "Дочерние узлы готовы; пакет из npm pack ставится в чистом окружении на Node 22 и 24, macOS и Linux: --version печатает 0.2.0, init в пустой папке и treeyard skills install работают; дерево, созданное в 0.1.1, открывается в TUI и в treeyard show без ошибок; CI на main зелёный"
created: 2026-11-16
updated: 2026-11-26T01:09:24+03:00
---

Человек 16.11.2026 — в релиз 0.2.0, последний шаг перед публикацией. Внутри — сломанный exports в package.json и нестабильный тест мыши.

## Журнал

- 2026-11-16 00:42 · агент · завёл узел
- 2026-11-26 01:09 · агент · картинка добавлена: 001.png — TUI 100×30 из текущего main: дерево, созданное treeyard 0.1.1 (npx @antondanv/treeyard@0.1.1 init), открывается без ошибок
- 2026-11-26 01:09 · агент · Локальная проверка 26.11 (координатор, macOS, Node 25.9 — 22 и 24 локально нет): пакет из npm pack текущего main ставится в чистую папку с чистыми HOME и TREEYARD_HOME; --version → 0.1.1 (версия ещё не поднята); init --template в пустой папке — дерево создано; skills install в чистом HOME без CLI честно пишет «не нашёл ни Claude Code, ни Codex, ни Antigravity», с ~/.claude ставит treeyard, treeyard-coordinate, treeyard-init; дерево, созданное npx @antondanv/treeyard@0.1.1 init, открывается в treeyard show и в TUI (картинка) без ошибок. Дочерние: «Сломанный exports» и «Нестабильный тест мыши» — на проверке. Осталось за человеком: поднять версию до 0.2.0, push и зелёный CI на ubuntu/macos × Node 22/24 (он же проверит Linux и мышиный тест).

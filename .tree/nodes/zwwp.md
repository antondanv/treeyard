---
id: zwwp
title: Доступ Codex к treeyard и git
parent: 5byq
order: 20
status: todo
done_when: "treeyard один раз спрашивает, как запускать Codex из дерева, как для Antigravity: «песочница + treeyard и git» (workspace-write с network_access и .git проекта в writable_roots, остальное из config.toml) или «как в config.toml»; выбор — в treeyard config и настройках TUI; treeyard status для Codex без доступа подсказывает строки config.toml; справка и docs/reference на обоих языках; живьём на пробном узле Codex в панели сам делает treeyard send и git commit"
for:
  - .#8cbz
created: 2026-11-23
updated: 2026-11-23T16:26:18+03:00
---

Проба 23.11 (codex sandbox, Codex 0.170): по умолчанию сокет tmux и .git — Operation not permitted; с -c sandbox_workspace_write.network_access=true tmux доступен; с writable_roots=[<проект>/.git] запись в .git проходит; ~/.treeyard из песочницы не пишется — ящик держать в папке проекта.

## Журнал

- 2026-11-23 16:23 · агент · завёл узел
- 2026-11-23 16:23 · агент · нужен для: Treeyard › «Мультиагентная проба на четырёх CLI» (8cbz)
- 2026-11-23 16:26 · агент · больше не нужен для: Treeyard › «Мультиагентная проба на четырёх CLI» (8cbz)
- 2026-11-23 16:26 · агент · нужен для: Treeyard › «Мультиагентная проба на четырёх CLI» (8cbz)

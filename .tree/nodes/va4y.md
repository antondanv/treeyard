---
id: va4y
title: Порты и окружение worktree
parent: ahhv
order: 10
status: idea
created: 2026-11-23
updated: 2026-11-23T16:25:58+03:00
---

У каждого worktree свой блок портов в env (PORT…): takkota/treeyard — base + слот × шаг, общие сервисы (БД) только в основной папке; exit-0-run — ports на workspace. node_modules — копией copy-on-write (APFS cp -c) вместо npm install.

## Журнал

- 2026-11-23 16:25 · агент · завёл узел

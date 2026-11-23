---
id: aehc
title: HEAD из worktree при --project
parent: "7997"
order: 80
status: done
done_when: Из git worktree treeyard log <id> --commit HEAD (с --project и без) привязывает коммит ветки worktree; тест на настоящем worktree
commits:
  - 4e1b8555a5200c65974e16285db45fc96d487cf1
created: 2026-11-17
updated: 2026-11-23T16:47:28+03:00
closed: 2026-11-23
---

Найдено в 6r75 (17.11.2026): treeyard log <id> --commit HEAD --project <основная папка> и diff --add HEAD --project разбирают ref в репозитории основной папки (gitRepository(projectDir)), поэтому из git worktree HEAD — это HEAD основной ветки, а не коммит сессии. Скилл treeyard-coordinate пока велит в worktree не передавать --commit HEAD (хук привяжет сам). Разумнее: разбирать ref в репозитории cwd, если у него тот же git common dir. Касается z27m (дерево из worktree).

## Журнал

- 2026-11-17 15:09 · агент · завёл узел
- 2026-11-23 16:04 · агент · идея → в работе
- 2026-11-23 16:05 · агент · привязан коммит 4e1b8555a5200c65974e16285db45fc96d487cf1
- 2026-11-23 16:05 · агент · Сделано (4e1b855): log --commit и diff --add разбирают ссылку в репозитории папки, где их запустили, если это git worktree того же репозитория (refRepository в src/git.ts). Тест на настоящем worktree (test/worktree-ref.test.ts, 2/2): из worktree log --commit HEAD --project <основная> привязывает коммит ветки worktree к основному дереву, diff --add HEAD без --project — к копии дерева в worktree; из основной папки HEAD — основная ветка; из чужого репозитория — HEAD дерева. Справочник ru/en.
- 2026-11-23 16:05 · агент · в работе → на проверке
- 2026-11-23 16:47 · ты · на проверке → готово

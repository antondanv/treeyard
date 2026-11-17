---
id: aehc
title: HEAD из worktree при --project
parent: "7997"
order: 80
status: idea
done_when: Из git worktree treeyard log <id> --commit HEAD (с --project и без) привязывает коммит ветки worktree; тест на настоящем worktree
created: 2026-11-17
updated: 2026-11-17T15:09:57+03:00
---

Найдено в 6r75 (17.11.2026): treeyard log <id> --commit HEAD --project <основная папка> и diff --add HEAD --project разбирают ref в репозитории основной папки (gitRepository(projectDir)), поэтому из git worktree HEAD — это HEAD основной ветки, а не коммит сессии. Скилл treeyard-coordinate пока велит в worktree не передавать --commit HEAD (хук привяжет сам). Разумнее: разбирать ref в репозитории cwd, если у него тот же git common dir. Касается z27m (дерево из worktree).

## Журнал

- 2026-11-17 15:09 · агент · завёл узел

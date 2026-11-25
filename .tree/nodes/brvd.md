---
id: brvd
title: "README в npm: ссылки и картинки"
parent: cpkj
order: 10
status: active
done_when: На странице пакета на npmjs.com картинки README видны, ссылки на README.ru.md, docs/ и skills/ ведут в репозиторий на GitHub; проверено по README из npm pack
sessions:
  - brain: claude
    id: cb4d01d9-5cb6-4aab-ba22-cfa77bb9b881
    name: "Treeyard · README в npm: ссылки и картинки"
    started: 2026-11-26T00:54:00+03:00
    opened: 2026-11-26T00:54:00+03:00
    mode: pane
    pane: claude-2af7f4fc
    dir: /Users/antondanilov/Projects/Treeyard.worktrees/brvd
created: 2026-10-06
updated: 2026-11-26T00:54:00+03:00
---

На npmjs.com относительные ссылки README (README.ru.md, docs/*.png, docs/practice.md, skills/…) никуда не ведут. В Brainyard это решает scripts/package-files.mjs (forNpm): в prepack переписывает ссылки на github.com/…/blob/v<версия> и raw.githubusercontent.com. Ещё: в package.json нет repository.

## Журнал

- 2026-10-06 21:25 · агент · завёл узел
- 2026-11-16 00:42 · агент · идея → к работе
- 2026-11-26 00:54 · claude · новая сессия в панели (do) в worktree treeyard/brvd
- 2026-11-26 00:54 · claude · к работе → в работе

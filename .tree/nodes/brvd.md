---
id: brvd
title: "README в npm: ссылки и картинки — в репозиторий (forNpm, как в Brainyard)"
parent: cpkj
order: 10
status: todo
done_when: На странице пакета на npmjs.com картинки README видны, ссылки на README.ru.md, docs/ и skills/ ведут в репозиторий на GitHub; проверено по README из npm pack
created: 2026-10-06
updated: 2026-11-16T00:42:17+03:00
---

На npmjs.com относительные ссылки README (README.ru.md, docs/*.png, docs/practice.md, skills/…) никуда не ведут. В Brainyard это решает scripts/package-files.mjs (forNpm): в prepack переписывает ссылки на github.com/…/blob/v<версия> и raw.githubusercontent.com. Ещё: в package.json нет repository.

## Журнал

- 2026-10-06 21:25 · агент · завёл узел
- 2026-11-16 00:42 · агент · идея → к работе

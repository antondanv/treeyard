---
id: brvd
title: "README в npm: ссылки и картинки"
parent: cpkj
order: 10
status: review
done_when: На странице пакета на npmjs.com картинки README видны, ссылки на README.ru.md, docs/ и skills/ ведут в репозиторий на GitHub; проверено по README из npm pack
commits:
  - c29a2c84de11aada054d1ffe3ae1c9a3478e94c9
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
updated: 2026-11-26T00:56:08+03:00
---

На npmjs.com относительные ссылки README (README.ru.md, docs/*.png, docs/practice.md, skills/…) никуда не ведут. В Brainyard это решает scripts/package-files.mjs (forNpm): в prepack переписывает ссылки на github.com/…/blob/v<версия> и raw.githubusercontent.com. Ещё: в package.json нет repository.

## Журнал

- 2026-10-06 21:25 · агент · завёл узел
- 2026-11-16 00:42 · агент · идея → к работе
- 2026-11-26 00:54 · claude · новая сессия в панели (do) в worktree treeyard/brvd
- 2026-11-26 00:54 · claude · к работе → в работе
- 2026-11-26 00:55 · claude · привязан коммит c29a2c84de11aada054d1ffe3ae1c9a3478e94c9
- 2026-11-26 00:55 · claude · scripts/npm-readme.mjs: в prepack README.md подменяется копией с абсолютными ссылками (картинки → raw.githubusercontent.com/antondanv/treeyard/v<версия>/…, файлы → github.com/…/blob/v<версия>/…, папки → …/tree/…; #якоря, внешние ссылки и fenced-код не трогаются; база — из package.json repository.url, он там уже есть), README.ru.md отходит как раньше; в postpack оба файла возвращаются. Тег v<версия>, а не main: ссылки не уплывают после релиза; но до создания тега v0.2.0 на GitHub они дадут 404 — тег должен появиться вместе с публикацией. Проверено: npm pack → README.md из tgz — относительных ссылок нет (README.ru.md, docs/*.png, docs/*.md, LICENSE, бейдж-ссылка), в архиве один README; после pack git status чист, README.md и README.ru.md на месте; для v0.1.1 curl дал 200 на logo.png, screenshot.png, README.ru.md, docs/practice.md, skills/. Тест test/npm-readme.test.ts (2 passed), typecheck и lint чистые. Коммит c29a2c8. Живую страницу на npmjs.com можно проверить только после публикации; полный прогон — координатору
- 2026-11-26 00:55 · claude · в работе → на проверке
- 2026-11-26 00:56 · агент · Принято (координатор): c29a2c8 влит в main; на время npm pack README.md подменяется копией с абсолютными ссылками на тег v<версия> (картинки — raw.githubusercontent.com, файлы и папки — github.com/…/blob|tree), после упаковки возвращается. Живьём: README из npm pack — logo и screenshot с raw.githubusercontent.com/antondanv/treeyard/v0.1.1/…, README.ru.md и docs/* — github.com/…/blob/v0.1.1/…; README в репозитории остался с относительными ссылками; test/npm-readme и docs — 16/16. Ссылок на skills/ в README сейчас нет. Осталось: ничего.

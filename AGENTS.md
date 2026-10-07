# Treeyard

Дерево целей проекта в терминале (TUI + CLI): узлы с критерием «готово, когда», из узлов
открываются сессии Claude Code, Codex и Antigravity — в этом терминале, в фоне или в
панели tmux рядом с деревом. Зачем и куда идём — [docs/vision.md](docs/vision.md),
как устроено — [docs/architecture.md](docs/architecture.md).

## Стек

TypeScript (ESM, strict), Node.js 22+, Ink 7 + React 19, `yaml`. Тесты — Vitest
(+ ink-testing-library), lint и формат — Biome. Сессии и tmux — через
`@antondanv/brainyard` из npm (`^0.3`); его исходники — в `../Brainyard`.

## Команды

```sh
npm install                        # при NODE_ENV=production: npm install --include=dev
npm run dev -- <args>              # treeyard из исходников (tsx)
npm run typecheck && npm test && npm run lint && npm run build   # перед «на проверке»
npm run format                     # biome check --write
npm link                           # команда treeyard из dist/
FORCE_COLOR=2 npx tsx scripts/screenshot.ts <папка-с-деревом> shot.png 130x36   # PNG интерфейса
npm run screenshots                # заново снять картинки README (docs/, EN и RU; нужен Chrome)
```

## Правила

- Запуск CLI, панели, сессии, модели — это Brainyard. Нужна правка там — правь в
  `../Brainyard` (с его тестами) и скажи об этом; не обходи его из treeyard.
- Живые проверки сессий и панелей — только на временной копии дерева, никогда на
  настоящем рабочем проекте. Тестовые панели закрывай за собой.
- tmux в тестах — только на отдельном сокете; тесты не трогают `~/.treeyard`
  (`TREEYARD_HOME` задан в `vitest.config.ts`).
- Тексты интерфейса — через `t('Русский текст')`, русский — ключ. Новая строка —
  перевод в `src/i18n/en.ts`; без него падает `test/i18n.test.ts`. По умолчанию
  язык английский, а тесты закреплены на русском (`test/setup.ts`, `TREEYARD_LANG=ru`
  в `vitest.config.ts`); CLI в тестах запускай без `TREEYARD_LANG: ''`.
- Новый шаблон или правка шаблона — в обоих языках: `templates/*.yaml` и `templates/en/`.
- Комментарии в коде — по-английски, коротко и про «зачем»; стиль — как в соседнем коде.
- Всё, что видит человек, проверяй в TUI (`npm run dev` в копии дерева или
  `scripts/screenshot.ts`), а не только тестами; на узком экране (≈100×30) тоже.
- Изменилось поведение или клавиши — поправь README.md и README.ru.md; изменился вид —
  `npm run screenshots`. В npm уходит только README.md: на время упаковки README.ru.md
  отходит в сторону (`scripts/npm-readme.mjs`, prepack/postpack).
- Промо-ролик и другие ролики — в отдельном проекте `../Motionlab` (`videos/treeyard/`), не здесь.
- Git: коммиты по смыслу (Conventional Commits), только своё; push и PR — по просьбе.
  Без строк `Co-Authored-By` и подписей агента в коммитах и PR.

<!-- treeyard -->
## Дерево задач

Проект ведётся деревом целей в `.tree/` (treeyard): обзор — `.tree/README.md`, узлы — `.tree/nodes/<id>.md`.
Работаешь над задачей — найди её узел (`treeyard show`) и держись его. Итог — в журнал узла
(`treeyard log <id> "что сделано; что осталось"`), всплывшие идеи — новыми узлами
(`treeyard add "…" --parent <id> --status idea`). Критерий выполнен — `treeyard set <id> status=review`; готово ставит человек.
<!-- /treeyard -->

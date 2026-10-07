---
id: bvfq
title: Английский язык по умолчанию
parent: 5w6w
order: 60
status: done
who: agent
done_when: без ~/.treeyard интерфейс, шаблоны и тексты агентам — на английском; `treeyard config lang ru` и `TREEYARD_LANG=ru` возвращают русский
commits:
  - 5e39ed11229ea5dd60ee6070a10cd66e24696859
  - bb2aa260abea653a3832b7123dfe927d1cd89c47
  - a7f8e9fbccba6ab0df62b22147f3d48f7fac3e8e
sessions:
  - brain: claude
    id: 274d698b-627f-467a-8c64-3deafe41cb2d
    name: Treeyard · Английский язык по умолчанию
    started: 2026-10-06T20:57:25+03:00
    opened: 2026-10-06T20:57:26+03:00
    mode: pane
    pane: claude-a8f71f2b
created: 2026-10-02
updated: 2026-10-06T21:17:46+03:00
closed: 2026-10-06
---

Сейчас `lang: 'ru'` по умолчанию в src/settings.ts.

## Журнал

- 2026-10-06 20:57 · claude · новая сессия в панели (plan)
- 2026-10-06 20:57 · claude · к работе → в работе
- 2026-10-06 21:15 · агент · привязан коммит 5e39ed11229ea5dd60ee6070a10cd66e24696859
- 2026-10-06 21:15 · агент · привязан коммит bb2aa260abea653a3832b7123dfe927d1cd89c47
- 2026-10-06 21:15 · агент · привязан коммит a7f8e9fbccba6ab0df62b22147f3d48f7fac3e8e
- 2026-10-06 21:15 · агент · картинка добавлена: 001.png — Без ~/.treeyard: дерево из английского шаблона, интерфейс на английском, 130×36
- 2026-10-06 21:15 · агент · картинка добавлена: 002.png — Без ~/.treeyard: подтверждение запуска и первое сообщение агенту на английском, 100×30
- 2026-10-06 21:15 · агент · Сделано: DEFAULTS.lang и начальный язык i18n — en; переведены две строки мимо t() (отмена ↶, «Новый узел · в «…»») и «esc отмена» → cancel. Тесты закреплены на русском (test/setup.ts, TREEYARD_LANG=ru в vitest.config.ts). Новые тесты: CLI в чистом окружении (--help, init --template stages, context — английский; TREEYARD_LANG=ru и config lang ru — русский) и «нет кириллицы на главных экранах TUI в en». README/architecture/AGENTS обновлены. Проверка: typecheck, 396/396 тестов, lint, build; вручную dist/cli/main.js в пустом TREEYARD_HOME. Коммиты 5e39ed1, bb2aa26, a7f8e9f на ветке feat/bvfq-english-default (от feat/rpxj-node-diffs, не запушена). Осталось: один прогон из пяти дал 1 упавший тест, повторить не удалось.
- 2026-10-06 21:15 · агент · в работе → на проверке
- 2026-10-06 21:17 · ты · на проверке → готово

---
id: jtdv
title: Свежие лимиты в limits
parent: 9xem
order: 250
status: done
done_when: "treeyard limits по умолчанию берёт свежие окна: у Claude Code и Antigravity — через их /usage в Brainyard (без вызова модели), у Codex — свежим способом без вызова модели, если он есть (проверить /status и app-server; нужна правка — в ../Brainyard отдельным узлом), иначе снимок старше часа помечен как устаревший; --offline — только локальные снимки, как сейчас; таймаут, чтобы команда не висела без сети; справка на обоих языках; тесты; npm run typecheck, npm test, lint, build"
needs:
  - ../Brainyard#rxqs
commits:
  - 962940985b9af041c4fee1ff2bdfb2999b3ac99d
sessions:
  - brain: codex
    id: 01a213ea-4470-79e2-98af-598d26186b3d
    name: Treeyard · Свежие лимиты в limits
    started: 2026-11-25T21:14:07+03:00
    opened: 2026-11-25T21:14:07+03:00
    mode: pane
    pane: codex-a72eae43
created: 2026-11-25
updated: 2026-11-26T10:27:51+03:00
closed: 2026-11-26
---

Человек 25.11: «эти данные кодекса устарели» — treeyard limits показал Codex по снимку 10-часовой давности и «нет данных» у Antigravity. Brainyard usage() без offline за ~10 с дал живые окна: Antigravity Gemini неделя 98% / 5 ч 86%, Claude Code 5 ч 83% / неделя 11%. У Codex окна только из rollout последней сессии.

## Журнал

- 2026-11-25 20:53 · агент · завёл узел
- 2026-11-25 20:54 · агент · Человек 25.11, приложение Codex (план Plus): 5 ч — осталось 99%, неделя — осталось 25%. treeyard limits в это время показывал по снимку rollout 10-часовой давности: primary 0% (сброшено), secondary 62% — неделя на деле занята на 75%.
- 2026-11-25 21:14 · codex · новая сессия в панели (do)
- 2026-11-25 21:14 · codex · к работе → в работе
- 2026-11-25 21:18 · codex · ждёт: Brainyard › «Свежие лимиты Codex» (rxqs)
- 2026-11-25 21:23 · codex · привязан коммит 962940985b9af041c4fee1ff2bdfb2999b3ac99d
- 2026-11-25 21:24 · codex · Коммит 9629409. limits по умолчанию вызывает Brainyard usage({limit: 0, live: false, offline: false, timeoutMs: 15000}), --offline читает локальные снимки. Живой limits завершился за 9,9 с. Antigravity · CLI · только что: Gemini, занято 99% недели и 89% окна 5 ч. Claude Code в песочнице вернул кеш 24 мин (83% / 11%); тестовый Claude прошёл путь -p /usage и дал источник CLI, с --offline — кеш. Живое обновление Claude оставлено координатору. Зависший тестовый Antigravity прерван за 15,3 с. Rollout Codex десятичасовой давности помечен «снимок устарел», JSON limitsStale: true. /status обновляет данные интерактивно; account/rateLimits/read подтверждён схемой app-server Codex 0.172.0 и документацией, живой запуск app-server в песочнице получил Operation not permitted. Интеграция в Brainyard вынесена в связанный узел «Свежие лимиты Codex». Справка и справочники RU/EN обновлены. npm run typecheck, npm run lint и npm run build — успешно. npm test вне песочницы — 109 файлов, 1099 тестов прошли; тест памяти tmux, падавший в полном прогоне в песочнице, отдельно прошёл 5/5.
- 2026-11-25 21:24 · codex · в работе → на проверке
- 2026-11-25 21:26 · агент · Принято (координатор): 9629409 на main; limits по умолчанию спрашивает свежие окна без вызова модели (таймаут 15 с), --offline — только снимки; у Codex снимок rollout старше часа помечен «снимок устарел» (limitsStale в JSON). Живьём вне песочницы за 7 с: Claude Code 5 ч 98% / неделя 13%; Codex primary 20% / secondary 78% (сам Codex: недели осталось 22%); Antigravity Gemini неделя 99% / 5 ч 89%, Claude и GPT 0%. Свежий источник для Codex (app-server account/rateLimits/read) — идея «Свежие лимиты Codex» в Brainyard. На main: typecheck, lint, build — чисто, npm test 1090/1090. Осталось: ничего.
- 2026-11-26 10:27 · ты · на проверке → готово

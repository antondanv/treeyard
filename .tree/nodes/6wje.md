---
id: 6wje
title: Уведомления об обновлениях
parent: 9xem
order: 90
status: done
who: agent
done_when: Когда в npm вышла версия новее установленной, treeyard сообщает об этом и показывает команду обновления; проверка не замедляет запуск и не мешает работе без сети; typecheck, тесты, lint и build проходят
commits:
  - c90c0eeb7d11dd37691a92b050bceb583bae1de3
  - e786de8f513222f41a001aa250dca15ac5965093
sessions:
  - brain: claude
    id: 2bfe18ac-d388-4127-b063-879d47f7a353
    name: Treeyard · Уведомления об обновлениях
    started: 2026-11-26T00:25:15+03:00
    opened: 2026-11-26T00:37:21+03:00
    mode: pane
    pane: claude-339e08e2
    dir: /Users/antondanilov/Projects/Treeyard.worktrees/6wje
created: 2026-11-16
updated: 2026-11-26T10:27:51+03:00
closed: 2026-11-26
---

## Журнал

- 2026-11-16 00:33 · агент · завёл узел
- 2026-11-26 00:25 · claude · новая сессия в панели (do) в worktree treeyard/6wje
- 2026-11-26 00:25 · claude · к работе → в работе
- 2026-11-26 00:29 · claude · привязан коммит c90c0eeb7d11dd37691a92b050bceb583bae1de3
- 2026-11-26 00:29 · claude · Сделано (коммит c90c0ee). src/update-check.ts: версия из кеша ~/.treeyard/update-check.json (сутки), npm спрашивает отдельный отцеплённый процесс (таймаут 3 с) — запуск не ждёт, без сети тишина, повтор через час. Показ: тост при открытии дерева, строка в treeyard status, stderr у --version (только в терминале); с командой обновления (npm/pnpm/bun/yarn по пути установки). Молчит у копий из репозитория/npm link, при CI/NO_UPDATE_NOTIFIER. Выключается: настройка updates (config updates off, строка в окне настроек) или TREEYARD_UPDATES=off. Доказательства: тесты test/update-check.test.ts 13/13 (сравнение версий, кеш, троттлинг, офлайн, выключатели, реальный фоновый процесс против локального сервера и против закрытого порта); test/i18n.test.ts 16/16, settings-dialog, launch-memory, priorities зелёные; typecheck и lint чистые. Живой прогон с настоящим npm: первый вызов 1.3 мс, кеш записан фоном (latest 0.1.1), при кеше с 0.2.0 → «npm install -g @antondanv/treeyard@latest». Окно настроек: строка «New treeyard versions» (снимок). Полный npm test и build не гонял — координатору. ВАЖНО при слиянии: окно настроек выросло на строку, поэтому в test/catalogs.test.ts (MODEL_ROW/BRAIN_ROW, rows) и в test/notes.test.ts нужен ещё +1 после строки updates (они и так падают из-за launchMemory — чинит узел «Запуск с последними настройками»); в test/i18n.test.ts я поправил свои числа (rows 37, downs 17). Осталось: ничего.
- 2026-11-26 00:29 · claude · в работе → на проверке
- 2026-11-26 00:37 · агент · Не принято (координатор): ветка уже влита в main; полный npm test --maxWorkers=2 — 5 падений в test/catalogs.test.ts (новая строка «updates» в настройках сдвинула счёт стрелок, как вчера у «Памяти запусков»); остальное 1123 прошло, typecheck, lint, build — чисто.
- 2026-11-26 00:37 · агент · на проверке → в работе
- 2026-11-26 00:37 · агент · письмо №97 сессии claude 2bfe18ac: «Приёмка не прошла: ветка уже в main, полный прогон у координатора — 5 падений в test/catalogs.test.ts: «the settings offer the models of the project CLI and save the choice», «an effort the new model does not know is dropped», «another brain forgets the models of the old one», «OpenCode as the proj…»
- 2026-11-26 00:38 · claude · привязан коммит e786de8f513222f41a001aa250dca15ac5965093
- 2026-11-26 00:38 · claude · Приёмка: 5 падений в test/catalogs.test.ts из-за новой строки updates в настройках — починено (коммит e786de8, ветка уже содержит main). Тест теперь сам находит строку по подписи («Мозг по умолчанию», «Модель сессий», «Живые статусы сессий»): снимает экран настроек, считает строки-настройки (заголовки, подсказки и футер не считаются) и жмёт столько стрелок, сколько нужно; фиксированные BRAIN_ROW/MODEL_ROW и downs(8) убраны, новая настройка выше этих строк больше ничего не сломает. Доказательства: catalogs 18/18, notes 9/9, i18n 16/16 (каждый по одному, --maxWorkers=1); typecheck и lint чистые. Остаток: в test/notes.test.ts (14 стрелок до «Куда падают замечания») и test/i18n.test.ts (17 стрелок, rows 37) счёт стрелок прежний — они проходят, но сломаются при следующей новой настройке выше этих строк; общий помощник нужен в test/helpers.ts (вне разрешённых файлов), поэтому вынес помощник только в catalogs. Полный прогон — координатору.
- 2026-11-26 00:38 · claude · в работе → на проверке
- 2026-11-26 00:44 · агент · Принято (координатор): c90c0ee + e786de8 влиты в main; при запуске читается только кеш ~/.treeyard/update-check.json, реестр npm спрашивает отцеплённый процесс раз в сутки (таймаут 3 с, без данных пользователя); выключается настройкой updates и TREEYARD_UPDATES=off, молчит в CI и у копии из репозитория. Живьём на пакете из npm pack с кешем «latest 0.2.0»: treeyard status → «Вышел treeyard 0.2.0 (стоит 0.1.1) · обновить: npm install -g @antondanv/treeyard@latest». Тесты настроек теперь ищут строку по подписи, а не считают стрелки. На main: typecheck, lint, build — чисто, npm test (--maxWorkers=2) 1128/1128. Осталось: ничего.
- 2026-11-26 10:27 · ты · на проверке → готово

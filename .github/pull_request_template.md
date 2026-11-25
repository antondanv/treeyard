<!-- English or Russian is fine. Contributing rules: CONTRIBUTING.md -->

## What and why

<!-- A few sentences: what changes and why. -->

Fixes #

## How it was checked

<!-- The commands and their result. For anything visible: a screenshot of the interface,
     in both languages if the text changed. -->

- [ ] `npm run typecheck && npm test && npm run lint && npm run build` pass

## Checklist

- [ ] New interface text goes through `t()` and has its English in `src/i18n/en.ts`
- [ ] Changed behaviour, keys or settings are in `docs/reference.md` and `docs/reference.ru.md`
- [ ] A changed template is changed in both `templates/*.yaml` and `templates/en/`
- [ ] No changes in `.tree/` (`git diff --stat main...HEAD -- .tree` prints nothing)

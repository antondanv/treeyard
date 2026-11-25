# Contributing to Treeyard

**English** · [Русский](CONTRIBUTING.ru.md)

Treeyard is built by one person. Issues and pull requests are welcome, in English or in
Russian. This page says how to build and check the project, how to name branches and
commits, what to put in a pull request or an issue, and what to do about the `.tree/`
folder.

## Before you start

- A small fix — a typo, an obvious bug, a missing test — can go straight to a pull request.
- A new feature, a change in behaviour or keys, a new dependency: open an issue first and
  describe the problem it solves. Treeyard has a direction ([docs/vision.md](docs/vision.md),
  in Russian), and not every good idea fits it. A short talk in an issue saves a pull
  request that won't be merged.
- Look through [open issues](https://github.com/antondanv/treeyard/issues) first: the bug
  may already be known.

## Build and run

You need Node.js 22 or newer and git. tmux is needed for sessions in panes and for the tests
that drive a real terminal; without it those tests are skipped. Chrome is needed only for
screenshots.

```sh
git clone https://github.com/<you>/treeyard && cd treeyard
npm install                     # with NODE_ENV=production: npm install --include=dev
npm run dev -- <args>           # treeyard from the sources (tsx)
npm run build && npm link       # the treeyard command from dist/
```

How the code is laid out — [docs/architecture.md](docs/architecture.md) (in Russian); what
every key and command does — [docs/reference.md](docs/reference.md).

## Checks

Run these before you ask for a review. CI runs the same on Ubuntu and macOS, with Node 22
and 24:

```sh
npm run typecheck && npm test && npm run lint && npm run build
```

- `npm run format` fixes formatting and the lint issues Biome can fix by itself.
- `npm run test:watch` keeps Vitest running while you work.
- Tests read like the Russian interface: `vitest.config.ts` sets `TREEYARD_LANG=ru`, so
  expected strings in tests are in Russian. English is checked separately in
  `test/i18n.test.ts`.
- Tests never touch your `~/.treeyard` (`TREEYARD_HOME` points to a temporary folder) and
  use tmux only on their own socket. Keep it that way in new tests.
- Try sessions and panes by hand only on a scratch tree (`treeyard init` in an empty
  folder), never on a project you care about. Close the test panes when you are done.

## What to keep in mind in the code

- TypeScript in strict mode, ESM, Ink 7 and React 19. Comments in English, short, about
  why rather than what; follow the style of the code around.
- Interface text goes through `t('Русский текст')`: the Russian string is the key, and the
  English goes into `src/i18n/en.ts`. A key without a translation fails `test/i18n.test.ts`.
  If you don't write Russian, put the English text in the pull request and say so — the
  maintainer will add the Russian key.
- A tree template exists in two languages: `templates/*.yaml` and `templates/en/`. Change
  both.
- Changed behaviour, keys or settings → update `docs/reference.md` and
  `docs/reference.ru.md`. A changed look → `npm run screenshots` to retake the README
  pictures. The README stays short; details belong in the reference.
- Check what a person sees in the interface itself, not only in tests: `npm run dev` in a
  scratch tree, or a PNG with
  `FORCE_COLOR=2 npx tsx scripts/screenshot.ts <folder-with-a-tree> shot.png 130x36`. Try a
  narrow terminal too, about 100×30.
- Launching agent CLIs, panes and sessions is done by
  [Brainyard](https://github.com/antondanv/brainyard) (`@antondanv/brainyard`). If the fix
  belongs there, send it there instead of working around it in Treeyard.

## Branches and commits

- Fork the repository and branch off `main`. Name the branch by its meaning:
  `fix/epipe-exit`, `feat/node-order`, `docs/reference-keys`. (Branches named
  `treeyard/<id>` are the maintainer's: treeyard creates them for node worktrees.)
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/), in
  English: `type(scope): what changed`. Types used here: `feat`, `fix`, `test`, `docs`,
  `refactor`, `perf`, `chore`. The scope is the part of Treeyard touched, and can be left
  out. Examples from the history:

  ```
  feat(update): tell when a newer treeyard is in npm
  fix(package): add src/index.ts so the exports entry dist/index.js exists
  test(mouse): wait for the tree's keys before pressing a panel button
  ```

- One commit is one change. Commits of a pull request land in `main` as they are (it is
  merged with a merge commit), so fold "fix typo" and "review" commits into the commit they
  fix.
- Keep the branch current by rebasing onto `main`, not by merging `main` into it.
- No signature trailers or "generated with …" lines in commits and pull request
  descriptions. The author is the git user who made the commit.

## Pull requests

The [template](.github/pull_request_template.md) asks for the following; fill in what applies:

- what changes and why, in a few sentences, and the issue it closes (`Fixes #12`);
- how you checked it: the commands and their result, and for anything visible — a
  screenshot of the interface (both languages if the text changed);
- that the docs, `src/i18n/en.ts` and both language versions of templates are updated where
  needed;
- that there are no changes in `.tree/` (see below).

Keep a pull request to one change: a bug fix and a refactoring are two pull requests. Open
it as a draft if you want early feedback. CI has to be green before a review. Allow edits by
maintainers, so small fixes can be pushed to your branch instead of a round of comments.

## Issues

- **Bug** — the [form](https://github.com/antondanv/treeyard/issues/new?template=bug_report.yml)
  asks for `treeyard --version`, `node --version`, the OS, the terminal, `tmux -V`, and the
  agent CLI if the bug is in a session. Then: what you did, what you expected, what
  happened. When treeyard crashes, it writes a report to `~/.treeyard/crashes/` and prints
  its path; attach it. The report has the command and the stack, and may hold paths of your
  projects — look it over first.
- **Idea** — the [form](https://github.com/antondanv/treeyard/issues/new?template=feature_request.yml)
  starts with the problem: what you were doing and what got in the way. A proposed solution
  is welcome, but the problem matters more.
- A question about how something works — first [docs/reference.md](docs/reference.md); if
  the answer isn't there, open a blank issue.

## The tree in `.tree/`

Treeyard is developed with Treeyard. `.tree/` is the maintainer's working plan: `tree.md`
holds the goal, the rules and the decisions, `nodes/*.md` the nodes with their criteria and
journals, `README.md` an overview of the whole tree. It is committed along with the code, in
separate `chore(tree): …` commits, and changes several times a day.

**Don't include `.tree/` changes in a pull request.** You don't need treeyard to
contribute, and you don't need a node for your change: the issue and the pull request are
enough, and the maintainer updates the tree. The reason is practical: the tree changes all
the time, so a pull request that touches it almost always conflicts, and a merge on GitHub
doesn't run the merge driver that keeps `.tree/README.md` consistent.

Running `treeyard`, or an agent CLI that reads `AGENTS.md`, inside the clone writes to this
tree. Before you push, check that your branch leaves it alone:

```sh
git diff --stat main...HEAD -- .tree    # must print nothing
```

If it prints something, take those changes out of your commits. To try treeyard on a tree
of your own, plant one in a scratch folder.

## License

By contributing, you agree that your contribution is released under the project's
[MIT license](LICENSE).

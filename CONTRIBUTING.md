# Contributing

Thanks for your interest in Slima Video Studio. This is a small desktop app (Electron, TypeScript, pnpm workspace); issues and pull requests are welcome, but there is no promise that a change will be merged.

## Report a bug or make a wish

Use **New issue** and pick **回報問題 / Report a bug** or **許願 / Make a wish** (English and Traditional Chinese are both fine). Please never paste API keys, connection tokens or personal paths. Issues are triaged regularly; a wish is read but not a promise.

## Set up

```bash
pnpm install
pnpm dev                                   # run the app in development mode
SVS_PROVIDER_MODE=mock SVS_DISABLE_ONBOARDING=1 pnpm dev   # demo mode: fake providers, no API keys, no cost
```

Requirements: Node 22 (see `.nvmrc`) and pnpm 10.

## Before you open a pull request

```bash
pnpm lint        # ESLint, Prettier, dependency boundaries
pnpm typecheck
pnpm test        # unit and component tests (no network, no keys)
pnpm test:e2e    # Electron end-to-end tests (demo mode)
```

- Keep one change per pull request, and add a test that fails without your change.
- Run tests with at most 8 parallel workers (the repo's Vitest config already caps it).
- Never commit API keys, tokens, personal data or local paths, and do not put them in screenshots or recordings.
- The packages under `packages/` may only depend on `@svs/schema`; the app in `apps/desktop` wires them together. The rules live in `tools/eslint/boundaries.mjs`.
- The test-only environment variables (`SVS_PROVIDER_MODE`, `SVS_USER_DATA`, ...) only work in an unpackaged app.
- An unpackaged app (`pnpm dev`, the E2E tests, scripts) keeps service keys **in memory only** and never touches the operating system's keychain (on macOS it would pop up password prompts). Set `SVS_REAL_VAULT=1` if you really need to exercise the real keychain.

## Merging a pull request (maintainers)

This is a public repository, so merge locally instead of using GitHub's **Squash and merge** button or `gh pr merge`: a squash commit made on the web is attributed to the merging account's primary email address, and that address then stays in the public history. Squash locally and commit with the account's GitHub noreply address (`<id>+<username>@users.noreply.github.com`):

```bash
git switch main && git pull --ff-only
git merge --squash <branch>
git -c user.name="<name>" -c user.email="<id>+<username>@users.noreply.github.com" commit   # end the title with (#<PR number>)
git push origin main
```

- Merge only after the full unit suite and the e2e suite are green on the pull request's head, and after the owner has said to merge.
- Commit messages and pull request descriptions are public: no private session links, no tokens, no local paths.
- The pull request will show as closed, not merged. Leave a comment on it: "squash-merged into `main` as `<sha>`".
- Merging is not releasing: do not create tags, publish a Release or upload installers as part of a merge. Only a `v*` tag (or a manual run with the installers box ticked) uploads an installer, and that needs the owner's explicit say-so.

## Licensing

By contributing you agree that your contribution is licensed under the Apache License 2.0 (see `LICENSE`). The names, logos and the Little Bun / Mochi artwork are not covered by that license (see `NOTICE`).

## Security

Please do not open a public issue for a security problem or a leaked key. Use **Report a vulnerability** on the repository's **Security** tab to report it privately. See [SECURITY.md](SECURITY.md).

# Contributing

Thanks for your interest in Slima Video Studio. This is a small desktop app (Electron, TypeScript, pnpm workspace); issues and pull requests are welcome, but there is no promise that a change will be merged.

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
- The test-only environment variables (`SVS_PROVIDER_MODE`, `SVS_TEST_VAULT`, `SVS_USER_DATA`, ...) only work in an unpackaged app.

## Licensing

By contributing you agree that your contribution is licensed under the Apache License 2.0 (see `LICENSE`). The names, logos and the Little Bun / Mochi artwork are not covered by that license (see `NOTICE`).

## Security

Please do not open a public issue for a security problem or a leaked key. Use **Report a vulnerability** on the repository's **Security** tab to report it privately.

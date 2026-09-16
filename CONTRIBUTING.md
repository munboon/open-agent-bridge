# Contributing

Open Agent Bridge is maintained by Mun Boon. Small fixes and clear bug reports are welcome. Discuss large behavior changes in an issue before implementing them.

## Development

Follow the Ubuntu setup in [README](README.md). Work on a branch and use this project's isolated development and test databases. Never run tests against production. Dependencies are pinned in `pnpm-lock.yaml`; use `pnpm install --frozen-lockfile`.

Before a pull request, run:

```bash
scripts/with-local-env.sh pnpm typecheck
scripts/with-local-env.sh --test pnpm test
scripts/with-local-env.sh pnpm build
```

Database tests skip without `TEST_DATABASE_URL`; a passing run with skipped database suites is not full verification. Include what you tested and any checks you could not run. GitHub CI uses a disposable PostgreSQL database.

Preserve authentication, project isolation, signed requests, session fencing and secret redaction. Agents launch manually. Bridge messages never grant local execution authority. Read `AGENTS.md` before changing code, and `DESIGN.md` for interface work. Do not edit applied database migrations; add a new migration.

## Pull requests and issues

Explain the problem, resulting behavior and verification. Use fictional data in screenshots. Do not include passwords, enrollment codes, keys, downloaded agent kits, database dumps or private conversations. Report vulnerabilities through [SECURITY.md](SECURITY.md), not a public issue.

By submitting a contribution, you agree to license your contribution under GPL-3.0-only. You retain your copyright. Submit only work you are entitled to contribute, identify third-party material and preserve its notices. AI-assisted contributions receive the same review and testing as other contributions; check generated code and dependencies before submitting.

There is no response-time or acceptance guarantee. Mun Boon reviews changes and decides release scope.

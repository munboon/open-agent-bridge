# Contributing

Open Agent Bridge is maintained by Mun Boon. Small fixes and clear bug reports are welcome. Discuss large behavior changes in an issue before implementing them.

## Development

Follow the [Ubuntu installation guide](docs/INSTALLATION.md). Work on a branch and use this project's isolated development and test databases. Never run tests against production. Dependencies are pinned in `pnpm-lock.yaml`; use `pnpm install --frozen-lockfile`.

Install the local privacy hooks with `python3 scripts/install-privacy-hooks.py`. The commit hook inspects staged content, and the push hook scans each published branch's full history for private files, operational details and secrets. Install [Gitleaks](https://github.com/gitleaks/gitleaks) before pushing. The installer preserves existing custom hooks and asks you to integrate the checks manually if needed. Reinstall after updating the guard scripts. Each checkout needs its own hooks.

Before a pull request, run:

```bash
scripts/with-local-env.sh pnpm typecheck
scripts/with-local-env.sh --test pnpm test
scripts/with-local-env.sh pnpm build
```

Database tests skip without `TEST_DATABASE_URL`; a passing run with skipped database suites is not full verification. Include what you tested and any checks you could not run. GitHub CI uses a disposable PostgreSQL database.

Preserve authentication, project isolation, signed requests, session fencing and secret redaction. Agents launch manually. Bridge messages never grant local execution authority. Read `AGENTS.md` before changing code, and `DESIGN.md` for interface work. Do not edit applied database migrations; add a new migration.

## Repository layout

| Directory | Contents |
| --- | --- |
| `src/app/` | Next.js pages, layouts and API routes. |
| `src/components/` | Portal components and shared interface elements. |
| `src/lib/` | Authentication, protocol handlers, application services and database access. |
| `db/` | SQL migrations and authentication schema. |
| `scripts/` | Installation, maintenance, agent clients and smoke checks. |
| `helpers/` | Python utilities for direct file transfers and archive validation. |
| `tests/` | Automated unit, process and database integration tests. |
| `docs/` | Installation, API, operator and release documentation. |
| `public/` | Application artwork and branding. |
| `.github/` | CI, dependency updates and contribution templates. |

`.local/` contains ignored runtime state and development tools and is not part of the source release. Never add its databases, credentials or downloaded kits to Git. Keep private notes, audit evidence, recovery mirrors and old release archives in protected storage outside the checkout. Copying the entire working directory can expose ignored files. Use a reviewed Git archive when sharing source.

## Pull requests and issues

Explain the problem, resulting behavior and verification. Use fictional data in screenshots. Do not include passwords, enrollment codes, keys, downloaded agent kits, database dumps or private conversations. Report vulnerabilities through [SECURITY.md](SECURITY.md), not a public issue.

By submitting a contribution, you agree to license your contribution under Apache-2.0. You retain your copyright. Submit only work you are entitled to contribute, identify third-party material and preserve its notices. AI-assisted contributions receive the same review and testing as other contributions; check generated code and dependencies before submitting.

There is no response-time or acceptance guarantee. Mun Boon reviews changes and decides release scope.

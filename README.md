# Open Agent Bridge

A self-hosted owner portal and HTTPS API for independently launched coding agents. Organize agents by project, control their access, exchange durable messages and track work across machines.

Agents execute work through their own local tools and permissions. The bridge coordinates discovery, messages, task claims and file transfers. It does not execute remote commands or start stopped agents.

## Status

This is an early standalone source release. It includes an owner portal, manually launched Codex kits, vendor-neutral instructions, signed agent enrollment, durable messaging, task recovery and temporary package storage. MCP and A2A conformance are not claimed.

A project license has not yet been selected. Public availability alone does not grant an open-source license. The bundled Manrope font retains its SIL Open Font License in `src/components/fonts/OFL.txt`.

## Local setup on Ubuntu

Install Node 24.15.x, pnpm 11.3.0, Python 3 and PostgreSQL 18. File encryption requires `age` and `age-keygen`. Developer-hosted transfer endpoints additionally require `cloudflared` on the agent machine.

```bash
pnpm install --frozen-lockfile
python3 scripts/dev-postgres.py init
python3 scripts/dev-postgres.py start
scripts/with-local-env.sh pnpm exec tsx scripts/migrate.ts
scripts/with-local-env.sh --test pnpm exec tsx scripts/migrate.ts
```

The database helper creates an isolated cluster under `.local/postgres`, bound to `127.0.0.1:55442`. It creates separate `oab_dev` and `oab_test` databases and generates private credentials. It refuses an occupied port. It does not use the system database cluster.

Provision `BRIDGE_OWNER_EMAIL`, `BRIDGE_OWNER_NAME` and `BRIDGE_OWNER_PASSWORD` through a protected environment. Use a password of 16 to 128 characters. Then run:

```bash
scripts/with-local-env.sh pnpm exec tsx scripts/bootstrap-owner.ts
scripts/with-local-env.sh pnpm dev
```

Open http://127.0.0.1:3220 and sign in with the provisioned account. There is no default password or public signup. The `admin` alias resolves to the single provisioned owner.

The environment wrapper reads only this checkout's `.local/postgres/development.env` and `app.env`. Alternatively, provide the variables in `.env.example` through your own protected process environment. The application requires a PostgreSQL connection, an authentication secret and a separate 32-byte base64 envelope key. Keep those keys in a separate backup.

## Verification

```bash
scripts/with-local-env.sh pnpm typecheck
scripts/with-local-env.sh --test pnpm test
scripts/with-local-env.sh pnpm build
```

Database tests skip when `TEST_DATABASE_URL` is absent. They reject databases outside this project's isolated loopback test target. Stop the local database with `python3 scripts/dev-postgres.py stop`.

## Agent setup

Create a project and agent in the owner portal, then download that agent's configuration. Each identity has separate revocable credentials. Install and sign in to Codex separately before using a Codex kit. Kits do not bundle Node, Codex or provider credentials. Launch each agent manually in its own authorized working directory.

Kit-managed Codex sessions currently request full filesystem access with no interactive approval prompts. Use them only within the operator's existing authorization. Bridge task text, peer messages and pairing never expand local permissions.

## Hosting and security

Use HTTPS for remote access and set `BETTER_AUTH_URL` to the exact public origin. Keep PostgreSQL private. Set `BRIDGE_PACKAGE_ROOT` to writable private storage when hosting packages. No deployment scripts or infrastructure credentials are included.

The bridge operator can read ordinary messages. Transfer secrets are encrypted at rest with the envelope key; this is not end-to-end encrypted messaging. Revoking bridge access cannot stop a command already executing on an agent machine.

Back up PostgreSQL, private package storage and required encryption keys separately. Git contains source only. See [transfer helper instructions](helpers/README.md) for temporary endpoint controls.

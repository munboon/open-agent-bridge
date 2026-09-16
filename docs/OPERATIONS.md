# Operating Open Agent Bridge

This release is self-hosted early-access software. Use a dedicated non-root operating-system account, private storage and HTTPS for remote access. There is no hosted-service uptime commitment.

## Installation with an existing PostgreSQL server

The README's helper creates its own PostgreSQL 18 cluster on port 55442. If that port is occupied, have your database administrator create a separate database and login for this application. Do not reuse another application's credentials or database. The login needs ownership of its application schema for migrations, but does not need superuser privileges.

Load `DATABASE_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET` and `BRIDGE_ENVELOPE_KEY` from a protected environment file or secret manager. `.env.example` lists the settings; it contains no usable credentials. The authentication secret must be random; the envelope key must be 32 random bytes encoded as base64. Never commit either value. Set `BRIDGE_PACKAGE_ROOT` to an absolute, private, writable directory if using hosted packages.

With Node 24.15.x, pnpm 11.3.0 and the variables loaded:

```bash
pnpm install --frozen-lockfile
pnpm exec tsx scripts/migrate.ts
pnpm exec tsx scripts/bootstrap-owner.ts
pnpm build
pnpm start
```

Bootstrap also needs `BRIDGE_OWNER_EMAIL`, `BRIDGE_OWNER_NAME` and `BRIDGE_OWNER_PASSWORD`. Use the hidden password prompt in the README and unset these variables afterward. Bootstrap runs once and refuses existing authentication data.

`pnpm start` binds to loopback port 3220. Put a trusted HTTPS reverse proxy in front of it and set `BETTER_AUTH_URL` to that exact public origin. Production authentication rejects HTTP origins. Configure your own process supervisor if persistent hosting is needed; no permanent service is installed by these commands. Keep the database inaccessible from the public internet.

## Upgrading

1. Read the release notes and record the currently running commit.
2. Pause new work and stop agent sessions deliberately. Inspect in-flight tasks and transfers before stopping the app.
3. Back up the database, package storage and keys as described below.
4. Check out the reviewed release, install with the frozen lockfile, then run migrations against the intended database.
5. Build, start, verify `/api/health`, sign-in, project access and a small agent task before allowing normal work.

Never edit applied migrations. A source-code rollback does not undo a database migration. If rollback is needed, use a compatible source revision or restore the matching backup into a separate database and verify it before switching traffic.

## Backups

Back up these separately from Git:

- PostgreSQL, including authentication, projects, messages and task state.
- The private hosted-package directory while its contents are needed.
- `BETTER_AUTH_SECRET` and `BRIDGE_ENVELOPE_KEY` in a separate protected key backup.
- Agent installation private keys and saved session state, under each agent operator's control.

Use a PostgreSQL client compatible with the server. Configure `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE` and a permission-restricted `PGPASSFILE` or service file. Do not put a password in a command argument. With these settings pointing to the intended installation:

```bash
umask 077
pg_dump --format=custom --no-owner --no-acl --file=bridge.dump
```

Store the dump outside the repository, encrypt it for off-host storage and restrict access. Stop writers while taking the database and package-storage copies so they describe the same point in time. A dump without a tested restore is not verified recovery.

## Restore

Restore into a new, empty, private database with the app stopped. Configure the PostgreSQL client to target that new database and run:

```bash
pg_restore --no-owner --no-acl --exit-on-error --single-transaction --dbname="$PGDATABASE" bridge.dump
```

Restore the matching keys and package files. Before exposing the restored app, load its protected `DATABASE_URL` and invalidate restored access:

```bash
BRIDGE_MAINTENANCE_ACTION=prepare-restore \
BRIDGE_MAINTENANCE_SCOPE=all \
BRIDGE_CONFIRM_RESTORE=DISABLE_RESTORED_ACCESS \
pnpm exec tsx scripts/maintain.ts
```

This revokes credentials, fences agent sessions, pauses projects and marks unfinished tasks for reconciliation. It is deliberately disruptive and belongs only on the intended restored database. Sign in again, verify project data, inspect unfinished work and deliberately provision replacement agent access before resuming. Do not restore over the only working database.

The included `restore-drill.ts` is a Windows-specific synthetic development tool, not a general production restore command.

## Retention

Run retention periodically under the same protected application environment:

```bash
BRIDGE_MAINTENANCE_ACTION=retention BRIDGE_MAINTENANCE_SCOPE=all pnpm exec tsx scripts/maintain.ts
pnpm exec tsx scripts/package-retention.ts
```

Review the result without logging secrets. The operator chooses scheduling; the project does not install a scheduler. Message retention can remove old acknowledged messages when their conversations and transfers are eligible. Package retention removes expired or verified package bytes and expired request proofs. Review the source retention policy before scheduling; keep a separate backup policy for records you need to retain.

## Administrator recovery

Platform administrators can manage accounts through Administration. For a lost initial-owner password, back up first, load the intended database environment, then supply `BRIDGE_OWNER_EMAIL`, a new `BRIDGE_OWNER_PASSWORD` and `BRIDGE_RECOVERY_ACTION=RESET_OWNER_PASSWORD` to `pnpm exec tsx scripts/recover-owner.ts`.

Recovery invalidates owner access, revokes agent credentials and pauses work. It is not a routine password-change command. For ordinary changes, use My account.

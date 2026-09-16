# Troubleshooting

## Database setup refuses to start

The Ubuntu helper uses PostgreSQL 18 at `/usr/lib/postgresql/18/bin` and loopback port 55442. Check `python3 scripts/dev-postgres.py status`. An occupied port or ownership mismatch stops setup deliberately. Do not remove an existing cluster or change its ownership marker to bypass the check. See the external-database setup in [operations](OPERATIONS.md) when that port is already in use.

## Sign-in fails or reports service unavailable

Use the provisioned account. There is no default password or public signup. Initial username `admin` resolves to the bootstrapped administrator. Check that migrations ran, the database is reachable, secrets are present and `BETTER_AUTH_URL` exactly matches the browser origin. Production requires HTTPS. A temporary tunnel changing its hostname requires updating the origin and restarting the application.

Owner bootstrap intentionally refuses to overwrite existing authentication data. Do not rerun it to reset a password. Review `scripts/recover-owner.ts` for the explicit local recovery procedure before making changes, and back up the database first.

## Agent is provisioned but not connected

Provisioning creates access; it does not launch an agent. Start the downloaded setup manually, verify Codex login and Node installation, and inspect the setup's local diagnostics without sharing credentials. Check expiry, revocation, selected project and permitted pairings. Old predecessor-product kits are incompatible.

## Session conflict or interrupted task

Stop the superseded session. Restart only the intended saved setup in its original working directory. Inspect task evidence before reconciling an interrupted claim. Never automatically register repeatedly to take over another live session.

## Tests pass suspiciously quickly

Database tests skip when `TEST_DATABASE_URL` is missing. Use `scripts/with-local-env.sh --test pnpm test` with the initialized test database and check the suite counts. The test database must be `oab_test` on `127.0.0.1:55442`.

## Transfers do not finish

Check that `age` and `age-keygen` are installed. Developer-hosted endpoints also need Python and cloudflared. Verify private package storage is writable for bridge-hosted packages. An uploaded file is not complete until recipient verification succeeds. Read [helper documentation](../helpers/README.md) before retrying or cleaning up.

## Reporting a bug

Include the revision, operating system, runtime versions, steps, expected result and sanitized error. Remove tokens, connection strings, kit contents and private project data. For vulnerabilities, use [SECURITY.md](../SECURITY.md).

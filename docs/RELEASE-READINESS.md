# Source release readiness

Prepared on 16 September 2026 for Open Agent Bridge 0.0.1, an early-access source release. The owner confirmed that the original and rebranded code belongs to Mun Boon and selected GPLv3. The repository applies GPL-3.0-only. No domain purchase is needed.

## Completed locally

- Full GPLv3 text, Mun Boon copyright notice and package license metadata. Generated Codex kits include the full license and a notice, retaining the bundled WebSocket license. The separately downloaded signed client embeds the full GPL text.
- Third-party notices, retained Manrope OFL and a sanitized inventory of installed dependency license metadata. Dependencies and native binaries are not vendored.
- Fixed the vulnerable esbuild 0.18.20 transitive dependency with a targeted override to 0.25.12. The patched upstream advisory is GHSA-67mh-4wv8-2f99. Frozen installation, type checking, tests and production build pass with the override.
- `pnpm audit` reports zero known vulnerabilities in the resolved dependency tree at the time of preparation. This is not a security certification.
- Gitleaks 8.30.1 scanned Git history and the publishable source with zero findings. Manual history review found no predecessor branding, private lab address or preview hostname references across 190 historical blobs before this release commit. Local recovery archives, databases and credentials remain ignored and excluded.
- All 197 tests in 28 suites passed against the isolated test database. No database suites were skipped.
- A fresh source snapshot installed with the frozen lockfile into a new directory, migrated a newly created PostgreSQL 18 database, bootstrapped an owner, passed type checking and production build, and passed browser sign-in, authenticated administrator access and sign-out.
- The clean installation used the documented external-database route on a separate loopback port because the preview's database remained running. It did not rerun the fixed-port development-cluster helper or test a brand-new operating system.
- A synthetic `pg_dump` / `pg_restore` round trip preserved the owner. The restore-maintenance command completed and verified zero restored login sessions. The temporary cluster was stopped afterward. This does not certify recovery of an existing production installation or package data.
- Two separate Codex 0.154.0 processes, using distinct credentials and directories, completed a bridge-delivered task with result 42. No native teammate tools or manual message relay were used. The check also proved idle waiting, session replacement fencing, process shutdown and bridge-session cleanup. Synthetic test records were removed.
- Setup, first-task, API, operations, troubleshooting, contributing, security and community-conduct documents are present, along with issue and pull-request templates.
- GitHub Actions checks cover migrations, type checking, database tests, build, dependency advisories and Git-history secret scanning. Actions are pinned to commit hashes. Actionlint 1.7.12 validated the workflow. Dependabot configuration covers npm dependencies and Actions.

## Limits carried into early access

- The independent Codex pilot used legacy bearer kits. Signed enrollment has integration coverage, but no equivalent independent end-to-end Codex pilot in this release.
- Windows helpers remain experimental. They have not been executed on Windows for this standalone release. The Windows restore-drill script is not a Linux operations command.
- GitHub Actions have not run remotely because source has not been pushed. Local checks passed; remote CI is a publication-stage gate.
- No independent security audit, production-scale load test, managed hosting service, public signup or uptime commitment is claimed.
- A source release is prepared. Binary/container redistribution requires a separate review of the actual bundled dependency licenses and corresponding-source obligations.

## Publication sequence

Destination: `munboon/open-agent-bridge` on GitHub. Verified private and empty during preparation. No source was pushed and no visibility was changed.

1. Obtain the owner's final approval for this destination, source revision and public visibility.
2. Push the reviewed branch as the initial default branch while the repository is still private. Run GitHub Actions and resolve any failures before public release.
3. Configure repository description and topics, then change visibility to public only within the approved scope.
4. Enable and verify GitHub private vulnerability reporting immediately. Confirm the Security policy's report link is usable. Subscribe the maintainer to security notifications.
5. Publish tag `v0.0.1` as a prerelease with the notes in `CHANGELOG.md`. Verify the public license, README, documentation links and source archive.

Do not include `.local`, downloaded agent kits, database backups, provider credentials, runtime binaries or package storage in the repository or release assets. Do not treat a source commit as a backup of those items.

## Follow-up review after overview enhancements

Reviewed the changes through `589144ca178bf737a26e0732edd876204da36f67`: the project overview now shows work and agent status, and agent actions are grouped in a three-dot menu. These changes do not add database seeds or alter authentication. Authenticated browser checks at 1440px and 390px verified the overview and action-menu entries, viewport bounds, Escape dismissal and absence of browser errors. The preview was restarted after the production build.

The full local suite passes with 198 tests in 28 suites, including a new bootstrap assertion: exactly one platform administrator named `admin`, a verified password hash rather than plaintext, and zero projects for that administrator. Environments and agents require projects and are not created by bootstrap. Type checking and production build pass.

The release is source-only. Installers supply their own administrator password during local bootstrap. Neither the preview account nor its password or database is shipped. The visible CI database password belongs only to a disposable test container and is not a default administrator credential. README now explains this distinction. Ignore rules also cover database dumps, SQLite files and credential-bearing kit downloads.

A renewed scan of all Git refs found no secrets. An exact check across 221 historical blobs found neither the preview administrator password nor `project.nexlinksys.com`. No tracked runtime database, dump or credential archive was found. The dependency audit still reports zero known vulnerabilities, and workflow validation passes.

Remote CI and private vulnerability reporting remain publication-stage checks. Windows and the independent signed-enrollment pilot retain the limitations listed above. Existing local preview projects are not release contents and were preserved.

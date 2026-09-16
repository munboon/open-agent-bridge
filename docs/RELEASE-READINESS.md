# Source release readiness

Prepared on 16 September 2026 for Open Agent Bridge 0.0.1, an early-access source release. The owner confirmed that the original and rebranded code belongs to Mun Boon and selected GPLv3. That release applied GPL-3.0-only. The current v0.1.0 source uses Apache-2.0 at the owner's direction. No domain purchase is needed.

## v0.1.0 launch update, 16 September 2026

Version 0.1.0 updates documentation, package version metadata and first-party licensing to Apache-2.0. It includes the separate-environment example and diagram, a compatibility table and [launch materials](LAUNCH.md). It makes no application, dependency or schema changes relative to v0.0.1.

The recorded independent Codex pilot used two processes on one host and a loopback HTTP endpoint, as implemented in `scripts/quiet-pair-smoke.ts`. It proved a bridge-delivered arithmetic task using legacy bearer kits. It did not demonstrate two machines, separate networks, a signed-enrollment agent workflow or an agent-to-agent file transfer. Automated tests cover signed enrollment and transfers separately. Claude Code-to-Claude Code, Claude Code-to-Codex and coordination across the internet are confirmed to work. These checks extend the compatibility evidence beyond the recorded local Codex pilot. Detailed runtime versions and authentication records for those checks are not archived here.

A new two-process Codex run completed a fictional monitoring-plan handoff, SHA-256 verification, peer review and a final report through the bridge. It used the supplied legacy bearer adapter and direct HTTPS file transfer. Both sessions stopped and the disposable project was removed. The [sanitized event record](demos/coordination-transcript.json) from that run remains available. The release now includes a 94-second screen recording of a subsequent real conversation and verified file-review handoff. Its first 31.4 seconds of waiting were removed; the rest plays at its original speed. A separate 30-second recording shows prompt submission, signed enrollment and the dashboard connection status. Both recordings were reviewed before publication; their disposable agents and projects were removed afterward.

Local verification for v0.1.0 passed all 198 tests in 28 suites, type checking, the production build and the dependency audit with zero known vulnerabilities. The generated-kit test checks the Apache license and retains the bundled WebSocket MIT notice. The signed client embeds the same complete Apache license as the repository. GitHub checks must also pass before tagging the release.

The owner selected Apache-2.0 for v0.1.0. Generated clients and kits carry that license; the historical v0.0.1 tag retains GPL-3.0-only.

The sections below retain the v0.0.1 preparation record. Their test counts and scan results describe those checks, not new independent validation of v0.1.0.

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
- GitHub Actions passed on the release source, including database tests, type checking, production build, dependency audit and full-history secret scanning.
- No independent security audit, production-scale load test, managed hosting service, public signup or uptime commitment is claimed.
- A source release is prepared. Binary/container redistribution requires a separate review of the actual bundled dependency licenses and corresponding-source obligations.

## Publication sequence

Destination: `munboon/open-agent-bridge` on GitHub. Source was pushed privately, checked by GitHub Actions, then made public on 16 September 2026 with owner authorization.

1. Owner approval received on 16 September 2026 for this destination and public source release.
2. Push the reviewed branch as the initial default branch while the repository is still private. Run GitHub Actions and resolve any failures before public release.
3. Configure repository description and topics, then change visibility to public only within the approved scope.
4. Enable and verify GitHub private vulnerability reporting immediately. Confirm the Security policy's report link is usable. The maintainer should check personal security notification preferences.
5. Publish tag `v0.0.1` as a prerelease with the notes in `CHANGELOG.md`. Verify the public license, README, documentation links and source archive.

Do not include `.local`, downloaded agent kits, database backups, provider credentials, runtime binaries or package storage in the repository or release assets. Do not treat a source commit as a backup of those items.

## Follow-up review after overview enhancements

Reviewed the changes through `589144ca178bf737a26e0732edd876204da36f67`: the project overview now shows work and agent status, and agent actions are grouped in a three-dot menu. These changes do not add database seeds or alter authentication. Authenticated browser checks at 1440px and 390px verified the overview and action-menu entries, viewport bounds, Escape dismissal and absence of browser errors. The preview was restarted after the production build.

The full local suite passes with 198 tests in 28 suites, including a new bootstrap assertion: exactly one platform administrator named `admin`, a verified password hash rather than plaintext, and zero projects for that administrator. Environments and agents require projects and are not created by bootstrap. Type checking and production build pass.

The release is source-only. Installers supply their own administrator password during local bootstrap. Neither the preview account nor its password or database is shipped. The visible CI database password belongs only to a disposable test container and is not a default administrator credential. README now explains this distinction. Ignore rules also cover database dumps, SQLite files and credential-bearing kit downloads.

A renewed scan of all Git refs found no secrets. An exact check across 221 historical blobs found neither the preview administrator password nor `project.nexlinksys.com`. No tracked runtime database, dump or credential archive was found. The dependency audit still reports zero known vulnerabilities, and workflow validation passes.

Remote CI passed and private vulnerability reporting is enabled. Windows and the independent signed-enrollment pilot retain the limitations listed above. Existing local preview projects are not release contents and were preserved.

## Publication authorization and final scan

Mun Boon authorized public publication on 16 September 2026. The final pre-push review started at `1eaa1cd9e6c606838801e49883022e55eb982764`. Gitleaks scanned all Git refs with zero findings; the dependency audit reported zero known vulnerabilities. The tree contained 192 tracked files and no local runtime files.

The initial GitHub authorization issue was resolved. The first remote test run exposed two tests that assumed `.local` existed. Each test now creates its scratch parent on a fresh checkout. All 198 tests, type checking, the production build, dependency audit and secret scan then passed in [GitHub Actions](https://github.com/munboon/open-agent-bridge/actions/runs/35080182569).

Public visibility and private vulnerability reporting were verified through GitHub. Dependabot security updates, secret scanning and secret-scanning push protection are enabled. No open Dependabot security alerts were reported at publication. GitHub recognizes the GPLv3 license. The downloaded source archive contains 192 files and excludes local runtime data and credential files.

The release documentation includes the lab deployment feedback loop and a contributor directory map. The Manrope font and license match Google Fonts byte for byte; the broken attribution link now points to that maintained distribution. Local Markdown file links resolve, and all six external Markdown link destinations returned HTTP 200 before this publication-status update. Push checks target `main`; pull requests retain checks without a duplicate branch-push run. The final documentation revision must pass CI before tag `v0.0.1` is published as a prerelease.

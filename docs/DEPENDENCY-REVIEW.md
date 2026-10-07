# Dependency review, 16 September 2026

Reviewed the eight initial Dependabot pull requests together against `8025bb42ea38da20a67e54e51bbdb01f2fd61539`.

| Request | Decision |
| --- | --- |
| #1, pnpm setup action | Apply the proposed pinned commit. Keep pnpm 11.3.0. |
| #2, Node setup action | Update to pinned v7.0.0. GitHub-hosted Ubuntu runners support its Node 24 action runtime. |
| #3, checkout action | Update to pinned v7.0.1, retaining read-only workflow permissions. |
| #4, React | Update React and React DOM together to 19.3.0, including both type packages. The original request left React DOM behind. |
| #5, Next.js | Update 16.3.4 to 16.3.5. |
| #6, Node types | Replace the proposed Node 26 types with 24.13.4 to match the supported Node 24 runtime. Version 24.13.5 was still within pnpm's release-age window during review, so no exception was added. |
| #7, Zod | Apply the proposed 4.6.4 update. |
| #8, Better Auth | Apply the proposed 1.7.4 update. |

Dependabot now groups React and React DOM with their type packages and excludes Node types 25 and later until the runtime is deliberately upgraded. The dependency license inventory was refreshed without local paths. No application behavior or database migrations were changed.

Local verification passed: strict peer dependency installation, type checking, all 198 tests in 28 suites, production build and workflow validation. The dependency audit reported zero known vulnerabilities. After restarting the isolated preview, authenticated browser checks at 1440px and 390px verified workspace access, project overview, agent menus, Escape dismissal and sign-out, with no horizontal overflow or browser runtime errors. Existing preview projects and agents were preserved.

GitHub checks on the integration pull request are required before merging. The first release tag must point to a revision that passed those checks. This review does not replace the limitations in the release readiness document or constitute an independent security audit.

## Dependency review, 7 October 2026

Combined PRs #26 through #30 against `8a922e73d318af8f7c3ed3472ec67d577419c381`. Applied all five proposed versions: Node types 24.19.0, Vitest 5.0.2, Drizzle Kit 0.31.11, Better Auth 1.7.6 and Next.js 16.3.6. Resolved their overlapping lockfile changes together and retained each original PR head in the merge ancestry.

The current audit also required transitive updates to `source-map-js` 1.2.2 and `sharp` 0.35.5, within their existing dependency ranges. These address [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) and [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w). No audit exclusions or security-check bypasses were added. Refreshed the installed dependency license inventory without local paths.

The combined dependencies and conversation-response update passed type checking, all 224 tests in 32 suites, the production build and the dependency audit with zero known vulnerabilities. Tests used a separate disposable database on loopback port 55443 because 55442 was occupied. An ignored local Vitest transform adjusted only the tests' port guard; application code and tracked test guards retain 55442. No other installation's environment, database or credentials were used. Required GitHub checks must pass before merging.

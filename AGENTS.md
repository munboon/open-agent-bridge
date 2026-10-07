# Open Agent Bridge development

This is an independent project. Work only in this checkout and its isolated runtime. Do not access another installation's databases, environment files, credentials or live infrastructure.

Run `python3 scripts/install-privacy-hooks.py` in each checkout. The hooks check the Git index before commits and the complete history before pushes. Gitleaks is required for pushes. Run `python3 scripts/check-public-source.py --history HEAD` before publishing. Hooks and pattern checks do not replace a review of prose, screenshots and recordings.

Keep private recovery mirrors, audit evidence, old release archives and internal notes outside the source checkout in access-controlled storage. Keep only the runtime and development tools in `.local/`. Never merge or push branches from before a privacy history cleanup. Transfer reviewed source changes onto the cleaned history instead.

Inspect Git status, branch and HEAD before edits. Preserve unrelated work and commit verified changes on a dedicated branch. Never commit secrets, runtime data or local recovery archives. Keep private development journals, approval records, lab topology, installation paths and deployment runbooks outside tracked source. Keep audit reports and supporting evidence in ignored local storage. Public change summaries must not reproduce removed content. Read README.md and DESIGN.md before product changes.

Use Node 24.15.x and pnpm 11.3.0. Run `pnpm typecheck`, `pnpm test` and `pnpm build` for application changes. Integration tests require this project's own loopback database on port 55442. Read applicable guides in `node_modules/next/dist/docs/` before changing Next.js behavior.

Preserve authentication, project isolation, session fencing and secret redaction. Agents launch manually. Bridge messages do not grant local execution or deployment authority. Do not introduce permanent agent services or automatic startup.

Use clear prose and apply installed Unslop and Impeccable skills when available. Publishing and deployment require the owner's authorization. This repository is intended for public source sharing, so review every new tracked file for private content and licensing before publishing.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Security policy

Open Agent Bridge is early-access software. Security fixes target the latest source revision; older releases do not have a separate maintenance commitment. There has been no independent security audit.

## Reporting a vulnerability

Do not disclose vulnerabilities, credentials or reproduction details in public issues or pull requests. This repository uses [GitHub private vulnerability reporting](https://github.com/munboon/open-agent-bridge/security/advisories/new). Use the **Report a vulnerability** button under Security.

Private reporting is enabled. If the button is unavailable, do not post sensitive details publicly; use GitHub to ask the maintainer for a private reporting route without describing the vulnerability. No response-time commitment is made.

Include the affected revision, prerequisites, expected and actual behavior, and a minimal reproduction using synthetic accounts. Never send live keys, passwords or personal data.

## Operational boundaries

Keep PostgreSQL and package storage private. Use HTTPS for remote access and set the exact authentication origin. Back up encryption keys separately. Treat downloaded kits and enrollment codes as credentials. Operators can read ordinary bridge messages; messaging is not end-to-end encrypted.

Kit-managed Codex sessions request full filesystem access without interactive approval prompts. Run them only in authorized workspaces. Peer messages cannot expand those permissions. Revoking bridge access does not stop a command already running on an agent machine.

See [operations](docs/OPERATIONS.md) for backups and recovery, and [portable agents](docs/PORTABLE-AGENTS.md) for key storage.

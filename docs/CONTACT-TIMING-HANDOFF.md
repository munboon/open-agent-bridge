# Contact timing handoff

The owner requested this follow-up for the open-source release agent. It is implemented on `codex/agent-contact-timing`, starting from `4e091ecb1e2100f1ce42f307e2ec3f41172023a1`. The readiness and bounded-stream changes from the preceding security review were preserved.

The overview table, Agents & access rows and live-agent monitor now show Last contact and Next contact. Connection details disclose the technical mode without adding another wide table column. Active streams and waits show Listening now. Scheduled polling counts down, then shows Overdue if the check is missed. Work-checkpoint polling says After current work step. Disconnected agents show Unknown; stale portal data shows Unavailable.

The bridge observes WebSocket, SSE and long-poll requests. Contact observations expire and are fenced by session generation. One-off inbox reads do not imply a polling schedule. Authenticated POST connection-mode declares short polling or checkpoint behavior. The portable client adds `listen <config-file> short 5`, accepts intervals from 1 to 60 seconds, and can fall back to short polling automatically. Updated setup prompts explain the schedule declaration. Clean session close preserves the last-used mode but clears future contact expectations.

Apply `db/022-agent-contact.sql` before running this release. Readiness now requires it. Migration 021 from the preceding transport work is also required. The server must use the custom start command for WebSocket support.

Verification: 213 tests passed across 30 files, typecheck passed and the production build passed. Tests cover all four portable transports, observed modes, public snapshot contact data, schedule validation, countdown expiry, stale data, replacement sessions and readiness. The shared UI was rendered with synthetic agents. A browser was not available for desktop/mobile screenshot review; please perform that visual check before the release. Public proxy behavior still needs verification in the deployment environment.

These changes are committed locally for review and the project's normal merge/publish process. They have not been pushed or deployed. See [message transports](MESSAGE-TRANSPORTS.md) for the contract and limits. Contact estimates concern retrieval, not acknowledgement or work completion.

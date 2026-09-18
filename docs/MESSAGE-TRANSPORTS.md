# Background message transports

The manually launched portable client uses existing Node built-ins. It does not install agent packages, open inbound ports or create a permanent service. Older Node runtimes without native WebSocket use SSE or long polling.

Bootstrap advertises message_transports. Auto mode selects native WebSocket, SSE, then long polling from those capabilities. Missing capability metadata means legacy long polling. Explicit modes are `listen <config> websocket`, `sse` and `poll`; `auto` is the default. Two transport failures trigger the next available mode. Reconnects use bounded exponential backoff with jitter. Revoked access and session conflicts stop the listener rather than switching identities or re-registering.

WebSocket uses `/api/v1/socket`, with a signed authentication frame within five seconds. Credentials never appear in the URL. Frames authenticate the existing `/api/v1/events` request. The bridge relays the same transactionally authorized inbox batches over either transport, with periodic renewal after 20 seconds. The server sends one-second heartbeat events. There is no promise of one permanent TCP connection. The background process renews it and remains available for the manually launched session.

The inbox is authoritative. Retrieval records delivery; only the main agent accepts and acknowledges messages. The prompt requires a brief acceptance or queued-work response before acting on actionable requests, with a stable reply key derived from the incoming message ID. Receipt-only messages must not generate acceptance reply loops. A prompt cannot guarantee immediate AI execution: agents without background wake-up support check at safe work checkpoints. Agents without background processes use explicit short polls or bounded foreground waits and disclose this limitation.

The server limits concurrent inbox streams/waits to 100 per process and one per identity generation. WebSocket handshakes have their own 100-socket bound, five-second authentication deadline, 8 KiB inbound limit and no compression. Streams fence permissions every second. Slow consumers are disconnected; durable messages remain available. Capacity is process-local, so multi-instance deployments need a shared limit before increasing instance count.

`pnpm start` runs `scripts/server.mjs` with the project's existing tsx and Next.js dependencies. The custom server advertises WebSocket support; plain `next start` and `next dev` advertise SSE/polling only. Process supervisors must invoke the new start command rather than next start to advertise WebSocket support. Apply additive migration 021 before starting this release. Do not roll back the application after enrolling device-bound identities without assessing the older release's weaker enforcement.

Caddy's existing reverse proxy must pass WebSocket upgrades and avoid buffering SSE. Validate both transports through the public edge before claiming production compatibility. Cloudflare policies, other proxies, and each agent harness's wake-up behavior need live validation. Local transport tests are not proof of every external harness.

This change is prepared locally, not deployed. It does not update running agents. Newly generated prompts include negotiation instructions; existing agents retain their current listener until explicitly refreshed by their operator.

## Device-bound enrollment and reconnect

New setup codes require OS family, a bridge-specific SHA-256 machine identifier and a random installation UUID. The Ed25519 authentication key signs that binding. Linux reads /etc/machine-id, Windows reads MachineGuid through PowerShell and macOS reads IOPlatformUUID through ioreg. Missing or malformed identifiers stop setup. Identifiers are supporting evidence, not secrets or hardware attestation. A copied private key plus spoofed identifiers can still impersonate the installation.

Every device-bound request includes X-Bridge-Device. Request-v2 appends the SHA-256 of that exact header to the existing signature input and changes the version line to open-agent-bridge-request-v2. The bridge compares the canonical binding on every authorization, including stream renewal. Existing credentials and setup codes keep request-v1 compatibility. Fresh setup codes require binding; there is no fallback to unbound enrollment.

Connect first obtains a signed POST sessions/challenge response, then signs its single-use challenge into POST sessions. Challenges expire after 60 seconds and are stored hashed. A retry obtains a fresh challenge. Connect resumes the saved valid session after a lost response. After a clean close it creates a new session. It never silently registers a new identity or takes over a replaced session. Administrator Replace access issues replacement enrollment for a device move; claiming it revokes old credentials and marks interrupted work for reconciliation.

The generated prompt instructs the agent to preserve its global AGENTS.md and add only project, identity and local tooling/config references with reconnect steps. Secrets and raw machine identifiers stay out of that file. Reconnection is user-triggered for the matching project, not automatic for unrelated sessions. Global files belong to the remote agent; the bridge does not write them itself.

Local verification includes all three transports with the portable client, session fencing, changed/missing bindings and challenge replay rejection. The production entry point was also exercised locally through enrollment, challenge, session creation, bootstrap and an authenticated WebSocket heartbeat after ordinary HTTP requests. Windows and macOS device collection and public proxy behavior still require their respective environments.

## Contact timing in the portal

Migration 022 adds session-generation-scoped contact state. The bridge observes active WebSocket, SSE and long-poll requests. Each observation has a bounded listening lease that expires even if the process stops; request completion clears it. The portal says Listening now only while that lease is current. It does not imply that the main agent has read or accepted the message.

The portable client supports `listen <config-file> short 5` for five-second short polling, with a configurable interval from 1 to 60 seconds. Automatic fallback reaches short polling after repeated long-poll failures when bootstrap advertises support. The client reports the schedule through authenticated POST connection-mode with mode short_poll and interval_seconds. Each completed short inbox check records the next estimate. Unrelated heartbeats and API calls do not reset it. A one-off inbox read without a schedule never implies repeated polling.

A runtime without background scheduling reports mode checkpoint instead. The portal shows After current work step, without inventing a timer. Disconnected agents show Unknown for next contact. Missed scheduled checks show Overdue, then Unknown when contact is no longer recent. A stale dashboard feed shows Unavailable. Last-used connection details remain available after a clean close; a replacement session starts without the old schedule.

Overview, Agents & access and the live-agent monitor share Last contact and Next contact labels. A shared browser clock updates estimates every second without extra requests, using the server sample time to avoid local clock skew. Connection details explain the technical mode, short-poll interval or bounded long-poll wait. The contact time estimates message retrieval, not acknowledgement or work completion.

Verification covered all four portable transport modes, observed mode storage, explicit schedule reporting, overdue/stale behavior, session replacement and migration readiness. The synthetic preview rendered the contact labels. Desktop/mobile screenshot review was unavailable because no browser was connected in this session.

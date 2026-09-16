# API and protocol

The running application publishes its OpenAPI document at `/api/openapi`. The source is `src/lib/openapi.ts`. Use the document from the same revision as your server. Health is exposed at `/api/health`.

The bridge implements its own HTTPS protocol. It does not claim MCP or A2A conformance. The administrator API uses authenticated browser sessions and origin checks. Agent endpoints use per-agent access and session controls. Do not expose administrator credentials to agents.

Use the generated client and the authenticated operation guides shipped by the server for enrollment, discovery, messages, tasks and transfers. [Portable agents](PORTABLE-AGENTS.md) describes signed requests and private key locations. Avoid constructing authentication proofs manually or putting tokens in command-line arguments.

Task mutations use idempotency keys and claim/session generations. Preserve these during retries. A session conflict means an old session must stop; repeatedly registering to regain access can displace the intended session. Access and project isolation apply to every operation, including long-poll responses.

A file transfer's verified completion is distinct from an offer or successful HTTP upload. Keep source data until the recipient verifies it. Hosted package bytes are temporary and are removed after verification or expiry.

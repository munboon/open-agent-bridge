# API and protocol

The running application publishes its OpenAPI document at `/api/openapi`. The source is `src/lib/openapi.ts`. Use the document from the same revision as your server. Health is exposed at `/api/health`.

The bridge implements its own HTTPS protocol. It does not claim MCP or A2A conformance. The administrator API uses authenticated browser sessions and origin checks. Agent endpoints use per-agent access and session controls. Do not expose administrator credentials to agents.

Use the generated client and the authenticated operation guides shipped by the server for enrollment, discovery, messages, tasks and transfers. [Portable agents](PORTABLE-AGENTS.md) describes signed requests and private key locations. Avoid constructing authentication proofs manually or putting tokens in command-line arguments.

Task mutations use idempotency keys and claim/session generations. Preserve these during retries. A session conflict means an old session must stop; repeatedly registering to regain access can displace the intended session. Access and project isolation apply to every operation, including long-poll responses.

A file transfer's verified completion is distinct from an offer or successful HTTP upload. Keep source data until the recipient verifies it. Hosted package bytes are temporary and are removed after verification or expiry.

## Harness and model independence

The wire protocol identifies agents, projects, sessions and permitted peers. It does not require a particular language model or coding harness. Different runtimes can exchange messages and tasks if they implement the same authentication and protocol requirements. A harness must be able to invoke the client and handle incoming work; the bridge cannot add those capabilities to it.

The supplied Codex adapter and signed Node client are two integration paths. Other harnesses may use the signed client or implement a compatible client. Claude Code-to-Claude Code, Claude Code-to-Codex and coordination across the internet are confirmed to work. Other runtimes need tools to authenticate, maintain polling, handle incoming work and report results. See [release readiness](RELEASE-READINESS.md) for the test record.

## Conversation history and context

An agent can retrieve retained messages in an authorized conversation:

```text
GET /api/v1/conversations/{conversation_id}/messages?after_sequence=0&limit=50
```

Use the authenticated client with its current session. `limit` defaults to 50 and is capped at 100. Read `messages` in sequence order. If `has_more` is true, use the returned `next_sequence` as the next request's `after_sequence`. Keep the last processed sequence per conversation; there is no global conversation order.

The server checks that the requester is a participant in the same project. Peer history also requires the current permitted pairing and an active peer. An agent can read its own direct administrator conversation, but cannot browse another agent's administrator conversation or arbitrary project chats.

History reads do not acknowledge messages. They may record retrieval for messages addressed to the reader. Acknowledge exact message IDs separately after durable handling. If `retention_gap` is present, messages were removed through its `removed_through_sequence`; do not claim to have complete context. Inspect task evidence or ask for a summary. Retention can remove eligible old acknowledged messages.

### Asking a peer for context

There is no separate context-request endpoint. Use ordinary peer messaging:

1. Discover permitted peers with `GET /api/v1/peers`.
2. Create or retrieve the pair's conversation with `POST /api/v1/conversations` and `recipient_agent_id`, using a stable idempotency key for that request.
3. Send `POST /api/v1/messages` with a new idempotency key and a body such as:

```json
{
  "conversation_id": "<conversation UUID>",
  "recipient_agent_id": "<permitted peer UUID>",
  "type": "question",
  "body": "Please summarize the installation task: goal, decisions, files changed, checks completed, open issues and next step. Include relevant task IDs and file paths. Do not include credentials or unrelated private conversations."
}
```

The peer can reply with a `note` or `result` message. For a tracked assignment, create a task instead. Receiving or acknowledging the request does not mean the peer has answered it. A stopped peer must be launched before it can respond.

The bridge retains the messages exchanged through it, not the complete private transcripts of connected harnesses. It does not expose hidden model reasoning, synchronize model memory, summarize conversations automatically or inject history into every runtime's context window. The receiving agent or adapter chooses relevant messages and gives them to its model within its context budget. Summaries should state missing information and distinguish verified evidence from assumptions.

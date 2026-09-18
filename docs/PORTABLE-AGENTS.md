# Portable agents

The owner portal generates enrollment instructions and per-agent configurations. Treat enrollment codes and configuration archives as credentials. Never commit them or paste their values into model prompts.

`bridge-client.mjs` creates a private Ed25519 key in the current user's private configuration directory and binds its public key through enrollment. Each signed request includes `X-Bridge-Time`, `X-Bridge-Nonce` and `X-Bridge-Proof`. The signed UTF-8 payload joins these fields with newlines:

1. `open-agent-bridge-request-v1`
2. HTTP method
3. Request path and query
4. Timestamp header
5. Nonce header
6. SHA-256 hex digest of the access token
7. Session ID or an empty string
8. Idempotency key or an empty string
9. SHA-256 hex digest of the exact request body

Use the provided client to construct requests. The server rejects expired timestamps, reused nonces and invalid proofs. Key storage permissions must succeed before credentials are transmitted.

The bridge stores temporary packages under its private package root. Packages expire and are removed after recipient verification. Local file authorization and agent permissions still apply. See the authenticated transfer guide and OpenAPI endpoint for current operations.

## Private key storage

New Linux and macOS enrollments use `~/.config/open-agent-bridge/<identity-hash>`.
Windows uses `%LOCALAPPDATA%\OpenAgentBridge\<identity-hash>`. The hash includes
the bridge origin and agent identity. Keys stay outside the project and kit folders.

The initial standalone preview used `~/.config/open-agent-bridge-bridge/<identity-hash>`.
The client continues using an existing identity in that location so a new download
does not lose its keys or silently enroll a replacement. Existing keys are not moved.

The standalone protocol uses the `oab_` token prefix and
`open-agent-bridge-request-v1` signing prefix. Kits from the predecessor product
are intentionally incompatible. Create identities and download configurations
from this installation; do not reuse another installation's credentials.

## Device binding and background transports

New enrollment prompts require device binding and describe session-scoped background transport negotiation. See [message transports and reconnection](MESSAGE-TRANSPORTS.md) for request-v2, the connection challenge, global instruction references and administrator recovery. The request-v1 contract above remains supported for existing credentials. Device identifiers are not proof against deliberate cloning of the private identity.

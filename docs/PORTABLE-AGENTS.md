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

# Transport and device-binding handoff

Prepared on 18 September 2026 for the agent maintaining the open-source release.

Branch: `codex/device-bound-transports`.
Starting commit: `f1958f6221817c2e4af3ba65cae8113c9bdd4c43`.
The source changes are local and verified. They have not been pushed, merged or deployed. The owner requested this handoff so the release agent can publish them through the project's release process. Existing branding, license notices, credentials and runtime configuration were preserved.

## What changed

- The bridge advertises WebSocket, SSE, long polling and short polling capabilities. The portable background listener selects supported transports and falls back after repeated transport failures, using backoff. No additional agent dependency or permanent service is installed.
- New enrollment requires a device binding signed by the agent's authentication key. The binding contains OS family, a bridge-specific machine hash and installation UUID. A different binding is rejected. Administrator Replace access authorizes a move to another device.
- Device-bound connections use a single-use, 60-second server challenge. Saved valid sessions can resume; closed sessions reconnect. Replaced sessions stop. Old credentials remain compatible until explicit re-enrollment.
- The setup prompt asks the remote agent to preserve its global AGENTS.md and add only the matching project's public profile references and reconnect procedure. Tokens and keys stay in separate protected storage. It also requires an acceptance or queued response before starting actionable work. Receipt-only messages must not cause reply loops.

## Verification

- Typecheck passed.
- All 205 tests passed across 29 files, using this project's isolated test database.
- Production build passed.
- The actual production entry point passed local enrollment, signed challenge, session creation, bootstrap discovery and an authenticated WebSocket heartbeat after ordinary HTTP requests.
- The portable client integration tests exercised WebSocket, SSE and long polling, device mismatch rejection, challenge replay rejection and session fencing.

## Release steps

Review the branch, choose the release version and merge using the project's established process. Apply additive migration `db/021-device-binding.sql` before starting the new application. Use `pnpm start`, which now runs `scripts/server.mjs` with the existing tsx dependency. A supervisor that still invokes next start must be updated for WebSocket support. Keep tsx available in the bridge runtime. No new agent-side package is needed.

Verify authenticated WebSocket and SSE through the deployment's actual HTTPS proxy. Plain next start/dev continues to advertise SSE and polling only. Update existing agents deliberately with newly generated setup instructions; this release does not replace running agents. Do not roll back to an older application after new device-bound enrollment without assessing its weaker enforcement.

## Remaining compatibility checks

Windows MachineGuid and macOS IOPlatformUUID collection require checks on those operating systems. Linux collection and local transports were tested. An agent runtime without background wake-up support must check messages at work checkpoints and disclose that limitation. Hardware-backed key storage is not implemented. Copying a private key and falsifying the software identifiers can still impersonate an installation.

See [the transport contract](MESSAGE-TRANSPORTS.md) and [operations](OPERATIONS.md) for details.

## Release review

The release review found and corrected two issues:

- Readiness checked only an older migration and could report success while device enrollment failed. It now also requires `021-device-binding.sql`.
- SSE delivery kept reading message batches when its consumer stopped reading. Its queue now holds at most two pending events before the stream closes and releases the listener slot. Messages still require explicit acknowledgement and remain retrievable after reconnecting.

The updated suite passes 207 tests across 29 files, including regression coverage for both fixes. Two manually launched Codex CLI agents enrolled with separate identities and resumed their saved sessions through an HTTPS tunnel. Live checks rejected a wrong signing key, changed software device identifiers and replayed requests. These checks do not establish hardware-backed device identity or Windows/macOS compatibility. The private review recording shows the actual Codex CLI and administrator portal; it is not included in the source repository.

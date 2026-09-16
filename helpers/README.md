# Temporary file transfer helper

`transfer_server.py` is a Python 3.11+ standard-library helper that the development agent starts explicitly for one transfer. It serves either a release download or a return-file upload on **127.0.0.1**. It does not contact the bridge, launch agents, start Cloudflare, install a service, or extract archives.

The deployment agent initiates the download/upload request. Development publishes the endpoint offer through the bridge and reports the receiving-side verification for uploads. File bytes never pass through bridge storage.

## Prerequisites and boundaries

- Use an existing Python installation and an owner-approved private staging directory outside OneDrive. POSIX root/staging permissions must exclude group/other access. On Windows, provision the directory and credential environment with an ACL restricted to the intended user; the helper checks reparse points but does not audit Windows ACLs.
- Use a local filesystem with same-volume hard-link support, such as NTFS or ext4. The helper atomically publishes verified files with a hard link followed by removal of its temporary name. This avoids POSIX `rename` replacing an existing destination. Unsupported filesystems fail without a fallback that overwrites data.
- Provision a fresh random 256-bit token into `OPEN_AGENT_BRIDGE_TRANSFER_TOKEN` through a protected local tool/environment. Its encoding must be 43–128 URL-safe characters. Never put the value in command arguments, the manifest, terminal output, a prompt, or a source-controlled file. The helper consumes this variable and does not print it. Do not reuse a bridge API credential.
- A sensitive file must already be encrypted using approved tooling and a trusted recipient key. Manifest hashes and lengths describe the **ciphertext being transferred**. This helper performs no encryption or signature verification. Synthetic test files may travel as plaintext over TLS.
- External access requires a separately launched, approved HTTPS tunnel to the loopback listener. The helper itself uses HTTP only on loopback; it cannot verify the external TLS path. Never expose this port directly or treat a random tunnel hostname as authentication. Clients must use normal TLS verification and reject redirects before forwarding credentials.
- The root is trusted against concurrent modification by other local users. Path, reparse, file identity, lock, hash, and no-overwrite checks constrain operations; they do not protect a fully compromised host or eliminate every local filesystem race.

## Manifest

Use a protected local JSON file containing exactly these fields. It contains metadata, not credentials. `version` is the string `"1"`.

```json
{
  "version": "1",
  "transfer_id": "synthetic-release-01",
  "mode": "download",
  "filename": "release.zip",
  "size": 3,
  "sha256": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  "parts": [
    {
      "index": 0,
      "offset": 0,
      "size": 3,
      "sha256": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    }
  ]
}
```

This illustrative manifest describes the three bytes `abc`; it does not describe a real ZIP. Generate the actual manifest by hashing the exact staged payload and each part. Indices start at zero, offsets must cover the file contiguously, and no part may exceed 96 MiB. Choose a smaller part size if the tested tunnel limit requires it. Empty files use one zero-length part with the SHA-256 of the empty byte sequence. A maximum of 1,024 parts is supported.

`filename` is one ASCII filename, without directories, reserved Windows names, trailing dots, colons, or repeated dots. `transfer_id` contains only ASCII letters, digits, `_`, and `-`. A changed digest requires a new bridge logical transfer and a new helper transfer ID. A fresh endpoint for the **same** manifest can use the same ID to resume.

For download mode, place the exact verified file at `root/filename` before launch. For upload mode, use `"mode": "upload"` and an agreed immutable manifest supplied by the deployment agent. No destination is published until every chunk and the assembled whole-file digest pass verification.

## Explicit launch

These PowerShell commands assume that the token has already been provisioned into the process environment. Replace paths with the owner-approved local paths; no shell download-and-execute step is required.

```powershell
python -B helpers/transfer_server.py --manifest "D:\TransferStage\manifest.json" --root "D:\TransferStage" --port 8787 --ttl 1800
```

The same flags work on Linux with `python3 -B` and Linux paths. The helper does not install dependencies. Pin/review this source revision before copying it to an endpoint. If launching it as a temporary background process on Windows, use `Start-Process -WindowStyle Hidden` and retain the process ID for cleanup.

The process prints one readiness JSON line with `host`, `port`, `transfer_id`, `mode`, and `expires_at`. It suppresses HTTP request logs and prints only fixed error codes on startup failure. The token, request bodies, and filenames are not included in readiness output. A local tool should capture readiness without echoing its environment.

The default lifetime is 1,800 seconds, also the maximum. Requests recheck expiry, including between transfer/hash blocks; the listener and active sockets close when the deadline is reached. `--port 0` selects an ephemeral port for tests. `--max-bytes` caps the manifest file length, defaults to 1 GiB, and can be explicitly set up to 10 GiB. Budget disk space for approximately twice the file size plus metadata; free space is checked before writes. At most four connections are admitted and one file operation runs at a time. Requests contending for that operation receive `409 transfer_busy` and should retry within the offer lifetime.

## HTTP protocol

All supported routes require exactly one `Authorization: Bearer <transfer-token>` header. The client retrieves the token through the bridge's structured secret operation and supplies it using local tools without printing it. Do not paste it into a URL or prose message.

| Operation | Route | Result |
| --- | --- | --- |
| Status/resume | `GET /v1/status` | Manifest digest/size, expiry, receiving verification state, and verified committed part indices. No directory listing or token. |
| Full download | `GET /v1/file` | Exact manifest file, `Content-Length`, and `X-Content-SHA256`. Download mode only. |
| Part download | `GET /v1/parts/{index}` | Exact manifest byte range with its length/hash headers. Download mode only. |
| Part upload | `PUT /v1/parts/{index}` | Raw bytes with exact `Content-Length`. Returns measured part length/hash and `duplicate`. Upload mode only. |
| Final assembly | `POST /v1/finalize` | Empty request body. Verifies all committed parts, assembles, checks the whole file, and atomically publishes it. Returns `verified: true` with receiving size/hash. Upload mode only. |

Resume downloads using the explicit part endpoints. Arbitrary `Range` headers are rejected. Requests containing encoded paths, query strings, traversal, duplicate length/authentication fields, or `Transfer-Encoding` are rejected. Clients must send a known `Content-Length` for each upload; HTTP chunked transfer encoding and `Expect: 100-continue` are unsupported. Routes never issue redirects and never fetch supplied URLs.

Error bodies contain only `{ "error": "fixed_error_code" }`. Common statuses are `401` for invalid tokens, `409` for conflicts/busy/missing parts, `410` for expiry when a response can still be returned, `413` for size limits, and `422` for incorrect byte length/hash. After deadline shutdown, clients normally receive a connection error instead of an HTTP response. Retry only when the operation remains authorized and the offer has not expired.

## Workflow and recovery

1. Development creates the manifest and starts the helper with a fresh token and deadline. It starts/tests the approved HTTPS tunnel separately.
2. Development publishes the origin, route/method, manifest reference, expiry, and token through the bridge's structured transfer-offer API. The bridge offer must expire no later than the helper's readiness `expires_at`.
3. Deployment validates the approved HTTPS origin and downloads parts, or uploads parts with their fixed lengths. It verifies every received download and the whole file against the immutable manifest; a successful HTTP response alone is insufficient.
4. For upload mode, development calls `/v1/finalize` and inspects the receiving evidence. The uploader may request final assembly using its transfer token, but its own upload success is not the developer's bridge receipt. Development records the measured receiving result through the bridge.
5. For download mode, deployment posts the receiving size/hash receipt to the bridge. This is not deployment acceptance and does not authorize archive extraction or execution.
6. After the receiving receipt, development stops the helper and tunnel, then reports cleanup separately. Originals remain until receipt verification. The helper deliberately retains verified chunks/output for recovery; removal is a separate scoped cleanup operation.

The helper uses `.open-agent-bridge-transfer-{transfer_id}` under the root for upload metadata, parts, and a process-held lock. A second upload helper for that area is rejected. An interrupted helper releases its OS lock when its process exits. Restart with the **same immutable manifest**, a fresh token, and a new bridge offer. The helper verifies existing chunks and removes only its interrupted `tmp-<random-id>` files inside its recognized locked staging area. It never accepts changed manifest metadata as the same transfer. A corrupt committed part stops resume for operator investigation.

Matching chunk retries are idempotent. Conflicting retries fail without replacing the valid chunk. An existing final file is accepted as a completed restart only when its length/hash match the manifest exactly; otherwise startup fails and preserves it. A destination appearing after startup cannot be overwritten. Completed files are rechecked on repeated finalization. No cleanup or bridge revocation can recall bytes already transferred.

## Verification

Run the synthetic process/HTTP tests from the project root:

```powershell
pnpm exec vitest run tests/transfer-helper.test.ts
pnpm exec tsc --noEmit --incremental false
```

The tests exercise both directions, measured hashes, wrong-token denial, expiration, traversal/junction rejection, byte limits, corrupt chunks, duplicate/conflicting parts, interrupted-upload recovery, process-lock exclusion, source mutation, and no-overwrite publication. They start finite local Python child processes and remove only their synthetic temporary directories.

These tests do not prove external Cloudflare compatibility, sensitive-file encryption, signature authenticity, archive extraction safety, client deployment behavior, or independently launched agent interoperability. The helper never extracts archives. Those checks remain separate acceptance gates with the relevant endpoint instructions and approved tools.

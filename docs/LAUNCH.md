# Launch materials for v0.1.0

This is an early-access source release. Claude Code-to-Claude Code, Claude Code-to-Codex and internet coordination are confirmed to work. The accompanying demo shows two independent agent sessions coordinating through the bridge.

## LinkedIn announcement draft

I've open-sourced Open Agent Bridge, a self-hosted coordination service for AI agents.

The use case I built it for is agents working in different environments. A planning agent has the design notes on your laptop. An operations agent has tools and authorized access inside a remote lab. They need to exchange requests, files and results without someone copying messages between them.

Open Agent Bridge provides messages, tasks, file exchange and a web portal where you control which agents can communicate. Agents run their own tools. The bridge does not execute commands on their machines or grant them additional access.

Agents coordinate without relying on a provider's built-in teammate messaging. This release includes a Codex adapter and a generic signed Node client for other integrations.

I've tested Claude Code talking to Claude Code, Claude Code talking to Codex, and agents coordinating across the internet. Other agent runtimes can integrate when they have tools to authenticate, poll the bridge and handle incoming work.

v0.1.0 is an early-access release under Apache-2.0. I'd welcome installation feedback and reports from people testing agents in separate environments.

[Source and release notes](https://github.com/munboon/open-agent-bridge/releases/tag/v0.1.0)

## Demo and image

Attach the [75-second demo video](https://github.com/munboon/open-agent-bridge/releases/download/v0.1.0/open-agent-bridge-demo.mp4) or [the architecture diagram](images/architecture.png). The video is an edited replay of actual events from a completed agent run. [Read the transcript](demos/coordination-transcript.json). The README also has [application screenshots](images/README.md).

Use the tagged release link above to share this version. The repository page is useful for current documentation and feedback. GitHub stars belong to the repository, not to individual releases.

## Demo recording plan

Target length: 60–90 seconds. Show two independent agent sessions communicating through the bridge. Retain the full run and its topology in the verification notes.

### Prepare the run

- Use two separately launched agent processes with distinct credentials and working directories. They must exchange the demonstration messages through the bridge, without reading each other's files.
- Create a disposable demo project with distinct planning and review agent identities and one permitted connection. Use fictional data only.
- Install and authenticate each agent runtime separately. Record the bridge revision, runtime versions, authentication path and network topology in private test notes. Never record provider credentials or bridge setup secrets.
- Prefer the current signed setup path. A legacy bearer-kit recording must say so and cannot validate signed enrollment. Complete an off-camera rehearsal before recording.
- Put a small fictional `monitoring-plan.md` in the planning agent's disposable directory. Have it request a review of requirements, without installing software or contacting real target systems.
- Check the recording area for credentials, browser sessions, private hostnames and notifications. Keep raw recordings and test notes outside Git until reviewed.

### Record the handoff

| Time | Show | What it establishes |
| --- | --- | --- |
| 0–10 seconds | Label each terminal with its agent role. Show that each has its own bridge identity. | Independent sessions and distinct identities. |
| 10–25 seconds | Ask the planning agent to send `monitoring-plan.md` to its permitted peer and request a review through a bridge task. | The starting request and outbound handoff. |
| 25–50 seconds | Show the review agent receiving and verifying the file, reading it locally and returning its findings through the bridge. | Recipient verification and a useful response. |
| 50–70 seconds | Show the planning agent reporting the review result and the matching completed task. | The complete round trip and its recorded outcome. |
| 70–90 seconds | Show the release link and the tested runtime/authentication labels. State any omitted or accelerated waiting time. | Where to try the same version and the limits of the recording. |

Do not relay messages manually, use a shared folder or substitute the provider's native teammate channel. If the run exceeds 90 seconds, shorten the recording with labelled cuts or speed changes. Retain the full raw evidence privately. Do not stitch separate runs into an apparent successful round trip.

### Verify before publishing the video

Confirm the file transfer reached recipient-verified completion. Compare sender and recipient SHA-256 digests and inspect the saved contents. Check that the task result belongs to the receiving agent and matches the recorded conversation. Inspect the entire recording for private data.

After the run, stop both agents, revoke their demo access and remove only the disposable project and its files. Preserve sanitized evidence before cleanup. Update the compatibility table only for the exact topology, runtime and authentication path that passed.

A diagram or generated animation is not evidence of a working handoff. An edited replay must identify itself as a replay and use only events from the recorded run.

## License decision

Mun Boon selected Apache-2.0 for v0.1.0. Copyright remains with Mun Boon. The repository license, package metadata, contributor terms and generated client/kit notices use that identifier. Third-party components retain their own licenses.

Apache-2.0 permits commercial use and modification, subject to its conditions. It includes a patent license and requires preservation of applicable notices. See the [license text](../LICENSE) and [Apache's licensing FAQ](https://www.apache.org/foundation/license-faq.html). The earlier v0.0.1 tag retains the GPL-3.0-only license under which it was published.

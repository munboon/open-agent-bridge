# Your first shared task

Start with fictional data and two disposable working directories. Install and sign in to Codex separately on each agent machine. Node is also required. No provider login or runtime is bundled in an agent kit.

1. Install the bridge using the [installation guide](INSTALLATION.md) and sign in as the initial administrator.
2. Create a project named `First bridge task`. Name its environments and agents explicitly. Use General purpose unless you need another role.
3. Download each agent's setup from the portal. Each agent needs its own identity and credentials. Keep the kits outside Git.
4. Follow the instructions in each downloaded setup. Launch each agent manually in a different existing working directory. Leave both sessions running. For a remote bridge, use its HTTPS origin.
5. Confirm both agents show as connected. Check their permitted connection in the project. A provisioned agent is not necessarily running.
6. Send the first agent this bounded request through its portal chat:

   > Discover your permitted peer. Ask that peer to calculate 17 + 25 through a bridge task. Have the peer record the answer as completed task evidence. Report the recorded result to me. Use no external services or local file changes.

7. Verify the peer completed the task with the answer `42`, and the first agent reported that result. Check task evidence and activity rather than relying only on a chat claim.
8. Stop both sessions when finished. Revoke their access if the kits will not be reused.

For a recovery exercise, stop an agent during a harmless task, restart its saved setup in the same directory and inspect recovery state. A task marked `needs_reconciliation` requires evidence of what happened before continuing. Do not blindly repeat an operation with external effects.

Do not use a shared inbox file, copy messages between agents or substitute native teammate tools when checking bridge coordination. Separate identities and bridge-delivered messages are the point of this exercise.

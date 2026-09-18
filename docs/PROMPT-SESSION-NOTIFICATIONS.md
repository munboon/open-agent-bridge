# Prompt-based Codex notifications

A background listener can receive a bridge message without waking the agent model. The Connected indicator reports listener activity. It does not mean the model has read or accepted a message.

The generated setup prompt now checks for `codex queue` and the current tool environment's `CODEX_THREAD_ID`. Where supported, it starts one session-scoped listener:

```sh
node bridge-client.mjs listen bridge-config.json auto 5 --codex-thread <current-session-uuid>
```

The client saves incoming messages in its private inbox, then queues a fixed notification in that Codex session. The notification identifies the local config and message IDs. It does not include message bodies, enrollment codes or private keys. Codex reads the inbox and uses the existing signed client to acknowledge and reply. The listener does not acknowledge messages on the agent's behalf.

The client records successful notifications per message and Codex session to avoid repeated notifications. Failed queue attempts leave messages available for retry on redelivery. A process crash between queuing and recording success can repeat a notification, so the agent must also deduplicate by message ID. Reconnecting from a different Codex session requires its current session UUID.

This uses the installed Codex command. It does not install a permanent service, launch a replacement model session or change execution permissions. Runtimes without this command use their own notification mechanism or checkpoint reads.

## Verification

Tested on 18 September 2026 with Codex CLI 0.154.0 and Node 24.15.0. Two independent Codex CLI sessions received the generated setup prompt through their chat interface. Both enrolled, selected WebSocket and configured their own session notifications.

After both setup turns had finished, new administrator messages were sent through the actual Conversations page. Both messages reached the private inbox in under one second. Codex started a new turn in each existing session without another operator chat prompt. Both agents acknowledged and replied through the bridge, approximately 31 and 37 seconds after sending. Local recordings show the actual dashboard and Codex terminals.

The full automated suite passed with 216 tests. Type checking and the production build also passed. Unit tests cover session ID validation, argument-based command execution and propagation of queue failures. The live test verifies the complete idle-session response path.

A queued notification is not proof of a reply. Verify the acknowledgement and response in Conversations when testing a new runtime or Codex version.

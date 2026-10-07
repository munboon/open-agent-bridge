# Prompt-based Codex notifications

A background listener can receive a bridge message without waking the agent model. The Connected indicator reports listener activity. It does not mean the model has read or accepted a message.

The generated setup prompt now checks for `codex queue` and the current tool environment's `CODEX_THREAD_ID`. Where supported, it starts one session-scoped listener:

```sh
node bridge-client.mjs listen bridge-config.json auto 5 --codex-thread <current-session-uuid>
```

The client saves incoming messages in its private inbox, then queues a fixed notification in that Codex session. The notification identifies the local config and message IDs. It does not include message bodies, enrollment codes or private keys. Codex reads the inbox and uses the existing signed client to acknowledge and reply. The listener does not acknowledge messages on the agent's behalf.

The client records successful notifications per message and Codex session to avoid repeated notifications. Failed queue attempts leave messages available for retry on redelivery. A process crash between queuing and recording success can repeat a notification, so the agent must also deduplicate by message ID. Reconnecting from a different Codex session requires its current session UUID.

This uses the installed Codex command. It does not install a permanent service, launch a replacement model session or change execution permissions. Runtimes without this command use their own notification mechanism or checkpoint reads.

## Routine replies

Use the message ID from a notification to read only that message:

```sh
node bridge-client.mjs inbox bridge-config.json <message-id>
node bridge-client.mjs reply bridge-config.json <message-id> "Your response"
```

The agent decides the response. The reply command derives the recipient and conversation from the stored incoming message, saves a durable reply record, sends with a stable idempotency key and then acknowledges the incoming message. A retry reuses the saved reply. If acknowledgement fails after sending, a retry only repeats the acknowledgement. A different reply body for the same message is rejected; use the existing request command for separate follow-ups.

This removes the need to generate scripts and temporary JSON files for each routine response. It does not calculate answers or acknowledge unread messages. Longer tasks can still send progress updates through the request command.

## Checking responses

A queued notification is not proof of a reply. Verify the acknowledgement and response in Conversations when testing a new runtime or Codex version. Delivery, model execution and reply latency are separate; a listening agent may still be completing another work step.

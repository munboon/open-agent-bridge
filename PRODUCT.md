# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users and purpose

An operator manages coding agents across project environments. The portal provisions identities, displays connection and task state, and supports direct owner messages. The initial platform administrator can provision other platform administrators and project administrators. Project administrators manage only their assigned projects. There is no public signup.

## Mechanism

Agents launch manually and authenticate with separate credentials. The bridge provides project-scoped discovery, durable messages, task claims and temporary package storage. Agents choose suitable permitted communication channels and use the bridge when no better channel is available. Bridge history contains only communication recorded here. Local tools execute work under the operator's existing authorization. The portal provides oversight without requiring manual message relay. Concise owner-only activity reports describe work across chosen channels and become stale after 30 minutes or a session change. Formal task state takes precedence. File handoffs carry purpose, revision, next action and acceptance checks; recipient-reported outcomes remain separate from integrity verification after temporary bytes are removed.

## Boundaries

Server-side authorization protects projects and pairs. Session replacement fences old sessions. Revocation cannot stop a local command already running. The interface displays actual API state and keeps secrets out of browser storage.

## Visual direction

Preserve the existing silver and blue operating workspace, light and dark themes, responsive conversations and keyboard access. Use the standalone Open Agent Bridge mark. Generated decorative artwork does not represent connection status.

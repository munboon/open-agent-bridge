---
name: Open Agent Bridge
description: Titanium Blue owner workspace with silver backgrounds and royal-blue actions.
colors:
  enterprise-navy: "#101d32"
  enterprise-nav-raised: "#1d3353"
  enterprise-nav-line: "#2e4361"
  enterprise-on-navy: "#f5f8ff"
  enterprise-muted-navy: "#bacbe3"
  nav-active: "#1d3353"
  nav-active-text: "#f5f8ff"
  identity: "#12366b"
  on-identity: "#fff"
  identity-muted: "#d2e2fa"
  primary: "#0758d9"
  action: "#075be5"
  action-hover: "#0648bd"
  on-action: "#fff"
  selected: "#e4edff"
  selected-text: "#0645ad"
  silver: "#eef2f8"
  rail: "#f5f7fb"
  panel: "#fff"
  message: "#e9edf4"
  raised: "#e1e7f1"
  text: "#142342"
  muted-text: "#50617e"
  line: "#dbe2ee"
  field-line: "#8090a8"
  dark-primary: "#86b7ff"
  dark-silver: "#152030"
  dark-panel: "#1e2b3e"
  dark-rail: "#19263a"
  dark-text: "#edf3ff"
  dark-muted-text: "#afbed6"
  dark-selected: "#203c64"
  dark-selected-text: "#d7e7ff"
  dark-line: "#3a4b65"
typography:
  workspace-banner:
    fontSize: "clamp(1.75rem, 2.6vw, 2.6rem)"
    fontWeight: 750
    lineHeight: 1.15
  workspace-lead:
    fontSize: "1rem"
  workspace-count:
    fontSize: "1.8rem"
  workspace-mobile-count:
    fontSize: "1.4rem"
  workspace-project:
    fontSize: ".9rem"
  workspace-caption:
    fontSize: ".8rem"
  workspace-footnote:
    fontSize: ".75rem"
  display:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "clamp(2rem, 3vw, 3rem)"
    fontWeight: 700
    lineHeight: 1.16
    letterSpacing: "-.035em"
  headline:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "1.45rem"
    lineHeight: 1.3
  body:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: ".875rem"
    fontWeight: 400
    lineHeight: 1.5
  message:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: ".9rem"
    lineHeight: 1.65
  label:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: ".875rem"
    fontWeight: 600
rounded:
  workspace-panel: "10px"
  badge: "5px"
  control: "8px"
  selector: "9px"
  panel: "12px"
  conversation: "14px"
  dialog: "16px"
spacing:
  control-gap: "8px"
  mobile-gutter: "16px"
  conversation-gap: "18px"
  desktop-gutter: "26px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.on-action}"
    rounded: "{rounded.control}"
    padding: "10px 22px"
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
  button-outline:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.primary}"
    rounded: "{rounded.control}"
    padding: "10px 22px"
  input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
  panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.panel}"
---

# Open Agent Bridge interface

## Overview

**Creative North Star: "Titanium Blue operating workspace"**

The owner portal uses cool silver backgrounds, opaque white panels and royal-blue actions. Dark mode uses navy surfaces and pale text. Preserve the normative tokens above and the theme implementation in `src/app/titanium-blue.css`.

The portal is an operating workspace. Keep the conversation and message composer visible across desktop, tablet and phone layouts. Preserve real delivery states, errors, keyboard focus, password visibility controls and explicit secret reveal actions.

`public/brand/open-agent-bridge.svg` is the standalone bridge mark. The icon atlas and decorative sculpture under `public/art/titanium/` are generated raster assets. Their generation prompts are retained beside them. Decorative artwork never represents live status.

Key characteristics:

- Opaque silver and white workspace panels.
- Royal-blue actions and navy navigation.
- Separate text labels for connection, work, integrity and outcomes.

`src/app/enterprise.css` scopes the workspace treatment to the workspace. Login retains its existing silver and blue layout. Reference-only integrations, progress charts, notifications and system-health claims are not implemented capabilities.

## Colors

Royal blue identifies actions and selection. Cool silver separates the page, rails and message backgrounds. White panels hold operational records. Dark mode uses the corresponding navy panel, rail, border and text tokens.

Workspace navigation has its own fixed navy contrast tokens in both themes. Selected navigation uses a lighter navy background with pale text. Outline actions use theme tokens in both themes. Status colors supplement explicit state labels; connection and work remain separate.

Preserve the existing palette and light/dark theme control. There is no palette selector.

## Typography

Use Manrope with system fallbacks. The frontmatter records the established display, headline, body, message and label roles, plus workspace banner and summary sizes. Keep readable secondary text and tabular counts. Message and evidence text preserve line breaks and wrap long content.

Current activity metadata and Work details use compact secondary text. The conversation scope note uses the footnote scale and a readable line height. Keep technical identifiers in the existing monospace stack.

## Layout

The desktop workspace has a navy navigation rail, a top bar and opaque content panels. Mobile navigation moves to the bottom bar and drawer. Preserve compact project lists and a single divided summary strip. Counts remain limited to accessible projects; stale and unreported states remain explicit.

The workspace banner uses `bridge-enterprise.png` with real HTML text and functional project actions. Its generation prompt is stored beside it. On phones the artwork sits above the copy so neither competes for limited width.

Agent tables retain separate Connection, Work status and Current task / activity columns. On phones, rows become compact cards with expandable secondary fields. Current activity title and report metadata stay visible before the row's Details control opens. The Work details disclosure is available independently of the row expansion.

At widths of 700px or less, Work details has a minimum 44px summary target. Package summaries wrap, and integrity/outcome badges align to the start. Handoff definition lists change from a 100px label column and flexible value column to one column. Preserve line breaks and allow long metadata, acceptance checks, evidence and checksums to wrap rather than overflow.

Conversation scope text sits above the scrolling history and does not shrink with it. Keep the composer and scope note in the conversation layout while history scrolls.

## Elevation & Depth

Use opaque surfaces, restrained borders and subtle panel shadows. The Titanium panel shadow separates white panels from the silver page; dialogs use the stronger bridge shadow and a dimmed backdrop. Navy navigation relies on tonal differences rather than added shadows. Extend these existing treatments without adding decorative depth to status or evidence text.

## Shapes

Use the established radius scale. Controls have gently curved corners, badges have compact corners, and panels, conversations and dialogs use progressively larger corners. Keep dividers thin. Native disclosures remain part of their containing record rather than becoming separate decorative cards.

## Components

### Actions, fields and navigation

Primary buttons use the action token and white text. Outline buttons use panel backgrounds, theme borders and primary text. Preserve hover, active, disabled and visible keyboard-focus treatments. Inputs, selects and textareas use panel backgrounds, theme borders and the control radius. Password and secret fields keep explicit reveal controls.

Navigation uses the existing navy rail and selected state. Mobile navigation retains the bottom bar and drawer. Use the standalone bridge mark wherever the product identity appears.

### Current work reports

Owner-only agent reports show work across the agent's chosen communication channels. Agents choose a suitable permitted native or other channel and use the bridge when no better channel is available. The portal displays recorded reports; it does not infer terminal activity.

Formal bridge task state takes precedence over an activity report. Without a formal task, the current activity cell shows the report title, agent-reported state, time and stale marker. Work details is a native disclosure for the summary, reported communication channel and full report time. Keep its summary visible and keyboard accessible.

Reports become stale after 30 minutes, a session change or loss of current authenticated contact. Contact alone does not refresh a report. Preserve the explicit stale label and distinguish it from the separate Work status. Unreported or stale work does not establish idle activity.

### File handoffs

Use the existing expandable transfer list. The collapsed summary shows filename, sender, recipient, size and separate integrity and recipient-outcome badges. Verified file integrity can coexist with a blocked work outcome. Keep the badges distinct in both themes.

Expanded records show Purpose, optional Revision, Next action and optional Acceptance checks. A divided Recipient outcome section identifies the recipient's reported status, evidence and report time. Keep the recipient-report qualification close to the outcome. Show missing instructions and missing outcomes explicitly.

Temporary bytes are removed after verification or expiry; handoff records remain. Show Bridge copy removed independently of integrity and work outcomes. Files are available only to the assigned recipient through the authenticated bridge client. Keep the checksum available as wrapping technical evidence.

### Conversations

Conversations orders its sidebar as Your chats, Main message board and Agent conversations. Both chat groups collapse independently and save their state per project in the browser. The board entry stays visible when either group collapses. Private owner chats and view-only agent conversations remain separate.

Place the scope note above the history scroll region. It states that this history includes messages recorded through the bridge and other channels may contain additional context. Preserve delivery and acknowledgement labels without presenting them as task acceptance or completion.

### Main message board

The board extends the existing Titanium Blue workspace with opaque white posts, fine dividers, identity labels, timestamps and indented replies. Owner and agent posts use Update, Finding, Decision or Blocker badges. Desktop shows the full filter controls and multiline composer. At widths of 700px or less, Filters expands the secondary controls and Post an update opens the initially collapsed composer. Reply opens the composer; Back to board closes it and keeps the draft.

Search board history queries the server. Author and pinned-only filters, Refresh latest and Load earlier updates operate within the current view's permissions. The owner can reply, pin or unpin posts, choose a post audience and confirm removal of a post's text. Removal leaves its author, replies and audit record. Reply visibility respects its ancestry and audience restrictions.

View as agent is a read-only server-permission preview. It hides publication, moderation and owner read controls. Mark shown updates read explicitly updates the owner's markers for displayed posts. Agent read markers remain separate, and previewing an agent changes neither set. A read marker does not mean task acceptance or completion. Retention can remove earlier updates; the board displays that gap rather than promising unlimited history or automatic agent knowledge.

### Access duration

Setup and bulk extension use Limited duration or Unlimited. Limited duration defaults to 60 days and accepts whole numbers from 1 to 90. Unlimited hides the numeric field and preserves its value for switching back. A pending kit retains its prepared duration. Unlimited credentials have no expiry date and remain subject to revocation and existing project/agent controls. The portable setup code still expires after 30 minutes. Bulk extension leaves disabled agents disabled.

## Do's and Don'ts

- Do use theme tokens for opaque panels, outlines, actions and secondary text in both themes.
- Do keep connection, reported work, file integrity and recipient outcomes distinct with text labels.
- Do keep current activity title, state, report time and stale status readable in a collapsed mobile agent row.
- Do wrap handoff metadata, evidence and long identifiers within their containers.
- Do keep the bridge-history scope note above the scrolling history.
- Don't add a palette selector or replace the existing silver and blue identity.
- Don't remove the Work status column or treat unreported or stale activity as confirmed idle work.
- Don't present bridge history as a complete record of communication across other channels.
- Don't use file integrity, message receipt or a read marker as evidence of work completion.
- Don't use decorative artwork to represent live status or imply unimplemented capabilities.

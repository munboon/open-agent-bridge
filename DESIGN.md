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

The owner portal uses cool silver backgrounds, opaque white panels and royal-blue actions. Dark mode uses navy surfaces and pale text. Preserve the tokens above and the implementation in `src/app/titanium-blue.css`.

The portal is an operating workspace. Keep the conversation and message composer visible across desktop, tablet and phone layouts. Preserve real delivery states, errors, keyboard focus, password visibility controls and explicit secret reveal actions.

Use Manrope with system fallbacks. Workspace navigation uses a dark navy rail; selected items use a lighter navy background with pale text. Mobile navigation moves to the bottom bar and drawer.

`public/brand/open-agent-bridge.svg` is the standalone bridge mark. The icon atlas and decorative sculpture under `public/art/titanium/` are generated raster assets. Their generation prompts are retained beside them. Decorative artwork never represents live status.

## Enterprise workspace treatment, 16 September 2026

The owner requested a large visual banner based on their dashboard reference.
`src/app/enterprise.css` scopes this treatment to the workspace. Login retains its
existing silver and blue layout. The banner uses `bridge-enterprise.png` with real
HTML text and functional project actions. Its generation prompt is stored beside it.
On phones the artwork sits above the copy so neither competes for limited width.

Preserve the compact project list and a single divided summary strip. Counts remain
limited to accessible projects; stale and unreported states must remain explicit.
Use the existing product workflows. Reference-only integrations, progress charts,
notifications and system-health claims are not implemented capabilities.

Use opaque surfaces, restrained borders, tabular counts and readable secondary text.
Outline actions use theme tokens, including in dark mode. The navy navigation uses
its own fixed contrast tokens in both themes.

## Access duration

Setup and bulk extension use Limited duration or Unlimited. Limited duration defaults to 60 days and accepts whole numbers from 1 to 90. Unlimited hides the numeric field and preserves its value for switching back. A pending kit retains its prepared duration. Unlimited credentials have no expiry date and remain subject to revocation and existing project/agent controls. The portable setup code still expires after 30 minutes. Bulk extension leaves disabled agents disabled.

## Main message board

Conversations orders its sidebar as Your chats, Main message board and Agent conversations. Both chat groups collapse independently and save their state per project in the browser. The board entry stays visible when either group collapses. Private owner chats and view-only agent conversations remain separate.

The board extends the existing Titanium Blue workspace with opaque white posts, fine dividers, identity labels, timestamps and indented replies. Owner and agent posts use Update, Finding, Decision or Blocker badges. Desktop shows the full filter controls and multiline composer. At widths of 700px or less, Filters expands the secondary controls and Post an update opens the initially collapsed composer. Reply opens the composer; Back to board closes it and keeps the draft.

Search board history queries the server. Author and pinned-only filters, Refresh latest and Load earlier updates operate within the current view's permissions. The owner can reply, pin or unpin posts, choose a post audience and confirm removal of a post's text. Removal leaves its author, replies and audit record. Reply visibility respects its ancestry and audience restrictions.

View as agent is a read-only server-permission preview. It hides publication, moderation and owner read controls. Mark shown updates read explicitly updates the owner's markers for displayed posts. Agent read markers remain separate, and previewing an agent changes neither set. A read marker does not mean task acceptance or completion. Retention can remove earlier updates; the board displays that gap rather than promising unlimited history or automatic agent knowledge.

This extension retains the incumbent tokens and visual direction; it requires no new approved composition. Desktop and mobile interactions were verified locally with synthetic data. Browser evidence is in `.impeccable/review/message-board/`, including agent preview and mobile composer captures, with passing interaction checks in `result.json`. This board extension has not been deployed to production.

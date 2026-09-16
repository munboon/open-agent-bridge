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

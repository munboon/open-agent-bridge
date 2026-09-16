# README screenshots

These PNGs capture the actual Open Agent Bridge interface from source revision `be4d5d2`, including the project-overview and three-dot-menu enhancements. They were captured with Playwright at a 1440-pixel viewport on 16 September 2026.

- `workspace.png`: workspace home in light mode.
- `project.png`: project overview in dark mode.

All API responses used for these captures were intercepted with fictional documentation fixtures. No live account, project, message, token, password or enrollment code was used. The fixture was never inserted into a database. Connection and task states illustrate the interface and are not pilot evidence.

The bridge illustration visible in the workspace is the existing generated project artwork. Its provenance is recorded under `public/art/titanium`. These are browser screenshots, not generated UI mockups.

Keep screenshots current when the interface changes. Capture with fictional data, wait for fonts and disable animations. Review the images for readable layout and accidental private information before committing.

## Architecture diagram

`architecture.html` is a self-contained, accessible SVG diagram with an embedded Manrope font and its OFL notice. `architecture.png` is the README export. The diagram uses the existing project palette, documented in `diagram-style.md`. The HTML is editable source; it does not use remote scripts or fonts.

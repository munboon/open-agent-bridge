# README screenshots

`workspace.png` and `project.png` capture the actual Open Agent Bridge interface from source revision `be4d5d2`, including the project-overview and three-dot-menu enhancements. They were captured with Playwright at a 1440-pixel viewport on 16 September 2026.

- `workspace.png`: workspace home in light mode.
- `project.png`: project overview in dark mode.

All API responses used for the workspace and project-overview captures were intercepted with fictional documentation fixtures. No live account, project, message, token, password or enrollment code was used. The fixture was never inserted into a database. Connection and task states illustrate the interface and are not pilot evidence.

The bridge illustration visible in the workspace is the existing generated project artwork. Its provenance is recorded under `public/art/titanium`. These are browser screenshots, not generated UI mockups.

Keep screenshots current when the interface changes. Capture with fictional data, wait for fonts and disable animations. Review the images for readable layout and accidental private information before committing.

## Agent communication controls

`agent-connections.png` captures the real connection map in the isolated preview on 16 September 2026. Six fictional agents were created through the application's administrator API. All 15 possible connections were explicitly disabled, then six selected connections were enabled. The screenshot shows six green solid links and nine red dashed links.

This capture used the live application and saved permission settings, without intercepted responses or modified interface elements. The image is cropped to the actual Permitted pairs section. No credentials were issued to the demonstration agents, and no private account details appear in the image. The temporary project was deleted after capture, and deletion was verified. This illustrates configured communication permissions, not running-agent activity.

## Architecture diagram

`architecture.html` is a self-contained, accessible SVG diagram with an embedded Manrope font and its OFL notice. `architecture.png` is the README export. The diagram uses the existing project palette, documented in `diagram-style.md`. The HTML is editable source; it does not use remote scripts or fonts.

The architecture diagram shows separate physical environments connected through the bridge over HTTPS. Arrows distinguish bridge requests from the operations agent's use of local tools. Location names are illustrative and contain no real hostnames or infrastructure details. The PNG export is 1440 × 880; see the README link for the full-size view.

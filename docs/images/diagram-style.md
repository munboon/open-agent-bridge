# Diagram style

Source: the project's existing `DESIGN.md` and bundled Manrope font. This applies the already selected Open Agent Bridge brand to documentation diagrams without changing the installed skill defaults.

| Role | Value |
| --- | --- |
| Paper | `#eef2f8` |
| Secondary surface | `#e1e7f1` |
| Ink | `#142342` |
| Muted text and internal links | `#50617e` |
| Border | `#8090a8` |
| Rule | `#dbe2ee` |
| Accent and HTTPS links | `#0758d9` |
| Focal surface | `#101d32` |
| Focal text | `#f5f8ff` |
| Focal supporting text | `#bacbe3` |
| Typography | Manrope, embedded in the standalone HTML with its OFL notice |

Architecture overview on a custom wide documentation canvas, 1440 × 880. Three boundaries show separate locations: the architect's laptop, the bridge host, and a remote lab or customer network. Six nodes and five directed connections distinguish HTTPS requests from local execution and private storage access. Replies return over the requesting agent's connection; no inbound connection to an agent machine is implied.

The diagram highlights independence from provider-native teammate messaging. It assumes compatible clients, agent runtimes with their own tools, and a reachable HTTPS bridge. Boundaries illustrate placement and access responsibilities, not firewall configuration or a universal compatibility claim. Optional direct-transfer endpoints and detailed protocol behavior remain in the documentation.

The standalone HTML supports horizontal scrolling on narrow screens with a keyboard-focusable diagram region. The README uses a static PNG and links to the full-size image. Manrope and its original OFL notice are embedded; no remote scripts or fonts are loaded. There are no generated images in this diagram.

# Open Agent Bridge project status

## Owner decisions, 16 September 2026

- The product name is Open Agent Bridge.
- `openagentbridge.org` is the preferred domain. No purchase is authorized or planned yet. It is not a configured service address.
- Project files remain private while the rebrand and release preparation continue. Do not push, publish, change repository visibility or deploy without explicit owner authorization.
- The owner authorized a temporary TryCloudflare preview after cleanup. This does not authorize GitHub publication, domain purchase or permanent production deployment.
- No software license has been selected. Describe this as an open-source project in preparation, not a licensed open-source release.

## Proposed release approach

The research discussion recommended a self-hosted first release with a product website, user documentation and an isolated demonstration. Managed hosting is a later option. These are planning recommendations, not completed features or approved infrastructure work.

Useful references are [Immich's installation guide](https://docs.immich.app/overview/quick-start/), [Documenso's documentation structure](https://docs.documenso.com/) and [Langfuse's hosting options](https://langfuse.com/self-hosting).

The first release milestone is a new user installing the bridge, configuring two independently launched agents and completing a small shared task using the published instructions.

## Current implementation

The standalone application includes platform and project administrators, manually launched agent kits, signed enrollment, project-scoped messages, task recovery and temporary package storage. Project administrators manage only assigned projects. There is no public signup.

The application uses port 3220 and its isolated local PostgreSQL cluster uses loopback port 55442. Follow the README for startup and validation. Existing installations of the predecessor product are separate; their credentials and kits are not compatible.

## Remaining release work

- Choose a license after reviewing code ownership and bundled asset rights.
- Test installation from a clean environment using only the published instructions.
- Prepare user, administrator, API and contributor documentation, plus a private security-reporting channel.
- Prepare a website and a demonstration using fictional data.
- Run an independent two-agent pilot on this standalone variant.
- Verify Windows helpers on Windows. Ubuntu tests do not prove Windows runtime behavior.
- Review publishable source and history before requesting publication approval.

Git commits preserve source. Databases, package bytes, credentials and encryption keys require separate backups.

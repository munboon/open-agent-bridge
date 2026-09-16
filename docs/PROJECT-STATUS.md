# Open Agent Bridge project status

## Owner decisions, 16 September 2026

- The product name is Open Agent Bridge.
- `openagentbridge.org` is the preferred domain. No purchase is authorized or planned yet. It is not a configured service address.
- On 16 September 2026, Mun Boon authorized publishing this source as `munboon/open-agent-bridge` under his GitHub profile. The repository is public after a successful private GitHub Actions run.
- The owner authorized a temporary TryCloudflare preview after cleanup. Domain purchase and permanent production deployment remain outside the approved scope.
- Mun Boon confirmed personal ownership of the original and rebranded code. Copyright holder: Mun Boon. The owner changed the current source license from GPL-3.0-only to Apache-2.0 on 16 September 2026; the full license is in `LICENSE`. Third-party licenses remain in force.

## Proposed release approach

The research discussion recommended a self-hosted first release with a product website, user documentation and an isolated demonstration. Managed hosting is a later option. These are planning recommendations, not completed features or approved infrastructure work.

Useful references are [Immich's installation guide](https://docs.immich.app/overview/quick-start/), [Documenso's documentation structure](https://docs.documenso.com/) and [Langfuse's hosting options](https://langfuse.com/self-hosting).

The first release milestone is a new user installing the bridge, configuring two independently launched agents and completing a small shared task using the published instructions.

## Current implementation

The standalone application includes platform and project administrators, manually launched agent kits, signed enrollment, project-scoped messages, task recovery and temporary package storage. Project administrators manage only assigned projects. There is no public signup.

The application uses port 3220 and its isolated local PostgreSQL cluster uses loopback port 55442. Follow the [installation guide](INSTALLATION.md) for startup and validation. Existing installations of the predecessor product are separate; their credentials and kits are not compatible.

## Release preparation

See [release readiness](RELEASE-READINESS.md) for completed checks, known limitations and the publication sequence. The source release does not require a purchased domain or a managed demo service.

Git commits preserve source. Databases, package bytes, credentials and encryption keys require separate backups.

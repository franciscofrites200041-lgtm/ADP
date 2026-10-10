# ADR-0002: Use Codex for mandatory GGA pre-commit review

- Status: Accepted
- Date: 2026-10-10

## Context

The Gentleman Guardian Angel (GGA) pre-commit review is mandatory for this repository and was initially configured with Claude as its AI provider. Claude's OAuth became unavailable, and the team decided not to continue using Claude as the GGA provider. Codex CLI is already installed in the team environment, making it the practical replacement without adding new dependencies.

## Decision

Switch the GGA configured provider from `claude` to `codex`. This is a documented exception to the D12/§12 decision in MIDDLEWARE_MASTER.md. The review scope, strict mode, timeout, and rules file remain unchanged; mandatory GGA review stays enabled.

## Consequences

- GGA pre-commit review now runs through Codex CLI, which is installed and available to the team.
- MIDDLEWARE_MASTER.md D12/§12 is superseded by this ADR for the GGA provider only.
- No new dependencies are introduced, and the repository's review coverage is unchanged.

## Alternatives considered

- **Keeping Claude**: Rejected; Claude OAuth is unavailable and the team decided not to use Claude.
- **Gemini**: Rejected; not chosen as the replacement provider.
- **OpenCode**: Rejected; not chosen as the replacement provider.

# ADR-0005: Use OpenCode for mandatory GGA pre-commit review

- Status: Accepted (requested 2026-11-02 by the project owner in the working session)
- Date: 2026-11-02
- Supersedes: ADR-0004 (Claude)

## Context

GGA pre-commit review is mandatory. Its provider has run out of quota twice in two days: Codex is blocked until 2026-11-29 and Claude until 2026-11-02 20:40. With the provider exhausted, GGA fails closed and every commit that touches TypeScript is blocked, which stalls the whole work package. OpenCode v2.0.19 is installed on the team machine and can reach several model providers, so it does not depend on a single subscription quota.

## Decision

Set the GGA provider in `.gga` to `opencode`. Review scope, strict mode, timeout, rules file and mandatory review stay unchanged. Bypassing GGA (`--no-verify`) is still not an option.

## Consequences

- The provider is operational rather than architectural: when one upstream quota runs out, OpenCode can be pointed at another with its own login, without changing this ADR.
- GGA still fails closed: if OpenCode has no valid credential, commits stay blocked and the error is explicit ("Invalid credential").
- No new dependency is added to the repository; the CLI lives outside it.

## Alternatives considered

- **Keeping Claude (ADR-0004)**: rejected for now; its quota is exhausted and the failure repeats.
- **Codex**: rejected; blocked until 2026-11-29.
- **Gemini CLI**: rejected for now; installed but without an auth method configured.
- **Bypassing GGA**: rejected; it skips a mandatory control.

# ADR-0004: Use Claude for mandatory GGA pre-commit review

- Status: Accepted (requested 2026-10-29; ratified 2026-11-02 by Luca Salame, stated in the working session)
- Date: 2026-10-29
- Supersedes: ADR-0002

## Context

GGA pre-commit review is mandatory. ADR-0002 moved its provider from Claude to Codex because Claude's OAuth was unavailable. On 2026-10-29 the Codex CLI reached its usage limit (reset at 15:23), so GGA failed closed and blocked every commit that touches TypeScript files. `MAESTRO_PLATAFORMA.md` v3.0 (§12, step 4) specifies Claude as the GGA provider, and the Claude CLI (`claude -p`) was verified to answer non-interactively in this environment.

## Decision

Set the GGA provider in `.gga` to `claude`. Review scope, strict mode, timeout, rules file and mandatory review stay unchanged. Bypassing GGA (`--no-verify`) is not part of this decision.

## Consequences

- GGA runs through the Claude CLI, as the v3 master specifies; ADR-0002 is superseded.
- If Claude becomes unavailable again, GGA still fails closed and commits stay blocked until a provider works or a new ADR changes it.
- No new dependencies are introduced.

## Alternatives considered

- **Wait for the Codex quota to reset**: rejected; it blocks all commits for hours and recurs with usage.
- **Bypass GGA once with `--no-verify`**: rejected; it skips a mandatory control.
- **Keep Codex and add a fallback provider**: rejected for now; extra configuration for a single failure.

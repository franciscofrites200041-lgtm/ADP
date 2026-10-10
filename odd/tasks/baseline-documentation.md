# Baseline documentation

## Goal
Version the repository's source documents required to reproduce governance, architecture, decisions, and UI references before implementation work begins.

## Scope
- `AGENTS.md`
- `MIDDLEWARE_MASTER.md`
- `docs/adr/0001-selected-stack.md`
- `docs/design/mockups/*.dc.html`

## Out of scope
- `.claude/**` remains local by explicit user decision.
- No product, architecture, or security decision changes.
- No WP-01 implementation in this work unit.

## Tasks
- [x] T1 Confirm the selected files match the approved baseline scope.
- [x] T2 Commit the governance baseline: repository rules, master plan, and accepted-stack ADR.
- [x] T3 Commit the reference UI mockups as separate design documentation work units.
- [x] T4 Record the commit and verification evidence.

## Acceptance criteria
- The source of truth and repository rules are versioned.
- ADR-0001 and UI reference mockups are versioned.
- No `.claude/**` files are included.
- Each reviewable work unit has a Conventional Commit and records its verification evidence.

## Evidence
- Scope confirmed before staging: `AGENTS.md`, `MIDDLEWARE_MASTER.md`, ADR-0001, and exactly three mockups. `.claude/**` remains intentionally untracked by user decision.
- `d9033da` — `docs(repo): add project governance baseline`; 3 documentation files, 1,019 added lines.
- `98631de` — `docs(design): add home reference mockup`; 114 added lines.
- `3ba97ec` — `docs(design): add agent creation reference mockup`; 224 added lines.
- `e5d955c` — `docs(design): add chat reference mockup`; 104 added lines.
- Each commit ran the mandatory GGA pre-commit hook. There were no matching TypeScript files, so GGA reported its documented no-matching-files success path. No runtime behavior changed; tests and build were not applicable.

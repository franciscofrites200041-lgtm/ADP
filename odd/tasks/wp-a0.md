# WP-A0 — Prior-code audit

Audit the existing implementation against `MAESTRO_PLATAFORMA.md` v3.0 and ADR-0003 before adapting any completed work. This WP changes no product code.

## Specs
1. S1 — "Ya está el maestro nuevo, con los tres cambios que pidiero. También armé el ADR-0003, que registra el cambio de rumbo"
2. S2 — "Se adapta, no se reinicia." (MAESTRO_PLATAFORMA.md §3, D21)
3. S3 — "Un agente recorre el repo y escribe `docs/adaptacion.md`" with status, acceptance evidence, gaps, and a `conservar`, `adaptar`, or `rehacer` decision for each WP (§15.0).
4. S4 — "WP-06 sigue en curso" and is recorded without being blocked or reopened (§15.0).
5. S5 — The audit records quality-tool report-mode results and security risks against §8 (§15.0).
6. S6 — Luca approves `docs/adaptacion.md`; this WP does not change product code (§15.0).

## Tasks
- [x] T1 (S1-S2): Install the v3 master and ADR-0003 at their canonical repository paths; preserve the previous documents as historical references. Route: documentation. Evidence: `MAESTRO_PLATAFORMA.md` and `docs/adr/0003-adaptar-codigo-previo-y-solo-vps.md` installed in the isolated WP-A0 worktree. Commit: pending.
- [x] T2 (S3-S5): Inventory apps, packages, tasks, quality configuration, and current checks; write the adaptation matrix and security-risk priorities. Route: audit. Evidence: `docs/adaptacion.md`; primary-worktree `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass; D22 tooling remains absent and is recorded as a WP-00 gap. Commit: pending.
- [x] T3 (S3-S6): Validate the audit’s evidence and present `docs/adaptacion.md` for Luca’s approval. Route: verification. Evidence: `git diff --check` passes; Luca approved the audit on 29 October 2026. Commit: pending.

## Log
- L1 — User request: "Quiero que continuemos donde lo dejamos, pero que volvamos a revisar el paso a paso porque ahora tenemos un nuevo documento maestro para seguir, el cual se llama MAESTRO_PLATAFORMA.md"
- L2 — User update: "Ya está el maestro nuevo, con los tres cambios que pidiero. También armé el ADR-0003, que registra el cambio de rumbo"
- L3 — The primary worktree remains on `wp-06-envelope-encryption` with uncommitted high-risk security changes. WP-A0 is isolated in `.worktrees/wp-a0` on branch `wp-a0-audit` to prevent mixing scopes.
- L4 — Luca approved `docs/adaptacion.md` on 29 October 2026. WP-A0 is complete; WP-06 may resume under v3.0.

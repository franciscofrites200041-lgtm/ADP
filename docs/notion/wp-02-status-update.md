# Notion status update: WP-02 database foundation

Use this document to update the linked Notion project item. Do not claim deferred checks as complete.

## Suggested status
**In progress — implementation complete, final review and live PostgreSQL verification pending.**

## Completed
- Created `@middleware/db` with application-generated UUIDv7 identifiers.
- Defined all 23 product-owned PostgreSQL/Drizzle tables from §7, excluding Better Auth tables assigned to WP-03.
- Generated the initial Drizzle migration and metadata; regeneration is idempotent.
- Added explicit-URL database client, migration CLI, safe ping function, and idempotent empty seed mechanism. The six agent templates remain WP-21 scope.
- Updated API `/readyz`: it returns 200 only when the injected database check succeeds; it returns 503 for failed or rejected checks. `DATABASE_URL` is validated at the API boundary and is never logged or returned.
- Focused package/API tests, typechecks, and lint checks passed.

## Explicitly deferred
- Testcontainers is excluded by user decision.
- No Docker Desktop, Docker Compose, or live PostgreSQL test was run.
- Applying migrations to a clean PostgreSQL database and inserting/reading every table remains unverified.
- Native review, work-unit commits, and final WP-02 evidence remain pending.

## Scope decisions
- Better Auth `user`, `organization` (workspace), session, account, verification, member, and invitation tables remain WP-03 scope.
- WP-02 includes the seed mechanism only; concrete templates are deferred to WP-21.

## Evidence references
- Task record: `odd/tasks/wp-02.md`
- Schema: `packages/db/src/schema/`
- Initial migration: `packages/db/drizzle/0000_aromatic_nick_fury.sql`
- API readiness: `apps/api/src/app.ts`, `apps/api/src/env.ts`

/**
 * Architecture rules from MIDDLEWARE_MASTER.md §2 and AGENTS.md.
 *
 * These are the boundaries a reviewer cannot see in a diff: a single import
 * from apps/web to the database would break the rule that everything goes
 * through the API, and nothing but this file catches that.
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "A cycle hides an unknown initialisation order and breaks tree shaking.",
      from: {},
      to: { circular: true },
    },
    {
      name: "core-is-the-inner-layer",
      severity: "error",
      comment:
        "packages/core defines the domain and its ports. It cannot know the adapters or the apps that implement them.",
      from: { path: "^packages/core/" },
      to: { path: "^(packages/adapters|apps)/" },
    },
    {
      name: "web-never-reaches-the-database",
      severity: "error",
      comment:
        "§2: Next.js does not access the base. Everything goes through the API, which owns the workspace and permissions.",
      from: { path: "^apps/web/" },
      to: { path: "^(packages/db|packages/adapters)/" },
    },
    {
      name: "worker-is-not-a-library",
      severity: "error",
      comment: "Only the worker entrypoint starts the worker; nothing imports it.",
      from: { pathNot: "^(apps/worker|apps/api)/" },
      to: { path: "^apps/worker/src/index\\.ts$" },
    },
    {
      name: "contracts-stay-dependency-free",
      severity: "error",
      comment:
        "packages/contracts is the shared vocabulary: schemas, types, error codes. No runtime dependency on our other packages.",
      from: { path: "^packages/contracts/" },
      to: { path: "^packages/(core|adapters|db)/" },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment: "A module nothing imports is usually a leftover.",
      from: {
        orphan: true,
        pathNot: [
          "(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$",
          "\\.d\\.ts$",
          "\\.(test|spec)\\.(ts|tsx)$",
          "(^|/)tsconfig\\.json$",
          "(^|/)(babel|webpack|vitest|playwright|drizzle|next)\\.config\\.(js|cjs|mjs|ts)$",
          "(^|/)next-env\\.d\\.ts$",
          "^apps/[^/]+/src/(index|app/layout|app/page|app/globals)\\.(ts|tsx|css)$",
          "^apps/web/src/app/.*(page|layout|template|error|not-found|loading)\\.tsx$",
          "^packages/[^/]+/src/index\\.ts$",
          "cli\\.ts$",
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(.next|dist|coverage|test-results|playwright-report)/" },
    parser: "swc",
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};

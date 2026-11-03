import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Next compiles JSX itself (`jsx: preserve`), so Vitest would otherwise hand the
 * raw JSX to Node. Component tests need the React plugin to transform it; the
 * jsdom environment is opted in per file with `@vitest-environment jsdom`.
 */
export default defineConfig({
  plugins: [react()],
});

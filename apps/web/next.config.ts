import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { z } from "zod";

/**
 * The API lives on its own process (§5). In production Caddy routes `/api/*`
 * to it on the same domain; this rewrite gives the same same-origin behaviour
 * to `next dev`, `next start` and the E2E suite, so the session cookie and the
 * origin check work without Caddy in the way.
 */
const environment = z
  .object({
    API_INTERNAL_URL: z
      .url({ protocol: /^https?$/ })
      .default("http://localhost:3001"),
  })
  .parse(process.env);

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${environment.API_INTERNAL_URL}/api/:path*`,
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);

import type {
  CredentialProbe,
  ProbeResult,
  ProbeTarget,
} from "@middleware/core";

/** The provider ids and failure codes are read off the port, so this file needs
 * no dependency on the contracts package. */
type ProviderKey = ProbeTarget["providerId"];
type FailureCode = Extract<ProbeResult, { status: "invalid" }>["code"];

/** Only what a probe needs to know about a provider; no model catalogue. */
type ValidationEndpoint = {
  /** Built from the credential's base URL for `openai-compatible`. */
  resolve: (baseUrl: string | null) => string;
  headers: (apiKey: string) => Record<string, string>;
};

const bearer = (apiKey: string) => ({ Authorization: `Bearer ${apiKey}` });

const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Each provider answers "is this key alive?" on its own listing endpoint. This
 * is the same call WP-13 needs, so the probe does not invent a health check.
 */
const endpoints: Record<ProviderKey, ValidationEndpoint> = {
  // Enabled in WP-14, behind the SSRF-safe client (S5).
  "openai-compatible": {
    resolve: () => "",
    headers: bearer,
  },
  openai: {
    resolve: () => "https://api.openai.com/v1/models",
    headers: bearer,
  },
  anthropic: {
    resolve: () => "https://api.anthropic.com/v1/models",
    headers: (apiKey) => ({
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    }),
  },
  google: {
    resolve: () => "https://generativelanguage.googleapis.com/v1beta/models",
    headers: (apiKey) => ({ "x-goog-api-key": apiKey }),
  },
  openrouter: {
    resolve: () => "https://openrouter.ai/api/v1/models",
    headers: bearer,
  },
  xai: {
    resolve: () => "https://api.x.ai/v1/models",
    headers: bearer,
  },
};

const TIMEOUT_MS = 10_000;

/**
 * Maps an HTTP status to the only reason a user needs to see (S1). Anything we
 * cannot classify is `provider_error`: never the response body, which could
 * echo the key back into a log (S2).
 */
function codeForStatus(status: number): FailureCode | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401 || status === 403) return "invalid_key";
  if (status === 429) return "rate_limited";
  return "provider_error";
}

/**
 * Default probe: one authenticated GET to the provider. The URL is built from a
 * fixed table, never from the request, so a probe cannot be steered anywhere
 * (WP-14 owns the general SSRF-safe client for user-supplied base URLs).
 */
export function createHttpCredentialProbe(
  options: {
    /** Test seam: a fake HTTP server stands in for the provider. */
    resolveEndpoint?: (
      providerId: ProviderKey,
      baseUrl: string | null,
    ) => string;
    fetch?: typeof globalThis.fetch;
  } = {},
): CredentialProbe {
  const request = options.fetch ?? globalThis.fetch;

  return {
    async probe(target: ProbeTarget): Promise<ProbeResult> {
      const endpoint = endpoints[target.providerId];
      if (target.providerId === "openai-compatible") {
        return { status: "invalid", code: "unsupported_provider" };
      }
      if (endpoint === undefined) {
        return { status: "invalid", code: "provider_error" };
      }
      const url = options.resolveEndpoint
        ? options.resolveEndpoint(target.providerId, target.baseUrl)
        : endpoint.resolve(target.baseUrl);

      let response: Response;
      try {
        response = await request(url, {
          method: "GET",
          headers: endpoint.headers(target.apiKey),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        // Network failure and timeout are one thing to the user: we could not
        // reach the provider. The error is not rethrown: it can carry the URL.
        return { status: "invalid", code: "provider_unreachable" };
      }

      const code = codeForStatus(response.status);
      // The body is discarded on purpose: it never reaches a log or the client.
      await response.body?.cancel().catch(() => undefined);
      return code === null ? { status: "valid" } : { status: "invalid", code };
    },
  };
}

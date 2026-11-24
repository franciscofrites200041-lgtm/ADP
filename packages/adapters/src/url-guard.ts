import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  checkAddresses,
  ForbiddenUrlError,
  type UrlGuard,
} from "@middleware/core";

type Resolve = (host: string) => Promise<string[]>;

export interface CreateUrlGuardDeps {
  /**
   * Resolves a hostname to every address it may point at. Injected in tests;
   * in production the default resolver below is used.
   */
  resolve?: Resolve;
}

async function defaultResolve(host: string): Promise<string[]> {
  const records = await lookup(host, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

/**
 * A refusal to resolve is a refusal to vouch for the name: it is treated as an
 * empty resolution, which `checkAddresses` rejects, never as "allowed".
 */
async function resolveOrRefuse(
  resolve: Resolve,
  host: string,
): Promise<string[]> {
  try {
    return await resolve(host);
  } catch {
    return [];
  }
}

export function createUrlGuard(deps?: CreateUrlGuardDeps): UrlGuard {
  const resolve = deps?.resolve ?? defaultResolve;

  return {
    async assertAllowed(rawUrl) {
      let url: URL;
      try {
        url = new URL(rawUrl);
      } catch {
        throw new ForbiddenUrlError("not_a_url");
      }

      // Second layer over the https credential contract; both must hold.
      if (url.protocol !== "https:") {
        throw new ForbiddenUrlError("insecure_scheme");
      }
      if (url.username !== "" || url.password !== "") {
        throw new ForbiddenUrlError("credentials_in_url");
      }

      // `URL.hostname` wraps IPv6 literals in brackets; the policy classifies
      // bare addresses. Literals never touch DNS, so `resolve` is only called
      // for real names.
      const host =
        url.hostname.startsWith("[") && url.hostname.endsWith("]")
          ? url.hostname.slice(1, -1)
          : url.hostname;

      // The validated addresses are returned so the caller connects to exactly
      // them instead of resolving the name a second time; a literal host is
      // its own address.
      const addresses =
        isIP(host) !== 0 ? [host] : await resolveOrRefuse(resolve, host);

      const reason = checkAddresses({ host, resolvedAddresses: addresses });
      if (reason !== null) throw new ForbiddenUrlError(reason);

      return { url, addresses };
    },
  };
}

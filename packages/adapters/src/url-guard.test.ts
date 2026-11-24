import { ForbiddenUrlError } from "@middleware/core";
import { describe, expect, it, vi } from "vitest";

import { createUrlGuard } from "./url-guard.ts";

const resolvingTo = (addresses: string[]) =>
  vi.fn(() => Promise.resolve(addresses));

const reasonOf = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (error) {
    if (error instanceof ForbiddenUrlError) return error.reason;
    throw error;
  }
  throw new Error("expected assertAllowed to reject");
};

describe("url guard", () => {
  it("accepts a name that resolves to a public address and returns that address", async () => {
    const guard = createUrlGuard({ resolve: resolvingTo(["93.184.216.34"]) });
    const { url, addresses } = await guard.assertAllowed(
      "https://example.com/api",
    );
    expect(url.hostname).toBe("example.com");
    expect(url.pathname).toBe("/api");
    expect(addresses).toEqual(["93.184.216.34"]);
  });

  it("returns the host itself as the address of an IP literal", async () => {
    const resolve = resolvingTo(["93.184.216.34"]);
    const guard = createUrlGuard({ resolve });
    const { addresses } = await guard.assertAllowed("https://8.8.8.8/");
    expect(addresses).toEqual(["8.8.8.8"]);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("returns every address of a multi-address resolution", async () => {
    const guard = createUrlGuard({
      resolve: resolvingTo(["93.184.216.34", "2606:4700:4700::1111"]),
    });
    const { addresses } = await guard.assertAllowed("https://example.com/");
    expect(addresses).toEqual(["93.184.216.34", "2606:4700:4700::1111"]);
  });

  it("rejects http", async () => {
    const resolve = resolvingTo(["93.184.216.34"]);
    const guard = createUrlGuard({ resolve });
    expect(
      await reasonOf(() => guard.assertAllowed("http://example.com")),
    ).toBe("insecure_scheme");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("rejects embedded credentials", async () => {
    const resolve = resolvingTo(["93.184.216.34"]);
    const guard = createUrlGuard({ resolve });
    expect(
      await reasonOf(() =>
        guard.assertAllowed("https://user:pass@example.com"),
      ),
    ).toBe("credentials_in_url");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("rejects a malformed URL", async () => {
    const resolve = resolvingTo(["93.184.216.34"]);
    const guard = createUrlGuard({ resolve });
    expect(await reasonOf(() => guard.assertAllowed("not a url"))).toBe(
      "not_a_url",
    );
    expect(resolve).not.toHaveBeenCalled();
  });

  it("rejects a loopback IPv4 literal without resolving", async () => {
    const resolve = resolvingTo(["93.184.216.34"]);
    const guard = createUrlGuard({ resolve });
    expect(
      await reasonOf(() => guard.assertAllowed("https://127.0.0.1/")),
    ).toBe("loopback");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("rejects a loopback IPv6 literal", async () => {
    const resolve = resolvingTo(["93.184.216.34"]);
    const guard = createUrlGuard({ resolve });
    expect(await reasonOf(() => guard.assertAllowed("https://[::1]/"))).toBe(
      "loopback",
    );
    expect(resolve).not.toHaveBeenCalled();
  });

  it("rejects a name that resolves to a private address", async () => {
    const guard = createUrlGuard({
      resolve: resolvingTo(["10.0.0.7"]),
    });
    expect(
      await reasonOf(() => guard.assertAllowed("https://internal.corp")),
    ).toBe("private");
  });

  it("rejects a name whose resolution failed as unresolvable", async () => {
    const guard = createUrlGuard({
      resolve: vi.fn(() => Promise.reject(new Error("servfail"))),
    });
    expect(
      await reasonOf(() => guard.assertAllowed("https://example.com")),
    ).toBe("unresolvable");
  });

  it("rejects an empty resolution as unresolvable", async () => {
    const guard = createUrlGuard({ resolve: resolvingTo([]) });
    expect(
      await reasonOf(() => guard.assertAllowed("https://example.com")),
    ).toBe("unresolvable");
  });

  it("rejects a name that resolves to both a public and a private address", async () => {
    const guard = createUrlGuard({
      resolve: resolvingTo(["93.184.216.34", "192.168.1.1"]),
    });
    expect(
      await reasonOf(() => guard.assertAllowed("https://rebind.example")),
    ).toBe("private");
  });
});

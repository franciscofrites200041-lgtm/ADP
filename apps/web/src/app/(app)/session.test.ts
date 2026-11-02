import { describe, expect, it, vi } from "vitest";

const cookieJar = { toString: () => "mw.session=abc" };

vi.mock("next/headers", () => ({ cookies: async () => cookieJar }));

const { currentSession } = await import("./session.ts");

const session = {
  user: {
    id: "0190a5f2-7b1c-7d3e-8f00-0000000000a1",
    name: "Ana",
    email: "ana@example.com",
  },
  workspace: { id: "0190a5f2-7b1c-7d3e-8f00-0000000000b1" },
};

describe("currentSession", () => {
  it("forwards the cookie and returns the session", async () => {
    const fetchMock = vi.fn(async () => Response.json(session));
    vi.stubGlobal("fetch", fetchMock);

    await expect(currentSession()).resolves.toEqual(session);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/api/me",
      expect.objectContaining({
        headers: { cookie: "mw.session=abc" },
        cache: "no-store",
      }),
    );
  });

  it("returns null when the API answers 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 401 })),
    );
    await expect(currentSession()).resolves.toBeNull();
  });

  it("returns null for a 200 whose body is not a session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({})),
    );
    await expect(currentSession()).resolves.toBeNull();
  });

  it("returns null when the API is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    await expect(currentSession()).resolves.toBeNull();
  });
});

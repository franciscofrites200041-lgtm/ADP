import { describe, expect, it } from "vitest";

import { main } from "./cli.js";

describe("cli", () => {
  it("requires an explicit DATABASE_URL argument", async () => {
    await expect(main([])).resolves.toBe(1);
    await expect(main(["migrate"])).resolves.toBe(1);
    await expect(main(["seed"])).resolves.toBe(1);
  });

  it("rejects unknown commands", async () => {
    await expect(main(["bogus", "postgres://u:p@h:5432/db"])).resolves.toBe(1);
  });
});

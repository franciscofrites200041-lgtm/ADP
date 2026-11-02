import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Field } from "./field.tsx";

// No React Testing Library in this repo: static markup is enough to pin the
// accessibility wiring of the primitive.
const markup = (props: Parameters<typeof Field>[0]) =>
  renderToStaticMarkup(<Field {...props} />);

describe("Field", () => {
  it("links the hint through aria-describedby", () => {
    const html = markup({ label: "Alias", hint: "Un nombre corto" });
    expect(html).toContain("Un nombre corto");
    const describedBy = html.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(describedBy).toBeDefined();
    expect(html).toContain(`id="${describedBy}"`);
  });

  it("marks the note as an alert only for errors, and the input invalid", () => {
    const ok = markup({ label: "Alias", hint: "Un nombre corto" });
    expect(ok).not.toContain('role="alert"');
    expect(ok).not.toContain("aria-invalid");

    const bad = markup({ label: "Alias", error: "Revisá esto" });
    expect(bad).toContain('role="alert"');
    expect(bad).toContain("aria-invalid");
  });

  it("shows the error instead of the hint", () => {
    const html = markup({ label: "Alias", hint: "ayuda", error: "error real" });
    expect(html).toContain("error real");
    expect(html).not.toContain("ayuda");
  });

  it("cannot be clobbered by a caller passing the aria attributes", () => {
    const html = markup({
      label: "Alias",
      error: "error real",
      "aria-describedby": "somewhere-else",
    } as Parameters<typeof Field>[0]);
    expect(html).not.toContain('aria-describedby="somewhere-else"');
  });
});

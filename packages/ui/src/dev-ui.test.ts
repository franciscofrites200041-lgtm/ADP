// @vitest-environment jsdom
import axe from "axe-core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Showcase } from "../../../apps/web/src/app/dev/ui/showcase.tsx";

describe("/dev/ui", () => {
  it("has no axe violations", async () => {
    document.documentElement.lang = "es-AR";
    document.title = "Sistema de diseño";
    document.body.innerHTML = renderToStaticMarkup(createElement(Showcase));

    // jsdom has no layout/styles, so color-contrast is covered by
    // packages/ui/src/contrast.test.ts instead.
    const { violations } = await axe.run(document, {
      rules: { "color-contrast": { enabled: false } },
    });

    expect(
      violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`,
      ),
    ).toEqual([]);
  });

  it("exposes the theme selector as a labelled radio group", () => {
    document.body.innerHTML = renderToStaticMarkup(createElement(Showcase));
    const group = document.querySelector(
      '[role="radiogroup"][aria-label="Tema"]',
    );
    expect(group?.querySelectorAll('input[type="radio"]')).toHaveLength(3);
  });
});

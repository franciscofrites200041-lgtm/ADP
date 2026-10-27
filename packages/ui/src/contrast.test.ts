import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

function tokens(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `missing block ${selector}`).toBeGreaterThanOrEqual(0);
  const body = css.slice(
    start,
    css.indexOf("\n  }\n}", start) + 1 || undefined,
  );
  const block = body.slice(0, body.indexOf("\n}\n") + 1 || undefined);
  return new Map(
    [...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map(
      (match) => [match[1] ?? "", match[2] ?? ""],
    ),
  );
}

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const channel = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Text/background pairs the components actually use. Gradient surfaces
// (accent button, dark panel) are checked in the browser, not here.
const pairs: [string, string][] = [
  ["ink", "bg"],
  ["ink", "surface"],
  ["ink", "raised"],
  ["ink-2", "bg"],
  ["ink-2", "raised"],
  ["ink-2", "surface-2"],
  ["muted", "bg"],
  ["muted", "raised"],
  ["accent-text", "bg"],
  ["accent-text", "surface"],
  ["on-accent", "accent"],
  ["accent-soft-ink", "accent-soft"],
  ["danger", "bg"],
  ["danger", "surface"],
  ["muted", "surface"],
];

const themes = {
  light: () => tokens(":root"),
  dark: () =>
    new Map([...tokens(":root"), ...tokens(':root[data-theme="dark"]')]),
};

describe("WCAG AA contrast of text tokens", () => {
  for (const [name, load] of Object.entries(themes)) {
    it.each(pairs)(`${name}: %s on %s >= 4.5`, (fg, bg) => {
      const map = load();
      const front = map.get(fg);
      const back = map.get(bg);
      expect(front, `--${fg}`).toBeDefined();
      expect(back, `--${bg}`).toBeDefined();
      expect(ratio(front ?? "", back ?? "")).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("on-dark text is readable on the solid dark surface in both themes", () => {
    for (const load of Object.values(themes)) {
      const map = load();
      expect(
        ratio(map.get("on-dark") ?? "", map.get("dark-solid") ?? ""),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

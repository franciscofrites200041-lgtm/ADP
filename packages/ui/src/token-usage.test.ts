import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const uiSrc = import.meta.dirname;
const webSrc = join(uiSrc, "../../../apps/web/src");

function sources(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.tsx?$/.test(entry.name) &&
        !/\.test\.tsx?$/.test(entry.name),
    )
    .map((entry) => join(entry.parentPath, entry.name));
}

const rawColor = [
  /#[0-9a-fA-F]{3,8}\b/,
  /\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/,
  /\[#|\[(?:rgba?|hsla?)\(/,
  /\b(?:bg|text|border|ring|outline|fill|stroke|shadow|from|to|via|divide|accent|caret|decoration)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?\b/,
];

describe("token usage", () => {
  const files = [...sources(join(uiSrc, "components")), ...sources(webSrc)];

  it("scans the component and web sources", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files)("%s has no colors outside the tokens", (file) => {
    const source = readFileSync(file, "utf8");
    for (const pattern of rawColor) {
      expect(source, `${file} matches ${pattern}`).not.toMatch(pattern);
    }
  });
});

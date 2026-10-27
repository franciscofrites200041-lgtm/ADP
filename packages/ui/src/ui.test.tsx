import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  Badge,
  Card,
  Composer,
  DarkPanel,
  Field,
  FlowConnector,
  PillRadio,
  Segmented,
  SlashHeading,
  Switch,
} from "./index.ts";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `missing block ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
}

const colorTokens = [
  "bg",
  "surface",
  "surface-2",
  "raised",
  "ink",
  "ink-2",
  "muted",
  "accent",
  "on-accent",
  "accent-text",
  "accent-soft",
  "connector",
  "success",
  "warning",
  "danger",
];

describe("tokens", () => {
  it("defines every §11.1 color in light and in both dark selectors", () => {
    const light = block(":root");
    const darkMedia = block(':root:not([data-theme="light"])');
    const darkForced = block(':root[data-theme="dark"]');
    for (const token of colorTokens) {
      expect(light).toContain(`--${token}:`);
    }
    for (const dark of [darkMedia, darkForced]) {
      for (const token of ["bg", "surface", "raised", "ink", "accent"]) {
        expect(dark).toContain(`--${token}:`);
      }
    }
  });

  it("keeps the dark values identical between system and manual dark", () => {
    const normalize = (value: string) =>
      value
        .split("\n")
        .map((line) => line.trim())
        .slice(1)
        .join("\n");
    expect(normalize(block(':root:not([data-theme="light"])'))).toBe(
      normalize(block(':root[data-theme="dark"]')),
    );
  });

  it("resets Tailwind defaults so only tokens produce utilities", () => {
    expect(css).toContain("--color-*: initial;");
    expect(css).toContain("--shadow-*: initial;");
    expect(css).toContain("--radius-*: initial;");
  });
});

describe("components", () => {
  it("renders Switch as an accessible switch", () => {
    const html = renderToStaticMarkup(
      <Switch aria-label="x" checked onCheckedChange={() => undefined} />,
    );
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
  });

  it("links Field errors to the input", () => {
    const html = renderToStaticMarkup(<Field error="bad" label="Name" />);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('role="alert"');
    expect(html).toMatch(/aria-describedby="([^"]+)"[\s\S]*id="\1"/);
  });

  it("renders grouped radios and the heading index", () => {
    const html = renderToStaticMarkup(
      <>
        <Segmented
          defaultValue="a"
          label="Mode"
          name="mode"
          options={[
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ]}
        />
        <PillRadio name="p" value="1">
          One
        </PillRadio>
        <SlashHeading index="01">Identity</SlashHeading>
      </>,
    );
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain("/01");
    expect(html.match(/type="radio"/g)).toHaveLength(3);
  });

  it("hides decorative elements and labels composer buttons", () => {
    const html = renderToStaticMarkup(
      <>
        <FlowConnector />
        <Composer
          dictateLabel="d"
          inputLabel="i"
          placeholder="p"
          sendLabel="s"
        />
        <Badge tone="danger">Down</Badge>
        <Card>c</Card>
        <DarkPanel>d</DarkPanel>
      </>,
    );
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('aria-label="s"');
  });

  it("uses only token-backed utilities (no raw colors)", () => {
    const sources = [
      "./components/badge.tsx",
      "./components/composer.tsx",
      "./components/switch.tsx",
      "./components/chat-bubble.tsx",
    ].map((file) => readFileSync(new URL(file, import.meta.url), "utf8"));
    for (const source of sources) {
      expect(source).not.toMatch(
        /#[0-9a-fA-F]{3,8}\b|\b(?:bg|text)-(?:white|black)\b/,
      );
    }
  });
});

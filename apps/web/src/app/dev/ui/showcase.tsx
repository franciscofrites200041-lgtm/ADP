"use client";

import {
  ApprovalCard,
  Badge,
  BrandTile,
  Card,
  ChatBubble,
  Composer,
  DarkPanel,
  Field,
  IconTile,
  PillRadio,
  RaisedRow,
  Segmented,
  SlashHeading,
  Switch,
  ToolStep,
} from "@middleware/ui";
import { useEffect, useState } from "react";

import { messages } from "../../../messages";

const copy = messages.devUi;
const sample = copy.sample;

type Theme = "system" | "light" | "dark";

const themeOptions = [
  { value: "system", label: copy.theme.system },
  { value: "light", label: copy.theme.light },
  { value: "dark", label: copy.theme.dark },
] as const;

const frequencyOptions = [
  { value: "daily", label: sample.pillA },
  { value: "weekly", label: sample.pillB },
] as const;

function isTheme(value: string): value is Theme {
  return value === "system" || value === "light" || value === "dark";
}

export function Showcase() {
  const [theme, setTheme] = useState<Theme>("system");
  const [enabled, setEnabled] = useState(true);

  // "system" removes the override so the stylesheet follows prefers-color-scheme.
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", theme);
    }
    return () => root.removeAttribute("data-theme");
  }, [theme]);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-10 p-6">
      <header className="flex flex-col gap-4">
        <h1 className="text-page font-semibold">{copy.title}</h1>
        <p className="text-ink-2">{copy.description}</p>
        <Segmented
          defaultValue="system"
          label={copy.theme.label}
          name="theme"
          onValueChange={(value) => {
            if (isTheme(value)) setTheme(value);
          }}
          options={themeOptions}
        />
      </header>

      <section className="flex flex-col gap-4">
        <SlashHeading index="01">{copy.sections.surfaces}</SlashHeading>
        <Card>{sample.card}</Card>
        <RaisedRow>{sample.raisedRow}</RaisedRow>
        <DarkPanel>{sample.darkPanel}</DarkPanel>
        <ApprovalCard>{sample.approval}</ApprovalCard>
      </section>

      <section className="flex flex-col gap-4">
        <SlashHeading index="02">{copy.sections.forms}</SlashHeading>
        <Field hint={sample.fieldHint} label={sample.fieldLabel} />
        <Field
          error={sample.fieldError}
          label={sample.fieldErrorLabel}
          type="email"
        />
        <div className="flex gap-2">
          {frequencyOptions.map((option, index) => (
            <PillRadio
              defaultChecked={index === 0}
              key={option.value}
              name="frequency"
              value={option.value}
            >
              {option.label}
            </PillRadio>
          ))}
        </div>
        <Segmented
          defaultValue="daily"
          label={sample.segmentedLabel}
          name="segmented-demo"
          options={frequencyOptions}
        />
        <Switch
          aria-label={sample.switchLabel}
          checked={enabled}
          onCheckedChange={setEnabled}
        />
      </section>

      <section className="flex flex-col gap-4">
        <SlashHeading index="03">{copy.sections.status}</SlashHeading>
        <div className="flex flex-wrap gap-2">
          <Badge tone="accent">{sample.badges.accent}</Badge>
          <Badge tone="soft">{sample.badges.soft}</Badge>
          <Badge tone="neutral">{sample.badges.neutral}</Badge>
          <Badge tone="success">{sample.badges.success}</Badge>
          <Badge tone="warning">{sample.badges.warning}</Badge>
          <Badge tone="danger">{sample.badges.danger}</Badge>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SlashHeading index="04">{copy.sections.flow}</SlashHeading>
        <div>
          <ToolStep icon={<IconTile>⌕</IconTile>}>{sample.toolStep}</ToolStep>
          <ToolStep icon={<IconTile>≡</IconTile>}>
            {sample.toolStepNext}
          </ToolStep>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SlashHeading index="05">{copy.sections.chat}</SlashHeading>
        <ChatBubble author="user">{sample.userBubble}</ChatBubble>
        <ChatBubble author="agent">{sample.agentBubble}</ChatBubble>
        <Composer
          dictateLabel={sample.composerDictate}
          inputLabel={sample.composerInput}
          placeholder={sample.composerPlaceholder}
          sendLabel={sample.composerSend}
        />
      </section>

      <section className="flex flex-col gap-4">
        <SlashHeading index="06">{copy.sections.brand}</SlashHeading>
        <BrandTile />
      </section>
    </main>
  );
}

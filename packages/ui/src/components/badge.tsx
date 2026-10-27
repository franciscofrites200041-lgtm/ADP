import type { ComponentProps } from "react";

import { cn } from "../cn.ts";

type BadgeTone =
  | "accent"
  | "soft"
  | "neutral"
  | "success"
  | "warning"
  | "danger";

interface BadgeProps extends ComponentProps<"span"> {
  tone?: BadgeTone;
}

const toneClasses: Record<BadgeTone, string> = {
  accent: "bg-accent text-on-accent",
  soft: "bg-accent-soft text-accent-soft-ink",
  neutral: "bg-raised text-ink-2 shadow-raised",
  success: "bg-raised text-ink shadow-raised",
  warning: "bg-raised text-ink shadow-raised",
  danger: "bg-raised text-ink shadow-raised",
};

const dotClasses: Partial<Record<BadgeTone, string>> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

/** Status tones render a dot; the label text must always carry the meaning. */
export function Badge({
  tone = "neutral",
  className,
  children,
  ...props
}: BadgeProps) {
  const dot = dotClasses[tone];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-pill px-3 py-1 text-caption font-medium",
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {dot ? (
        <span aria-hidden="true" className={cn("size-2 rounded-pill", dot)} />
      ) : null}
      {children}
    </span>
  );
}

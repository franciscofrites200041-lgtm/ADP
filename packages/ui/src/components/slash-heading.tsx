import type { ComponentProps } from "react";

import { cn } from "../cn.ts";

interface SlashHeadingProps extends ComponentProps<"h2"> {
  /** Zero-padded sequence number, e.g. "01". Use only for a real sequence. */
  index: string;
}

export function SlashHeading({
  index,
  className,
  children,
  ...props
}: SlashHeadingProps) {
  return (
    <h2
      className={cn("text-title font-semibold text-ink", className)}
      {...props}
    >
      <span className="mr-2 font-mono text-accent-text">/{index}</span>
      {children}
    </h2>
  );
}

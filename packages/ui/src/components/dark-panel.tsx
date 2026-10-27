import type { ComponentProps } from "react";

import { cn } from "../cn.ts";

export function DarkPanel({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "rounded-card bg-dark-panel p-6 text-on-dark shadow-panel",
        className,
      )}
      {...props}
    />
  );
}

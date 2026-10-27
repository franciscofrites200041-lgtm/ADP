import type { ComponentProps } from "react";

import { cn } from "../cn.ts";

export function Card({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cn("rounded-card bg-surface p-6 text-ink", className)}
      {...props}
    />
  );
}

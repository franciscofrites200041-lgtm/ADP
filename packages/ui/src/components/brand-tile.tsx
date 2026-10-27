import type { ComponentProps } from "react";

import { cn } from "../cn.ts";

/** Provisional "mw" logo tile. */
export function BrandTile({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-grid size-10 place-items-center rounded-tile bg-accent-gradient text-body font-bold text-on-accent shadow-accent",
        className,
      )}
      {...props}
    >
      mw
    </span>
  );
}

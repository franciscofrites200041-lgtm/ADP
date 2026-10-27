import type { ComponentProps } from "react";

import { cn } from "../cn.ts";

/** Decorative by default; pass `aria-label` and `role="img"` to expose it. */
export function IconTile({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      aria-hidden={props["aria-label"] ? undefined : true}
      className={cn(
        "inline-grid size-10 place-items-center rounded-tile bg-raised text-ink-2 shadow-raised",
        className,
      )}
      {...props}
    />
  );
}

import type { ComponentProps } from "react";

import { cn } from "../cn.ts";

interface SwitchProps
  extends Omit<ComponentProps<"button">, "role" | "type" | "onChange"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/** Callers must name it with `aria-label` or `aria-labelledby`. */
export function Switch({
  checked,
  onCheckedChange,
  className,
  onClick,
  ...props
}: SwitchProps) {
  return (
    <button
      aria-checked={checked}
      className={cn(
        "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center",
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          onCheckedChange(!checked);
        }
      }}
      role="switch"
      type="button"
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex h-7 w-12 items-center rounded-pill p-1 transition-colors motion-reduce:transition-none",
          checked ? "bg-accent" : "bg-surface-2 shadow-raised",
        )}
      >
        <span
          className={cn(
            "size-5 rounded-pill transition-transform motion-reduce:transition-none",
            checked ? "translate-x-5 bg-on-accent" : "bg-muted",
          )}
        />
      </span>
    </button>
  );
}

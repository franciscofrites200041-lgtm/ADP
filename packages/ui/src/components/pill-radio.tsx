import type { ComponentProps, ReactNode } from "react";

import { cn } from "../cn.ts";

interface PillRadioProps extends Omit<ComponentProps<"input">, "type"> {
  children: ReactNode;
}

export function PillRadio({ children, className, ...props }: PillRadioProps) {
  return (
    <label className={cn("relative inline-flex", className)}>
      <input className="peer sr-only" type="radio" {...props} />
      <span className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-field border-2 border-transparent bg-raised px-4 text-body font-medium text-ink shadow-raised peer-checked:border-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
        {children}
      </span>
    </label>
  );
}

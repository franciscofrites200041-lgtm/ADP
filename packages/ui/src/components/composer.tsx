import type { ComponentProps } from "react";

import { cn } from "../cn.ts";

interface ComposerProps extends Omit<ComponentProps<"form">, "children"> {
  placeholder: string;
  inputLabel: string;
  dictateLabel: string;
  sendLabel: string;
  disabled?: boolean;
}

const buttonBase =
  "inline-grid size-11 shrink-0 cursor-pointer place-items-center rounded-field disabled:cursor-not-allowed disabled:opacity-60";

export function Composer({
  placeholder,
  inputLabel,
  dictateLabel,
  sendLabel,
  disabled,
  className,
  ...props
}: ComposerProps) {
  return (
    <form
      className={cn(
        "flex items-center gap-2 rounded-card bg-raised p-2 shadow-raised",
        className,
      )}
      {...props}
    >
      <input
        aria-label={inputLabel}
        className="min-h-11 flex-1 bg-transparent px-3 text-body text-ink placeholder:text-muted"
        disabled={disabled}
        name="message"
        placeholder={placeholder}
        type="text"
      />
      <button
        aria-label={dictateLabel}
        className={cn(buttonBase, "bg-raised text-ink-2 shadow-raised")}
        disabled={disabled}
        type="button"
      >
        <svg
          aria-hidden="true"
          fill="currentColor"
          height="18"
          viewBox="0 0 24 24"
          width="18"
        >
          <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V22h2v-3.08A7 7 0 0 0 19 12h-2Z" />
        </svg>
      </button>
      <button
        aria-label={sendLabel}
        className={cn(
          buttonBase,
          "bg-accent-gradient text-on-accent shadow-accent",
        )}
        disabled={disabled}
        type="submit"
      >
        <svg
          aria-hidden="true"
          fill="currentColor"
          height="18"
          viewBox="0 0 24 24"
          width="18"
        >
          <path d="M3.4 20.4 21 12 3.4 3.6 3.39 10l12.6 2-12.6 2 .01 6.4Z" />
        </svg>
      </button>
    </form>
  );
}

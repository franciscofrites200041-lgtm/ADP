import { type ComponentProps, useId } from "react";

import { cn } from "../cn.ts";

interface FieldProps extends Omit<ComponentProps<"input">, "id"> {
  label: string;
  hint?: string;
  error?: string;
}

export function Field({ label, hint, error, className, ...props }: FieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;

  return (
    <div className="flex flex-col gap-2">
      <label className="text-small font-medium text-ink-2" htmlFor={id}>
        {label}
      </label>
      <input
        aria-describedby={note ? noteId : undefined}
        aria-invalid={error ? true : undefined}
        className={cn(
          "min-h-11 rounded-field bg-raised px-4 text-body text-ink shadow-raised placeholder:text-muted",
          className,
        )}
        id={id}
        {...props}
      />
      {note ? (
        <p
          className={cn("text-small", error ? "text-danger" : "text-muted")}
          id={noteId}
          role={error ? "alert" : undefined}
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}

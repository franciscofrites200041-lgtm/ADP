interface SegmentedOption {
  value: string;
  label: string;
}

interface SegmentedProps {
  name: string;
  label: string;
  options: readonly SegmentedOption[];
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

export function Segmented({
  name,
  label,
  options,
  defaultValue,
  onValueChange,
}: SegmentedProps) {
  return (
    <div
      aria-label={label}
      className="inline-flex gap-1 rounded-field bg-surface-2 p-1"
      role="radiogroup"
    >
      {options.map((option) => (
        <label className="relative" key={option.value}>
          <input
            className="peer sr-only"
            defaultChecked={option.value === defaultValue}
            name={name}
            onChange={() => onValueChange?.(option.value)}
            type="radio"
            value={option.value}
          />
          <span className="inline-flex min-h-11 cursor-pointer items-center rounded-tile px-4 text-body font-medium text-ink-2 peer-checked:bg-raised peer-checked:text-ink peer-checked:shadow-raised peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
            {option.label}
          </span>
        </label>
      ))}
    </div>
  );
}

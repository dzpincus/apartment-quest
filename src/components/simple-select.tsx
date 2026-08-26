"use client";

/**
 * Base UI's Select is a nine-part assembly. Ninety percent of this app just
 * needs "a list of options" — this is that, everywhere.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type SelectOption<T extends string = string> = {
  value: T;
  label: string;
};

export function SimpleSelect<T extends string>({
  id,
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  className,
  contentClassName,
  size = "default",
  disabled,
  "aria-label": ariaLabel,
}: {
  /** Lands on the trigger, so a `<FieldLabel htmlFor>` can point at it. */
  id?: string;
  value: T | null;
  onValueChange: (value: T) => void;
  options: ReadonlyArray<SelectOption<T>>;
  placeholder?: string;
  className?: string;
  contentClassName?: string;
  size?: "sm" | "default";
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <Select
      items={options as ReadonlyArray<{ value: T; label: string }>}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next != null) onValueChange(next as T);
      }}
    >
      <SelectTrigger
        id={id}
        size={size}
        className={cn("w-full", className)}
        aria-label={ariaLabel}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className={contentClassName}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

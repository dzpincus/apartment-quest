"use client";

/**
 * Click-to-edit cell. Shared by the listings table and the detail grid.
 *
 * Enter or blur saves, Escape cancels, an unchanged value saves nothing (which
 * is what keeps `edited_listing` out of the activity feed on a stray click).
 * `onSave` gets the raw string — the caller decides how to parse it.
 */

import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type InlineEditProps = {
  value: string | number | null | undefined;
  onSave: (raw: string) => void;
  /** What to show when not editing. Defaults to the value. */
  display?: React.ReactNode;
  type?: "text" | "number" | "date";
  multiline?: boolean;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  label?: string;
  disabled?: boolean;
};

export function InlineEdit({
  value,
  onSave,
  display,
  type = "text",
  multiline = false,
  placeholder = "—",
  className,
  inputClassName,
  label,
  disabled,
}: InlineEditProps) {
  const initial = value == null ? "" : String(value);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial);
  const cancelled = useRef(false);

  function start() {
    if (disabled) return;
    cancelled.current = false;
    setDraft(initial);
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    if (cancelled.current) return;
    if (draft.trim() === initial.trim()) return;
    onSave(draft.trim());
  }

  if (editing) {
    const shared = {
      autoFocus: true,
      value: draft,
      placeholder: label,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          cancelled.current = true;
          setEditing(false);
        }
        if (e.key === "Enter" && (!multiline || e.metaKey)) {
          e.preventDefault();
          commit();
        }
      },
    };
    return multiline ? (
      <Textarea {...shared} className={cn("min-h-16 text-sm", inputClassName)} />
    ) : (
      <Input {...shared} type={type} className={cn("h-7 text-sm", inputClassName)} />
    );
  }

  const isEmpty = initial === "";
  return (
    <button
      type="button"
      onClick={start}
      disabled={disabled}
      aria-label={label ? `Edit ${label}` : undefined}
      className={cn(
        "-mx-1 w-full max-w-full truncate rounded px-1 py-0.5 text-left hover:bg-muted disabled:pointer-events-none",
        isEmpty && "text-muted-foreground",
        className,
      )}
    >
      {display ?? (isEmpty ? placeholder : initial)}
    </button>
  );
}

/** Parse helpers for the `onSave(raw)` string. */
export function toNumberOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function toTextOrNull(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

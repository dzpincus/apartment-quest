"use client";

/**
 * Broker fields. Renders a `<div>`, not a `<form>`, on purpose: the listing
 * modal embeds this inside its own form and nested forms are invalid HTML.
 * Submission is driven by the buttons calling `handleSubmit` directly.
 */

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Broker } from "@/lib/types";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const brokerSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  company: z.string().trim(),
  phone: z.string().trim(),
  email: z
    .string()
    .trim()
    .refine((v) => v === "" || EMAIL.test(v), "Enter a valid email"),
  notes: z.string().trim(),
});

export type BrokerValues = z.infer<typeof brokerSchema>;

export function brokerDefaults(broker?: Broker | null): BrokerValues {
  return {
    name: broker?.name ?? "",
    company: broker?.company ?? "",
    phone: broker?.phone ?? "",
    email: broker?.email ?? "",
    notes: broker?.notes ?? "",
  };
}

/** Strings out, nulls in — empty text columns stay null in Postgres. */
export function brokerPayload(values: BrokerValues) {
  const nullify = (v: string) => (v.trim() === "" ? null : v.trim());
  return {
    name: values.name.trim(),
    company: nullify(values.company),
    phone: nullify(values.phone),
    email: nullify(values.email),
    notes: nullify(values.notes),
  };
}

export function BrokerForm({
  broker,
  submitLabel = "Save broker",
  pending = false,
  onSubmit,
  onCancel,
}: {
  broker?: Broker | null;
  submitLabel?: string;
  pending?: boolean;
  onSubmit: (values: BrokerValues) => void;
  onCancel?: () => void;
}) {
  const form = useForm<BrokerValues>({
    resolver: zodResolver(brokerSchema),
    defaultValues: brokerDefaults(broker),
  });
  const { errors } = form.formState;

  return (
    <div className="grid gap-3">
      <Field>
        <FieldLabel htmlFor="broker-name">Name</FieldLabel>
        <Input id="broker-name" {...form.register("name")} />
        <FieldError errors={[errors.name]} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="broker-company">Company</FieldLabel>
          <Input id="broker-company" {...form.register("company")} />
        </Field>
        <Field>
          <FieldLabel htmlFor="broker-phone">Phone</FieldLabel>
          <Input id="broker-phone" type="tel" {...form.register("phone")} />
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="broker-email">Email</FieldLabel>
        <Input id="broker-email" type="email" {...form.register("email")} />
        <FieldError errors={[errors.email]} />
      </Field>

      <Field>
        <FieldLabel htmlFor="broker-notes">Notes</FieldLabel>
        <Textarea id="broker-notes" rows={2} {...form.register("notes")} />
      </Field>

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          type="button"
          disabled={pending}
          onClick={form.handleSubmit((values) => onSubmit(values))}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

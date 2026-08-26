"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { BrokerForm, brokerPayload } from "@/components/brokers/broker-form";
import { usePerson } from "@/lib/person";
import { useMutations } from "@/lib/mutations";
import type { Broker } from "@/lib/types";

export function AddBrokerDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus />
        Add broker
      </DialogTrigger>
      {open && <BrokerDialogBody onDone={() => setOpen(false)} />}
    </Dialog>
  );
}

export function EditBrokerDialog({ broker }: { broker: Broker }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="ghost" size="icon-sm" />}
        aria-label={`Edit ${broker.name}`}
      >
        <Pencil />
      </DialogTrigger>
      {open && <BrokerDialogBody broker={broker} onDone={() => setOpen(false)} />}
    </Dialog>
  );
}

function BrokerDialogBody({
  broker,
  onDone,
}: {
  broker?: Broker;
  onDone: () => void;
}) {
  const { person } = usePerson();
  const { createBroker, updateBroker } = useMutations(person?.id);

  return (
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{broker ? "Edit broker" : "Add broker"}</DialogTitle>
        <DialogDescription>
          Whatever you have. Name is the only required field.
        </DialogDescription>
      </DialogHeader>
      <BrokerForm
        broker={broker}
        submitLabel={broker ? "Save" : "Add broker"}
        pending={createBroker.isPending || updateBroker.isPending}
        onCancel={onDone}
        onSubmit={async (values) => {
          const payload = brokerPayload(values);
          try {
            if (broker) {
              await updateBroker.mutateAsync({ id: broker.id, patch: payload });
              toast.success(`Saved ${payload.name}`);
            } else {
              await createBroker.mutateAsync(payload);
              toast.success(`Added ${payload.name}`);
            }
          } catch {
            // Toasted by `onError`. The dialog stays open with the typed values,
            // which is the whole point of catching: a duplicate name is worth
            // fixing in place, not retyping.
            return;
          }
          onDone();
        }}
      />
    </DialogContent>
  );
}

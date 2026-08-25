"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Merge } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { usePerson } from "@/lib/person";
import { useMutations } from "@/lib/mutations";
import { useListings, type ListingRow } from "@/lib/queries";
import { listingLabel, money } from "@/lib/format";

/**
 * Post-hoc dedupe: fold this listing into another one. The RPC repoints
 * interactions/messages/votes and hides this row behind `merged_into`.
 */
export function MergeIntoDialog({ listing }: { listing: ListingRow }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Merge />
        Merge into…
      </DialogTrigger>
      {open && <MergePicker listing={listing} onDone={() => setOpen(false)} />}
    </Dialog>
  );
}

function MergePicker({
  listing,
  onDone,
}: {
  listing: ListingRow;
  onDone: () => void;
}) {
  const router = useRouter();
  const { person } = usePerson();
  const { mergeListings } = useMutations(person?.id);
  const { data: listings = [] } = useListings();
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<ListingRow | null>(null);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return listings
      .filter((l) => l.id !== listing.id)
      .filter((l) =>
        q === ""
          ? true
          : listingLabel(l.address, l.unit).toLowerCase().includes(q) ||
            (l.neighborhood ?? "").toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [listings, listing.id, search]);

  async function confirm() {
    if (!target) return;
    await mergeListings.mutateAsync({ src: listing, dstId: target.id });
    toast.success(`Merged into ${listingLabel(target.address, target.unit)}`);
    onDone();
    router.push(`/listings/${target.id}`);
  }

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Merge into another listing</DialogTitle>
        <DialogDescription>
          {target
            ? `${listingLabel(listing.address, listing.unit)} will be hidden and its
               history moved onto ${listingLabel(target.address, target.unit)}. This
               cannot be undone from the app.`
            : "Pick the listing to keep."}
        </DialogDescription>
      </DialogHeader>

      {!target && (
        <div className="grid gap-2">
          <Input
            autoFocus
            placeholder="Search by address"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="grid max-h-64 gap-1 overflow-y-auto">
            {matches.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setTarget(l)}
                className="flex items-center justify-between gap-2 rounded-md border p-2 text-left text-sm hover:bg-muted"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {listingLabel(l.address, l.unit)}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {l.neighborhood ?? "—"}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">{money(l.rent)}</span>
              </button>
            ))}
            {matches.length === 0 && (
              <p className="p-2 text-sm text-muted-foreground">No other listings.</p>
            )}
          </div>
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={target ? () => setTarget(null) : onDone}>
          {target ? "Back" : "Cancel"}
        </Button>
        <Button
          variant="destructive"
          disabled={!target || mergeListings.isPending}
          onClick={confirm}
        >
          Merge
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

"use client";

import { SimpleSelect } from "@/components/simple-select";
import { STATUS_OPTIONS } from "@/components/listings/options";
import { usePerson } from "@/lib/person";
import { useMutations } from "@/lib/mutations";
import type { Listing, ListingStatus } from "@/lib/types";

/** Status changes get their own verb, so they never go through `updateListing`. */
export function StatusSelect({
  listing,
  size = "sm",
  className,
}: {
  listing: Pick<Listing, "id" | "address" | "unit" | "status">;
  size?: "sm" | "default";
  className?: string;
}) {
  const { person } = usePerson();
  const { setListingStatus } = useMutations(person?.id);

  return (
    <SimpleSelect<ListingStatus>
      aria-label="Status"
      size={size}
      className={className}
      // No optimistic patch here: the write also nulls the follow-up triple for
      // passed/lost, so a local guess would have to reimplement that. Locking
      // the control instead keeps the displayed value honest for the one round
      // trip, and stops a double-pick racing itself.
      disabled={setListingStatus.isPending}
      value={listing.status ?? "saved"}
      options={STATUS_OPTIONS}
      onValueChange={(status) => setListingStatus.mutate({ listing, status })}
    />
  );
}

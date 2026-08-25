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
      value={listing.status ?? "saved"}
      options={STATUS_OPTIONS}
      onValueChange={(status) => setListingStatus.mutate({ listing, status })}
    />
  );
}

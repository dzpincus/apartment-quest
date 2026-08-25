"use client";

import { useCallback } from "react";
import { usePerson } from "@/lib/person";
import { useMutations, type ListingPatch } from "@/lib/mutations";
import type { ListingRow } from "@/lib/queries";

/**
 * One inline-edit saver per row. `prev` is the row as rendered, so an edit that
 * changes nothing writes no activity entry.
 */
export function useRowEdit(row: ListingRow) {
  const { person } = usePerson();
  const { updateListing } = useMutations(person?.id);
  const mutate = updateListing.mutate;

  return useCallback(
    (patch: ListingPatch) => {
      mutate({ id: row.id, patch, prev: row });
    },
    [mutate, row],
  );
}

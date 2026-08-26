"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPeople, queryKeys } from "@/lib/queries";
import { humans } from "@/lib/people";
import type { Person } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "person_id";

// localStorage as an external store, so React reads it without a setState-in-effect.
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readPersonId() {
  return window.localStorage.getItem(STORAGE_KEY);
}

function writePersonId(id: string) {
  window.localStorage.setItem(STORAGE_KEY, id);
  for (const listener of listeners) listener();
}

type PersonContextValue = {
  person: Person | null;
  people: Person[];
  setPersonId: (id: string) => void;
};

const PersonContext = createContext<PersonContextValue | null>(null);

export function usePerson() {
  const ctx = useContext(PersonContext);
  if (!ctx) throw new Error("usePerson must be used inside <PersonProvider>");
  return ctx;
}

/** For mutations: the person is guaranteed by the gate, so blow up loudly if not. */
export function useRequirePerson(): Person {
  const { person } = usePerson();
  if (!person) throw new Error("No person selected");
  return person;
}

/**
 * The people list, defined once. The key and the fetcher come from
 * `queries.ts` — this module used to carry a second copy of both, which is one
 * schema change away from two queries that disagree. The import cycle with
 * `queries.ts` (which needs `usePerson` for the unread badges) is safe: every
 * reference on both sides is inside a function body, so neither module touches
 * the other while it is still evaluating.
 */
export function peopleQueryOptions() {
  return {
    queryKey: queryKeys.people,
    queryFn: fetchPeople,
    staleTime: 5 * 60_000,
  };
}

export function PersonProvider({ children }: { children: React.ReactNode }) {
  const personId = useSyncExternalStore(subscribe, readPersonId, () => null);

  const { data: roster = [], isPending, error, refetch } = useQuery(peopleQueryOptions());

  /**
   * Quest Bot is a row in `people` (0006) because `activity.person_id` is NOT
   * NULL and the sync run needs something to sign with — it is not one of us.
   * Every consumer of this context is asking about *housemates*: the picker
   * below, the incomes list, the vote rows, the four vote circles, the
   * next-action owner and the qualification sum. So the roster is filtered
   * once, here, with `isBot`.
   *
   * The two places the bot does appear — the activity feed and a queue row's
   * owner dot — read their person from the query's own join
   * (`activity.person`, `next_action_owner_person`), never from this list, so
   * they keep rendering it with its own quiet-blue dot exactly like anyone
   * else.
   */
  const people = useMemo(() => humans(roster), [roster]);

  const setPersonId = useCallback((id: string) => writePersonId(id), []);

  const person = useMemo(
    () => people.find((p) => p.id === personId) ?? null,
    [people, personId],
  );

  const value = useMemo(
    () => ({ person, people, setPersonId }),
    [person, people, setPersonId],
  );

  // Only gate once the people list has loaded (i.e. after hydration).
  const gateOpen = !isPending && !person;

  return (
    <PersonContext.Provider value={value}>
      {children}
      <Dialog open={gateOpen} disablePointerDismissal>
        <DialogContent showCloseButton={false} className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Who are you?</DialogTitle>
            <DialogDescription>
              Pick yourself. Stored on this device only.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {/* A failed fetch and an unseeded database both left an empty list,
                so a dropped connection told you to go run seed.sql. */}
            {error && (
              <div className="grid gap-2">
                <p className="text-sm text-destructive">
                  Could not load the list of people:{" "}
                  {String((error as Error).message)}
                </p>
                <Button variant="outline" onClick={() => void refetch()}>
                  Retry
                </Button>
              </div>
            )}
            {people.map((p) => (
              <Button
                key={p.id}
                variant="outline"
                className="h-12 w-full justify-start gap-3 text-base"
                // Tinted with their own colour — the same colour that will
                // border everything they add from here on.
                style={{
                  borderColor: p.color ?? undefined,
                  backgroundColor: `${p.color ?? "#888"}1f`,
                }}
                onClick={() => setPersonId(p.id)}
              >
                <span
                  className="size-4 rounded-full"
                  style={{ backgroundColor: p.color ?? "#888" }}
                />
                {p.name}
              </Button>
            ))}
            {!error && people.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No people found. Run supabase/seed.sql.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </PersonContext.Provider>
  );
}

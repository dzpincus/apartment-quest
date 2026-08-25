"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
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

export function peopleQueryOptions() {
  return {
    queryKey: ["people"] as const,
    queryFn: async (): Promise<Person[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("people")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Person[];
    },
    staleTime: 5 * 60_000,
  };
}

export function PersonProvider({ children }: { children: React.ReactNode }) {
  const personId = useSyncExternalStore(subscribe, readPersonId, () => null);

  const { data: people = [], isPending } = useQuery(peopleQueryOptions());

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
            {people.map((p) => (
              <Button
                key={p.id}
                variant="outline"
                className="h-11 w-full justify-start gap-3 text-base"
                style={{
                  borderColor: p.color ?? undefined,
                  backgroundColor: `${p.color ?? "#888"}14`,
                }}
                onClick={() => setPersonId(p.id)}
              >
                <span
                  className="size-3 rounded-full"
                  style={{ backgroundColor: p.color ?? "#888" }}
                />
                {p.name}
              </Button>
            ))}
            {people.length === 0 && (
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

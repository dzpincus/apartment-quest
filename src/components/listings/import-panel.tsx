"use client";

/**
 * The top of the Add Listing dialog: paste a link, get a filled-in form.
 *
 * The whole design assumes the fetch will sometimes fail, because Zillow and
 * StreetEasy block datacentre IPs on purpose. "Blocked" is therefore not an
 * error state — it is a second, quieter input: copy the page text, paste it
 * here, same result. Nothing in here throws a red toast at a wall we expected
 * to hit.
 *
 * Photos are picked here and *saved* by the dialog after the listing exists
 * (a photo needs a listing id), so this component only ever reports the
 * selection upward.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, ClipboardPaste, ImageOff, Link2, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  isBlocked,
  isDisabled,
  isExisting,
  isSuccess,
  type ImportExisting,
  type ImportResponse,
  type ImportSuccess,
} from "@/lib/import/types";

type PanelState =
  | { kind: "idle" }
  | { kind: "loading"; what: "link" | "text" }
  | { kind: "done"; result: ImportSuccess }
  | { kind: "existing"; info: ImportExisting }
  | { kind: "error"; message: string };

const SOURCE_LABEL: Record<ImportSuccess["source"], string> = {
  direct: "the listing page",
  firecrawl: "the listing page",
  paste: "the text you pasted",
};

export function ImportPanel({
  initialUrl = null,
  autoFetch = false,
  onFill,
  onPhotosChange,
}: {
  initialUrl?: string | null;
  /** Deep link (`/listings?import=…`): fetch once, without waiting for a click. */
  autoFetch?: boolean;
  onFill: (result: ImportSuccess) => void;
  onPhotosChange: (urls: string[]) => void;
}) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [pasted, setPasted] = useState("");
  const [state, setState] = useState<PanelState>({ kind: "idle" });
  const [photos, setPhotos] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [broken, setBroken] = useState<Set<string>>(new Set());
  /**
   * Held outside the state machine on purpose: once a site has refused us, the
   * paste box stays on screen through the loading and error states that
   * follow. Losing the textarea the moment "Read the text" is clicked would
   * throw away what the user just pasted.
   */
  const [blockedReason, setBlockedReason] = useState<string | null>(null);

  const busy = state.kind === "loading";

  /** Photo state and the parent's copy of it move together, always. */
  const publishPhotos = useCallback(
    (all: string[], picked: Set<string>) => {
      setPhotos(all);
      setSelected(picked);
      onPhotosChange(all.filter((u) => picked.has(u)));
    },
    [onPhotosChange],
  );

  const run = useCallback(
    async (body: { url?: string; text?: string; force?: boolean }, what: "link" | "text") => {
      setState({ kind: "loading", what });
      let res: Response;
      try {
        res = await fetch("/api/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        setState({ kind: "error", message: "Couldn't reach the server." });
        return;
      }

      let data: ImportResponse;
      try {
        data = (await res.json()) as ImportResponse;
      } catch {
        setState({ kind: "error", message: "The server sent something unreadable." });
        return;
      }

      if (isDisabled(data)) {
        toast.info("Import isn't configured — fill the form in by hand.");
        setState({ kind: "idle" });
        return;
      }
      if (res.status === 401) {
        setState({ kind: "error", message: "Your session expired — reload and sign in." });
        return;
      }
      if (isExisting(data)) {
        setState({ kind: "existing", info: data });
        return;
      }
      if (isBlocked(data)) {
        setBlockedReason(data.reason);
        setState({ kind: "idle" });
        return;
      }
      if (!res.ok || !isSuccess(data)) {
        const message =
          "error" in data && typeof data.error === "string"
            ? data.error
            : "That didn't work.";
        setState({ kind: "error", message });
        return;
      }

      publishPhotos(data.photos, new Set(data.photos));
      setBroken(new Set());
      setBlockedReason(null);
      setState({ kind: "done", result: data });
      onFill(data);
    },
    [onFill, publishPhotos],
  );

  /**
   * The deep link fetches once, on mount, and never again.
   *
   * Queued with a timeout rather than called straight from the effect body:
   * `run` sets state on its first line, and a synchronous setState inside an
   * effect is a cascading render. The guard lives *inside* the callback so
   * development's double-invoke — schedule, clean up, schedule — still ends in
   * exactly one fetch rather than zero.
   */
  const autoRan = useRef(false);
  useEffect(() => {
    if (!autoFetch || autoRan.current) return;
    const trimmed = (initialUrl ?? "").trim();
    if (!trimmed) return;
    const timer = setTimeout(() => {
      if (autoRan.current) return;
      autoRan.current = true;
      void run({ url: trimmed }, "link");
    }, 0);
    return () => clearTimeout(timer);
  }, [autoFetch, initialUrl, run]);

  function fetchLink() {
    const trimmed = url.trim();
    if (!trimmed) {
      toast.info("Paste a listing link first.");
      return;
    }
    void run({ url: trimmed }, "link");
  }

  function extractPaste() {
    if (pasted.trim().length < 40) {
      toast.info("Paste a bit more of the page — that isn't enough to read.");
      return;
    }
    void run({ text: pasted }, "text");
  }

  function toggle(photo: string) {
    const next = new Set(selected);
    if (next.has(photo)) next.delete(photo);
    else next.add(photo);
    publishPhotos(photos, next);
  }

  return (
    <div className="grid gap-3 rounded-xl border-2 border-border bg-inset p-3">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-primary" />
        <p className="text-sm font-extrabold">Import from a link</p>
        <span className="text-xs text-faint">optional</span>
      </div>

      <div className="flex gap-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              fetchLink();
            }
          }}
          placeholder="Paste a Zillow / StreetEasy link"
          inputMode="url"
          aria-label="Listing link to import"
          disabled={busy}
        />
        <Button type="button" onClick={fetchLink} disabled={busy}>
          {state.kind === "loading" && state.what === "link" ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Link2 />
          )}
          Fetch
        </Button>
      </div>

      {state.kind === "loading" && (
        <p className="text-sm text-muted-foreground">
          {state.what === "link" ? "Reading the listing…" : "Reading what you pasted…"}
        </p>
      )}

      {state.kind === "done" && <DoneChip result={state.result} />}

      {state.kind === "existing" && (
        <div className="grid gap-2 rounded-lg border-2 border-border bg-card p-3 text-sm">
          <p>
            <strong>{state.info.existingLabel}</strong> is already on the board
            {state.info.existingAddedBy ? `, added by ${state.info.existingAddedBy}` : ""}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              render={<Link href={`/listings/${state.info.existingListingId}`} />}
            >
              Open it
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void run({ url: url.trim(), force: true }, "link")}
            >
              Import anyway
            </Button>
          </div>
        </div>
      )}

      {state.kind === "error" && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          <span>{state.message}</span>
          <Button type="button" size="sm" variant="outline" onClick={fetchLink}>
            Try again
          </Button>
        </div>
      )}

      {blockedReason && state.kind !== "done" && (
        <div className="grid gap-2 rounded-lg border-2 border-border bg-card p-3">
          <p className="text-sm">
            {blockedReason} Open the listing, select the page (⌘A) and copy it, then paste
            it here — that always works.
          </p>
          <Textarea
            rows={4}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="Paste the listing page text here"
            aria-label="Pasted listing text"
          />
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" onClick={extractPaste} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <ClipboardPaste />}
              Read the text
            </Button>
            <span className="text-xs text-faint">Pasted text has no photos.</span>
          </div>
        </div>
      )}

      {photos.length > 0 && (
        <PhotoPicker
          photos={photos}
          selected={selected}
          broken={broken}
          onToggle={toggle}
          onSelectAll={() => publishPhotos(photos, new Set(photos))}
          onSelectNone={() => publishPhotos(photos, new Set())}
          onBroken={(u) => setBroken((prev) => new Set(prev).add(u))}
        />
      )}
    </div>
  );
}

function DoneChip({ result }: { result: ImportSuccess }) {
  const count = result.filledKeys.length;
  return (
    <div className="grid gap-1">
      <p className="text-sm">
        <span className="mr-2 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-extrabold text-ink">
          <Check className="size-3" />
          {count === 0 ? "Nothing found" : `Filled ${count} field${count === 1 ? "" : "s"}`}
        </span>
        <span className="text-muted-foreground">
          from {SOURCE_LABEL[result.source]} — check the highlighted ones.
        </span>
      </p>
      {result.warnings.map((warning) => (
        <p key={warning} className="text-xs text-destructive">
          {warning}
        </p>
      ))}
    </div>
  );
}

/**
 * Thumbnails straight from the source CDN — no proxy, no Next image loader.
 * `no-referrer` because some hosts 403 a request that admits it came from
 * localhost, and a thumbnail that fails to load still has to stay tickable:
 * the URL may well fetch fine from the server that eventually saves it.
 */
function PhotoPicker({
  photos,
  selected,
  broken,
  onToggle,
  onSelectAll,
  onSelectNone,
  onBroken,
}: {
  photos: string[];
  selected: Set<string>;
  broken: Set<string>;
  onToggle: (url: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onBroken: (url: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <p className="text-sm font-extrabold">
          Photos found ({photos.length}) · {selected.size} selected
        </p>
        <div className="ml-auto flex gap-1">
          <Button type="button" size="xs" variant="ghost" onClick={onSelectAll}>
            All
          </Button>
          <Button type="button" size="xs" variant="ghost" onClick={onSelectNone}>
            None
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {photos.map((photo) => {
          const isSelected = selected.has(photo);
          return (
            <button
              key={photo}
              type="button"
              onClick={() => onToggle(photo)}
              aria-pressed={isSelected}
              aria-label={isSelected ? "Deselect photo" : "Select photo"}
              className={cn(
                "relative aspect-square overflow-hidden rounded-2xl border-2 transition-opacity",
                isSelected
                  ? "border-primary opacity-100"
                  : "border-border opacity-50 hover:opacity-80",
              )}
            >
              {broken.has(photo) ? (
                <span className="flex size-full items-center justify-center bg-secondary">
                  <ImageOff className="size-4 text-faint" />
                </span>
              ) : (
                /* A remote CDN thumbnail we neither host nor optimise, and
                   which must keep its own referrer policy. */
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photo}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={() => onBroken(photo)}
                  className="size-full object-cover"
                />
              )}
              {isSelected && (
                <span className="absolute top-1 right-1 rounded-full bg-primary p-0.5 text-ink">
                  <Check className="size-3" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

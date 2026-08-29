"use client";

/**
 * "Notify me" — the one control for browser notifications.
 *
 * Three states the browser owns and one we do:
 *
 * - `unsupported`: no `window.Notification` at all. On an iPhone that means
 *   Safari in a tab, and the fix is "Add to Home Screen", so the button says
 *   that rather than nothing.
 * - `denied`: only the browser's own settings can undo this. Asking again does
 *   nothing at all (the promise resolves `denied` without a prompt), so the
 *   button is disabled and says where to go.
 * - `default`: one click asks, and a *yes* switches the preference on and fires
 *   a single test banner — the whole point of pressing it is to find out
 *   whether it works.
 * - `granted`: the click is ours, and toggles the per-device preference.
 *
 * Permission and preference are deliberately two things: somebody who said yes
 * six weeks ago and has since had enough turns off the preference, not the
 * browser, and gets it back with one tap.
 */

import { useState, useSyncExternalStore } from "react";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePerson } from "@/lib/person";
import { useNotifyEnabled } from "@/lib/prefs";
import { notificationPermission, type NotifyPermission } from "@/lib/notifications";

const TITLES: Record<NotifyPermission, string> = {
  unsupported:
    "Notifications need this app added to your Home Screen on iPhone, or a desktop browser.",
  denied: "Notifications are blocked in your browser settings.",
  default: "Ask this browser for permission to show new messages.",
  granted: "New messages show as a notification while a tab is open.",
};

/**
 * The browser's permission as an external store, so the button can read it
 * without a setState in an effect. There is no event for a permission change,
 * so nothing subscribes to anything real — `emit()` after
 * `requestPermission()` is the only thing that ever moves it. The server
 * snapshot is `"unsupported"`, which renders the button disabled for exactly
 * one paint and never renders a live-looking control that would throw.
 */
const permissionListeners = new Set<() => void>();

function subscribePermission(onChange: () => void) {
  permissionListeners.add(onChange);
  return () => permissionListeners.delete(onChange);
}

function emitPermission() {
  for (const listener of permissionListeners) listener();
}

export function NotifyToggle({ className }: { className?: string }) {
  const { person } = usePerson();
  const [enabled, setEnabled] = useNotifyEnabled(person?.id);
  // `unsupported` until the client has looked, so the server and the first
  // paint agree; hydration corrects it.
  const permission = useSyncExternalStore(
    subscribePermission,
    notificationPermission,
    () => "unsupported" as const,
  );
  const [asking, setAsking] = useState(false);

  const blocked = permission === "unsupported" || permission === "denied";
  const on = enabled && permission === "granted";

  async function click() {
    if (blocked || asking) return;

    if (permission === "granted") {
      setEnabled(!enabled);
      return;
    }

    setAsking(true);
    try {
      const result = await window.Notification.requestPermission();
      emitPermission();
      if (result !== "granted") return;
      setEnabled(true);
      try {
        // One banner, so the answer to "did that work" is on screen and not
        // "wait for somebody to say something".
        new window.Notification("Notifications on", {
          body: "You'll hear about new messages while Apartment Quest is open in a tab.",
          tag: "aq:test",
          icon: "/icon-192.png",
        });
      } catch {
        // Chrome on Android throws for a Notification constructed outside a
        // service worker. The preference is still set and realtime messages
        // will try the same path; there is nothing useful to say here.
      }
    } catch {
      // A browser that refuses to be asked is a browser that will not notify.
      emitPermission();
    } finally {
      setAsking(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={blocked || asking}
      aria-pressed={on}
      title={TITLES[permission]}
      className={className}
      onClick={() => void click()}
    >
      {on ? <Bell /> : <BellOff />}
      {on ? "Notifying" : "Notify me"}
    </Button>
  );
}

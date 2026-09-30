import { useSyncExternalStore } from "react";

/**
 * Installing the worker and contractor apps. ADR-0018.
 *
 * Chrome, Brave and Edge on Android fire `beforeinstallprompt` when a page can
 * be installed. The event may come before React has drawn anything, so the
 * entry script calls `captureInstallPrompt()` first and keeps the event here.
 * The header's Install button shows only while an event is kept, and calling
 * `install()` shows the browser's own question.
 *
 * The officer app calls neither function, so it never shows the button.
 * iPhone Safari has no such event, so no button appears there; the user adds
 * the app with "Add to Home Screen" himself.
 */

/** The part of the browser's event we use. Not in TypeScript's DOM types yet. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let kept: InstallPromptEvent | null = null;
let listening = false;
const subscribers = new Set<() => void>();

function set(next: InstallPromptEvent | null) {
  kept = next;
  subscribers.forEach((fn) => fn());
}

function onPrompt(e: Event) {
  // Stops the browser's own small banner, so there is one way to install.
  e.preventDefault();
  set(e as InstallPromptEvent);
}

function onInstalled() {
  set(null);
}

/** Start listening. The worker and contractor entry scripts call this first. */
export function captureInstallPrompt() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);
}

/** Tests only: forget the kept event and stop listening. */
export function resetInstallPromptForTests() {
  if (typeof window !== "undefined") {
    window.removeEventListener("beforeinstallprompt", onPrompt);
    window.removeEventListener("appinstalled", onInstalled);
  }
  listening = false;
  set(null);
}

/** Whether an Install button should show now, as a React value. */
export function useCanInstall(): boolean {
  return useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    () => kept !== null,
    () => false,
  );
}

/**
 * Show the browser's install question. The event can be used only once,
 * whatever the answer, so the button goes away after this.
 */
export async function install(): Promise<void> {
  const e = kept;
  if (!e) return;
  set(null);
  await e.prompt();
  await e.userChoice;
}

/**
 * Register the app's service worker, in the production build only: in
 * development Vite serves source files that change on every save, and a cache
 * would show old code.
 */
export function registerServiceWorker(app: "worker" | "contractor") {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`/${app}/sw.js`, { scope: `/${app}/` }).catch(() => {
      // The app works without it; it only will not open offline.
    });
  });
}

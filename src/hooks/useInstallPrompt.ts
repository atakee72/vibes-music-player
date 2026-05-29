import { useEffect, useState } from 'react';

/**
 * The `beforeinstallprompt` event isn't in the standard TS lib yet.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function detectIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);
  // Already installed → no need for the hint.
  const standalone =
    (navigator as unknown as { standalone?: boolean }).standalone === true ||
    (typeof matchMedia !== 'undefined' &&
      matchMedia('(display-mode: standalone)').matches);
  return isIOSDevice && !standalone;
}

/**
 * Bridges the browser's PWA install affordances into React state.
 *
 * - `canInstall` / `promptInstall`: Chromium fires `beforeinstallprompt`; we
 *   stash it and replay it on user gesture.
 * - `isIOS`: iOS Safari never fires that event, so the UI shows a manual
 *   "Add to Home Screen" hint instead. UA detection is best-effort (modern
 *   iPadOS reports as Mac); it only gates a hint, never functionality.
 *
 * Thin browser-API wrapper, untested by convention (see useMediaSession).
 */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS] = useState(detectIOS);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const promptInstall = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    // The event is single-use; clear it whether accepted or dismissed.
    setDeferred(null);
  };

  return { canInstall: deferred !== null, promptInstall, isIOS };
}

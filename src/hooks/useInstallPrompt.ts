import { useEffect, useState } from 'react';

/** Chrome/Edge fire this before they would show their own install UI. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const isStandalone = () =>
  typeof window !== 'undefined'
  && (window.matchMedia?.('(display-mode: standalone)').matches
    || window.matchMedia?.('(display-mode: fullscreen)').matches
    // iOS Safari exposes its own flag.
    || (navigator as Navigator & { standalone?: boolean }).standalone === true);

/**
 * PWA install state.
 *
 * `canInstall` is true only when the browser has actually offered an install
 * prompt — which is the only case where a button can install in one click.
 * Everywhere else (iOS Safari, Firefox, Linux desktops without app support,
 * or a browser that already installed it) the UI explains the manual route
 * instead of showing a button that does nothing.
 */
export function useInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      // Keep the event so a click can call prompt() later (browsers require a
      // user gesture; storing the event is the documented pattern).
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => { setInstalled(true); setPromptEvent(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    const mq = window.matchMedia?.('(display-mode: standalone)');
    const onDisplayChange = () => setInstalled(isStandalone());
    mq?.addEventListener?.('change', onDisplayChange);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      mq?.removeEventListener?.('change', onDisplayChange);
    };
  }, []);

  const install = async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!promptEvent) return 'unavailable';
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      setPromptEvent(null);
      if (choice.outcome === 'accepted') setInstalled(true);
      return choice.outcome;
    } catch {
      return 'unavailable';
    }
  };

  return { canInstall: !!promptEvent, installed, install };
}

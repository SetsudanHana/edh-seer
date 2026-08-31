import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** Chrome's `beforeinstallprompt`, which has no TypeScript lib definition because it is not in any
 *  standard -- `prompt()` is the only member this component uses. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

/** THE PAGE'S OWN "INSTALL", because the browser stopped offering one.
 *
 *  Everything that makes this app installable already shipped and works -- manifest, icons at 192
 *  and 512 plus a maskable, a registered service worker with a fetch handler, all served over
 *  HTTPS and all asserted in `pwa.test.ts`. What was missing is that **nothing on screen ever said
 *  so.** Chrome on Android removed the automatic install banner, so installing lives in the browser
 *  menu, and a reader who does not go looking there cannot tell an installable app from one that
 *  refuses to install. Owner report, 2026-08-31: *"if I open the website on android phone it does
 *  not appear to be installable"* -- and it was, the whole time.
 *
 *  THE EVENT FIRING IS THE CONDITION, and that is the whole gate. A button rendered unconditionally
 *  would lie on iOS Safari (no `beforeinstallprompt` at all -- Add to Home Screen is a Share-sheet
 *  item there, which is why `index.html` carries the `apple-*` tags), in an already-installed
 *  window, and on any browser that has decided not to offer it. There is deliberately no
 *  `display-mode: standalone` check beside it: Chrome does not fire this once the app is installed,
 *  so the check would be a second condition testing the same fact.
 *
 *  IT PORTALS INTO THE STATIC HEADER. The nav is markup `index.html` ships and React never owns
 *  (the header moved out of React so a crawler gets the `h1` without running a 700 KB bundle), so
 *  reaching it means a portal rather than a prop. A missing nav renders nothing instead of
 *  throwing, because any page that mounts the app without the header is still a page. */
export function InstallButton() {
  const [event, setEvent] = useState<InstallPromptEvent | null>(null);
  const [host, setHost] = useState<Element | null>(null);

  useEffect(() => {
    setHost(document.querySelector(".site-nav"));
    const onPrompt = (e: Event) => {
      // Or the browser keeps its own affordance and the reader is offered the same install twice.
      e.preventDefault();
      setEvent(e as InstallPromptEvent);
    };
    // Fires when the app is installed by ANY route, the browser's own menu included, which never
    // touches the button below.
    const onInstalled = () => setEvent(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!event || !host) return null;
  return createPortal(
    <button
      type="button"
      className="site-nav-install"
      onClick={() => {
        // SPENT ON CLICK, whatever the reader then chooses in the browser's dialog. The event
        // cannot be prompted twice -- a second `prompt()` throws -- so holding it to see the
        // outcome would leave a button that fails when pressed. Chrome fires a fresh event if it
        // decides to offer again, and that is what brings this back.
        setEvent(null);
        void event.prompt();
      }}
    >
      Install
    </button>,
    host,
  );
}

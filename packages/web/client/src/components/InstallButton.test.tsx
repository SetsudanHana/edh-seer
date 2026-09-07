import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InstallButton } from "./InstallButton.js";

afterEach(() => {
  cleanup();
  document.querySelector(".site-header")?.remove();
});

/** The static header, which `index.html` ships and React never owns. The button portals into it --
 *  beside the nav, not inside it, so the nav does not move when the button appears -- so every test
 *  needs it present. */
const nav = () => {
  const el = document.createElement("header");
  el.className = "site-header";
  document.body.appendChild(el);
  return el;
};

/** `beforeinstallprompt` is Chrome's, not jsdom's, so the event is built by hand. `prompt` is the
 *  only member this component calls. */
const fireInstallPrompt = () => {
  const prompt = vi.fn(() => Promise.resolve());
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt });
  window.dispatchEvent(event);
  return { prompt, event };
};

test("nothing renders until the browser says the app can be installed", () => {
  nav();
  render(<InstallButton />);
  // NOT A STYLING CHOICE. An install button that is always visible lies on every browser that will
  // not install -- iOS Safari, an already-installed window, a desktop that has it pinned. The event
  // firing IS the condition, which is also why there is no `display-mode: standalone` check beside
  // it: Chrome does not fire this at all once the app is installed.
  expect(screen.queryByRole("button", { name: /install/i })).not.toBeInTheDocument();
});

test("the button appears in the site nav when the prompt is available, and prompts on click", async () => {
  const host = nav();
  render(<InstallButton />);
  const { prompt, event } = fireInstallPrompt();
  const button = await screen.findByRole("button", { name: /install/i });
  // IN THE HEADER, not wherever the component happens to be mounted. The nav is static markup
  // outside `#root`, so this asserts the portal actually landed there.
  expect(host.contains(button)).toBe(true);
  // The default is prevented, or Chrome keeps its own affordance and the page shows two.
  expect(event.defaultPrevented).toBe(true);

  await userEvent.click(button);
  expect(prompt).toHaveBeenCalledTimes(1);
  // ONE SHOT. The event cannot be prompted twice -- a second call throws -- so the button has to go
  // as soon as it is spent, whatever the user then chooses in the browser's own dialog.
  expect(screen.queryByRole("button", { name: /install/i })).not.toBeInTheDocument();
});

test("the button goes away once the app is installed", async () => {
  nav();
  render(<InstallButton />);
  fireInstallPrompt();
  await screen.findByRole("button", { name: /install/i });
  // Installing from the browser's OWN menu fires `appinstalled` without ever touching our button,
  // and a page left offering to install something already installed is the same lie as above.
  // `act` because the listener sets state from outside React, so the flush is not synchronous.
  act(() => { window.dispatchEvent(new Event("appinstalled")); });
  expect(screen.queryByRole("button", { name: /install/i })).not.toBeInTheDocument();
});

test("no nav means no button, rather than a crash", () => {
  // `how-it-works.html` and any future page that does not ship the header still mount the app.
  render(<InstallButton />);
  fireInstallPrompt();
  expect(screen.queryByRole("button", { name: /install/i })).not.toBeInTheDocument();
});

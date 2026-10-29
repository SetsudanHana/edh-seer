import { act, fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ScrollToTop } from "./ScrollToTop.js";

// The router's own navigate, for moves that are not a click (the browser's Back, a script).
let nav: ReturnType<typeof useNavigate>;
function Back() {
  const go = useNavigate();
  nav = go;
  return <button onClick={() => go(-1)}>back</button>;
}
const app = (start: string[]) => (
  <MemoryRouter initialEntries={start} initialIndex={start.length - 1}>
    <ScrollToTop />
    <Link to="/cards/b">to b</Link>
    <Link to="/cards/b#x">hash</Link>
    <Back />
    <Routes><Route path="*" element={null} /></Routes>
  </MemoryRouter>
);
let scroll: ReturnType<typeof vi.fn>;
// The tests redefine these on the shared window; put back whatever was there so no test inherits another's page.
const WATCHED = [[window, "scrollY"], [window, "innerHeight"], [document.documentElement, "scrollHeight"]] as const;
const originals = WATCHED.map(([o, k]) => Object.getOwnPropertyDescriptor(o, k));
beforeEach(() => { history.replaceState({ idx: 0 }, ""); sessionStorage.clear(); scroll = vi.fn(); window.scrollTo = scroll as unknown as typeof window.scrollTo; });
afterEach(() => {
  vi.restoreAllMocks();
  WATCHED.forEach(([o, k], i) => { const d = originals[i]; if (d) Object.defineProperty(o, k, d); else delete (o as unknown as Record<string, unknown>)[k]; });
});

test("a link to another page scrolls to the top", () => {
  render(app(["/cards/a"]));
  expect(scroll).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("to b"));
  expect(scroll).toHaveBeenCalledWith(0, 0);
});

const scrolled = (y: number) => { Object.defineProperty(window, "scrollY", { value: y, configurable: true }); fireEvent.scroll(window); };
const height = (h: number) => Object.defineProperty(document.documentElement, "scrollHeight", { value: h, configurable: true });

test("back restores the remembered offset once the page is tall enough", () => {
  vi.useFakeTimers();
  try {
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    height(5000);
    render(app(["/cards/a"]));
    scrolled(3000);
    fireEvent.click(screen.getByText("to b"));
    expect(scroll).toHaveBeenLastCalledWith(0, 0);
    scrolled(0);
    scroll.mockClear();
    height(900); // card page not rendered yet: the browser would clamp here
    fireEvent.click(screen.getByText("back"));
    vi.advanceTimersByTime(100);
    expect(scroll).not.toHaveBeenCalled();
    height(5000);
    vi.advanceTimersByTime(100);
    expect(scroll).toHaveBeenCalledWith(0, 3000);
  } finally { vi.useRealTimers(); }
});

test("the offset saved is the one at the click, not the clamp the route swap causes", () => {
  vi.useFakeTimers();
  try {
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    height(5935 + 800);
    render(app(["/cards/a"]));
    scrolled(5774);
    fireEvent.click(screen.getByText("to b"));
    height(1500); // the shorter page replaces it; the browser clamps and fires scroll
    scrolled(700);
    scrolled(0);
    scroll.mockClear();
    height(5935 + 800);
    fireEvent.click(screen.getByText("back"));
    vi.advanceTimersByTime(50);
    expect(scroll).toHaveBeenCalledWith(0, 5774);
  } finally { vi.useRealTimers(); }
});

test("the offset is re-applied while the page is still settling, until the reader scrolls", () => {
  vi.useFakeTimers();
  try {
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    height(5000);
    render(app(["/cards/a"]));
    scrolled(3000);
    fireEvent.click(screen.getByText("to b"));
    scrolled(0);
    fireEvent.click(screen.getByText("back"));
    vi.advanceTimersByTime(50);
    scroll.mockClear();
    scrolled(2800); // content above grew after the restore; scroll anchoring moved the page
    height(5200);
    vi.advanceTimersByTime(50);
    expect(scroll).toHaveBeenCalledWith(0, 3000);
    scroll.mockClear();
    fireEvent.wheel(window);
    scrolled(2000);
    vi.advanceTimersByTime(1000);
    expect(scroll).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

test("a saved 0 is restored: A at its top, B scrolled, back shows A at 0", () => {
  vi.useFakeTimers();
  try {
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    height(5000);
    render(app(["/cards/a"]));
    scrolled(0);
    fireEvent.click(screen.getByText("to b"));
    scrolled(3000);
    scroll.mockClear();
    fireEvent.click(screen.getByText("back"));
    vi.advanceTimersByTime(50);
    expect(scroll).toHaveBeenCalledWith(0, 0);
  } finally { vi.useRealTimers(); }
});

test("the report and a card page have no shared ReportShell: leaving and returning are ours", () => {
  vi.useFakeTimers();
  try {
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    height(5000);
    render(<MemoryRouter initialEntries={["/"]}>
      <ScrollToTop /><Link to="/cards/b">to card</Link><Back /><Routes><Route path="*" element={null} /></Routes>
    </MemoryRouter>);
    scrolled(3000);
    fireEvent.click(screen.getByText("to card"));
    expect(scroll).toHaveBeenCalledWith(0, 0);
    scrolled(0);
    scroll.mockClear();
    fireEvent.click(screen.getByText("back"));
    vi.advanceTimersByTime(50);
    expect(scroll).toHaveBeenCalledWith(0, 3000);
  } finally { vi.useRealTimers(); }
});

test("two pages that both have ReportShell are left to its own memory", () => {
  render(<MemoryRouter initialEntries={["/"]}>
    <ScrollToTop /><Link to="/analysis/combos">go</Link><Routes><Route path="*" element={null} /></Routes>
  </MemoryRouter>);
  fireEvent.click(screen.getByText("go"));
  expect(scroll).not.toHaveBeenCalled();
});

test("offsets survive a reload: a fresh mount on the same entry restores from sessionStorage", () => {
  vi.useFakeTimers();
  try {
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    height(5000);
    const first = render(app(["/cards/a"]));
    scrolled(3000);
    fireEvent.click(screen.getByText("to b"));
    first.unmount();
    scrolled(0);
    scroll.mockClear();
    render(app(["/cards/a"]));
    vi.advanceTimersByTime(50);
    expect(scroll).toHaveBeenCalledWith(0, 3000);
  } finally { vi.useRealTimers(); }
});

test("a stored offset belongs to its page: another page on the same key is not restored", () => {
  sessionStorage.setItem("edh-seer:scroll-offsets", JSON.stringify([["default", { path: "/cards/other", y: 900 }]]));
  render(app(["/cards/a"]));
  expect(scroll).not.toHaveBeenCalled();
});

test("a restore that never becomes possible gives up", () => {
  vi.useFakeTimers();
  try {
    height(900);
    render(app(["/cards/a"]));
    scrolled(3000);
    fireEvent.click(screen.getByText("to b"));
    scrolled(0);
    scroll.mockClear();
    fireEvent.click(screen.getByText("back"));
    vi.advanceTimersByTime(2500);
    expect(scroll).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});

test("back to an entry with nothing remembered does nothing", () => {
  render(app(["/cards/a", "/cards/b"]));
  fireEvent.click(screen.getByText("back"));
  expect(scroll).not.toHaveBeenCalled();
});

test("a hash-only change does not scroll", () => {
  render(app(["/cards/b"]));
  fireEvent.click(screen.getByText("hash"));
  expect(scroll).not.toHaveBeenCalled();
});

test("an anonymous entry (state null, key default) is never restored from a record of another", () => {
  vi.useFakeTimers();
  try {
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    height(5000);
    render(app(["/cards/a"]));
    scrolled(3000);
    fireEvent.click(screen.getByText("to b"));
    scrolled(0);
    scroll.mockClear();
    history.replaceState(null, ""); // the entry went back to is a native fragment / pushState(null) one
    act(() => { void nav(-1); });
    vi.advanceTimersByTime(50);
    expect(scroll).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

test("going back onto a #fragment entry of the same page leaves the jump to the anchor", () => {
  sessionStorage.setItem("edh-seer:scroll-offsets", JSON.stringify([["default:0", { path: "/cards/a", y: 700 }]]));
  render(app(["/cards/a#up", "/cards/a"]));
  scroll.mockClear();
  fireEvent.click(screen.getByText("back"));
  expect(scroll).not.toHaveBeenCalled();
});

test("a click's offset is taken at the click, before the anchor's own jump", () => {
  vi.useFakeTimers();
  try {
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    height(5000);
    render(<MemoryRouter initialEntries={["/cards/a"]}><ScrollToTop /><a href="#x" data-testid="frag" onClick={(e) => e.preventDefault()}>f</a><Back /><Routes><Route path="*" element={null} /></Routes></MemoryRouter>);
    scrolled(2000);
    fireEvent.click(screen.getByTestId("frag")); // capture-phase listener notes 2000
    scrolled(2600); // the browser jumped to the anchor before the router rendered
    act(() => { void nav("/cards/b"); });
    scrolled(0);
    scroll.mockClear();
    act(() => { void nav(-1); });
    vi.advanceTimersByTime(50);
    expect(scroll).toHaveBeenCalledWith(0, 2000);
  } finally { vi.useRealTimers(); }
});

test("a click on the page left is not used for the page arrived on", () => {
  vi.useFakeTimers();
  try {
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    height(5000);
    render(app(["/cards/a"]));
    scrolled(500);
    fireEvent.click(screen.getByText("to b")); // B opens at the top
    scrolled(0);
    act(() => { void nav(-1); }); // browser Back, no click, within a second
    scrolled(500);
    scroll.mockClear();
    act(() => { void nav(1); });
    vi.advanceTimersByTime(50);
    expect(scroll).not.toHaveBeenCalledWith(0, 500);
  } finally { vi.useRealTimers(); }
});

test("leaving the document saves the entry's offset, and a fresh mount restores it", () => {
  vi.useFakeTimers();
  try {
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    height(5000);
    const first = render(app(["/cards/a"]));
    scrolled(1234);
    window.dispatchEvent(new Event("pagehide"));
    expect(JSON.parse(sessionStorage.getItem("edh-seer:scroll-offsets")!)).toEqual([["default:0", { path: "/cards/a", y: 1234 }]]);
    first.unmount();
    scrolled(0);
    scroll.mockClear();
    render(app(["/cards/a"]));
    vi.advanceTimersByTime(50);
    expect(scroll).toHaveBeenCalledWith(0, 1234);
  } finally { vi.useRealTimers(); }
});

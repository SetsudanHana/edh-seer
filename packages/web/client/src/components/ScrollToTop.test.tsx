import { fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ScrollToTop } from "./ScrollToTop.js";

function Back() {
  const go = useNavigate();
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
beforeEach(() => { scroll = vi.fn(); window.scrollTo = scroll as unknown as typeof window.scrollTo; });
afterEach(() => vi.restoreAllMocks());

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

test("the report keeps its own memory: no reset into or out of /", () => {
  render(app(["/"]));
  fireEvent.click(screen.getByText("to b"));
  expect(scroll).not.toHaveBeenCalled();
});

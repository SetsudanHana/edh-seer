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

test("back leaves the position to the browser", () => {
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

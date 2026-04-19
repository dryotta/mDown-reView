import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SearchBar } from "../SearchBar";

describe("SearchBar", () => {
  it("renders input and match count", () => {
    render(<SearchBar query="foo" matchCount={5} currentIndex={2} onQueryChange={vi.fn()} onNext={vi.fn()} onPrev={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByPlaceholderText("Find...")).toHaveValue("foo");
    expect(screen.getByText("3 of 5")).toBeInTheDocument();
  });

  it("shows 'No results' when matchCount is 0 and query is non-empty", () => {
    render(<SearchBar query="xyz" matchCount={0} currentIndex={-1} onQueryChange={vi.fn()} onNext={vi.fn()} onPrev={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("No results")).toBeInTheDocument();
  });

  it("calls onQueryChange on input", () => {
    const onChange = vi.fn();
    render(<SearchBar query="" matchCount={0} currentIndex={-1} onQueryChange={onChange} onNext={vi.fn()} onPrev={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("Find..."), { target: { value: "hello" } });
    expect(onChange).toHaveBeenCalledWith("hello");
  });

  it("calls onNext on Enter, onPrev on Shift+Enter", () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    render(<SearchBar query="a" matchCount={3} currentIndex={0} onQueryChange={vi.fn()} onNext={onNext} onPrev={onPrev} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText("Find...");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onNext).toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onPrev).toHaveBeenCalled();
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(<SearchBar query="" matchCount={0} currentIndex={-1} onQueryChange={vi.fn()} onNext={vi.fn()} onPrev={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(screen.getByPlaceholderText("Find..."), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

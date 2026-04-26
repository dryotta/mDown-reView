import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { SettingsDialog } from "../SettingsDialog";

const setAuthorMock = vi.fn();
let currentAuthor = "Existing User";

vi.mock("@/lib/vm/useAuthor", () => ({
  useAuthor: () => ({ author: currentAuthor, setAuthor: setAuthorMock }),
}));

vi.mock("@/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
}));

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  currentAuthor = "Existing User";
  setAuthorMock.mockReset();
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("SettingsDialog", () => {
  it("prefills the input with the current author", () => {
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);
    const input = screen.getByLabelText("Display name") as HTMLInputElement;
    expect(input.value).toBe("Existing User");
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("calls setAuthor and closes on successful save", async () => {
    setAuthorMock.mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);
    const input = screen.getByLabelText("Display name");
    fireEvent.change(input, { target: { value: "Reviewer-2" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(setAuthorMock).toHaveBeenCalledWith("Reviewer-2");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("shows a validation error for empty name without closing", async () => {
    setAuthorMock.mockRejectedValueOnce({ kind: "InvalidAuthor", reason: "empty" });
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);
    const input = screen.getByLabelText("Display name");
    fireEvent.change(input, { target: { value: "   " } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    await waitFor(() => expect(screen.getByText("Name required")).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("shows a length error for too_long", async () => {
    setAuthorMock.mockRejectedValueOnce({ kind: "InvalidAuthor", reason: "too_long" });
    render(<SettingsDialog onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "x".repeat(200) } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    await waitFor(() =>
      expect(screen.getByText(/too long/i)).toBeInTheDocument(),
    );
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("Cancel button closes without calling setAuthor", () => {
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(setAuthorMock).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("hydrates draft when author resolves after dialog mount", async () => {
    // Reproduce the race: dialog opens BEFORE useAuthor's get_author IPC
    // resolves, so `author` is "" on mount. After the store updates with
    // the resolved value, the input must reflect it (otherwise the user
    // submits empty against text they never erased).
    currentAuthor = "";
    const { rerender } = render(<SettingsDialog onClose={vi.fn()} />);
    const input = screen.getByLabelText("Display name") as HTMLInputElement;
    expect(input.value).toBe("");

    // Simulate the IPC resolving and the store hydrating.
    currentAuthor = "alice";
    rerender(<SettingsDialog onClose={vi.fn()} />);

    await waitFor(() => {
      const refreshed = screen.getByLabelText("Display name") as HTMLInputElement;
      expect(refreshed.value).toBe("alice");
    });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});

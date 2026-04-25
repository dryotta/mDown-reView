import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { SectionShell } from "../SectionShell";

describe("SectionShell", () => {
  it("renders title, description, and status pill", () => {
    render(
      <SectionShell
        title="Test title"
        description="Test description"
        status="done"
      />,
    );
    expect(screen.getByText("Test title")).toBeInTheDocument();
    expect(screen.getByText("Test description")).toBeInTheDocument();
    expect(screen.getByTestId("section-status")).toHaveTextContent("Done");
  });

  it("primary button click fires onPrimary", async () => {
    const onPrimary = vi.fn();
    render(
      <SectionShell
        title="t"
        description="d"
        status="pending"
        primaryLabel="Install"
        onPrimary={onPrimary}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Install" }));
    });
    expect(onPrimary).toHaveBeenCalled();
  });

  it("disables buttons while a click handler's promise is pending", async () => {
    let resolve!: () => void;
    const onPrimary = vi.fn(
      () => new Promise<void>((r) => { resolve = r; }),
    );
    render(
      <SectionShell
        title="t"
        description="d"
        status="pending"
        primaryLabel="Install"
        onPrimary={onPrimary}
      />,
    );
    const btn = screen.getByRole("button", { name: "Install" });
    await act(async () => {
      fireEvent.click(btn);
    });
    // Now in-flight: button shows working text and is disabled.
    expect(screen.getByRole("button", { name: /working/i })).toBeDisabled();
    await act(async () => {
      resolve();
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Install" })).not.toBeDisabled(),
    );
  });

  it("renders error block when error prop is set", () => {
    render(
      <SectionShell
        title="t"
        description="d"
        status="error"
        error="Permission denied"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Permission denied");
  });

  it("renders helpText", () => {
    render(
      <SectionShell
        title="t"
        description="d"
        status="pending"
        helpText={<span>Help me</span>}
      />,
    );
    expect(screen.getByText("Help me")).toBeInTheDocument();
  });

  it("collapsedByDefault renders <details> that is initially closed", () => {
    const { container } = render(
      <SectionShell
        title="Collapsed title"
        description="hidden body"
        status="done"
        collapsedByDefault
      />,
    );
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details!.open).toBe(false);
  });

  it("hides status pill when hideStatus is true", () => {
    render(
      <SectionShell
        title="t"
        description="d"
        status="done"
        hideStatus
      />,
    );
    expect(screen.queryByTestId("section-status")).toBeNull();
  });
});

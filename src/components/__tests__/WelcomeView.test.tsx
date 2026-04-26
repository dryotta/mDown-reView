import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useStore } from "@/store";
import { WelcomeView } from "@/components/WelcomeView";

vi.mock("@/hooks/useRecentItemStatus", () => ({
  useRecentItemStatus: () => ({}),
}));

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
});

describe("WelcomeView – settings link (B11)", () => {
  it("renders a Settings link that calls openSettings on click", () => {
    const openSettings = vi.fn();
    useStore.setState({ openSettings } as Partial<ReturnType<typeof useStore.getState>>);

    render(<WelcomeView onOpenFile={() => {}} onOpenFolder={() => {}} />);

    const link = screen.getByRole("button", { name: /settings/i });
    fireEvent.click(link);

    expect(openSettings).toHaveBeenCalledOnce();
  });
});

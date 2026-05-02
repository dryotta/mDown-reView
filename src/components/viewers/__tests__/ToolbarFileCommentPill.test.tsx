import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock the useComments subscription so each test controls the threads
// the pill sees. The pill's contract is: derive counts from `threads`
// and render the AC2 verbatim "{N} file {M} orphan" pill.
const useCommentsMock = vi.fn();
vi.mock("@/lib/vm/use-comments", () => ({
  useComments: (filePath: string | null) => useCommentsMock(filePath),
}));

import { ToolbarFileCommentPill } from "../ToolbarFileCommentPill";

type RootShape = {
  resolved?: boolean;
  anchor_kind?: string | null;
  isOrphaned?: boolean;
};

function thread(root: RootShape) {
  return { root, replies: [] };
}

function setThreads(threads: ReturnType<typeof thread>[]) {
  useCommentsMock.mockReturnValue({ threads, comments: [], loading: false, reload: () => {} });
}

describe("ToolbarFileCommentPill", () => {
  it("renders null when there are no threads (both counts 0)", () => {
    setThreads([]);
    const { container } = render(
      <ToolbarFileCommentPill filePath="/r.md" onCommentOnFile={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("fileCount=3, orphanCount=0 → renders only the file segment", () => {
    setThreads([
      thread({ anchor_kind: "file" }),
      thread({ anchor_kind: "file" }),
      thread({ anchor_kind: "file" }),
    ]);
    render(<ToolbarFileCommentPill filePath="/r.md" onCommentOnFile={vi.fn()} />);
    const btn = screen.getByRole("button");
    expect(btn.textContent).toContain("3 file");
    expect(btn.textContent).not.toContain("orphan");
  });

  it("fileCount=0, orphanCount=2 → renders only the orphan segment", () => {
    setThreads([
      thread({ anchor_kind: "line", isOrphaned: true }),
      thread({ anchor_kind: "line", isOrphaned: true }),
    ]);
    render(<ToolbarFileCommentPill filePath="/r.md" onCommentOnFile={vi.fn()} />);
    const btn = screen.getByRole("button");
    expect(btn.textContent).toContain("2 orphan");
    expect(btn.textContent).not.toMatch(/\bfile\b/);
  });

  it("fileCount=1, orphanCount=1 → renders AC2 verbatim '1 file 1 orphan'", () => {
    // AC2 verbatim — exact case-sensitive single-space format.
    setThreads([
      thread({ anchor_kind: "file" }),
      thread({ anchor_kind: "line", isOrphaned: true }),
    ]);
    render(<ToolbarFileCommentPill filePath="/r.md" onCommentOnFile={vi.fn()} />);
    expect(screen.getByText("1 file 1 orphan")).toBeInTheDocument();
  });

  it("excludes resolved threads from both counts", () => {
    setThreads([
      thread({ anchor_kind: "file", resolved: true }),
      thread({ anchor_kind: "line", isOrphaned: true, resolved: true }),
    ]);
    const { container } = render(
      <ToolbarFileCommentPill filePath="/r.md" onCommentOnFile={vi.fn()} />,
    );
    // both threads are resolved → both excluded → both counts 0 → null render.
    expect(container.firstChild).toBeNull();
  });

  it("invokes onCommentOnFile when clicked", async () => {
    setThreads([thread({ anchor_kind: "file" })]);
    const onClick = vi.fn();
    render(<ToolbarFileCommentPill filePath="/r.md" onCommentOnFile={onClick} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

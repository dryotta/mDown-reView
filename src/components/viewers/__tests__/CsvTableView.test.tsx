import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ── Mocks ──────────────────────────────────────────────────────────────────
const { addCommentMock, setFocusedThreadMock } = vi.hoisted(() => ({
  addCommentMock: vi.fn<(filePath: string, text: string, anchor?: unknown) => Promise<void>>(
    async () => {},
  ),
  setFocusedThreadMock: vi.fn(),
}));

vi.mock("@/lib/vm/use-comments", () => ({
  useComments: () => ({
    threads: [],
    comments: [],
    loading: false,
    reload: () => {},
  }),
}));

vi.mock("@/lib/vm/use-comment-actions", () => ({
  useCommentActions: () => ({ addComment: addCommentMock }),
}));

vi.mock("@/store", () => {
  const state = {
    setFocusedThread: setFocusedThreadMock,
    zoomByFiletype: {} as Record<string, number>,
    bumpZoom: () => {},
    setZoom: () => {},
  };
  const useStore = (selector: (s: typeof state) => unknown) => selector(state);
  (useStore as unknown as { getState: () => typeof state }).getState = () => state;
  return { useStore };
});

import { CsvTableView } from "../CsvTableView";

beforeEach(() => {
  addCommentMock.mockClear();
  setFocusedThreadMock.mockClear();
});

describe("CsvTableView — rendering (existing behaviour)", () => {
  it("renders table with headers from first row", () => {
    render(<CsvTableView content={"Name,Age\nAlice,30\nBob,25"} path="/data.csv" />);
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Age")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("shows row and column count", () => {
    render(<CsvTableView content={"A,B\n1,2\n3,4"} path="/data.csv" />);
    expect(screen.getByText(/2 rows/)).toBeInTheDocument();
    expect(screen.getByText(/2 columns/)).toBeInTheDocument();
  });

  it("sorts columns on header click", () => {
    render(<CsvTableView content={"Name,Age\nBob,25\nAlice,30"} path="/data.csv" />);
    fireEvent.click(screen.getByText("Name"));
    const cells = screen.getAllByRole("cell");
    expect(cells[0].textContent).toBe("Alice");
  });

  it("handles TSV files", () => {
    render(<CsvTableView content={"Name\tAge\nAlice\t30"} path="/data.tsv" />);
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });
});

describe("CsvTableView — Group C iter 7 (commentable cells)", () => {
  it("each <td> carries data-row-idx, data-col-idx, data-col-header (header is row 0)", () => {
    const { container } = render(
      <CsvTableView content={"id,name\n1,Alice\n2,Bob"} path="/data.csv" />,
    );
    const tds = Array.from(container.querySelectorAll("td"));
    expect(tds.length).toBe(4);
    expect(tds[0].getAttribute("data-row-idx")).toBe("1");
    expect(tds[0].getAttribute("data-col-idx")).toBe("0");
    expect(tds[0].getAttribute("data-col-header")).toBe("id");
    expect(tds[3].getAttribute("data-row-idx")).toBe("2");
    expect(tds[3].getAttribute("data-col-idx")).toBe("1");
    expect(tds[3].getAttribute("data-col-header")).toBe("name");
  });

  it("Alt+click on a cell calls addComment with a csv_cell anchor including primary_key", async () => {
    const { container } = render(
      <CsvTableView content={"id,name,age\n1,Alice,30\n2,Bob,25"} path="/data.csv" />,
    );
    // Click on the "Bob" cell (row_idx=2, col_idx=1 in wire terms).
    const bobCell = Array.from(container.querySelectorAll("td")).find(
      (td) => td.textContent === "Bob",
    )!;
    fireEvent.click(bobCell, { altKey: true });

    // Composer opens; type and save.
    const textarea = await screen.findByRole("textbox");
    fireEvent.change(textarea, { target: { value: "looks off" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(addCommentMock).toHaveBeenCalledTimes(1));
    const [filePath, text, anchor] = addCommentMock.mock.calls[0];
    expect(filePath).toBe("/data.csv");
    expect(text).toBe("looks off");
    expect(anchor).toEqual({
      kind: "csv_cell",
      row_idx: 2,
      col_idx: 1,
      col_header: "name",
      primary_key_col: "id",
      primary_key_value: "2",
    });
  });

  it("plain (non-Alt) click does NOT open the composer or call addComment", async () => {
    const { container } = render(
      <CsvTableView content={"id,name\n1,Alice"} path="/data.csv" />,
    );
    const cell = container.querySelector("td")!;
    fireEvent.click(cell, { altKey: false });
    expect(addCommentMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("primary key heuristic: leftmost-unique column wins over the duplicate-bearing one", async () => {
    // Column 0 ("group") has duplicate "A"s; column 1 ("id") is unique → pk = id.
    const { container } = render(
      <CsvTableView content={"group,id,name\nA,1,Alice\nA,2,Bob\nB,3,Carol"} path="/data.csv" />,
    );
    const aliceNameCell = Array.from(container.querySelectorAll("td")).find(
      (td) => td.textContent === "Alice",
    )!;
    fireEvent.click(aliceNameCell, { altKey: true });
    const textarea = await screen.findByRole("textbox");
    fireEvent.change(textarea, { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(addCommentMock).toHaveBeenCalledTimes(1));
    const [, , anchor] = addCommentMock.mock.calls[0];
    expect(anchor).toMatchObject({
      kind: "csv_cell",
      primary_key_col: "id",
      primary_key_value: "1",
    });
  });

  it("primary key heuristic: when no column is unique, the anchor omits primary_key fields", async () => {
    // Both columns have at least one duplicate → no pk.
    const { container } = render(
      <CsvTableView content={"a,b\n1,x\n1,y\n2,x"} path="/data.csv" />,
    );
    const cell = Array.from(container.querySelectorAll("td")).find(
      (td) => td.textContent === "y",
    )!;
    fireEvent.click(cell, { altKey: true });
    const textarea = await screen.findByRole("textbox");
    fireEvent.change(textarea, { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(addCommentMock).toHaveBeenCalledTimes(1));
    const [, , anchor] = addCommentMock.mock.calls[0];
    expect(anchor).not.toHaveProperty("primary_key_col");
    expect(anchor).not.toHaveProperty("primary_key_value");
  });

  it("primary key heuristic: empty table yields no pk (no crash)", () => {
    expect(() => render(<CsvTableView content={"a,b"} path="/data.csv" />)).not.toThrow();
  });

  it("when the clicked cell IS the primary-key column itself, primary_key_* fields are omitted", async () => {
    const { container } = render(
      <CsvTableView content={"id,name\n1,Alice\n2,Bob"} path="/data.csv" />,
    );
    const idCell = Array.from(container.querySelectorAll("td")).find(
      (td) => td.textContent === "2",
    )!;
    fireEvent.click(idCell, { altKey: true });
    const textarea = await screen.findByRole("textbox");
    fireEvent.change(textarea, { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(addCommentMock).toHaveBeenCalledTimes(1));
    const [, , anchor] = addCommentMock.mock.calls[0];
    expect(anchor).toMatchObject({ kind: "csv_cell", row_idx: 2, col_idx: 0, col_header: "id" });
    expect(anchor).not.toHaveProperty("primary_key_col");
    expect(anchor).not.toHaveProperty("primary_key_value");
  });
});

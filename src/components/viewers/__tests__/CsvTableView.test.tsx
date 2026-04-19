import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CsvTableView } from "../CsvTableView";

describe("CsvTableView", () => {
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

import { useState, useMemo } from "react";
import Papa from "papaparse";
import { extname } from "@/lib/path-utils";
import { useZoom } from "@/hooks/useZoom";
import { useComments } from "@/lib/vm/use-comments";
import { useCommentActions } from "@/lib/vm/use-comment-actions";
import { useStore } from "@/store";
import { deriveAnchor, type Anchor } from "@/types/comments";
import { CommentBadge } from "@/components/comments/CommentBadge";
import { CommentInput } from "@/components/comments/CommentInput";
import "@/styles/csv-table.css";

interface CsvTableViewProps {
  content: string;
  path: string;
}

type SortDirection = "asc" | "desc" | null;

interface DataRow {
  cells: string[];
  /** Index into the original parsed data rows (0-based, header excluded). */
  originalIdx: number;
}

interface ComposerCell {
  rowIdx: number; // wire row_idx (data row + 1, header is row 0)
  colIdx: number;
  header: string;
  pkCol?: string;
  pkVal?: string;
}

/**
 * Compute the "primary key" column: the leftmost column whose values are
 * unique across all data rows. Returns `null` if no such column exists or
 * the table is empty.
 */
function pickPrimaryKeyCol(headers: string[], dataRows: DataRow[]): number | null {
  if (dataRows.length === 0) return null;
  for (let c = 0; c < headers.length; c++) {
    const seen = new Set<string>();
    let unique = true;
    for (const dr of dataRows) {
      const v = dr.cells[c] ?? "";
      if (seen.has(v)) {
        unique = false;
        break;
      }
      seen.add(v);
    }
    if (unique) return c;
  }
  return null;
}

export function CsvTableView({ content, path }: CsvTableViewProps) {
  const [sortColumn, setSortColumn] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [composerCell, setComposerCell] = useState<ComposerCell | null>(null);
  const { zoom } = useZoom(".csv");
  const { threads } = useComments(path);
  const { addComment } = useCommentActions();
  const setFocusedThread = useStore((s) => s.setFocusedThread);

  const { headers, rows, primaryKeyCol } = useMemo(() => {
    if (!content.trim()) {
      return { headers: [] as string[], rows: [] as DataRow[], primaryKeyCol: null as number | null };
    }

    const delimiter = extname(path).toLowerCase() === ".tsv" ? "\t" : ",";
    const parsed = Papa.parse(content, { delimiter });

    if (!parsed.data || parsed.data.length === 0) {
      return { headers: [], rows: [], primaryKeyCol: null };
    }

    const allRows = parsed.data as string[][];
    const headers = allRows[0] || [];
    const rows: DataRow[] = allRows
      .slice(1)
      .map((cells, i) => ({ cells, originalIdx: i }))
      .filter(({ cells }) => cells.some((c) => c.trim()));

    return { headers, rows, primaryKeyCol: pickPrimaryKeyCol(headers, rows) };
  }, [content, path]);

  const sortedRows = useMemo(() => {
    if (sortColumn === null || sortDirection === null) {
      return rows;
    }

    const sorted = [...rows];
    sorted.sort((a, b) => {
      const aVal = a.cells[sortColumn] || "";
      const bVal = b.cells[sortColumn] || "";

      // Check if both values are numeric
      const aNum = parseFloat(aVal);
      const bNum = parseFloat(bVal);
      const bothNumeric = !isNaN(aNum) && !isNaN(bNum);

      let comparison = 0;
      if (bothNumeric) {
        comparison = aNum - bNum;
      } else {
        comparison = aVal.localeCompare(bVal);
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

    return sorted;
  }, [rows, sortColumn, sortDirection]);

  // Map of `${row_idx}:${col_idx}` (Rust convention — header is row 0) to
  // unresolved threads anchored at that cell.
  const cellThreads = useMemo(() => {
    const m = new Map<string, typeof threads>();
    for (const t of threads) {
      if (t.root.resolved) continue;
      const a = deriveAnchor(t.root);
      if (a.kind !== "csv_cell") continue;
      const key = `${a.row_idx}:${a.col_idx}`;
      const arr = m.get(key) ?? [];
      arr.push(t);
      m.set(key, arr);
    }
    return m;
  }, [threads]);

  const handleHeaderClick = (columnIndex: number) => {
    if (sortColumn === columnIndex) {
      // Cycle through: asc -> desc -> null
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else if (sortDirection === "desc") {
        setSortColumn(null);
        setSortDirection(null);
      }
    } else {
      setSortColumn(columnIndex);
      setSortDirection("asc");
    }
  };

  const handleCellClick = (
    e: React.MouseEvent<HTMLTableCellElement>,
    row: DataRow,
    cellIndex: number,
  ) => {
    if (!e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    const header = headers[cellIndex] ?? "";
    const wireRowIdx = row.originalIdx + 1; // header is row 0 in the matcher
    let pkCol: string | undefined;
    let pkVal: string | undefined;
    if (primaryKeyCol !== null && primaryKeyCol !== cellIndex) {
      pkCol = headers[primaryKeyCol];
      pkVal = row.cells[primaryKeyCol];
    }
    setComposerCell({ rowIdx: wireRowIdx, colIdx: cellIndex, header, pkCol, pkVal });
  };

  const handleComposerSave = (text: string) => {
    if (!composerCell) return;
    const { rowIdx, colIdx, header, pkCol, pkVal } = composerCell;
    const anchor: Anchor = {
      kind: "csv_cell",
      row_idx: rowIdx,
      col_idx: colIdx,
      col_header: header,
      ...(pkCol !== undefined ? { primary_key_col: pkCol } : {}),
      ...(pkVal !== undefined ? { primary_key_value: pkVal } : {}),
    };
    addComment(path, text, anchor).catch(() => {});
    setComposerCell(null);
  };

  const handleBadgeClick = (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation();
    setFocusedThread(threadId);
  };

  if (headers.length === 0) {
    return (
      <div className="csv-table-container">
        <div className="csv-table-footer">No data</div>
      </div>
    );
  }

  return (
    <div className="csv-table-container" data-zoom={zoom} style={{ fontSize: `${zoom * 100}%` }}>
      <table className="csv-table">
        <thead>
          <tr>
            {headers.map((header, index) => (
              <th key={index} onClick={() => handleHeaderClick(index)}>
                {header}
                {sortColumn === index && (
                  <span className="csv-sort-indicator">
                    {sortDirection === "asc" ? "▲" : "▼"}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => {
            const wireRowIdx = row.originalIdx + 1;
            return (
              <tr key={row.originalIdx}>
                {row.cells.map((cell, cellIndex) => {
                  const key = `${wireRowIdx}:${cellIndex}`;
                  const cellThreadList = cellThreads.get(key) ?? [];
                  const count = cellThreadList.length;
                  const firstThreadId = count > 0 ? cellThreadList[0].root.id : null;
                  const isComposing =
                    composerCell?.rowIdx === wireRowIdx && composerCell?.colIdx === cellIndex;
                  return (
                    <td
                      key={cellIndex}
                      data-row-idx={wireRowIdx}
                      data-col-idx={cellIndex}
                      data-col-header={headers[cellIndex] ?? ""}
                      onClick={(e) => handleCellClick(e, row, cellIndex)}
                    >
                      {cell}
                      {count > 0 && firstThreadId && (
                        <button
                          type="button"
                          className="csv-cell-badge-btn"
                          aria-label={`Open ${count} comment${count === 1 ? "" : "s"} on this cell`}
                          onClick={(e) => handleBadgeClick(e, firstThreadId)}
                        >
                          <CommentBadge count={count} className="tree-comment-badge" />
                        </button>
                      )}
                      {isComposing && (
                        <div className="csv-cell-composer" onClick={(e) => e.stopPropagation()}>
                          <CommentInput
                            onSave={handleComposerSave}
                            onClose={() => setComposerCell(null)}
                            placeholder="Comment on this cell…"
                          />
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="csv-table-footer">
        {sortedRows.length} rows · {headers.length} columns
      </div>
    </div>
  );
}

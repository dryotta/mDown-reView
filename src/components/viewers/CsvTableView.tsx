import { useState, useMemo } from "react";
import Papa from "papaparse";
import { extname } from "@/lib/path-utils";
import { useZoom } from "@/hooks/useZoom";
import { FileCommentBadge } from "@/components/comments/FileCommentBadge";
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

export function CsvTableView({ content, path }: CsvTableViewProps) {
  const [sortColumn, setSortColumn] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const { zoom } = useZoom(".csv");

  const { headers, rows } = useMemo(() => {
    if (!content.trim()) {
      return { headers: [] as string[], rows: [] as DataRow[] };
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

    return { headers, rows };
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

  if (headers.length === 0) {
    return (
      <div className="csv-table-container">
        <div className="csv-table-footer">No data</div>
      </div>
    );
  }

  return (
    <div className="csv-table-container" data-zoom={zoom} style={{ fontSize: `${zoom * 100}%` }}>
      <FileCommentBadge filePath={path} />
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
          {sortedRows.map((row) => (
            <tr key={row.originalIdx}>
              {row.cells.map((cell, cellIndex) => (
                <td key={cellIndex}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="csv-table-footer">
        {sortedRows.length} rows · {headers.length} columns
      </div>
    </div>
  );
}

import { useState, useMemo } from "react";
import Papa from "papaparse";
import { extname } from "@/lib/path-utils";
import { useZoom } from "@/hooks/useZoom";
import "@/styles/csv-table.css";

interface CsvTableViewProps {
  content: string;
  path: string;
}

type SortDirection = "asc" | "desc" | null;

export function CsvTableView({ content, path }: CsvTableViewProps) {
  const [sortColumn, setSortColumn] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const { zoom } = useZoom(".csv");

  const { headers, rows } = useMemo(() => {
    if (!content.trim()) {
      return { headers: [], rows: [] };
    }

    const delimiter = extname(path).toLowerCase() === ".tsv" ? "\t" : ",";
    const parsed = Papa.parse(content, { delimiter });

    if (!parsed.data || parsed.data.length === 0) {
      return { headers: [], rows: [] };
    }

    const allRows = parsed.data as string[][];
    const headers = allRows[0] || [];
    const rows = allRows.slice(1).filter((row) => row.some((cell) => cell.trim()));

    return { headers, rows };
  }, [content, path]);

  const sortedRows = useMemo(() => {
    if (sortColumn === null || sortDirection === null) {
      return rows;
    }

    const sorted = [...rows];
    sorted.sort((a, b) => {
      const aVal = a[sortColumn] || "";
      const bVal = b[sortColumn] || "";

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
          {sortedRows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
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

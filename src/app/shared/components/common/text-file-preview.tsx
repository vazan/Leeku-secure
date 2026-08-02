import Papa from "papaparse";

export interface TextFilePreviewData {
  kind: "text" | "csv";
  content: string;
}

const CSV_PREVIEW_ROW_LIMIT = 1000;
const CSV_COLUMN_COLORS = [
  { color: "#22d3ee", backgroundColor: "rgba(34, 211, 238, 0.08)" },
  { color: "#f472b6", backgroundColor: "rgba(244, 114, 182, 0.08)" },
  { color: "#a3e635", backgroundColor: "rgba(163, 230, 53, 0.08)" },
  { color: "#fbbf24", backgroundColor: "rgba(251, 191, 36, 0.08)" },
  { color: "#c084fc", backgroundColor: "rgba(192, 132, 252, 0.08)" },
  { color: "#fb7185", backgroundColor: "rgba(251, 113, 133, 0.08)" },
];

export default function TextFilePreview({ preview }: { preview: TextFilePreviewData }) {
  if (preview.kind === "text") {
    return (
      <pre className="max-h-[34rem] overflow-auto whitespace-pre-wrap break-words border-y border-[var(--border-subtle)] bg-[var(--bg-muted)] px-4 py-4 font-mono text-xs leading-6 text-[var(--text-muted)]">
        {preview.content}
      </pre>
    );
  }

  const result = Papa.parse<string[]>(preview.content, { skipEmptyLines: false });
  const rows = result.data.slice(0, CSV_PREVIEW_ROW_LIMIT);
  const columnCount = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  const truncated = result.data.length > rows.length;

  return (
    <div>
      <div className="max-h-[34rem] overflow-auto border-y border-[var(--border-subtle)]">
        <table className="min-w-full border-separate border-spacing-0 font-mono text-xs">
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th className="sticky left-0 z-20 w-12 border-b border-r border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-2 text-right font-normal text-[var(--text-faint)]">
                  {rowIndex + 1}
                </th>
                {Array.from({ length: columnCount }, (_, columnIndex) => {
                  const columnStyle = CSV_COLUMN_COLORS[columnIndex % CSV_COLUMN_COLORS.length];
                  return (
                    <td
                      key={columnIndex}
                      style={columnStyle}
                      className="max-w-80 whitespace-pre-wrap break-words border-b border-r border-[var(--border-subtle)] px-3 py-2 align-top"
                    >
                      {row[columnIndex] ?? ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated && (
        <p className="mt-3 text-xs text-[var(--text-faint)]">
          Showing the first {CSV_PREVIEW_ROW_LIMIT.toLocaleString()} of {result.data.length.toLocaleString()} rows.
        </p>
      )}
    </div>
  );
}
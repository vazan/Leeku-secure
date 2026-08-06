import { useMemo } from "react";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import dos from "highlight.js/lib/languages/dos";
import go from "highlight.js/lib/languages/go";
import graphql from "highlight.js/lib/languages/graphql";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import lua from "highlight.js/lib/languages/lua";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import r from "highlight.js/lib/languages/r";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scala from "highlight.js/lib/languages/scala";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import Papa from "papaparse";
import "./text-file-preview.css";

export interface TextFilePreviewData {
  kind: "text" | "csv";
  content: string;
}

const CSV_PREVIEW_ROW_LIMIT = 1000;
const SYNTAX_HIGHLIGHT_MAX_CHARACTERS = 512 * 1024;
const CSV_COLUMN_COLORS = [
  { color: "#22d3ee", backgroundColor: "rgba(34, 211, 238, 0.08)" },
  { color: "#f472b6", backgroundColor: "rgba(244, 114, 182, 0.08)" },
  { color: "#a3e635", backgroundColor: "rgba(163, 230, 53, 0.08)" },
  { color: "#fbbf24", backgroundColor: "rgba(251, 191, 36, 0.08)" },
  { color: "#c084fc", backgroundColor: "rgba(192, 132, 252, 0.08)" },
  { color: "#fb7185", backgroundColor: "rgba(251, 113, 133, 0.08)" },
];

const PREVIEW_LANGUAGES = {
  bash,
  c,
  cpp,
  csharp,
  css,
  dockerfile,
  dos,
  go,
  graphql,
  ini,
  java,
  javascript,
  json,
  kotlin,
  lua,
  makefile,
  markdown,
  php,
  powershell,
  python,
  r,
  ruby,
  rust,
  scala,
  scss,
  sql,
  swift,
  typescript,
  xml,
  yaml,
};

Object.entries(PREVIEW_LANGUAGES).forEach(([name, language]) => {
  hljs.registerLanguage(name, language);
});

const EXTENSION_LANGUAGES: Record<string, keyof typeof PREVIEW_LANGUAGES> = {
  adoc: "markdown",
  bash: "bash",
  bat: "dos",
  c: "c",
  cjs: "javascript",
  cmd: "dos",
  conf: "ini",
  config: "ini",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  cxx: "cpp",
  env: "ini",
  fish: "bash",
  geojson: "json",
  go: "go",
  gql: "graphql",
  graphql: "graphql",
  h: "c",
  hpp: "cpp",
  htm: "xml",
  html: "xml",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  jsonl: "json",
  jsx: "javascript",
  kt: "kotlin",
  kts: "kotlin",
  less: "css",
  lua: "lua",
  markdown: "markdown",
  md: "markdown",
  mjs: "javascript",
  ndjson: "json",
  php: "php",
  properties: "ini",
  ps1: "powershell",
  py: "python",
  r: "r",
  rb: "ruby",
  rs: "rust",
  rst: "markdown",
  sass: "scss",
  scala: "scala",
  scss: "scss",
  sh: "bash",
  sql: "sql",
  swift: "swift",
  toml: "ini",
  ts: "typescript",
  tsx: "typescript",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

const FILE_NAME_LANGUAGES: Record<string, keyof typeof PREVIEW_LANGUAGES> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  procfile: "ruby",
};

export function getPreviewLanguage(fileName: string) {
  const normalizedName = fileName.toLowerCase();
  const extension = normalizedName.includes(".")
    ? normalizedName.slice(normalizedName.lastIndexOf(".") + 1)
    : "";
  return FILE_NAME_LANGUAGES[normalizedName] || EXTENSION_LANGUAGES[extension] || null;
}

export default function TextFilePreview({
  preview,
  fileName,
}: {
  preview: TextFilePreviewData;
  fileName: string;
}) {
  const language =
    preview.kind === "text" && preview.content.length <= SYNTAX_HIGHLIGHT_MAX_CHARACTERS
      ? getPreviewLanguage(fileName)
      : null;
  const highlightedContent = useMemo(
    () => language ? hljs.highlight(preview.content, { language }).value : null,
    [language, preview.content],
  );

  if (preview.kind === "text") {
    return (
      <pre className="syntax-preview max-h-[34rem] overflow-auto whitespace-pre-wrap break-words border-y border-[var(--border-subtle)] bg-[var(--bg-muted)] px-4 py-4 font-mono text-xs leading-6 text-[var(--text-secondary)]">
        {highlightedContent ? (
          <code
            className={`hljs language-${language}`}
            dangerouslySetInnerHTML={{ __html: highlightedContent }}
          />
        ) : preview.content}
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
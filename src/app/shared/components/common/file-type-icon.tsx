import React from "react";
import {
  Archive,
  Binary,
  Braces,
  Code,
  Database,
  File,
  FileCode2,
  FileSpreadsheet,
  FileText,
  FileType2,
  FileVideo,
  FileVolume2,
  Globe,
  Presentation,
  ScanText,
  Terminal,
} from "lucide-react";

type FileIconKind =
  | "audio"
  | "archive"
  | "binary"
  | "cad"
  | "code"
  | "config"
  | "data"
  | "design"
  | "document"
  | "executable"
  | "font"
  | "image"
  | "media"
  | "pdf"
  | "presentation"
  | "script"
  | "spreadsheet"
  | "text"
  | "web";

const extensionToKind: Record<string, FileIconKind> = {
  mpeg: "media",
  mpg: "media",
  avi: "media",
  mkv: "media",
  wav: "audio",
  flac: "audio",
  m4a: "audio",
  ogg: "audio",
  mid: "audio",
  midi: "audio",
  swf: "media",
  flv: "media",
  psd: "design",
  eps: "design",
  svg: "image",
  tiff: "image",
  tif: "image",
  indd: "design",
  ttf: "font",
  otf: "font",
  eot: "font",
  woff: "font",
  woff2: "font",
  dwg: "cad",
  skp: "cad",
  blend: "cad",
  ma: "cad",
  obj: "cad",
  nbt: "binary",
  sch: "design",
  pcb: "design",
  dbf: "data",
  mdb: "data",
  mht: "web",
  mhtml: "web",
  chm: "document",
  msi: "executable",
  pkg: "executable",
  sub: "text",
  txt: "text",
  doc: "document",
  docx: "document",
  pdf: "pdf",
  ppt: "presentation",
  pptx: "presentation",
  xls: "spreadsheet",
  xlsx: "spreadsheet",
  csv: "spreadsheet",
  json: "data",
  xml: "web",
  html: "web",
  htm: "web",
  css: "web",
  js: "code",
  jsx: "code",
  ts: "code",
  tsx: "code",
  py: "script",
  java: "code",
  c: "code",
  cpp: "code",
  cxx: "code",
  cs: "code",
  php: "code",
  sql: "data",
  md: "text",
  rtf: "document",
  log: "text",
  ini: "config",
  cfg: "config",
  conf: "config",
  bat: "script",
  sh: "script",
  zip: "archive",
  "7z": "archive",
  rar: "archive",
  tar: "archive",
  gz: "archive",
  tgz: "archive",
  iso: "binary",
  bin: "binary",
  apk: "executable",
  exe: "executable",
};

function extensionFromName(fileName: string) {
  const trimmed = fileName.trim();
  const dot = trimmed.lastIndexOf(".");
  if (dot < 0 || dot === trimmed.length - 1) return "";
  return trimmed.slice(dot + 1).toLowerCase();
}

function kindFromFile(fileName: string, mimeType: string): FileIconKind {
  const ext = extensionFromName(fileName);
  const fromExtension = extensionToKind[ext];
  if (fromExtension) return fromExtension;

  if (mimeType.startsWith("font/")) return "font";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "media";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint"))
    return "presentation";
  if (
    mimeType.includes("photoshop") ||
    mimeType.includes("postscript") ||
    mimeType.includes("illustrator")
  )
    return "design";
  if (mimeType.includes("cad") || mimeType.includes("dwg")) return "cad";
  if (mimeType.includes("pdf")) return "pdf";
  if (mimeType.includes("spreadsheet") || mimeType.includes("csv"))
    return "spreadsheet";
  if (
    mimeType.includes("json") ||
    mimeType.includes("xml") ||
    mimeType.includes("sql")
  )
    return "data";
  if (
    mimeType.includes("javascript") ||
    mimeType.includes("typescript") ||
    mimeType.includes("python") ||
    mimeType.includes("java") ||
    mimeType.includes("csharp")
  )
    return "code";
  if (mimeType.includes("script") || mimeType.includes("shell"))
    return "script";
  if (mimeType.includes("zip") || mimeType.includes("compressed"))
    return "archive";
  if (mimeType.startsWith("text/")) return "text";
  return "document";
}

function iconForKind(kind: FileIconKind, className: string) {
  if (kind === "audio") return <FileVolume2 className={className} />;
  if (kind === "archive") return <Archive className={className} />;
  if (kind === "binary") return <Binary className={className} />;
  if (kind === "cad") return <Braces className={className} />;
  if (kind === "code") return <Code className={className} />;
  if (kind === "config") return <Braces className={className} />;
  if (kind === "data") return <Database className={className} />;
  if (kind === "design") return <FileType2 className={className} />;
  if (kind === "executable") return <Terminal className={className} />;
  if (kind === "font") return <FileText className={className} />;
  if (kind === "image") return <FileType2 className={className} />;
  if (kind === "media") return <FileVideo className={className} />;
  if (kind === "pdf") return <ScanText className={className} />;
  if (kind === "presentation") return <Presentation className={className} />;
  if (kind === "script") return <FileCode2 className={className} />;
  if (kind === "spreadsheet") return <FileSpreadsheet className={className} />;
  if (kind === "text") return <FileText className={className} />;
  if (kind === "web") return <Globe className={className} />;
  return <File className={className} />;
}

function badgeFor(fileName: string) {
  const ext = extensionFromName(fileName);
  return ext ? ext.toUpperCase().slice(0, 4) : "FILE";
}

export default function FileTypeIcon({
  fileName,
  mimeType,
  className,
}: {
  fileName: string;
  mimeType: string;
  className: string;
}) {
  const kind = kindFromFile(fileName, mimeType);
  const badge = badgeFor(fileName);

  return (
    <span className="relative grid h-full w-full place-items-center">
      {iconForKind(kind, className)}
      <span className="pointer-events-none absolute bottom-1 rounded bg-black/70 px-1 py-0.5 text-[8px] font-semibold leading-none text-white">
        {badge}
      </span>
    </span>
  );
}

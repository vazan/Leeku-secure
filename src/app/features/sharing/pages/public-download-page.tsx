import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  Download,
  FileText,
  Folder,
  Loader2,
  Lock,
} from "lucide-react";
import ErrorScreen from "@/app/shared/components/common/error-screen";

interface PublicDownloadPageProps {
  token: string;
  onGoHome: () => void;
}
interface PublicFileMeta {
  file_name: string;
  mime_type: string;
  size: number;
  created_at: string;
  protected: boolean;
  uploader: string;
  downloads_current: number;
  downloads_max: number | null;
}

const formatBytes = (bytes: number) => {
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
};

export default function PublicDownloadPage({
  token,
  onGoHome,
}: PublicDownloadPageProps) {
  const [meta, setMeta] = useState<PublicFileMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`/api/public/share/${token}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "This link is no longer available.");
        setMeta(data);
      })
      .catch((reason) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [token]);

  const download = async (event: React.FormEvent) => {
    event.preventDefault();
    setDownloading(true);
    setError("");
    try {
      const response = await fetch(`/api/public/share/${token}/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok)
        throw new Error(
          (await response.json()).error || "Download unavailable.",
        );
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = meta?.file_name || "download";
      anchor.click();
      URL.revokeObjectURL(url);
      setDone(true);
    } catch (reason: any) {
      setError(reason.message);
    } finally {
      setDownloading(false);
    }
  };

  if (loading)
    return (
      <div className="grid min-h-screen place-items-center bg-[#f5f6f8]">
        <Loader2 className="h-5 w-5 animate-spin text-[#777e87]" />
      </div>
    );
  if (!meta) return <ErrorScreen code={404} onGoBack={onGoHome} />;

  return (
    <div className="min-h-screen bg-[#f5f6f8] px-5 py-6">
      <div className="mx-auto max-w-xl">
        <button
          onClick={onGoHome}
          className="flex items-center gap-2 text-sm text-[#747b84]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <div className="mt-16 rounded-2xl border border-[#dfe3e8] bg-white p-7">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#17191d] text-white">
              <Folder className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold">Leeku</span>
          </div>
          <div className="mt-10 flex gap-4">
            <div className="grid h-12 w-12 flex-none place-items-center rounded-xl bg-[#eef2f6]">
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold">
                {meta.file_name}
              </h1>
              <p className="mt-1 text-sm text-[#858b94]">
                {formatBytes(meta.size)} · Shared by {meta.uploader}
              </p>
            </div>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 rounded-xl bg-[#f7f8fa] p-4 text-sm">
            <div>
              <p className="text-xs text-[#9298a1]">Added</p>
              <p className="mt-1">
                {new Date(meta.created_at).toLocaleDateString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#9298a1]">Downloads</p>
              <p className="mt-1">
                {meta.downloads_current}
                {meta.downloads_max ? ` of ${meta.downloads_max}` : ""}
              </p>
            </div>
          </div>
          <form onSubmit={download} className="mt-6 space-y-4">
            {meta.protected && (
              <label className="block">
                <span className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <Lock className="h-4 w-4" />
                  Password
                </span>
                <input
                  required
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-lg border border-[#d8dde3] px-3 py-3 text-sm outline-none"
                />
              </label>
            )}
            {error && (
              <p className="rounded-lg border border-[#e1e4e8] bg-[#fafbfc] p-3 text-sm text-[#626973]">
                {error}
              </p>
            )}
            {done && (
              <p className="flex items-center gap-2 text-sm text-[#626973]">
                <Check className="h-4 w-4" />
                Your download has started.
              </p>
            )}
            <button
              disabled={downloading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#2f7ee6] px-4 py-3 text-sm font-medium text-white"
            >
              {downloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {downloading ? "Preparing download" : "Download file"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

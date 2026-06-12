import React, { useEffect, useId, useRef, useState } from "react";
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
  const downloadTarget = useId().replace(/:/g, "");
  const doneTimerRef = useRef<number | null>(null);

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

  useEffect(
    () => () => {
      if (doneTimerRef.current) window.clearTimeout(doneTimerRef.current);
    },
    [],
  );

  const handleDownloadFrameLoad = (
    event: React.SyntheticEvent<HTMLIFrameElement>,
  ) => {
    const text =
      event.currentTarget.contentDocument?.body?.textContent?.trim() || "";
    if (!text) return;

    try {
      const data = JSON.parse(text);
      if (data.error) {
        if (doneTimerRef.current) window.clearTimeout(doneTimerRef.current);
        setError(data.error);
        setDone(false);
        setDownloading(false);
      }
    } catch {
      // Successful attachment downloads do not render JSON into the iframe.
    }
  };

  const download = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDownloading(true);
    setError("");
    setDone(false);

    const form = event.currentTarget;
    if (doneTimerRef.current) window.clearTimeout(doneTimerRef.current);
    doneTimerRef.current = window.setTimeout(() => {
      setDone(true);
      setDownloading(false);
    }, 1200);
    form.submit();
  };

  if (loading)
    return (
      <div className="grid min-h-screen place-items-center bg-[var(--bg-primary)]">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--text-muted)]" />
      </div>
    );
  if (!meta) return <ErrorScreen code={404} onGoBack={onGoHome} />;

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] px-5 py-6">
      <div className="mx-auto max-w-xl">
        <button
          onClick={onGoHome}
          className="flex items-center gap-2 text-sm text-[var(--text-muted)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <div className="mt-16 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-7 shadow-[var(--shadow-panel)]">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--bg-hover)] text-[var(--text-primary)]">
              <Folder className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold">Leeku</span>
          </div>
          <div className="mt-10 flex items-start gap-4">
            <div className="grid h-12 w-12 flex-none place-items-center rounded-xl bg-[var(--bg-hover)]">
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="break-all text-xl font-semibold leading-snug">
                {meta.file_name}
              </h1>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                {formatBytes(meta.size)} · Shared by {meta.uploader}
              </p>
            </div>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 rounded-xl bg-[var(--bg-muted)] p-4 text-sm">
            <div>
              <p className="text-xs text-[var(--text-faint)]">Added</p>
              <p className="mt-1">
                {new Date(meta.created_at).toLocaleDateString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-faint)]">Downloads</p>
              <p className="mt-1">
                {meta.downloads_current}
                {meta.downloads_max ? ` of ${meta.downloads_max}` : ""}
              </p>
            </div>
          </div>
          <iframe
            name={downloadTarget}
            title="Shared file download"
            onLoad={handleDownloadFrameLoad}
            className="hidden"
          />
          <form
            method="POST"
            action={`/api/public/share/${token}/download`}
            target={downloadTarget}
            onSubmit={download}
            className="mt-6 space-y-4"
          >
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
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-linear)]"
                />
              </label>
            )}
            <input type="hidden" name="password" value={password} />
            {error && (
              <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-muted)] p-3 text-sm text-[var(--text-muted)]">
                {error}
              </p>
            )}
            {done && (
              <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                <Check className="h-4 w-4" />
                Your browser download has started.
              </p>
            )}
            <button
              disabled={downloading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent-linear)] px-4 py-3 text-sm font-medium text-[var(--accent-contrast)] hover:bg-[var(--accent-linear-bright)]"
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

import {
  ArrowRight,
  FileText,
  Folder,
  Link2,
  Search,
  ShieldCheck,
  Upload,
} from "lucide-react";
import type { Quota } from "@/app/shared/types";

interface LandingPageProps {
  onGoToAuth: (mode: "login" | "register") => void;
  quotas: Quota[];
  onSetView: (view: string) => void;
}

const sampleFiles = [
  "Project notes.pdf",
  "Launch assets.zip",
  "Budget review.xlsx",
  "Brand guidelines.pdf",
];

export default function LandingPage({ onGoToAuth }: LandingPageProps) {
  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 lg:px-8">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--bg-elevated)] text-[var(--text-primary)]">
            <Folder className="h-4 w-4" />
          </div>
          <span className="text-sm font-semibold">Leeku</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onGoToAuth("login")}
            className="rounded-full px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            Log in
          </button>
          <button
            onClick={() => onGoToAuth("register")}
            className="rounded-full bg-white px-4 py-2 text-sm font-medium text-black shadow-[var(--shadow-hairline)] hover:bg-[#e7e7e7]"
          >
            Create account
          </button>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-5 pb-20 pt-16 lg:px-8 lg:pt-24">
        <section className="grid items-center gap-14 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <p className="text-sm font-medium text-[var(--text-muted)]">
              A clearer place for your files
            </p>
            <h1 className="mt-4 max-w-xl text-5xl font-semibold leading-[1.02] tracking-[-0.065em] sm:text-6xl">
              Share files securely without losing control of them.
            </h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-[var(--text-muted)]">
              Upload, organize, and share the files that matter. Leeku
              keeps the details tidy so you can stay focused on the work.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                onClick={() => onGoToAuth("register")}
                className="flex items-center gap-2 rounded-lg bg-[var(--accent-linear)] px-5 py-3 text-sm font-medium text-[var(--accent-contrast)] hover:bg-[var(--accent-linear-bright)]"
              >
                Create an account <ArrowRight className="h-4 w-4" />
              </button>
              <button
                onClick={() => onGoToAuth("login")}
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-5 py-3 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                Open your files
              </button>
            </div>
            <div className="mt-10 flex flex-wrap gap-6 text-sm text-[var(--text-muted)]">
              <span className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" />
                Private by default
              </span>
              <span className="flex items-center gap-2">
                <Link2 className="h-4 w-4" />
                Share on your terms
              </span>
            </div>
          </div>

          <FileSharingPreview />
        </section>

        <section className="mt-24 grid gap-4 md:grid-cols-3">
          {[
            [
              "Add it once",
              "Upload a file once and keep it protected until you share it.",
            ],
            [
              "Find it quickly",
              "Useful names, simple search, and one clear home for everything.",
            ],
            [
              "Share with context",
              "Create a link when someone needs access, then move on.",
            ],
          ].map(([title, copy]) => (
            <div
              key={title}
              className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-6 shadow-[var(--shadow-hairline)]"
            >
              <h2 className="text-base font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{copy}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}

function FileSharingPreview() {
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-[var(--shadow-panel)]">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Folder className="h-4 w-4" />
          All files
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-muted)] px-3 py-2 text-xs text-[var(--text-faint)]">
          <Search className="h-3.5 w-3.5" />
          Search
        </div>
        <div className="rounded-full bg-white px-3 py-2 text-xs font-medium text-black shadow-[var(--shadow-hairline)]">
          Upload file
        </div>
      </div>
      <div className="grid grid-cols-[150px_1fr]">
        <aside className="border-r border-[var(--border-subtle)] p-4">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-[var(--bg-hover)] text-sm font-semibold">
            N
          </div>
          <p className="mt-3 text-sm font-medium">Your files</p>
          <div className="mt-6 space-y-2 text-xs text-[var(--text-muted)]">
            <p className="rounded-md bg-[var(--bg-hover)] px-2 py-2 text-[var(--text-secondary)]">
              Files
            </p>
            <p className="px-2 py-2">Shared</p>
            <p className="px-2 py-2">Settings</p>
          </div>
        </aside>
        <div className="bg-[var(--bg-muted)] p-5">
          <div className="mb-4 rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5 text-center">
            <Upload className="mx-auto h-4 w-4" />
            <p className="mt-2 text-xs font-medium">Drop a file here</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {sampleFiles.map((file) => (
              <div
                key={file}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3 shadow-[var(--shadow-hairline)]"
              >
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--bg-hover)]">
                  <FileText className="h-4 w-4" />
                </div>
                <p className="mt-5 truncate text-xs font-medium">{file}</p>
                <p className="mt-1 text-[10px] text-[var(--text-faint)]">Updated today</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

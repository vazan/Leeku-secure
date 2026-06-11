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
    <div className="min-h-screen bg-[#f5f6f8] text-[#17191d]">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 lg:px-8">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#17191d] text-white">
            <Folder className="h-4 w-4" />
          </div>
          <span className="text-sm font-semibold">Leeku</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onGoToAuth("login")}
            className="rounded-lg px-4 py-2 text-sm font-medium"
          >
            Log in
          </button>
          <button
            onClick={() => onGoToAuth("register")}
            className="rounded-lg bg-[#2f7ee6] px-4 py-2 text-sm font-medium text-white"
          >
            Create workspace
          </button>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-5 pb-20 pt-16 lg:px-8 lg:pt-24">
        <section className="grid items-center gap-14 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <p className="text-sm font-medium text-[#6f7680]">
              A clearer place for your files
            </p>
            <h1 className="mt-4 max-w-xl text-5xl font-semibold leading-[1.02] tracking-[-0.065em] sm:text-6xl">
              Keep work moving without losing track of it.
            </h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-[#747b85]">
              Upload, organize, and share the things your team needs. Leeku
              keeps the details tidy so you can stay focused on the work.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                onClick={() => onGoToAuth("register")}
                className="flex items-center gap-2 rounded-lg bg-[#2f7ee6] px-5 py-3 text-sm font-medium text-white"
              >
                Start a workspace <ArrowRight className="h-4 w-4" />
              </button>
              <button
                onClick={() => onGoToAuth("login")}
                className="rounded-lg border border-[#d9dde3] bg-white px-5 py-3 text-sm font-medium"
              >
                Open your files
              </button>
            </div>
            <div className="mt-10 flex flex-wrap gap-6 text-sm text-[#7d838c]">
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

          <WorkspacePreview />
        </section>

        <section className="mt-24 grid gap-4 md:grid-cols-3">
          {[
            [
              "Add it once",
              "Drop in a file and let the workspace take care of the rest.",
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
              className="rounded-2xl border border-[#e0e4e9] bg-white p-6"
            >
              <h2 className="text-base font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-[#7c828b]">{copy}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}

function WorkspacePreview() {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#dfe3e8] bg-white">
      <div className="flex items-center justify-between border-b border-[#e7eaee] px-5 py-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Folder className="h-4 w-4" />
          All files
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-[#e0e4e8] bg-[#fafbfc] px-3 py-2 text-xs text-[#969ca5]">
          <Search className="h-3.5 w-3.5" />
          Search
        </div>
        <div className="rounded-lg bg-[#2f7ee6] px-3 py-2 text-xs font-medium text-white">
          Upload file
        </div>
      </div>
      <div className="grid grid-cols-[150px_1fr]">
        <aside className="border-r border-[#e7eaee] p-4">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-[#eef1f5] text-sm font-semibold">
            N
          </div>
          <p className="mt-3 text-sm font-medium">Your workspace</p>
          <div className="mt-6 space-y-2 text-xs text-[#858b94]">
            <p className="rounded-md bg-[#f1f3f6] px-2 py-2 text-[#33373d]">
              Files
            </p>
            <p className="px-2 py-2">Shared</p>
            <p className="px-2 py-2">Settings</p>
          </div>
        </aside>
        <div className="bg-[#fafbfc] p-5">
          <div className="mb-4 rounded-xl border border-dashed border-[#d3d8df] bg-white p-5 text-center">
            <Upload className="mx-auto h-4 w-4" />
            <p className="mt-2 text-xs font-medium">Drop a file here</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {sampleFiles.map((file) => (
              <div
                key={file}
                className="rounded-xl border border-[#e2e5ea] bg-white p-3"
              >
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#eef3f9]">
                  <FileText className="h-4 w-4" />
                </div>
                <p className="mt-5 truncate text-xs font-medium">{file}</p>
                <p className="mt-1 text-[10px] text-[#979da6]">Updated today</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

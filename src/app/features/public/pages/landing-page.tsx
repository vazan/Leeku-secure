import {
  ArrowRight,
  Folder,
  Link2,
  ShieldCheck,
} from "lucide-react";

interface LandingPageProps {
  onGoToAuth: (mode: "login" | "register") => void;
}

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
        <section>
          <div className="max-w-5xl">
            <p className="text-sm font-medium text-[var(--text-muted)]">
              A clearer place for your files
            </p>
            <h1 className="mt-4 text-[clamp(2.5rem,4.2vw,4rem)] font-semibold leading-[1.02] tracking-[-0.065em]">
              <span className="block sm:whitespace-nowrap">Share files securely.</span>
              <span className="block sm:whitespace-nowrap">Stay in control.</span>
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

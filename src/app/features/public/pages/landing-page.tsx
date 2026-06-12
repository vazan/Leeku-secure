import {
  ArrowRight,
  Folder,
  Link2,
  ShieldCheck,
} from "lucide-react";

import { motion } from 'motion/react';
import { useState, useEffect } from 'react';
import { Shield, Upload, Sparkles, HardDrive, Key, Flame } from 'lucide-react';
import leekuMascot from '@/app/shared/assets/leeku_mascot.png';
import { MascotAvatar } from '@/app/shared/components/legacy/mascots';
import { Quota } from "@/app/shared/types";

interface LandingPageProps {
  onGoToAuth: (mode: "login" | "register") => void;
  quotas: Quota[];
}

const LEEKU_QUOTES = [
  "Your files are safer here than in your Downloads folder.",
  "We scanned your file. The leek approved.",
  "Leeku says this file has acceptable vibes.",
  "No digital goblins located in this sector today!",
  "Please stop feeding the server suspiciously large archives.",
  "I blocked some malware with my giant combat leek today."
];

export default function LandingPage({ onGoToAuth, quotas }: LandingPageProps) {
  const [mascotQuote, setMascotQuote] = useState(LEEKU_QUOTES[0]);

  // Rotate mascot quotes periodically for micro-interaction amusement
  useEffect(() => {
    const interval = setInterval(() => {
      const idx = Math.floor(Math.random() * LEEKU_QUOTES.length);
      setMascotQuote(LEEKU_QUOTES[idx]);
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  const formatSize = (bytes: number) => {
    if (bytes >= 1099511627776) return `${(bytes / 1099511627776).toFixed(0)} TB`;
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(0)} GB`;
    return `${(bytes / 1048576).toFixed(0)} MB`;
  };

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

          <br></br>
          {/* Mascot Mascot Card Column */}
            <motion.div 
              className="lg:col-span-5 relative"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.15 }}
            >
              {/* Mascot Dialog Card mimicking full graphic theme */}
              <div className="bg-[#00F2FF] p-1 shadow-[8px_8px_0px_#FF007F] rounded-none">
                <div className="bg-[#0A0E14] p-6 flex flex-col items-center">
                  {/* Dynamic Quote bubble above */}
                  <motion.div 
                    key={mascotQuote}
                    className="w-full bg-[#1A1F26] border-2 border-[#00F2FF] p-4 mb-6 relative rounded-none"
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                  >
                    <div className="absolute bottom-[-10px] left-1/2 transform -translate-x-1/2 w-4 h-4 bg-[#1A1F26] border-r-2 border-b-2 border-[#00F2FF] rotate-45"></div>
                    <p className="text-xs italic text-gray-200 text-center leading-relaxed font-mono">
                      "{mascotQuote}"
                    </p>
                  </motion.div>

                  {/* Mascot Photo inside exact style frame */}
                  <div className="mb-4">
                    <MascotAvatar id="leeku" size="xl" className="border-4 border-dashed border-[#FF007F]" />
                  </div>

                  {/* Mascot badge details */}
                  <div className="text-center w-full">
                    <h3 className="font-display font-black text-2xl text-[#FF007F] uppercase tracking-widest">LEEKU</h3>
                    <span className="block text-[10px] bg-[#00F2FF] text-[#0A0E14] px-2 py-0.5 mt-2 font-bold uppercase tracking-wider w-fit mx-auto">
                      VAULT_GUARDIAN_v1.0
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>
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

        <br></br>

        {/* Quota Tables Section */}
        <motion.div 
          className="bg-[#1A1F26]/90 border-2 border-[#00F2FF] p-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <div className="mb-6 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <h2 className="font-display font-black text-2xl uppercase tracking-widest text-[#00F2FF]/90">System Storage Allocation</h2>
              <p className="text-xs text-gray-400 font-mono mt-1 uppercase">
                Check our default quota sizes. Level up your leek power easily by joining.
              </p>
            </div>
            <span className="text-xs font-mono text-[#00FF00] uppercase font-bold tracking-widest">[ STATUS: RE-BLOSSOMING DAILY ]</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs border-collapse">
              <thead>
                <tr className="border-b-2 border-[#00F2FF] text-[#00F2FF] uppercase font-black tracking-wider text-xs bg-black/40">
                  <th className="py-3 px-4">Quota Tier</th>
                  <th className="py-3 px-4">Available Storage</th>
                  <th className="py-3 px-4">Max File Size</th>
                  <th className="py-3 px-4">Files Limit</th>
                  <th className="py-3 px-4">Daily Ingestion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800 text-slate-200">
                {quotas?.map((q) => (
                  <tr 
                    key={q.id} 
                    className={`hover:bg-[#00F2FF]/5 transition-colors border-b border-gray-800/80 ${q.id === 'guest' ? 'text-[#00F2FF] font-semibold' : ''}`}
                  >
                    <td className="py-4 px-4 font-sans font-black flex items-center gap-2 uppercase text-xs italic">
                      <span className="w-2 rounded-none h-4 bg-[#FF007F]"></span>
                      {q.name}
                    </td>
                    <td className="py-4 px-4 text-[#00F2FF] font-bold text-sm">{formatSize(q.storage_limit_bytes)}</td>
                    <td className="py-4 px-4 text-gray-300">{formatSize(q.max_file_size_bytes)}</td>
                    <td className="py-4 px-4 text-slate-400">{q.max_files.toLocaleString()} files</td>
                    <td className="py-4 px-4 text-slate-400">{formatSize(q.daily_upload_limit_bytes)}/day</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>

        {/* Trust Quote / Pitch */}
        <div className="mt-16 text-center border-t border-gray-800 pt-12 max-w-2xl mx-auto">
          <Sparkles className="w-8 h-8 text-[#FF007F] mx-auto mb-4 animate-pulse" id="sparkles-decor" />
          <p className="italic text-gray-300 text-md leading-relaxed font-mono text-sm">
            "Your files aren't just blocks on a server; they're precious packages stored securely in our Vocaloid bunker, guarded by lasers, digital code ciphers, and a persistent craving for leeks."
          </p>
          <span className="block mt-4 text-xs font-mono text-[#00F2FF] font-black uppercase tracking-widest">— Chief Architect of the Green Field</span>
        </div>

      </main>
    </div>
  );
}

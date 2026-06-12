import type { ReactNode } from "react";
import { Folder, LogOut } from "lucide-react";
import type { User } from "@/app/shared/types";

export type DashboardView = "home" | "files" | "shared" | "settings" | "admin";
export type DashboardNavItem = [DashboardView, ReactNode, string];

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

export default function DashboardSidebar({
  user,
  view,
  navItems,
  storageLimit,
  onView,
  onLogout,
}: {
  user: User;
  view: DashboardView;
  navItems: DashboardNavItem[];
  storageLimit: number;
  onView: (view: DashboardView) => void;
  onLogout: () => void;
}) {
  const storagePercent = Math.min(100, (user.storage_used / storageLimit) * 100);

  return (
    <aside
      data-dashboard-sidebar
      className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5 lg:flex lg:flex-col"
    >
      <div 
          className="flex items-center gap-3 cursor-pointer group"
        >
          <div className="w-10 h-10 bg-[#00F2FF] rounded-sm rotate-12 flex items-center justify-center border-2 border-[#FF007F] font-display font-black text-[#0A0E14] text-xl leading-none shadow-[0_0_15px_rgba(0,242,255,0.4)] group-hover:scale-115 transition-transform duration-300">
            L
          </div>
          <div>
            <span className="font-display font-black text-2xl tracking-tighter italic text-[#00F2FF] uppercase group-hover:text-white transition-colors">
              Leeks.<span className="text-[#FF007F]">miku</span>.rip
            </span>
            <span className="block font-mono text-[9px] uppercase tracking-wider text-gray-500 font-bold">Miku Bunker Secure</span>
          </div>
        </div>
      <nav className="mt-8 space-y-1">
        {navItems.map(([id, icon, label]) => (
          <button
            key={id}
            onClick={() => onView(id)}
            aria-current={view === id ? "page" : undefined}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${view === id ? "bg-[var(--bg-hover)] font-medium" : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"}`}
          >
            {icon}
            {label}
          </button>
        ))}
      </nav>
      <div className="mt-auto">
        <div className="mb-4 rounded-xl border border-[var(--border-subtle)] p-3">
          <div className="mb-2 text-xs">
            <span className="text-[var(--text-muted)]">Storage</span>
            <span className="mt-1 block text-[var(--text-secondary)]">
              {formatBytes(user.storage_used)} / {formatBytes(storageLimit)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-hover)]">
            <div
              className="h-full rounded-full bg-[var(--accent-linear)]"
              style={{ width: `${storagePercent}%` }}
            />
          </div>
        </div>
        <button
          onClick={onLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
        >
          <LogOut className="h-4 w-4" />
          Log out
        </button>
      </div>
    </aside>
  );
}

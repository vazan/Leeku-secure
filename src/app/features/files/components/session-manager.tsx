import { useCallback, useEffect, useState } from "react";
import { Laptop, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/app/shared/components/ui/button";
import type { ActiveSession } from "@/app/shared/types";

const getCsrfToken = () =>
  document.cookie
    .split("; ")
    .find((row) => row.startsWith("leeku_csrf="))
    ?.split("=")[1] || "";

async function readError(response: Response, fallback: string) {
  try {
    return (await response.json()).error || fallback;
  } catch {
    return fallback;
  }
}

function describeDevice(userAgent: string | null) {
  if (!userAgent) return "Unknown device";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Chrome\//.test(userAgent)
      ? "Chrome"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Browser";
  const platform = /Windows/i.test(userAgent)
    ? "Windows"
    : /Android/i.test(userAgent)
      ? "Android"
      : /iPhone|iPad/i.test(userAgent)
        ? "iOS"
        : /Macintosh/i.test(userAgent)
          ? "macOS"
          : /Linux/i.test(userAgent)
            ? "Linux"
            : "Unknown OS";
  return `${browser} on ${platform}`;
}

export default function SessionManager() {
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/auth/sessions");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setSessions(data.sessions || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load sessions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const reloadSessions = () => {
      void load();
    };
    void load();
    window.addEventListener("leeku:session-rotated", reloadSessions);
    return () =>
      window.removeEventListener("leeku:session-rotated", reloadSessions);
  }, [load]);

  const revoke = async (session: ActiveSession) => {
    const response = await fetch(session.is_current ? "/api/auth/sessions/current/revoke" : `/api/auth/sessions/${session.id}/revoke`, {
      method: "POST",
      headers: { "X-CSRF-Token": getCsrfToken() },
    });
    if (response.ok) {
      if (session.is_current) {
        window.location.assign("/");
        return;
      }
      setSessions((current) => current.filter((item) => item.id !== session.id));
      toast.success("Session signed out.");
    } else {
      toast.error(await readError(response, "Could not revoke session."));
    }
  };

  const revokeOthers = async () => {
    const response = await fetch("/api/auth/sessions/revoke-others", {
      method: "POST",
      headers: { "X-CSRF-Token": getCsrfToken() },
    });
    if (response.ok) {
      await load();
      toast.success("Other sessions signed out.");
    } else {
      toast.error(await readError(response, "Could not revoke sessions."));
    }
  };

  const revokeAll = async () => {
    if (!window.confirm("Sign out every active session, including this one?")) return;
    const response = await fetch("/api/auth/sessions/revoke-all", {
      method: "POST",
      headers: { "X-CSRF-Token": getCsrfToken() },
    });
    if (response.ok) window.location.assign("/");
    else toast.error(await readError(response, "Could not revoke sessions."));
  };

  return (
    <section className="mt-6 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-6 shadow-[var(--shadow-hairline)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            <h2 className="text-sm font-semibold">Active sessions</h2>
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Review browsers signed in to your account.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={revokeOthers}>
            Sign out others
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={revokeAll}>
            <LogOut className="h-3.5 w-3.5" />
            Sign out everywhere
          </Button>
        </div>
      </div>
      <div className="mt-5 divide-y divide-[var(--border-subtle)]">
        {loading && (
          <div className="flex items-center gap-2 py-4 text-sm text-[var(--text-muted)]">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Loading sessions
          </div>
        )}
        {!loading && sessions.length === 0 && (
          <p className="py-4 text-sm text-[var(--text-muted)]">No active refresh sessions.</p>
        )}
        {sessions.map((session) => (
          <div key={session.id} className="flex items-center gap-3 py-4">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--bg-hover)]">
              <Laptop className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {describeDevice(session.user_agent)}
                {session.is_current && (
                  <span className="ml-2 text-xs text-[var(--accent-linear)]">
                    Current session
                  </span>
                )}
              </p>
              <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
                {session.ip_address || "Unknown IP"} · Last active{" "}
                {new Date(session.created_at).toLocaleString()}
              </p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => revoke(session)}>
              Sign out
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

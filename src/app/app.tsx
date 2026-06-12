import { useEffect, useState } from "react";
import AuthPage from "@/app/features/auth/pages/auth-page";
import LandingPage from "@/app/features/public/pages/landing-page";
import PublicDownloadPage from "@/app/features/sharing/pages/public-download-page";
import UserDashboard from "@/app/features/files/pages/user-dashboard";
import { Toaster } from "@/app/shared/components/ui/sonner";
import type { Quota, User } from "@/app/shared/types";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState<
    "landing" | "auth" | "dashboard" | "download"
  >("landing");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [downloadToken, setDownloadToken] = useState<string | null>(null);
  const [quotas, setQuotas] = useState<Quota[]>([]);

  const getCsrfToken = () =>
    document.cookie
      .split("; ")
      .find((row) => row.startsWith("leeku_csrf="))
      ?.split("=")[1] || "";

  const refreshSession = async () => {
    const response = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "X-CSRF-Token": getCsrfToken() },
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data.user) {
      setUser(data.user);
      setToken("cookie");
      return data.user as User;
    }
    return null;
  };

  const handleHashChange = () => {
    const hash = window.location.hash;
    if (hash.startsWith("#f/")) {
      const parsedToken = hash.substring(3).trim();
      if (parsedToken) {
        setDownloadToken(parsedToken);
        setCurrentView("download");
        return;
      }
    }
    setDownloadToken(null);
    setCurrentView(user ? "dashboard" : "landing");
  };

  useEffect(() => {
    const initialise = async () => {
      try {
        const [quotasResponse, sessionResponse] = await Promise.all([
          fetch("/api/quotas"),
          fetch("/api/auth/me"),
        ]);
        const quotasData = await quotasResponse.json();
        const sessionData = await sessionResponse.json();
        if (quotasResponse.ok) setQuotas(quotasData.quotas || []);
        if (sessionResponse.ok && sessionData.user) {
          setUser(sessionData.user);
          setToken("cookie");
          if (!window.location.hash.startsWith("#f/"))
            setCurrentView("dashboard");
        } else {
          const refreshedUser = await refreshSession();
          if (refreshedUser && !window.location.hash.startsWith("#f/"))
            setCurrentView("dashboard");
        }
      } catch (error) {
        console.error("Unable to initialise the application.", error);
      } finally {
        setLoading(false);
      }
    };

    initialise();
    window.addEventListener("hashchange", handleHashChange);
    handleHashChange();
    const refreshInterval = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshSession().catch(() => null);
    }, 10 * 60 * 1000);
    const refreshOnVisible = () => {
      if (document.visibilityState === "visible") refreshSession().catch(() => null);
    };
    document.addEventListener("visibilitychange", refreshOnVisible);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
      window.clearInterval(refreshInterval);
      document.removeEventListener("visibilitychange", refreshOnVisible);
    };
  }, []);

  const handleRefreshUser = async () => {
    if (!user) return;
    try {
      const response = await fetch("/api/auth/me", {
        headers: { "X-CSRF-Token": getCsrfToken() },
      });
      const data = await response.json();
      if (response.ok && data.user) setUser(data.user);
    } catch (error) {
      console.error("Unable to refresh the current user.", error);
    }
  };

  const handleAuthSuccess = (_newToken: string, authenticatedUser: User) => {
    setToken("cookie");
    setUser(authenticatedUser);
    setCurrentView(downloadToken ? "download" : "dashboard");
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": getCsrfToken(),
        },
      });
    } catch {
      // Local state is cleared even when the network request fails.
    }
    setToken("");
    setUser(null);
    window.location.hash = "";
    setCurrentView("landing");
  };

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[var(--bg-primary)]">
        <div className="h-5 w-5 animate-spin rounded-full border border-[var(--border-subtle)] border-t-[var(--accent-linear)]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] selection:bg-[var(--accent-linear)] selection:text-[var(--accent-contrast)]">
      <Toaster />
      <main>
        {currentView === "landing" && (
          <div>
            <LandingPage
              quotas={quotas}
              onGoToAuth={(mode) => {
                setAuthMode(mode);
                setCurrentView("auth");
              }}
              onSetView={(view) => setCurrentView(view as any)}
            />
          </div>
        )}
        {currentView === "auth" && (
          <div>
            <AuthPage
              initialMode={authMode}
              onAuthSuccess={handleAuthSuccess}
              onCancel={() => setCurrentView(user ? "dashboard" : "landing")}
            />
          </div>
        )}
        {currentView === "dashboard" && user && (
          <div>
            <UserDashboard
              user={user}
              token={token}
              quotas={quotas}
              onLogout={handleLogout}
              onTriggerRefreshUser={handleRefreshUser}
            />
          </div>
        )}
        {currentView === "download" && downloadToken && (
          <div>
            <PublicDownloadPage
              token={downloadToken}
              onGoHome={() => {
                window.location.hash = "";
                setCurrentView(user ? "dashboard" : "landing");
              }}
            />
          </div>
        )}
      </main>
    </div>
  );
}

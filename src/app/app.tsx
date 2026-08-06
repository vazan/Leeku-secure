import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Toaster } from "@/app/shared/components/ui/sonner";
import type { Quota, User } from "@/app/shared/types";

const AuthPage = lazy(() => import("@/app/features/auth/pages/auth-page"));
const LandingPage = lazy(() => import("@/app/features/public/pages/landing-page"));
const PublicDownloadPage = lazy(() => import("@/app/features/sharing/pages/public-download-page"));
const PublicFolderPage = lazy(() => import("@/app/features/sharing/pages/public-folder-page"));
const UserDashboard = lazy(() => import("@/app/features/files/pages/user-dashboard"));

const getCsrfToken = () =>
  document.cookie
    .split("; ")
    .find((row) => row.startsWith("leeku_csrf="))
    ?.split("=")[1] || "";

async function ensureCsrfToken() {
  const existing = getCsrfToken();
  if (existing) return existing;

  const response = await fetch("/api/auth/csrf");
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Could not refresh the session.");
  }

  return data.csrfToken || getCsrfToken();
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState<
    "landing" | "auth" | "dashboard" | "download" | "folder"
  >("landing");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [downloadToken, setDownloadToken] = useState<string | null>(null);
  const [quotas, setQuotas] = useState<Quota[]>([]);
  const userRef = useRef<User | null>(null);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const refreshSession = async () => {
    const csrfToken = await ensureCsrfToken();
    const response = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data.user) {
      userRef.current = data.user;
      setUser(data.user);
      setToken("cookie");
      window.dispatchEvent(new Event("leeku:session-rotated"));
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
    if (hash.startsWith("#d/")) {
      const parsedToken = hash.substring(3).trim();
      if (parsedToken) {
        setDownloadToken(parsedToken);
        setCurrentView("folder");
        return;
      }
    }
    if (hash === "#auth/login" || hash === "#auth/register") {
      setAuthMode(hash.endsWith("register") ? "register" : "login");
      setDownloadToken(null);
      setCurrentView("auth");
      return;
    }
    if (hash.startsWith("#dashboard") && userRef.current) {
      setDownloadToken(null);
      setCurrentView("dashboard");
      return;
    }
    setDownloadToken(null);
    setCurrentView(userRef.current ? "dashboard" : "landing");
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
          userRef.current = sessionData.user;
          setUser(sessionData.user);
          setToken("cookie");
          if (
            !window.location.hash.startsWith("#f/") &&
            !window.location.hash.startsWith("#d/") &&
            !window.location.hash.startsWith("#auth/")
          )
            setCurrentView("dashboard");
        } else {
          const refreshedUser = await refreshSession();
          if (refreshedUser) userRef.current = refreshedUser;
          if (
            refreshedUser &&
            !window.location.hash.startsWith("#f/") &&
            !window.location.hash.startsWith("#d/") &&
            !window.location.hash.startsWith("#auth/")
          )
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
    userRef.current = authenticatedUser;
    setToken("cookie");
    setUser(authenticatedUser);
    if (downloadToken) {
      setCurrentView("download");
    } else {
      window.history.replaceState(null, "", "#dashboard");
      setCurrentView("dashboard");
    }
  };

  const handleLogout = async () => {
    try {
      const csrfToken = await ensureCsrfToken();
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
      });
    } catch {
      // Local state is cleared even when the network request fails.
    }
    setToken("");
    setUser(null);
    userRef.current = null;
    window.history.replaceState(null, "", window.location.pathname);
    setCurrentView("landing");
  };

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[var(--bg-primary)]">
        <div className="h-5 w-5 animate-spin rounded-full border border-[var(--border-subtle)] border-t-[var(--accent-linear)]" />
      </div>
    );
  }

  const viewFallback = (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="h-5 w-5 animate-spin rounded-full border border-[var(--border-subtle)] border-t-[var(--accent-linear)]" />
    </div>
  );

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] selection:bg-[var(--accent-linear)] selection:text-[var(--accent-contrast)]">
      <Toaster />
      <main>
        {currentView === "landing" && (
          <Suspense fallback={viewFallback}>
            <div>
              <LandingPage
                quotas={quotas}
                onGoToAuth={(mode) => {
                  window.location.hash = `auth/${mode}`;
                }}
              />
            </div>
          </Suspense>
        )}
        {currentView === "auth" && (
          <Suspense fallback={viewFallback}>
            <div>
              <AuthPage
                initialMode={authMode}
                onAuthSuccess={handleAuthSuccess}
                onCancel={() => {
                  window.history.replaceState(null, "", window.location.pathname);
                  setCurrentView(user ? "dashboard" : "landing");
                }}
              />
            </div>
          </Suspense>
        )}
        {currentView === "dashboard" && user && (
          <Suspense fallback={viewFallback}>
            <div>
              <UserDashboard
                user={user}
                token={token}
                quotas={quotas}
                onLogout={handleLogout}
                onTriggerRefreshUser={handleRefreshUser}
              />
            </div>
          </Suspense>
        )}
        {currentView === "download" && downloadToken && (
          <Suspense fallback={viewFallback}>
            <div>
              <PublicDownloadPage
                token={downloadToken}
                onGoHome={() => {
                  window.location.hash = "";
                  setCurrentView(user ? "dashboard" : "landing");
                }}
              />
            </div>
          </Suspense>
        )}
        {currentView === "folder" && downloadToken && (
          <Suspense fallback={viewFallback}>
            <div>
              <PublicFolderPage
                token={downloadToken}
                onGoHome={() => {
                  window.location.hash = "";
                  setCurrentView(user ? "dashboard" : "landing");
                }}
              />
            </div>
          </Suspense>
        )}
      </main>
    </div>
  );
}

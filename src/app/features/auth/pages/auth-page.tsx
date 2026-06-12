import React, { useEffect, useState } from "react";
import { ArrowLeft, Check, Folder, Loader2 } from "lucide-react";
import type { User } from "@/app/shared/types";

interface AuthPageProps {
  initialMode: "login" | "register";
  onAuthSuccess: (token: string, user: User) => void;
  onCancel: () => void;
}

export default function AuthPage({
  initialMode,
  onAuthSuccess,
  onCancel,
}: AuthPageProps) {
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setMode(initialMode);
    setMessage("");
  }, [initialMode]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(
        mode === "login" ? "/api/auth/login" : "/api/auth/register",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            mode === "login"
              ? { login: email, password }
              : { username, email, password },
          ),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Could not complete that request.");
      if (data.user) onAuthSuccess("cookie", data.user);
      else setMessage(data.message || "Check your email to continue.");
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen bg-[var(--bg-primary)] lg:grid-cols-2">
      <aside className="hidden bg-[var(--bg-elevated)] p-12 text-[var(--text-primary)] lg:flex lg:flex-col">
        <button onClick={onCancel} className="flex items-center gap-3 text-sm">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--bg-hover)] text-[var(--text-primary)]">
            <ArrowLeft className="h-4 w-4" />
          </div>
          Back To Home
        </button>
        <div className="my-auto max-w-md">
          <p className="text-sm text-[var(--text-muted)]">
            Your files, protected and ready to share.
          </p>
          <h1 className="mt-4 text-5xl font-semibold leading-[1.02] tracking-[-0.06em]">
            A calmer way to keep files close.
          </h1>
          <div className="mt-10 space-y-4 text-sm text-[var(--text-secondary)]">
            {[
              "Everything has one clear home.",
              "Sharing stays deliberate and easy.",
              "Your account keeps sharing under control.",
            ].map((item) => (
              <p key={item} className="flex items-center gap-3">
                <Check className="h-4 w-4" />
                {item}
              </p>
            ))}
          </div>
        </div>
      </aside>
      <main className="grid place-items-center p-5">
        <div className="w-full max-w-md">
          <button
            onClick={onCancel}
            className="mb-10 flex items-center gap-2 text-sm text-[var(--text-muted)] lg:hidden"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <h2 className="text-3xl font-semibold tracking-[-0.04em]">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h2>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            {mode === "login"
              ? "Pick up where you left off."
              : "A few details and you are ready to begin."}
          </p>
          {message && (
            <div className="mt-5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3 text-sm text-[var(--text-muted)] shadow-[var(--shadow-hairline)]">
              {message}
            </div>
          )}
          <form onSubmit={submit} className="mt-8 space-y-4">
            {mode === "register" && (
              <Field label="Username" value={username} onChange={setUsername} />
            )}
            <Field
              label={mode === "login" ? "Email or username" : "Email"}
              type={mode === "login" ? "text" : "email"}
              value={email}
              onChange={setEmail}
            />
            <Field
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
            />
            <button
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent-linear)] px-4 py-3 text-sm font-medium text-[var(--accent-contrast)] hover:bg-[var(--accent-linear-bright)]"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading
                ? "Please wait"
                : mode === "login"
                  ? "Log in"
                  : "Create account"}
            </button>
          </form>
          <button
            onClick={() => {
              const nextMode = mode === "login" ? "register" : "login";
              setMode(nextMode);
              window.location.hash = `auth/${nextMode}`;
              setMessage("");
            }}
            className="mt-6 text-sm text-[var(--text-muted)]"
          >
            {mode === "login"
              ? "Need an account? Create one"
              : "Already have an account? Log in"}
          </button>
        </div>
      </main>
    </div>
  );
}

function Field({
  label,
  type = "text",
  value,
  onChange,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium">{label}</span>
      <input
        required
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-faint)] focus:border-[var(--accent-linear)]"
      />
    </label>
  );
}

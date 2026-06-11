import React, { useState } from "react";
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
      if (data.token && data.user) onAuthSuccess(data.token, data.user);
      else setMessage(data.message || "Check your email to continue.");
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen bg-[#f5f6f8] lg:grid-cols-2">
      <aside className="hidden bg-[#17191d] p-12 text-white lg:flex lg:flex-col">
        <button onClick={onCancel} className="flex items-center gap-3 text-sm">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-white text-[#17191d]">
            <Folder className="h-4 w-4" />
          </div>
          Leeku
        </button>
        <div className="my-auto max-w-md">
          <p className="text-sm text-white/55">
            Your work, gathered thoughtfully.
          </p>
          <h1 className="mt-4 text-5xl font-semibold leading-[1.02] tracking-[-0.06em]">
            A calmer way to keep files close.
          </h1>
          <div className="mt-10 space-y-4 text-sm text-white/65">
            {[
              "Everything has one clear home.",
              "Sharing stays deliberate and easy.",
              "Your workspace stays out of the way.",
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
            className="mb-10 flex items-center gap-2 text-sm text-[#747b84] lg:hidden"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <h2 className="text-3xl font-semibold tracking-[-0.04em]">
            {mode === "login" ? "Welcome back" : "Create your workspace"}
          </h2>
          <p className="mt-2 text-sm text-[#7e858e]">
            {mode === "login"
              ? "Pick up where you left off."
              : "A few details and you are ready to begin."}
          </p>
          {message && (
            <div className="mt-5 rounded-lg border border-[#dfe3e8] bg-white p-3 text-sm text-[#606770]">
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
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#2f7ee6] px-4 py-3 text-sm font-medium text-white"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading
                ? "Please wait"
                : mode === "login"
                  ? "Log in"
                  : "Create workspace"}
            </button>
          </form>
          <button
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setMessage("");
            }}
            className="mt-6 text-sm text-[#6f7680]"
          >
            {mode === "login"
              ? "Need a workspace? Create one"
              : "Already have a workspace? Log in"}
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
        className="w-full rounded-lg border border-[#d8dde3] bg-white px-3 py-3 text-sm outline-none focus:border-[#9ba3ad]"
      />
    </label>
  );
}

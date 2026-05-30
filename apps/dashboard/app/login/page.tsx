"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setStatus("loading");
    setError("");

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (authError) {
      setStatus("error");
      setError(authError.message);
    } else {
      setStatus("sent");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="scan-line" />

      {/* Background glow */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 600px 400px at 50% 40%, rgba(245,158,11,0.04) 0%, transparent 70%)",
        }}
      />

      <div className="w-full max-w-sm relative">
        {/* Logo mark */}
        <div className="mb-10 opacity-0 animate-fade-up" style={{ animationFillMode: "forwards" }}>
          <div className="flex items-center gap-3 mb-1">
            <div
              className="w-8 h-8 flex items-center justify-center border"
              style={{ borderColor: "var(--amber)", color: "var(--amber)" }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M2 8L5 5L8 8L11 5L14 8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="square"
                />
                <path
                  d="M2 11L5 8L8 11L11 8L14 11"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="square"
                  opacity="0.4"
                />
              </svg>
            </div>
            <span
              className="font-display text-lg font-700 tracking-tight"
              style={{ color: "var(--text-primary)", fontFamily: "Syne, sans-serif", fontWeight: 700 }}
            >
              CONDUCTOR
            </span>
          </div>
          <p className="text-xs" style={{ color: "var(--text-secondary)", paddingLeft: "44px" }}>
            AI feature pipeline · control plane
          </p>
        </div>

        {/* Form card */}
        <div
          className="border p-6 opacity-0 animate-fade-up delay-100"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "var(--surface-raised)",
            animationFillMode: "forwards",
          }}
        >
          {status === "sent" ? (
            <div className="py-4">
              <div className="flex items-center gap-2 mb-3">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: "var(--amber)" }}
                />
                <span className="text-xs font-medium" style={{ color: "var(--amber)" }}>
                  LINK SENT
                </span>
              </div>
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                Check{" "}
                <span style={{ color: "var(--text-primary)" }}>{email}</span>
                {" "}for a magic link.
              </p>
              <p className="text-xs mt-3" style={{ color: "var(--text-dim)" }}>
                No email? Check spam, or{" "}
                <button
                  onClick={() => setStatus("idle")}
                  className="underline underline-offset-2"
                  style={{ color: "var(--text-secondary)" }}
                >
                  try again
                </button>
                .
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="mb-1">
                <label
                  htmlFor="email"
                  className="block text-xs uppercase tracking-widest mb-3"
                  style={{ color: "var(--text-dim)", letterSpacing: "0.12em" }}
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  disabled={status === "loading"}
                  className="w-full px-3 py-2.5 text-sm outline-none transition-all disabled:opacity-50"
                  style={{
                    backgroundColor: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text-primary)",
                    fontFamily: "JetBrains Mono, monospace",
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = "var(--amber)";
                    e.currentTarget.style.boxShadow = "0 0 0 1px var(--amber)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                />
              </div>

              {error && (
                <p className="text-xs mt-2" style={{ color: "var(--destructive)" }}>
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={status === "loading" || !email.trim()}
                className="mt-5 w-full py-2.5 text-xs uppercase tracking-widest font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: "var(--amber)",
                  color: "var(--surface)",
                  fontFamily: "JetBrains Mono, monospace",
                  letterSpacing: "0.12em",
                }}
                onMouseEnter={(e) => {
                  if (!e.currentTarget.disabled) {
                    e.currentTarget.style.backgroundColor = "#fbbf24";
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--amber)";
                }}
              >
                {status === "loading" ? "SENDING..." : "SEND MAGIC LINK →"}
              </button>
            </form>
          )}
        </div>

        {/* Footer */}
        <p
          className="mt-4 text-center text-xs opacity-0 animate-fade-up delay-200"
          style={{ color: "var(--text-dim)", animationFillMode: "forwards" }}
        >
          Single-user system · no signup
        </p>
      </div>
    </div>
  );
}

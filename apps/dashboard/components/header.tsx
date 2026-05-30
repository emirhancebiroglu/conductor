"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

export function Header({ user }: { user: User }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <header
      className="flex items-center justify-between px-6 py-3"
      style={{
        borderBottom: "1px solid var(--border)",
        backgroundColor: "var(--surface-raised)",
        minHeight: "48px",
      }}
    >
      {/* Breadcrumb / current section */}
      <div className="flex items-center gap-2">
        <span
          className="text-xs uppercase tracking-widest"
          style={{ color: "var(--text-dim)", letterSpacing: "0.12em", fontSize: "10px" }}
        >
          CONDUCTOR
        </span>
        <span style={{ color: "var(--text-dim)" }}>/</span>
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
          dashboard
        </span>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-4">
        {/* User email */}
        <span className="text-xs" style={{ color: "var(--text-dim)" }}>
          {user.email}
        </span>

        {/* Divider */}
        <div
          className="w-px h-4"
          style={{ backgroundColor: "var(--border)" }}
        />

        {/* Sign out */}
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          className="text-xs uppercase tracking-widest transition-colors disabled:opacity-40"
          style={{
            color: "var(--text-dim)",
            letterSpacing: "0.1em",
            fontSize: "10px",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--text-secondary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--text-dim)";
          }}
        >
          {signingOut ? "SIGNING OUT..." : "SIGN OUT"}
        </button>
      </div>
    </header>
  );
}

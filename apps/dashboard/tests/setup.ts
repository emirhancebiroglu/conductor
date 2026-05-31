import { vi } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

(process.env as Record<string, string>).NODE_ENV = "test";

const envPath = resolve(__dirname, "../.env.test");
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        (process.env as Record<string, string>)[key] = val;
      }
    }
  }
}

// Map NEXT_PUBLIC_SUPABASE_URL to SUPABASE_URL for createAdminClient
if (process.env.NEXT_PUBLIC_SUPABASE_URL && !process.env.SUPABASE_URL) {
  process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
}

vi.stubGlobal("structuredClone", (v: unknown) => JSON.parse(JSON.stringify(v)));

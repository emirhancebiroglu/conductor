import { createHash } from "node:crypto";

export type FingerprintInput = {
  source: string;
  package?: string | null;
  rule?: string | null;
  file?: string | null;
  line?: number | null;
  lineContent?: string | null;
};

export function fingerprint(input: FingerprintInput): string {
  const { source, package: pkg, rule, file, lineContent } = input;

  if (source === "sca") {
    const raw = `sca|${pkg ?? ""}|${rule ?? ""}`;
    return createHash("sha256").update(raw).digest("hex");
  }

  if (source === "sast") {
    const normalized = (lineContent ?? "").replace(/\s+/g, "");
    const raw = `sast|${rule ?? ""}|${file ?? ""}|${normalized}`;
    return createHash("sha256").update(raw).digest("hex");
  }

  const raw = `${source}|${rule ?? ""}|${file ?? ""}`;
  return createHash("sha256").update(raw).digest("hex");
}

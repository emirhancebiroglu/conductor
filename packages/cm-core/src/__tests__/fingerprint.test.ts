import { describe, it, expect } from "vitest";
import { fingerprint } from "../fingerprint.js";

describe("fingerprint", () => {
  describe("SCA findings", () => {
    const base = {
      source: "sca",
      package: "lodash",
      rule: "CVE-2024-1234",
    };

    it("produces a stable hash for SCA", () => {
      const a = fingerprint(base);
      const b = fingerprint(base);
      expect(a).toBe(b);
    });

    it("same package+rule = same fingerprint regardless of other fields", () => {
      const a = fingerprint({ ...base, file: "irrelevant.ts" });
      const b = fingerprint({ ...base });
      expect(a).toBe(b);
    });

    it("different package = different fingerprint", () => {
      const a = fingerprint(base);
      const b = fingerprint({ ...base, package: "express" });
      expect(a).not.toBe(b);
    });

    it("different rule = different fingerprint", () => {
      const a = fingerprint(base);
      const b = fingerprint({ ...base, rule: "CVE-2025-5678" });
      expect(a).not.toBe(b);
    });
  });

  describe("SAST findings", () => {
    const base = {
      source: "sast",
      rule: "SQL Injection",
      file: "src/users.ts",
      lineContent: "  db.query(\"SELECT * FROM users WHERE id = \" + userId)  ",
    };

    it("produces a stable hash for SAST", () => {
      const a = fingerprint(base);
      const b = fingerprint(base);
      expect(a).toBe(b);
    });

    it("whitespace-insensitive: extra spaces inside content = same fingerprint", () => {
      const a = fingerprint(base);
      const b = fingerprint({
        ...base,
        lineContent: '  db.query(  "SELECT * FROM users WHERE id = " + userId  )  ',
      });
      expect(a).toBe(b);
    });

    it("different file = different fingerprint", () => {
      const a = fingerprint(base);
      const b = fingerprint({ ...base, file: "src/admin.ts" });
      expect(a).not.toBe(b);
    });

    it("different line content = different fingerprint", () => {
      const a = fingerprint(base);
      const b = fingerprint({
        ...base,
        lineContent: 'db.query("SELECT * FROM users WHERE id = $1", [userId])',
      });
      expect(a).not.toBe(b);
    });

    it("missing lineContent still produces a hash", () => {
      const result = fingerprint({
        source: "sast",
        rule: "XSS",
        file: "src/app.tsx",
      });
      expect(result).toBeTruthy();
      expect(result.length).toBe(64);
    });
  });

  it("produces a 64-char hex string (SHA-256)", () => {
    const result = fingerprint({ source: "sca", package: "axios", rule: "CVE-2024-0001" });
    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });

  it("different sources produce different fingerprints even with same fields", () => {
    const sca = fingerprint({ source: "sca", package: "pkg", rule: "CVE-1" });
    const sast = fingerprint({ source: "sast", rule: "CVE-1", file: "f.ts", lineContent: "x" });
    expect(sca).not.toBe(sast);
  });
});

import { describe, it, expect } from "vitest";
import { parseCheckmarxResults } from "../parser.js";
import scaFixture from "../__fixtures__/checkmarx-sca.json" with { type: "json" };
import sastFixture from "../__fixtures__/checkmarx-sast.json" with { type: "json" };
import cleanFixture from "../__fixtures__/clean-rescan.json" with { type: "json" };

describe("parseCheckmarxResults", () => {
  describe("SCA fixture", () => {
    const findings = parseCheckmarxResults(scaFixture);

    it("returns 4 findings from the SCA fixture", () => {
      expect(findings).toHaveLength(4);
    });

    it("maps all findings as sca source", () => {
      for (const f of findings) {
        expect(f.source).toBe("sca");
      }
    });

    it("maps package names correctly", () => {
      const lodash = findings.find((f) => f.package === "lodash");
      expect(lodash).toBeDefined();
      expect(lodash!.currentVersion).toBe("4.17.20");
      expect(lodash!.fixedVersion).toBe("4.17.21");
    });

    it("maps severities correctly", () => {
      const critical = findings.find((f) => f.package === "lodash");
      expect(critical!.severity).toBe("CRITICAL");

      const high = findings.find((f) => f.package === "axios");
      expect(high!.severity).toBe("HIGH");

      const medium = findings.find((f) => f.package === "minimist");
      expect(medium!.severity).toBe("MEDIUM");
    });

    it("computes a stable fingerprint for each finding", () => {
      for (const f of findings) {
        expect(f.fingerprint).toBeTruthy();
        expect(f.fingerprint).toMatch(/^[a-f0-9]{64}$/);
      }
    });

    it("CRITICAL + HIGH findings are actionable (3 out of 4)", () => {
      const actionable = findings.filter((f) => f.severity === "CRITICAL" || f.severity === "HIGH");
      expect(actionable).toHaveLength(3);
    });
  });

  describe("SAST fixture", () => {
    const findings = parseCheckmarxResults(sastFixture);

    it("returns 3 findings from the SAST fixture", () => {
      expect(findings).toHaveLength(3);
    });

    it("maps all findings as sast source", () => {
      for (const f of findings) {
        expect(f.source).toBe("sast");
      }
    });

    it("maps file and line numbers correctly", () => {
      const sqli = findings.find((f) => f.rule === "SQL Injection");
      expect(sqli).toBeDefined();
      expect(sqli!.file).toBe("src/users.ts");
      expect(sqli!.line).toBe(42);
    });

    it("maps severities correctly", () => {
      const xss = findings.find((f) => f.rule === "Stored XSS");
      expect(xss!.severity).toBe("CRITICAL");

      const sqli = findings.find((f) => f.rule === "SQL Injection");
      expect(sqli!.severity).toBe("HIGH");

      const rand = findings.find((f) => f.rule === "Insecure Randomness");
      expect(rand!.severity).toBe("MEDIUM");
    });

    it("computes a stable fingerprint for each finding", () => {
      for (const f of findings) {
        expect(f.fingerprint).toBeTruthy();
        expect(f.fingerprint).toMatch(/^[a-f0-9]{64}$/);
      }
    });

    it("CRITICAL + HIGH findings are actionable (2 out of 3)", () => {
      const actionable = findings.filter((f) => f.severity === "CRITICAL" || f.severity === "HIGH");
      expect(actionable).toHaveLength(2);
    });
  });

  describe("clean fixture", () => {
    it("returns 0 findings", () => {
      const findings = parseCheckmarxResults(cleanFixture);
      expect(findings).toHaveLength(0);
    });

    it("returns 0 actionable findings", () => {
      const findings = parseCheckmarxResults(cleanFixture);
      const actionable = findings.filter(
        (f) => f.severity === "CRITICAL" || f.severity === "HIGH",
      );
      expect(actionable).toHaveLength(0);
    });
  });

  describe("shapes and invariants", () => {
    it("returns findings with fixStatus = 'open'", () => {
      const scaFindings = parseCheckmarxResults(scaFixture);
      for (const f of scaFindings) {
        expect(f.fixStatus).toBe("open");
      }
    });

    it("returns findings with fixAttempts = 0", () => {
      const sastFindings = parseCheckmarxResults(sastFixture);
      for (const f of sastFindings) {
        expect(f.fixAttempts).toBe(0);
      }
    });

    it("SAST findings have file+line but no package", () => {
      const findings = parseCheckmarxResults(sastFixture);
      for (const f of findings) {
        expect(f.file).toBeTruthy();
        expect(f.line).toBeGreaterThan(0);
        expect(f.package).toBeNull();
      }
    });

    it("SCA findings have package+versions but no file+line", () => {
      const findings = parseCheckmarxResults(scaFixture);
      for (const f of findings) {
        expect(f.package).toBeTruthy();
        expect(f.currentVersion).toBeTruthy();
        expect(f.fixedVersion).toBeTruthy();
        expect(f.file).toBeNull();
        expect(f.line).toBeNull();
      }
    });
  });
});

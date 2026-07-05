import { describe, it, expect } from "vitest";
import { extractErrorSignature, signaturesMatch } from "../pipeline/build-runner.js";

const MS_IMEI_OUTPUT = `$ mvn install -DskipTests
[INFO] --- frontend:1.15.1:npm (npm install) @ imei ---
[INFO] Running 'npm install --legacy-peer-deps' in C:\\Users\\emirh\\ms-imei\\client
[INFO] npm ERR! code ENOVERSIONS
[INFO] npm ERR! No versions available for react-flexy-loader
[INFO]
[INFO] npm ERR! A complete log of this run can be found in: C:\\Users\\emirh\\AppData\\Local\\npm-cache\\_logs\\2026-07-04T13_25_50_682Z-debug-0.log
[INFO] Reactor Summary for imei-root 0.6.92-imei:
[ERROR] Failed to execute goal com.github.eirslett:frontend-maven-plugin:1.15.1:npm (npm install) on project imei: Failed to run task: 'npm install --legacy-peer-deps' failed.
[INFO] BUILD FAILURE`;

const MS_TASIER_OUTPUT = `$ mvn install -DskipTests
[INFO] --- frontend:1.15.1:npm (npm install) @ tasier ---
[INFO] Running 'npm install --legacy-peer-deps' in D:\\repos\\ms-tasier\\client
[INFO] npm ERR! code ENOVERSIONS
[INFO] npm ERR! No versions available for react-flexy-table
[INFO]
[INFO] npm ERR! A complete log of this run can be found in: D:\\logs\\2026-07-04T13_27_16_202Z-debug-0.log
[ERROR] Failed to execute goal com.github.eirslett:frontend-maven-plugin:1.15.1:npm (npm install) on project tasier: Failed to run task: 'npm install --legacy-peer-deps' failed.
[INFO] BUILD FAILURE`;

describe("extractErrorSignature", () => {
  it("extracts the npm ENOVERSIONS failure that was previously missed by an agent (ms-imei case)", () => {
    const sig = extractErrorSignature(MS_IMEI_OUTPUT);
    expect(sig.some((l) => l.includes("ENOVERSIONS"))).toBe(true);
    expect(sig.some((l) => l.includes("No versions available for react-flexy-loader"))).toBe(true);
    expect(sig.some((l) => l.includes("BUILD FAILURE"))).toBe(true);
  });

  it("extracts the equivalent failure for ms-tasier (different package, same shape)", () => {
    const sig = extractErrorSignature(MS_TASIER_OUTPUT);
    expect(sig.some((l) => l.includes("ENOVERSIONS"))).toBe(true);
    expect(sig.some((l) => l.includes("No versions available for react-flexy-table"))).toBe(true);
  });

  it("normalizes absolute paths so the same underlying failure matches across different temp clones", () => {
    const sigA = extractErrorSignature("[ERROR] failed at C:\\Users\\a\\cm-worker-abc123\\repo\\pom.xml\nBUILD FAILURE");
    const sigB = extractErrorSignature("[ERROR] failed at D:\\other\\fix-graph-test-xyz789\\repo\\pom.xml\nBUILD FAILURE");
    expect(sigA).toEqual(sigB);
  });

  it("returns an empty signature for clean output", () => {
    expect(extractErrorSignature("BUILD SUCCESS\nall tests passed")).toEqual([]);
  });

  it("dedupes repeated occurrences of the same marker", () => {
    const sig = extractErrorSignature("npm ERR! code E404\nnpm ERR! code E404\nnpm ERR! code E404");
    expect(sig.filter((l) => l.includes("E404")).length).toBeGreaterThan(0);
    // no duplicate identical lines
    expect(new Set(sig).size).toBe(sig.length);
  });
});

describe("signaturesMatch", () => {
  it("matches identical sets regardless of order", () => {
    expect(signaturesMatch(["a", "b", "c"], ["c", "a", "b"])).toBe(true);
  });

  it("does not match different sets", () => {
    expect(signaturesMatch(["a", "b"], ["a", "c"])).toBe(false);
  });

  it("does not match different lengths", () => {
    expect(signaturesMatch(["a"], ["a", "b"])).toBe(false);
  });

  it("ms-imei and ms-tasier signatures do NOT match each other (different package names)", () => {
    const sigImei = extractErrorSignature(MS_IMEI_OUTPUT);
    const sigTasier = extractErrorSignature(MS_TASIER_OUTPUT);
    expect(signaturesMatch(sigImei, sigTasier)).toBe(false);
  });

  it("the same repo's build failing twice for the same reason DOES match", () => {
    const first = extractErrorSignature(MS_IMEI_OUTPUT);
    const second = extractErrorSignature(MS_IMEI_OUTPUT.replace("cm-worker-abc", "cm-worker-def"));
    expect(signaturesMatch(first, second)).toBe(true);
  });
});

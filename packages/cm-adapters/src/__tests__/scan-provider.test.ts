import { describe, it, expect } from "vitest";
import { MockScanProvider } from "../mock-scan-provider.js";

describe("MockScanProvider", () => {
  it("scan returns an externalScanId", async () => {
    const provider = new MockScanProvider();
    const result = await provider.scan({ owner: "test", name: "ms-test-repo" }, "main");
    expect(result.externalScanId).toBeTruthy();
    expect(result.externalScanId).toContain("mock-scan");
  });

  it("first fetch returns findings", async () => {
    const provider = new MockScanProvider();
    await provider.scan({ owner: "test", name: "ms-test-repo" }, "main");
    const findings = await provider.fetchResults("mock-scan-1");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]).toHaveProperty("fingerprint");
    expect(findings[0]).toHaveProperty("severity");
    expect(findings[0]).toHaveProperty("source");
  });

  it("second fetch (rescan) returns clean (empty)", async () => {
    const provider = new MockScanProvider();
    await provider.scan({ owner: "test", name: "ms-test-repo" }, "main");

    const first = await provider.fetchResults("mock-scan-1");
    expect(first.length).toBeGreaterThan(0);

    const second = await provider.fetchResults("mock-scan-1");
    expect(second).toHaveLength(0);
  });

  it("reset restores fetchCount to zero", async () => {
    const provider = new MockScanProvider();
    await provider.scan({ owner: "test", name: "ms-test-repo" }, "main");

    await provider.fetchResults("mock-scan-1");
    const first = await provider.fetchResults("mock-scan-1");
    expect(first).toHaveLength(0);

    provider.reset();
    const afterReset = await provider.fetchResults("mock-scan-2");
    expect(afterReset.length).toBeGreaterThan(0);
  });

  it("satisfies the ScanProvider contract", () => {
    const provider = new MockScanProvider();
    expect(typeof provider.scan).toBe("function");
    expect(typeof provider.fetchResults).toBe("function");
  });
});

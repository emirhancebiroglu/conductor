"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCmPipeline } from "@/lib/hooks/use-cm-pipeline";

type PipelineData = {
  id?: string;
  enabled: boolean;
  cron: string;
  github_owner: string;
  github_token_env: string;
  discovery_name_prefix: string;
  discovery_config_path: string;
  branch_exclude_pattern: string;
  severity_threshold: string[];
  sca_test_policy: string;
  fix_branch: string;
  report_dir: string;
  retry_cooldown_seconds: number;
  max_fix_attempts: number;
  name?: string;
};

const DEFAULT_PIPELINE: PipelineData = {
  enabled: false,
  cron: "0 0 * * *",
  github_owner: "",
  github_token_env: "GITHUB_TOKEN_WORK",
  discovery_name_prefix: "ms",
  discovery_config_path: ".github/checkmarx_scan.yml",
  branch_exclude_pattern: "*kubernetes*,*k8s*",
  severity_threshold: ["CRITICAL", "HIGH"],
  sca_test_policy: "skip-minor",
  fix_branch: "checkmarx-auto",
  report_dir: "D:/checkmarx-reports",
  retry_cooldown_seconds: 1800,
  max_fix_attempts: 2,
};

const SEVERITY_OPTIONS = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

function parseCronExpression(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return "Invalid cron expression";
  if (parts[0] === "0" && parts[1] === "0" && parts[2] === "*" && parts[3] === "*" && parts[4] === "*") return "Daily at midnight";
  if (parts[0] === "0" && parts[2] === "*" && parts[3] === "*" && parts[4] === "*") return `Daily at ${parts[1]}:00`;
  return `Cron: ${cron}`;
}

function isValidCron(cron: string): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return parts.every((p) => /^(\*|\d+|\d+\/\d+|\d+-\d+|\*\/\d+)$/.test(p));
}

function parsePipelineJson(json: unknown): PipelineData | null {
  if (!json || typeof json !== "object" || !("id" in json)) return null;
  const j = json as Record<string, unknown>;
  return {
    id: j.id as string,
    enabled: (j.enabled as boolean) ?? false,
    cron: (j.cron as string) ?? "0 0 * * *",
    github_owner: (j.github_owner as string) ?? "",
    github_token_env: (j.github_token_env as string) ?? "GITHUB_TOKEN_WORK",
    discovery_name_prefix: (j.discovery_name_prefix as string) ?? "ms",
    discovery_config_path: (j.discovery_config_path as string) ?? ".github/checkmarx_scan.yml",
    branch_exclude_pattern: (j.branch_exclude_pattern as string) ?? "*kubernetes*,*k8s*",
    severity_threshold: (j.severity_threshold as string[]) ?? ["CRITICAL", "HIGH"],
    sca_test_policy: (j.sca_test_policy as string) ?? "skip-minor",
    fix_branch: (j.fix_branch as string) ?? "checkmarx-auto",
    report_dir: (j.report_dir as string) ?? "D:/checkmarx-reports",
    retry_cooldown_seconds: (j.retry_cooldown_seconds as number) ?? 1800,
    max_fix_attempts: (j.max_fix_attempts as number) ?? 2,
  };
}

export function CmPipelineForm() {
  const { pipeline: rawPipeline, isLoading } = useCmPipeline();
  const [data, setData] = useState<PipelineData>(DEFAULT_PIPELINE);
  const [original, setOriginal] = useState<PipelineData>(DEFAULT_PIPELINE);
  const [isSaving, setIsSaving] = useState(false);
  const initializedRef = useRef(false);

  // Sync from SWR on first load; don't override while user is editing
  useEffect(() => {
    if (!initializedRef.current && rawPipeline) {
      const parsed = parsePipelineJson(rawPipeline);
      if (parsed) {
        setData(parsed);
        setOriginal(parsed);
        initializedRef.current = true;
      }
    }
  }, [rawPipeline]);

  const isDirty = JSON.stringify(data) !== JSON.stringify(original);

  const update = useCallback(<K extends keyof PipelineData>(key: K, value: PipelineData[K]) => {
    setData((prev) => ({ ...prev, [key]: value }));
  }, []);

  const toggleSeverity = (sev: string) => {
    setData((prev) => {
      const current = prev.severity_threshold;
      const next = current.includes(sev)
        ? current.filter((s) => s !== sev)
        : [...current, sev];
      if (next.length === 0) return prev;
      return { ...prev, severity_threshold: next };
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch("/api/cm/pipeline", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      setOriginal({ ...data });
      toast.success("Pipeline settings saved");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setData({ ...original });
    toast.info("Changes discarded");
  };

  const cronInvalid = data.cron && !isValidCron(data.cron);

  if (isLoading && !initializedRef.current) {
    return <div className="cm-placeholder" style={{ padding: "40px", textAlign: "center", color: "var(--text-dim)" }}>Loading pipeline settings...</div>;
  }

  return (
    <div className="pipeline-form">
      {/* Auto-mode toggle */}
      <div className="pf-toggle-row">
        <div>
          <span className="pf-toggle-label" style={{ color: data.enabled ? "#34d399" : "var(--text-secondary)" }}>
            {data.enabled ? "Auto-mode Active" : "Auto-mode Disabled"}
          </span>
          <p className="pf-toggle-desc">When enabled, scans run automatically per the cron schedule. Default: OFF (manual trigger only).</p>
        </div>
        <Switch checked={data.enabled} onCheckedChange={(v) => update("enabled", v)} />
      </div>

      <div className="pf-rule" />

      {/* Cron */}
      <div className="pf-field">
        <Label className="pf-label">Auto-scan Schedule (Cron)</Label>
        <Input
          value={data.cron}
          onChange={(e) => update("cron", e.target.value)}
          className="pf-input"
          placeholder="0 0 * * *"
        />
        {cronInvalid && <p className="pf-error">Invalid cron format — expected 5 fields</p>}
        <p className="pf-hint">{data.cron ? parseCronExpression(data.cron) : "Enter a cron expression"}</p>
      </div>

      <div className="pf-rule" />

      {/* Severity Threshold */}
      <div className="pf-field">
        <Label className="pf-label">Severity Threshold</Label>
        <p className="pf-hint" style={{ marginBottom: "8px" }}>Only findings at or above selected severities are actionable.</p>
        <div className="pf-chip-group">
          {SEVERITY_OPTIONS.map((sev) => {
            const selected = data.severity_threshold.includes(sev);
            return (
              <button
                key={sev}
                onClick={() => toggleSeverity(sev)}
                className="pf-chip"
                style={{
                  backgroundColor: selected ? "var(--amber)" : "var(--surface-overlay)",
                  color: selected ? "var(--surface)" : "var(--text-secondary)",
                  borderColor: selected ? "var(--amber)" : "var(--border)",
                }}
              >
                {sev}
              </button>
            );
          })}
        </div>
      </div>

      <div className="pf-rule" />

      {/* SCA Test Policy */}
      <div className="pf-field">
        <Label className="pf-label">SCA Test Policy</Label>
        <Select value={data.sca_test_policy} onValueChange={(v) => update("sca_test_policy", v)}>
          <SelectTrigger className="pf-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="skip-minor">Skip minor upgrades</SelectItem>
            <SelectItem value="test-all">Test all upgrades</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="pf-rule" />

      {/* GitHub */}
      <div className="pf-grid-2">
        <div className="pf-field">
          <Label className="pf-label">GitHub Owner (Org or User)</Label>
          <Input value={data.github_owner} onChange={(e) => update("github_owner", e.target.value)} className="pf-input" placeholder="Toyota-Europe" />
          <p className="pf-hint">GitHub org or user whose repos are scanned.</p>
        </div>
        <div className="pf-field">
          <Label className="pf-label">GitHub Token Env Var</Label>
          <Input value={data.github_token_env} onChange={(e) => update("github_token_env", e.target.value)} className="pf-input" placeholder="GITHUB_TOKEN_WORK" />
          <p className="pf-hint">Name of the env var holding the GitHub PAT (e.g. GITHUB_TOKEN_WORK, GITHUB_TOKEN_PERSONAL).</p>
        </div>
      </div>

      <div className="pf-rule" />

      {/* Discovery */}
      <div className="pf-grid-2">
        <div className="pf-field">
          <Label className="pf-label">Name Prefix</Label>
          <Input value={data.discovery_name_prefix} onChange={(e) => update("discovery_name_prefix", e.target.value)} className="pf-input" />
          <p className="pf-hint">Repo names starting with this prefix are auto-discovered.</p>
        </div>
        <div className="pf-field">
          <Label className="pf-label">Config Path</Label>
          <Input value={data.discovery_config_path} onChange={(e) => update("discovery_config_path", e.target.value)} className="pf-input" />
          <p className="pf-hint">Path to config file that marks a repo as scan-ready.</p>
        </div>
      </div>
      <div className="pf-field" style={{ marginTop: "12px" }}>
        <Label className="pf-label">Branch Exclude Pattern</Label>
        <Input
          value={data.branch_exclude_pattern}
          onChange={(e) => update("branch_exclude_pattern", e.target.value)}
          className="pf-input"
          placeholder="*kubernetes*,*k8s*"
        />
        <p className="pf-hint">Comma-separated patterns. Branches matching any pattern are skipped during branch selection.</p>
      </div>

      <div className="pf-rule" />

      {/* Fix settings */}
      <div className="pf-grid-2">
        <div className="pf-field">
          <Label className="pf-label">Fix Branch</Label>
          <Input value={data.fix_branch} onChange={(e) => update("fix_branch", e.target.value)} className="pf-input" />
        </div>
        <div className="pf-field">
          <Label className="pf-label">Report Directory</Label>
          <Input value={data.report_dir} onChange={(e) => update("report_dir", e.target.value)} className="pf-input" />
        </div>
      </div>

      <div className="pf-rule" />

      {/* Retry + attempts */}
      <div className="pf-grid-2">
        <div className="pf-field">
          <Label className="pf-label">Retry Cooldown (seconds)</Label>
          <Input
            type="number"
            min={0}
            value={data.retry_cooldown_seconds}
            onChange={(e) => update("retry_cooldown_seconds", parseInt(e.target.value, 10) || 0)}
            className="pf-input"
          />
        </div>
        <div className="pf-field">
          <Label className="pf-label">Max Fix Attempts</Label>
          <Input
            type="number"
            min={1}
            value={data.max_fix_attempts}
            onChange={(e) => update("max_fix_attempts", parseInt(e.target.value, 10) || 1)}
            className="pf-input"
          />
        </div>
      </div>

      <div className="pf-rule" />

      {/* Actions */}
      <div className="pf-actions">
        <Button variant="outline" disabled={!isDirty || isSaving} onClick={handleReset} className="pf-btn pf-btn--ghost">
          Discard
        </Button>
        <Button
          disabled={!isDirty || isSaving || !!cronInvalid}
          onClick={handleSave}
          className="pf-btn pf-btn--primary"
          style={{
            backgroundColor: !isDirty || isSaving || !!cronInvalid ? "var(--surface-overlay)" : "var(--amber)",
            color: !isDirty || isSaving || !!cronInvalid ? "var(--text-dim)" : "var(--surface)",
            borderColor: !isDirty || isSaving || !!cronInvalid ? "var(--border)" : "var(--amber)",
          }}
        >
          {isSaving ? "Saving..." : "Save Changes"}
          {isDirty && !isSaving && <span className="pf-dirty-dot" />}
        </Button>
      </div>

      <style jsx>{`
        .pipeline-form { max-width: 680px; }
        .pf-toggle-row { display: flex; justify-content: space-between; align-items: center; padding: 16px 0; }
        .pf-toggle-label { font-size: 13px; font-weight: 500; }
        .pf-toggle-desc { font-size: 11px; color: var(--text-dim); margin: 2px 0 0 0; }
        .pf-field { margin-bottom: 16px; }
        .pf-label { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-secondary); margin-bottom: 6px; display: block; }
        .pf-input { width: 100%; }
        .pf-select { width: 100%; }
        .pf-hint { font-size: 11px; color: var(--text-dim); margin: 4px 0 0 0; }
        .pf-error { font-size: 11px; color: #f87171; margin: 4px 0 0 0; }
        .pf-rule { height: 1px; background: var(--border); margin: 16px 0; }
        .pf-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .pf-chip-group { display: flex; gap: 8px; flex-wrap: wrap; }
        .pf-chip { padding: 6px 16px; font-size: 11px; font-family: var(--font-geist-mono), monospace; border: 1px solid; border-radius: 4px; cursor: pointer; transition: all 0.15s; letter-spacing: 0.04em; }
        .pf-actions { display: flex; gap: 8px; justify-content: flex-end; padding-top: 8px; }
        .pf-btn { font-size: 12px; padding: 8px 20px; }
        .pf-btn--ghost { background: transparent; border: 1px solid var(--border); color: var(--text-secondary); }
        .pf-dirty-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--amber); margin-left: 6px; vertical-align: middle; }
      `}</style>
    </div>
  );
}

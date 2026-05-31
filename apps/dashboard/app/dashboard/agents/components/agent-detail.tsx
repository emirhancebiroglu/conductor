"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AgentConfig, ProviderModel, RunningJob, Lane } from "@conductor/core";
import { ModelSelector } from "./model-selector";
import { PromptEditor } from "./prompt-editor";

interface AgentDetailProps {
  readonly agent: AgentConfig;
  readonly providerModels: ProviderModel[];
  readonly runningJob?: RunningJob;
  readonly lastRun?: {
    id: string;
    jobId: string;
    jobTitle: string;
    status: string;
    createdAt: string;
  };
  readonly onDirtyChange: (dirty: boolean) => void;
  readonly onSaveSuccess: (updatedAgent: AgentConfig) => void;
  readonly agents?: AgentConfig[];
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function AgentDetail({
  agent,
  providerModels,
  runningJob,
  lastRun,
  onDirtyChange,
  onSaveSuccess,
  agents,
}: AgentDetailProps) {
  const [displayName, setDisplayName] = useState<string>(agent.displayName);
  const [role, setRole] = useState<string>(agent.role);
  const [provider, setProvider] = useState<string>(agent.provider);
  const [model, setModel] = useState<string>(agent.model);
  const [systemPrompt, setSystemPrompt] = useState<string>(agent.systemPrompt);
  const [skillContent, setSkillContent] = useState<string | null>(agent.skillContent);
  const [laneOverride, setLaneOverride] = useState<Lane | null>(agent.laneOverride);
  const [order, setOrder] = useState<number>(agent.order);
  const [enabled, setEnabled] = useState<boolean>(agent.enabled);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [elapsedTime, setElapsedTime] = useState<string>("");

  useEffect(() => {
    setDisplayName(agent.displayName);
    setRole(agent.role);
    setProvider(agent.provider);
    setModel(agent.model);
    setSystemPrompt(agent.systemPrompt);
    setSkillContent(agent.skillContent);
    setLaneOverride(agent.laneOverride);
    setOrder(agent.order);
    setEnabled(agent.enabled);
  }, [agent]);

  const isDirty =
    displayName !== agent.displayName ||
    role !== agent.role ||
    provider !== agent.provider ||
    model !== agent.model ||
    systemPrompt !== agent.systemPrompt ||
    skillContent !== agent.skillContent ||
    laneOverride !== agent.laneOverride ||
    order !== agent.order ||
    enabled !== agent.enabled;

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    let interval: NodeJS.Timeout | undefined;
    if (runningJob) {
      const update = () => {
        const diffMs = Math.max(0, Date.now() - new Date(runningJob.startedAt).getTime());
        const s = Math.floor(diffMs / 1000);
        setElapsedTime(`${Math.floor(s / 60)}m ${s % 60}s`);
      };
      update();
      interval = setInterval(update, 1000);
    } else {
      setElapsedTime("");
    }
    return () => { if (interval) clearInterval(interval); };
  }, [runningJob]);

  const isLastEnabledAgent = (() => {
    if (!agents) return false;
    return agents.filter((a) => a.enabled).length <= 1 && agent.enabled;
  })();

  const allAgentsDisabled = agents ? agents.every((a) => !a.enabled) : false;

  const isModelUnavailable =
    providerModels.filter((pm) => pm.provider === provider && pm.modelId === model).length === 0;

  const isDisplayNameInvalid = displayName.trim().length === 0;
  const isRoleInvalid = role.trim().length === 0;
  const isPromptTooShort = systemPrompt.trim().length < 10;

  const isSaveDisabled =
    !isDirty ||
    isDisplayNameInvalid ||
    isRoleInvalid ||
    isPromptTooShort ||
    isSaving ||
    (isLastEnabledAgent && !enabled);

  const handleReset = () => {
    setDisplayName(agent.displayName);
    setRole(agent.role);
    setProvider(agent.provider);
    setModel(agent.model);
    setSystemPrompt(agent.systemPrompt);
    setSkillContent(agent.skillContent);
    setLaneOverride(agent.laneOverride);
    setOrder(agent.order);
    setEnabled(agent.enabled);
    toast.info("Changes discarded", { description: "Configuration reverted to saved state.", duration: 4000 });
  };

  const handleSave = async () => {
    if (isSaveDisabled) return;

    if (isDisplayNameInvalid) {
      toast.warning("Validation error", { description: "Display name cannot be empty.", duration: 8000 });
      return;
    }
    if (isRoleInvalid) {
      toast.warning("Validation error", { description: "Role description cannot be empty.", duration: 8000 });
      return;
    }
    if (isPromptTooShort) {
      toast.warning("Validation error", { description: "System prompt must be at least 10 characters.", duration: 8000 });
      return;
    }

    setIsSaving(true);

    try {
      let updatedAgent: AgentConfig = agent;

      const hasFieldsChanged =
        displayName !== agent.displayName ||
        role !== agent.role ||
        provider !== agent.provider ||
        model !== agent.model ||
        systemPrompt !== agent.systemPrompt ||
        skillContent !== agent.skillContent ||
        laneOverride !== agent.laneOverride ||
        order !== agent.order;

      if (hasFieldsChanged) {
        const response = await fetch(`/api/agents/${agent.agentName}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName: displayName.trim(),
            role: role.trim(),
            provider,
            model,
            systemPrompt,
            skillContent: skillContent?.trim() || null,
            laneOverride,
            order,
          }),
        });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || "Failed to update agent details");
        updatedAgent = json.agent;
      }

      if (enabled !== agent.enabled) {
        const response = await fetch(`/api/agents/${agent.agentName}`, { method: "PATCH" });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || "Failed to toggle agent status");
        updatedAgent = json.agent;
      }

      onSaveSuccess(updatedAgent);

      const hasRuntimeChanges =
        provider !== agent.provider ||
        model !== agent.model ||
        systemPrompt !== agent.systemPrompt ||
        laneOverride !== agent.laneOverride ||
        enabled !== agent.enabled;

      toast.success("Configuration saved", {
        description: hasRuntimeChanges
          ? "Changes will take effect on the next job run."
          : "All changes saved successfully.",
        duration: 4000,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "An unexpected error occurred while saving";
      toast.error("Save failed", { description: message, duration: 8000 });
    } finally {
      setIsSaving(false);
    }
  };

  const lastRunStatusColor = (s: string) => {
    if (s === "failed") return "#f87171";
    if (s === "started") return "var(--amber)";
    return "#34d399";
  };

  return (
    <div className="detail-panel">
      {/* ── Header ── */}
      <div className="detail-header">
        <div>
          <span className="detail-eyebrow">Agent Specification</span>
          <h2 className="detail-agent-name">{agent.agentName}</h2>
        </div>

        <div className="detail-actions">
          <Button
            variant="outline"
            disabled={!isDirty || isSaving}
            onClick={handleReset}
            className="detail-btn detail-btn--ghost"
          >
            Discard
          </Button>

          <Button
            disabled={isSaveDisabled}
            onClick={handleSave}
            className="detail-btn detail-btn--primary"
            style={{
              backgroundColor: isSaveDisabled ? "var(--surface-overlay)" : "var(--amber)",
              color: isSaveDisabled ? "var(--text-dim)" : "var(--surface)",
              borderColor: isSaveDisabled ? "var(--border)" : "var(--amber)",
            }}
          >
            {isSaving ? "Saving…" : "Save Changes"}
            {isDirty && !isSaving && <span className="detail-dirty-dot" />}
          </Button>
        </div>
      </div>

      {/* ── Warning Banners ── */}
      {allAgentsDisabled && (
        <div className="detail-banner detail-banner--error">
          <span className="detail-banner-icon">⚠</span>
          <div>
            <p className="detail-banner-title">All agents disabled</p>
            <p className="detail-banner-body">Pipeline cannot run until at least one agent is enabled.</p>
          </div>
        </div>
      )}

      {isModelUnavailable && (
        <div className="detail-banner detail-banner--warn">
          <span className="detail-banner-icon">⚠</span>
          <div>
            <p className="detail-banner-title">Model unavailable</p>
            <p className="detail-banner-body">
              <code>{model}</code> is no longer available for <code>{provider}</code>. Select a different model or add it via Providers.
            </p>
          </div>
        </div>
      )}

      {/* ── Sections ── */}
      <div className="detail-sections">

        {/* Identity */}
        <section className="detail-section">
          <h3 className="detail-section-title">Identity</h3>
          <div className="detail-grid-12">
            <div className="detail-col-8 detail-field">
              <Label htmlFor="display-name" className="detail-label">Display Name</Label>
              <Input
                id="display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Agent Display Name"
                className="detail-input"
              />
              {isDisplayNameInvalid && <p className="detail-field-error">Required</p>}
            </div>
            <div className="detail-col-4 detail-field">
              <Label htmlFor="pipeline-order" className="detail-label">Order</Label>
              <Input
                id="pipeline-order"
                type="number"
                min={0}
                value={order}
                onChange={(e) => setOrder(parseInt(e.target.value, 10) || 0)}
                className="detail-input"
              />
            </div>
          </div>

          <div className="detail-field">
            <Label htmlFor="agent-role" className="detail-label">Role</Label>
            <Input
              id="agent-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Conducts codebase reviews and security analysis"
              className="detail-input"
            />
            {isRoleInvalid && <p className="detail-field-error">Required</p>}
          </div>
        </section>

        <div className="detail-rule" />

        {/* Model & Routing */}
        <section className="detail-section">
          <h3 className="detail-section-title">Model & Routing</h3>
          <div className="detail-grid-3">
            <div className="detail-col-2">
              <ModelSelector
                currentProvider={provider}
                currentModel={model}
                providerModels={providerModels}
                onChange={(p, m) => { setProvider(p); setModel(m); }}
              />
            </div>
            <div className="detail-field">
              <Label className="detail-label">Lane Preference</Label>
              <Select
                value={laneOverride || "auto"}
                onValueChange={(val) => setLaneOverride(val === "auto" ? null : (val as Lane))}
              >
                <SelectTrigger className="detail-select-trigger">
                  <SelectValue placeholder="Lane Override" />
                </SelectTrigger>
                <SelectContent className="detail-select-content">
                  <SelectItem value="auto" className="detail-select-item">Auto (Router decides)</SelectItem>
                  <SelectItem value="cheap" className="detail-select-item">Force Cheap</SelectItem>
                  <SelectItem value="premium" className="detail-select-item">Force Premium</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <div className="detail-rule" />

        {/* System Prompt */}
        <section className="detail-section">
          <PromptEditor
            value={systemPrompt}
            onChange={setSystemPrompt}
            placeholder="Write the instruction framework for this agent…"
          />
          {isPromptTooShort && (
            <p className="detail-field-error" style={{ marginTop: "6px" }}>Minimum 10 characters</p>
          )}
        </section>

        <div className="detail-rule" />

        {/* Skill File */}
        <section className="detail-section">
          <div className="detail-field">
            <Label htmlFor="skill-path" className="detail-label">Skill File Path</Label>
            <div className="flex gap-2">
              <Input
                id="skill-path"
                value={skillContent || ""}
                onChange={(e) => setSkillContent(e.target.value || null)}
                placeholder="e.g. packages/skills/my-skill/SKILL.md"
                className="detail-input flex-grow"
              />
              {skillContent && (
                <Button
                  variant="outline"
                  onClick={() => setSkillContent(null)}
                  className="detail-btn detail-btn--ghost flex-shrink-0"
                >
                  Clear
                </Button>
              )}
            </div>
          </div>
        </section>

        <div className="detail-rule" />

        {/* Status Toggle */}
        <section className="detail-section">
          <div className="detail-toggle-row">
            <div>
              <span
                className="detail-toggle-label"
                style={{ color: enabled ? "#34d399" : "var(--text-secondary)" }}
              >
                {enabled ? "Agent Online" : "Agent Offline"}
              </span>
              <p className="detail-toggle-desc">
                {enabled
                  ? "Participates in the pipeline workflow."
                  : "Skipped entirely — pipeline will adapt."}
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={isSaving}
              className="data-[state=checked]:bg-[var(--amber)]"
            />
          </div>

          {isLastEnabledAgent && !enabled && (
            <div className="detail-banner detail-banner--error" style={{ marginTop: "12px" }}>
              <span className="detail-banner-icon">⚠</span>
              <p className="detail-banner-body">
                This is the last active agent. Saving will be rejected unless another agent is enabled first.
              </p>
            </div>
          )}
        </section>

        <div className="detail-rule" />

        {/* Execution Monitor */}
        <section className="detail-section">
          <h3 className="detail-section-title">Execution Monitor</h3>

          {runningJob ? (
            <div className="detail-exec-card detail-exec-card--running">
              <div className="detail-exec-header">
                <div className="flex items-center gap-2">
                  <span className="exec-pulse-dot" />
                  <span className="detail-exec-status">Active</span>
                </div>
                <span className="detail-exec-elapsed">{elapsedTime}</span>
              </div>

              <div className="detail-exec-body">
                <div className="detail-exec-row">
                  <span className="detail-exec-key">Job</span>
                  <Link href={`/dashboard/jobs/${runningJob.jobId}`} className="detail-exec-link">
                    {runningJob.jobTitle}
                  </Link>
                </div>

                {runningJob.stepMessage && (
                  <div className="detail-exec-row">
                    <span className="detail-exec-key">Action</span>
                    <p className="detail-exec-message">{runningJob.stepMessage}</p>
                  </div>
                )}

                <Link href={`/dashboard/jobs/${runningJob.jobId}`} className="detail-exec-view-link">
                  View execution context ↗
                </Link>
              </div>
            </div>
          ) : lastRun ? (
            <div className="detail-exec-card">
              <div className="detail-exec-header">
                <span className="detail-exec-key">Last completed run</span>
                <span
                  className="detail-exec-status-badge"
                  style={{ color: lastRunStatusColor(lastRun.status) }}
                >
                  {lastRun.status}
                </span>
              </div>

              <div className="detail-exec-body">
                <div className="detail-exec-row">
                  <span className="detail-exec-key">Job</span>
                  <Link href={`/dashboard/jobs/${lastRun.jobId}`} className="detail-exec-link">
                    {lastRun.jobTitle}
                  </Link>
                </div>
                <div className="detail-exec-row">
                  <span className="detail-exec-key">Run</span>
                  <span className="detail-exec-value">{lastRun.id.split("-")[0]}</span>
                </div>
                <div className="detail-exec-row">
                  <span className="detail-exec-key">When</span>
                  <span className="detail-exec-value">{formatRelativeTime(lastRun.createdAt)}</span>
                </div>

                <Link href={`/dashboard/jobs/${lastRun.jobId}`} className="detail-exec-view-link">
                  View job details ↗
                </Link>
              </div>
            </div>
          ) : (
            <div className="detail-exec-empty">No execution history recorded.</div>
          )}
        </section>
      </div>
    </div>
  );
}

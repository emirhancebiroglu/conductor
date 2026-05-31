"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import type { AgentConfig, AgentCategory, ProviderModel, RunningJob, Lane } from "@conductor/core";
import { ModelSelector } from "@/app/dashboard/agents/components/model-selector";
import { PromptEditor } from "@/app/dashboard/agents/components/prompt-editor";
import { SkillContentEditor } from "@/app/dashboard/agents/components/skill-content-editor";

interface AgentEditClientProps {
  readonly agent: AgentConfig;
  readonly categories: AgentCategory[];
  readonly providerModels: ProviderModel[];
  readonly initialRunningJob?: RunningJob;
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

export function AgentEditClient({
  agent,
  categories,
  providerModels,
  initialRunningJob,
}: AgentEditClientProps) {
  const router = useRouter();

  const [displayName, setDisplayName] = useState(agent.displayName);
  const [role, setRole] = useState(agent.role);
  const [categoryId, setCategoryId] = useState<string | null>(agent.categoryId);
  const [provider, setProvider] = useState(agent.provider);
  const [model, setModel] = useState(agent.model);
  const [systemPrompt, setSystemPrompt] = useState(agent.systemPrompt);
  const [skillContent, setSkillContent] = useState<string | null>(agent.skillContent);
  const [laneOverride, setLaneOverride] = useState<Lane | null>(agent.laneOverride);
  const [order, setOrder] = useState(agent.order);
  const [enabled, setEnabled] = useState(agent.enabled);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [elapsedTime, setElapsedTime] = useState("");

  useEffect(() => {
    if (!initialRunningJob) { setElapsedTime(""); return; }
    const update = () => {
      const s = Math.floor(Math.max(0, Date.now() - new Date(initialRunningJob.startedAt).getTime()) / 1000);
      setElapsedTime(`${Math.floor(s / 60)}m ${s % 60}s`);
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [initialRunningJob]);

  const isDirty =
    displayName !== agent.displayName ||
    role !== agent.role ||
    categoryId !== agent.categoryId ||
    provider !== agent.provider ||
    model !== agent.model ||
    systemPrompt !== agent.systemPrompt ||
    skillContent !== agent.skillContent ||
    laneOverride !== agent.laneOverride ||
    order !== agent.order ||
    enabled !== agent.enabled;

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const isDisplayNameInvalid = !displayName.trim();
  const isRoleInvalid = !role.trim();
  const isPromptTooShort = systemPrompt.trim().length < 10;
  const isSaveDisabled = !isDirty || isDisplayNameInvalid || isRoleInvalid || isPromptTooShort || isSaving;

  const handleReset = () => {
    setDisplayName(agent.displayName);
    setRole(agent.role);
    setCategoryId(agent.categoryId);
    setProvider(agent.provider);
    setModel(agent.model);
    setSystemPrompt(agent.systemPrompt);
    setSkillContent(agent.skillContent);
    setLaneOverride(agent.laneOverride);
    setOrder(agent.order);
    setEnabled(agent.enabled);
    toast.info("Changes discarded");
  };

  const handleSave = async () => {
    if (isSaveDisabled) return;
    setIsSaving(true);
    try {
      const hasFieldsChanged =
        displayName !== agent.displayName || role !== agent.role || categoryId !== agent.categoryId ||
        provider !== agent.provider || model !== agent.model || systemPrompt !== agent.systemPrompt ||
        skillContent !== agent.skillContent || laneOverride !== agent.laneOverride || order !== agent.order;

      if (hasFieldsChanged) {
        const res = await fetch(`/api/agents/${agent.agentName}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName: displayName.trim(), role: role.trim(), categoryId, provider, model, systemPrompt, skillContent: skillContent?.trim() || null, laneOverride, order }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to update");
      }

      if (enabled !== agent.enabled) {
        const res = await fetch(`/api/agents/${agent.agentName}`, { method: "PATCH" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to toggle");
      }

      toast.success("Configuration saved", { description: "Changes will take effect on the next job run." });
      router.refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete agent "${agent.displayName}"? This cannot be undone.`)) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/agents/${agent.agentName}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Failed to delete");
      }
      toast.success("Agent deleted");
      router.push("/dashboard/agents");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
      setIsDeleting(false);
    }
  };

  const agentCategory = categories.find((c) => c.id === agent.categoryId);

  return (
    <div className="agent-edit-page">
      {/* Breadcrumb */}
      <nav className="agent-edit-breadcrumb">
        <Link href="/dashboard/agents" className="agent-edit-back">
          ← Agents
        </Link>
        {agentCategory && (
          <>
            <span className="agent-edit-sep">/</span>
            <span className="agent-edit-cat" style={{ color: agentCategory.color }}>{agentCategory.name}</span>
          </>
        )}
        <span className="agent-edit-sep">/</span>
        <span className="agent-edit-current">{agent.agentName}</span>
      </nav>

      {/* Page header */}
      <div className="agent-edit-header">
        <div>
          <span className="agents-eyebrow">Agent Specification</span>
          <h1 className="agent-edit-title">{agent.displayName}</h1>
        </div>

        <div className="agent-edit-actions">
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

      {/* Running job banner */}
      {initialRunningJob && (
        <div className="detail-banner detail-banner--warn" style={{ marginBottom: "24px" }}>
          <span className="detail-banner-icon">⚡</span>
          <div>
            <p className="detail-banner-title">Currently running</p>
            <p className="detail-banner-body">
              Working on <Link href={`/dashboard/jobs/${initialRunningJob.jobId}`} className="detail-exec-link" style={{ display: "inline" }}>{initialRunningJob.jobTitle}</Link>
              {elapsedTime && ` · ${elapsedTime} elapsed`}
            </p>
          </div>
        </div>
      )}

      {/* Content grid */}
      <div className="agent-edit-content">
        {/* Left: identity + model + prompt */}
        <div className="agent-edit-main">

          {/* Identity */}
          <section className="detail-section">
            <h3 className="detail-section-title">Identity</h3>
            <div className="agent-edit-grid-2">
              <div className="detail-field">
                <Label htmlFor="edit-display-name" className="detail-label">Display Name</Label>
                <Input id="edit-display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="detail-input" />
                {isDisplayNameInvalid && <p className="detail-field-error">Required</p>}
              </div>
              <div className="detail-field">
                <Label htmlFor="edit-order" className="detail-label">Order</Label>
                <Input id="edit-order" type="number" min={0} value={order} onChange={(e) => setOrder(parseInt(e.target.value, 10) || 0)} className="detail-input" />
              </div>
            </div>
            <div className="detail-field">
              <Label htmlFor="edit-role" className="detail-label">Role</Label>
              <Input id="edit-role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Reviews code for security issues" className="detail-input" />
              {isRoleInvalid && <p className="detail-field-error">Required</p>}
            </div>
            <div className="detail-field">
              <Label className="detail-label">Category</Label>
              <Select value={categoryId ?? "none"} onValueChange={(v) => setCategoryId(v === "none" ? null : v)}>
                <SelectTrigger className="detail-select-trigger">
                  <SelectValue placeholder="Uncategorized" />
                </SelectTrigger>
                <SelectContent className="detail-select-content">
                  <SelectItem value="none" className="detail-select-item">Uncategorized</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id} className="detail-select-item">{cat.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </section>

          <div className="detail-rule" />

          {/* Model */}
          <section className="detail-section">
            <h3 className="detail-section-title">Model & Routing</h3>
            <div className="model-routing-row">
              <ModelSelector
                currentProvider={provider}
                currentModel={model}
                providerModels={providerModels}
                onChange={(p, m) => { setProvider(p); setModel(m); }}
              />
              <div className="detail-field">
                <Label className="detail-label">Lane Preference</Label>
                <Select value={laneOverride ?? "auto"} onValueChange={(v) => setLaneOverride(v === "auto" ? null : (v as Lane))}>
                  <SelectTrigger className="detail-select-trigger">
                    <SelectValue placeholder="Auto" />
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
            <PromptEditor value={systemPrompt} onChange={setSystemPrompt} placeholder="Write the instruction framework for this agent…" />
            {isPromptTooShort && <p className="detail-field-error" style={{ marginTop: "6px" }}>Minimum 10 characters</p>}
          </section>

          <div className="detail-rule" />

          {/* Skill Content */}
          <section className="detail-section">
            <SkillContentEditor value={skillContent} onChange={setSkillContent} />
          </section>
        </div>

        {/* Right: status + toggle + delete */}
        <aside className="agent-edit-sidebar">

          {/* Agent toggle */}
          <div className="detail-toggle-row" style={{ marginBottom: "16px" }}>
            <div>
              <span className="detail-toggle-label" style={{ color: enabled ? "#34d399" : "var(--text-secondary)" }}>
                {enabled ? "Online" : "Offline"}
              </span>
              <p className="detail-toggle-desc">{enabled ? "Participates in pipeline" : "Skipped by pipeline"}</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} disabled={isSaving} className="data-[state=checked]:bg-[var(--amber)]" />
          </div>

          {/* Meta */}
          <div className="agent-edit-meta">
            <div className="agent-edit-meta-row">
              <span className="detail-exec-key">Slug</span>
              <span className="detail-exec-value" style={{ fontFamily: "var(--font-geist-mono), monospace" }}>{agent.agentName}</span>
            </div>
            <div className="agent-edit-meta-row">
              <span className="detail-exec-key">Created</span>
              <span className="detail-exec-value">{formatRelativeTime(agent.createdAt)}</span>
            </div>
            <div className="agent-edit-meta-row">
              <span className="detail-exec-key">Updated</span>
              <span className="detail-exec-value">{formatRelativeTime(agent.updatedAt)}</span>
            </div>
          </div>

          {/* Danger zone */}
          <div className="agent-edit-danger">
            <p className="detail-section-title" style={{ marginBottom: "8px" }}>Danger Zone</p>
            <Button
              variant="outline"
              disabled={isDeleting || !!initialRunningJob}
              onClick={handleDelete}
              className="detail-btn"
              style={{
                width: "100%",
                borderColor: "rgba(248,113,113,0.3)",
                color: "#f87171",
                backgroundColor: "rgba(248,113,113,0.06)",
              }}
            >
              {isDeleting ? "Deleting…" : "Delete Agent"}
            </Button>
            {initialRunningJob && (
              <p className="detail-field-error" style={{ marginTop: "6px" }}>Cannot delete while running</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

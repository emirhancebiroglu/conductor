"use client";

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import type { AgentConfig, AgentCategory, ProviderModel, Lane } from "@conductor/core";
import { ModelSelector } from "./model-selector";
import { PromptEditor } from "./prompt-editor";
import { SkillContentEditor } from "./skill-content-editor";

interface CreateAgentDrawerProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly categories: AgentCategory[];
  readonly providerModels: ProviderModel[];
  readonly onAgentCreated: (agent: AgentConfig) => void;
}

export function CreateAgentDrawer({
  isOpen,
  onOpenChange,
  categories,
  providerModels,
  onAgentCreated,
}: CreateAgentDrawerProps) {
  const defaultProvider = providerModels[0]?.provider ?? "claude";
  const defaultModel = providerModels.find((m) => m.provider === defaultProvider)?.modelId ?? "";

  const [agentName, setAgentName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [role, setRole] = useState("");
  const [provider, setProvider] = useState(defaultProvider);
  const [model, setModel] = useState(defaultModel);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [skillContent, setSkillContent] = useState<string | null>(null);
  const [laneOverride, setLaneOverride] = useState<Lane | null>(null);
  const [order, setOrder] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const e: Record<string, string> = {};
    if (!agentName.trim()) e.agentName = "Required";
    else if (!/^[a-z0-9-]+$/.test(agentName.trim())) e.agentName = "Lowercase, alphanumeric, hyphens only";
    if (!displayName.trim()) e.displayName = "Required";
    if (!role.trim()) e.role = "Required";
    if (systemPrompt.trim().length < 10) e.systemPrompt = "Minimum 10 characters";
    return e;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentName: agentName.trim(),
          displayName: displayName.trim(),
          role: role.trim(),
          provider,
          model,
          systemPrompt: systemPrompt.trim(),
          skillContent: skillContent ?? null,
          categoryId: categoryId ?? null,
          laneOverride: laneOverride ?? null,
          order,
          enabled,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create agent");

      onAgentCreated(json.agent);
      onOpenChange(false);
      toast.success(`Agent "${displayName}" created`);

      // Reset form
      setAgentName("");
      setDisplayName("");
      setCategoryId(null);
      setRole("");
      setProvider(defaultProvider);
      setModel(defaultModel);
      setSystemPrompt("");
      setSkillContent(null);
      setLaneOverride(null);
      setOrder(0);
      setEnabled(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className="pm-sheet" style={{ maxWidth: "600px" }}>
        <SheetHeader className="pm-sheet-header">
          <span className="pm-eyebrow">Agent Registry</span>
          <SheetTitle className="pm-title">New Agent</SheetTitle>
          <SheetDescription className="pm-desc">
            Create a custom agent with its own model, system prompt, and skill content.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="create-agent-form">
          {/* Identity */}
          <div className="create-agent-section">
            <span className="detail-section-title">Identity</span>

            <div className="detail-field">
              <Label className="detail-label">Agent Slug <span className="create-agent-required">*</span></Label>
              <Input
                value={agentName}
                onChange={(e) => setAgentName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="e.g. devops-engineer"
                className="detail-input"
              />
              <p className="detail-label" style={{ opacity: 0.6, marginTop: "2px" }}>Lowercase, alphanumeric, hyphens. Cannot be changed later.</p>
              {errors.agentName && <p className="detail-field-error">{errors.agentName}</p>}
            </div>

            <div className="detail-field">
              <Label className="detail-label">Display Name <span className="create-agent-required">*</span></Label>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. DevOps Engineer"
                className="detail-input"
              />
              {errors.displayName && <p className="detail-field-error">{errors.displayName}</p>}
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
                    <SelectItem key={cat.id} value={cat.id} className="detail-select-item">
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="detail-field">
              <Label className="detail-label">Role / Description <span className="create-agent-required">*</span></Label>
              <Input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="e.g. Manages CI/CD pipelines and infrastructure"
                className="detail-input"
              />
              {errors.role && <p className="detail-field-error">{errors.role}</p>}
            </div>
          </div>

          <div className="detail-rule" />

          {/* Model */}
          <div className="create-agent-section">
            <span className="detail-section-title">Model & Routing</span>
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
          </div>

          <div className="detail-rule" />

          {/* Prompts */}
          <div className="create-agent-section">
            <PromptEditor
              value={systemPrompt}
              onChange={setSystemPrompt}
              placeholder="Write this agent's core instruction framework…"
            />
            {errors.systemPrompt && <p className="detail-field-error">{errors.systemPrompt}</p>}
          </div>

          <div className="detail-rule" />

          <div className="create-agent-section">
            <SkillContentEditor value={skillContent} onChange={setSkillContent} />
          </div>

          <div className="detail-rule" />

          {/* Settings */}
          <div className="create-agent-section">
            <span className="detail-section-title">Settings</span>
            <div className="create-agent-settings-row">
              <div className="detail-field" style={{ flex: 1 }}>
                <Label htmlFor="create-order" className="detail-label">Pipeline Order</Label>
                <Input
                  id="create-order"
                  type="number"
                  min={0}
                  value={order}
                  onChange={(e) => setOrder(parseInt(e.target.value, 10) || 0)}
                  className="detail-input"
                />
              </div>
              <div className="detail-toggle-row" style={{ flex: 2 }}>
                <div>
                  <span className="detail-toggle-label" style={{ color: enabled ? "#34d399" : "var(--text-secondary)" }}>
                    {enabled ? "Enabled" : "Disabled"}
                  </span>
                  <p className="detail-toggle-desc">Participate in pipeline</p>
                </div>
                <Switch
                  checked={enabled}
                  onCheckedChange={setEnabled}
                  className="data-[state=checked]:bg-[var(--amber)]"
                />
              </div>
            </div>
          </div>

          <div className="create-agent-submit-row">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="detail-btn detail-btn--ghost"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="pm-submit-btn" style={{ width: "auto", padding: "0 24px" }}>
              {isSubmitting ? "Creating…" : "Create Agent →"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

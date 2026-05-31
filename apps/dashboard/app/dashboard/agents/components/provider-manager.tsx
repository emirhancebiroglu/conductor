"use client";

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProviderModel } from "@conductor/core";
import { z } from "zod";

interface ProviderManagerProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly models: ProviderModel[];
  readonly onModelsChange: (newModels: ProviderModel[]) => void;
}

const CreateModelSchema = z.object({
  provider: z
    .string()
    .min(1, "Provider name is required")
    .regex(/^[a-z0-9-]+$/, "Lowercase, alphanumeric, or hyphenated"),
  modelId: z.string().min(1, "Model ID is required"),
  displayName: z.string().min(1, "Display name is required"),
  tier: z.enum(["premium", "cheap"]),
});

const UpdateModelSchema = z.object({
  displayName: z.string().min(1, "Display name is required"),
  tier: z.enum(["premium", "cheap"]),
});

export function ProviderManager({
  isOpen,
  onOpenChange,
  models,
  onModelsChange,
}: ProviderManagerProps) {
  const [newProvider, setNewProvider] = useState("");
  const [newModelId, setNewModelId] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newTier, setNewTier] = useState<"premium" | "cheap">("cheap");
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isAdding, setIsAdding] = useState(false);

  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editTier, setEditTier] = useState<"premium" | "cheap">("cheap");
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [isUpdating, setIsUpdating] = useState(false);

  const [isTogglingId, setIsTogglingId] = useState<string | null>(null);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const groups: Record<string, ProviderModel[]> = {};
  for (const m of models) {
    if (!groups[m.provider]) groups[m.provider] = [];
    groups[m.provider]?.push(m);
  }

  const handleAddModel = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormErrors({});
    setGlobalError(null);

    const validation = CreateModelSchema.safeParse({
      provider: newProvider.trim(),
      modelId: newModelId.trim(),
      displayName: newDisplayName.trim(),
      tier: newTier,
    });

    if (!validation.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of validation.error.issues) {
        if (issue.path[0]) fieldErrors[issue.path[0] as string] = issue.message;
      }
      setFormErrors(fieldErrors);
      return;
    }

    setIsAdding(true);
    try {
      const response = await fetch("/api/agents/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: validation.data.provider.toLowerCase(),
          modelId: validation.data.modelId,
          displayName: validation.data.displayName,
          capabilities: { tier: validation.data.tier },
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Failed to create provider model");
      onModelsChange([...models, json.model]);
      setNewProvider("");
      setNewModelId("");
      setNewDisplayName("");
      setNewTier("cheap");
    } catch (err: unknown) {
      setGlobalError(err instanceof Error ? err.message : "An error occurred while adding model");
    } finally {
      setIsAdding(false);
    }
  };

  const handleToggleAvailability = async (modelItem: ProviderModel) => {
    setIsTogglingId(modelItem.id);
    setGlobalError(null);
    try {
      const response = await fetch(`/api/agents/providers/${modelItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ available: !modelItem.available }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Failed to update availability");
      onModelsChange(models.map((m) => (m.id === modelItem.id ? json.model : m)));
    } catch (err: unknown) {
      setGlobalError(err instanceof Error ? err.message : "Failed to toggle availability");
    } finally {
      setIsTogglingId(null);
    }
  };

  const handleDeleteModel = async (id: string, name: string) => {
    if (!confirm(`Delete model '${name}'?`)) return;
    setIsDeletingId(id);
    setGlobalError(null);
    try {
      const response = await fetch(`/api/agents/providers/${id}`, { method: "DELETE" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Failed to delete provider model");
      onModelsChange(models.filter((m) => m.id !== id));
    } catch (err: unknown) {
      setGlobalError(err instanceof Error ? err.message : "Failed to delete model");
    } finally {
      setIsDeletingId(null);
    }
  };

  const startEditing = (modelItem: ProviderModel) => {
    setEditingModelId(modelItem.id);
    setEditDisplayName(modelItem.displayName);
    setEditTier((modelItem.capabilities as { tier?: "premium" | "cheap" } | undefined)?.tier ?? "cheap");
    setEditErrors({});
    setGlobalError(null);
  };

  const handleSaveEdit = async (id: string) => {
    setEditErrors({});
    setGlobalError(null);

    const validation = UpdateModelSchema.safeParse({
      displayName: editDisplayName.trim(),
      tier: editTier,
    });

    if (!validation.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of validation.error.issues) {
        if (issue.path[0]) fieldErrors[issue.path[0] as string] = issue.message;
      }
      setEditErrors(fieldErrors);
      return;
    }

    setIsUpdating(true);
    try {
      const response = await fetch(`/api/agents/providers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: validation.data.displayName,
          capabilities: { tier: validation.data.tier },
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Failed to save model edits");
      onModelsChange(models.map((m) => (m.id === id ? json.model : m)));
      setEditingModelId(null);
    } catch (err: unknown) {
      setGlobalError(err instanceof Error ? err.message : "Failed to save edits");
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className="pm-sheet">
        <SheetHeader className="pm-sheet-header">
          <span className="pm-eyebrow">System Registry</span>
          <SheetTitle className="pm-title">Providers & Models</SheetTitle>
          <SheetDescription className="pm-desc">
            Manage provider listings, toggle availability, or register new configurations.
          </SheetDescription>
        </SheetHeader>

        {globalError && (
          <div className="pm-error-banner">✕ {globalError}</div>
        )}

        {/* Register form */}
        <form onSubmit={handleAddModel} className="pm-form">
          <span className="pm-form-title">Register New Model</span>

          <div className="pm-form-grid-2">
            <div className="detail-field">
              <Label htmlFor="add-provider" className="detail-label">Provider</Label>
              <Input
                id="add-provider"
                value={newProvider}
                onChange={(e) => setNewProvider(e.target.value)}
                placeholder="e.g. openai"
                className="detail-input"
              />
              {formErrors.provider && <p className="detail-field-error">{formErrors.provider}</p>}
            </div>

            <div className="detail-field">
              <Label htmlFor="add-model-id" className="detail-label">Model ID</Label>
              <Input
                id="add-model-id"
                value={newModelId}
                onChange={(e) => setNewModelId(e.target.value)}
                placeholder="e.g. gpt-4o"
                className="detail-input"
              />
              {formErrors.modelId && <p className="detail-field-error">{formErrors.modelId}</p>}
            </div>
          </div>

          <div className="pm-form-grid-3">
            <div className="pm-form-col-2 detail-field">
              <Label htmlFor="add-display-name" className="detail-label">Display Name</Label>
              <Input
                id="add-display-name"
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
                placeholder="e.g. GPT-4o Premium"
                className="detail-input"
              />
              {formErrors.displayName && <p className="detail-field-error">{formErrors.displayName}</p>}
            </div>

            <div className="detail-field">
              <Label className="detail-label">Tier</Label>
              <Select value={newTier} onValueChange={(val) => setNewTier(val as "premium" | "cheap")}>
                <SelectTrigger className="detail-select-trigger">
                  <SelectValue placeholder="Tier" />
                </SelectTrigger>
                <SelectContent className="detail-select-content">
                  <SelectItem value="cheap" className="detail-select-item">Cheap</SelectItem>
                  <SelectItem value="premium" className="detail-select-item">Premium</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            type="submit"
            disabled={isAdding}
            className="pm-submit-btn"
          >
            {isAdding ? "Registering…" : "Register Model →"}
          </Button>
        </form>

        {/* Provider groups */}
        <div className="pm-groups">
          {Object.entries(groups).map(([providerName, modelList]) => (
            <div key={providerName} className="pm-group">
              <div className="pm-group-header">
                <span className="pm-group-name">{providerName}</span>
                <span className="pm-group-count">{modelList.length} {modelList.length === 1 ? "model" : "models"}</span>
              </div>

              <div className="pm-model-list">
                {modelList.map((m) => {
                  const tier = (m.capabilities as { tier?: "premium" | "cheap" } | undefined)?.tier ?? "cheap";
                  const isEditing = editingModelId === m.id;

                  if (isEditing) {
                    return (
                      <div key={m.id} className="pm-model-edit">
                        <span className="pm-model-edit-id">Editing: <strong>{m.modelId}</strong></span>

                        <div className="detail-field">
                          <Label htmlFor={`edit-name-${m.id}`} className="detail-label">Display Name</Label>
                          <Input
                            id={`edit-name-${m.id}`}
                            value={editDisplayName}
                            onChange={(e) => setEditDisplayName(e.target.value)}
                            className="detail-input"
                          />
                          {editErrors.displayName && <p className="detail-field-error">{editErrors.displayName}</p>}
                        </div>

                        <div className="detail-field">
                          <Label className="detail-label">Tier</Label>
                          <Select value={editTier} onValueChange={(val) => setEditTier(val as "premium" | "cheap")}>
                            <SelectTrigger className="detail-select-trigger">
                              <SelectValue placeholder="Tier" />
                            </SelectTrigger>
                            <SelectContent className="detail-select-content">
                              <SelectItem value="cheap" className="detail-select-item">Cheap</SelectItem>
                              <SelectItem value="premium" className="detail-select-item">Premium</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="pm-edit-actions">
                          <Button
                            size="sm"
                            disabled={isUpdating}
                            onClick={() => handleSaveEdit(m.id)}
                            className="pm-submit-btn"
                            style={{ flex: 1 }}
                          >
                            {isUpdating ? "Saving…" : "Save"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isUpdating}
                            onClick={() => setEditingModelId(null)}
                            className="detail-btn detail-btn--ghost"
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={m.id} className="pm-model-row" data-unavailable={!m.available}>
                      <div className="pm-model-info">
                        <div className="pm-model-name-row">
                          <span className="pm-model-name">{m.displayName}</span>
                          <span className="model-tier-chip" data-tier={tier}>{tier}</span>
                        </div>
                        <span className="pm-model-id">{m.modelId}</span>
                      </div>

                      <div className="pm-model-controls">
                        <div className="pm-model-toggle">
                          <span className="pm-model-avail">{m.available ? "Active" : "Inactive"}</span>
                          <Switch
                            checked={m.available}
                            onCheckedChange={() => handleToggleAvailability(m)}
                            disabled={isTogglingId === m.id}
                            className="data-[state=checked]:bg-[var(--amber)] scale-75"
                          />
                        </div>
                        <div className="pm-model-actions">
                          <button onClick={() => startEditing(m)} className="pm-action-btn">Edit</button>
                          <button
                            onClick={() => handleDeleteModel(m.id, m.displayName)}
                            disabled={isDeletingId === m.id}
                            className="pm-action-btn pm-action-btn--danger"
                          >
                            {isDeletingId === m.id ? "…" : "Remove"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {models.length === 0 && (
            <div className="pm-empty">No models registered. Use the form above to add one.</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

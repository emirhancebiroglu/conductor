"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { ProviderModel } from "@conductor/core";

interface ModelSelectorProps {
  readonly currentProvider: string;
  readonly currentModel: string;
  readonly providerModels: ProviderModel[];
  readonly onChange: (provider: string, model: string) => void;
}

const PROVIDER_DISPLAY: Record<string, string> = {
  claude: "Claude",
  opencode: "OpenCode",
};

export function ModelSelector({
  currentProvider,
  currentModel,
  providerModels,
  onChange,
}: ModelSelectorProps) {
  const uniqueProviders = Array.from(new Set(providerModels.map((pm) => pm.provider)));
  const availableModels = providerModels.filter((m) => m.provider === currentProvider && m.available);
  const selectedModel = providerModels.find((m) => m.provider === currentProvider && m.modelId === currentModel);
  const currentTier = (selectedModel?.capabilities as { tier?: string } | undefined)?.tier ?? "cheap";

  const handleProviderChange = (newProvider: string) => {
    const first = providerModels.find((m) => m.provider === newProvider && m.available);
    onChange(newProvider, first?.modelId ?? "");
  };

  return (
    <div className="model-selector">
      {/* Provider */}
      <div className="detail-field">
        <Label className="detail-label">Provider</Label>
        <Select value={currentProvider} onValueChange={handleProviderChange}>
          <SelectTrigger className="detail-select-trigger">
            <SelectValue placeholder="Select Provider" />
          </SelectTrigger>
          <SelectContent className="detail-select-content">
            {uniqueProviders.map((p) => (
              <SelectItem key={p} value={p} className="detail-select-item">
                {PROVIDER_DISPLAY[p] ?? p.toUpperCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Model — tier shown in label, NOT inside SelectItem to avoid trigger layout breakage */}
      <div className="detail-field">
        <div className="model-selector-label-row">
          <Label className="detail-label">Model</Label>
          <span className="model-tier-chip" data-tier={currentTier}>
            {currentTier}
          </span>
        </div>
        <Select value={currentModel} onValueChange={(val) => onChange(currentProvider, val)}>
          <SelectTrigger className="detail-select-trigger">
            <SelectValue placeholder="Select Model" />
          </SelectTrigger>
          <SelectContent className="detail-select-content">
            {availableModels.map((m) => {
              const tier = (m.capabilities as { tier?: string } | undefined)?.tier ?? "cheap";
              return (
                <SelectItem key={m.modelId} value={m.modelId} className="detail-select-item">
                  {m.displayName}
                  {tier === "premium" && (
                    <span className="model-item-tier-dot" aria-label="premium" />
                  )}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

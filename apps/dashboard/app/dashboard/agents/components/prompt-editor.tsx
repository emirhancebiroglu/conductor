"use client";

import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface PromptEditorProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly characterLimit?: number;
}

export function PromptEditor({
  value,
  onChange,
  placeholder = "Enter system prompt…",
  characterLimit,
}: PromptEditorProps) {
  const charCount = value.length;
  const wordCount = value.trim() === "" ? 0 : value.trim().split(/\s+/).length;
  const isShort = value.trim().length > 0 && value.trim().length < 50;
  const isExceeded = characterLimit !== undefined && charCount > characterLimit;

  let meterColor = "var(--text-secondary)";
  if (isExceeded) meterColor = "#f87171";
  else if (isShort) meterColor = "var(--amber)";

  return (
    <div className="prompt-editor">
      <div className="prompt-editor-header">
        <Label htmlFor="prompt-textarea" className="detail-label">System Prompt</Label>
        <div className="prompt-editor-meta">
          <span>{wordCount}w</span>
          <span className="prompt-editor-sep">·</span>
          <span style={{ color: meterColor }}>
            {charCount}{characterLimit === undefined ? "" : ` / ${characterLimit}`}
          </span>
        </div>
      </div>

      <Textarea
        id="prompt-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={10}
        className="prompt-editor-textarea"
      />

      {isShort && (
        <p className="prompt-editor-hint prompt-editor-hint--warn">
          Prompt is very short — consider adding more context.
        </p>
      )}
      {isExceeded && (
        <p className="prompt-editor-hint prompt-editor-hint--error">
          Character limit exceeded.
        </p>
      )}
    </div>
  );
}

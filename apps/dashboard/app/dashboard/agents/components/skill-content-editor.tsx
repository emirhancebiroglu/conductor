"use client";

import { useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface SkillContentEditorProps {
  readonly value: string | null;
  readonly onChange: (content: string | null) => void;
}

export function SkillContentEditor({ value, onChange }: SkillContentEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const charCount = value?.length ?? 0;
  const wordCount = value?.trim() ? value.trim().split(/\s+/).length : 0;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result;
      if (typeof text === "string") onChange(text);
    };
    reader.readAsText(file);
    // Reset input so same file can be re-selected
    e.target.value = "";
  };

  return (
    <div className="skill-editor">
      <div className="skill-editor-header">
        <Label className="detail-label">Skill Content</Label>
        <div className="skill-editor-meta">
          {value ? (
            <>
              <span>{wordCount}w · {charCount}ch</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onChange(null)}
                className="skill-editor-clear-btn"
              >
                Clear
              </Button>
            </>
          ) : (
            <span className="skill-editor-empty-hint">No skill content</span>
          )}
        </div>
      </div>

      {/* Drop zone + textarea */}
      <div
        className="skill-editor-dropzone"
        onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("skill-editor-dropzone--over"); }}
        onDragLeave={(e) => { e.currentTarget.classList.remove("skill-editor-dropzone--over"); }}
        onDrop={(e) => {
          e.preventDefault();
          e.currentTarget.classList.remove("skill-editor-dropzone--over");
          const file = e.dataTransfer.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (evt) => {
            const text = evt.target?.result;
            if (typeof text === "string") onChange(text);
          };
          reader.readAsText(file);
        }}
      >
        <Textarea
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          placeholder="Paste skill markdown content here, or drag & drop a .md file…"
          rows={8}
          className="skill-editor-textarea"
        />
      </div>

      {/* File upload fallback */}
      <div className="skill-editor-footer">
        <button
          type="button"
          className="skill-editor-upload-btn"
          onClick={() => fileInputRef.current?.click()}
        >
          Upload .md file
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.txt"
          className="sr-only"
          onChange={handleFileChange}
        />
      </div>
    </div>
  );
}

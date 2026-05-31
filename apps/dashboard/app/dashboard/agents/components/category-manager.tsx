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
import { toast } from "sonner";
import type { AgentCategory } from "@conductor/core";

const PRESET_COLORS = [
  "#818cf8", // indigo
  "#34d399", // emerald
  "#f59e0b", // amber
  "#f87171", // red
  "#60a5fa", // blue
  "#a78bfa", // violet
];

interface CategoryManagerProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly categories: AgentCategory[];
  readonly onCategoriesChange: (categories: AgentCategory[]) => void;
}

export function CategoryManager({
  isOpen,
  onOpenChange,
  categories,
  onCategoriesChange,
}: CategoryManagerProps) {
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[0] ?? "#818cf8");
  const [newDescription, setNewDescription] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);

  const deriveSlug = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const handleNameChange = (v: string) => {
    setNewName(v);
    setNewSlug(deriveSlug(v));
  };

  const handleAdd = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);
    if (!newName.trim() || !newSlug.trim()) {
      setFormError("Name and slug are required");
      return;
    }

    setIsAdding(true);
    try {
      const res = await fetch("/api/agents/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          slug: newSlug.trim(),
          color: newColor,
          description: newDescription.trim() || null,
          order: categories.length + 1,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create category");

      onCategoriesChange([...categories, json.category]);
      setNewName("");
      setNewSlug("");
      setNewColor(PRESET_COLORS[0] ?? "#818cf8");
      setNewDescription("");
      toast.success("Category created");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create category";
      setFormError(msg);
    } finally {
      setIsAdding(false);
    }
  };

  const startEdit = (cat: AgentCategory) => {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditColor(cat.color);
    setEditDescription(cat.description ?? "");
  };

  const handleSaveEdit = async (id: string) => {
    setIsSaving(true);
    try {
      const res = await fetch(`/api/agents/categories/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          color: editColor,
          description: editDescription.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update category");

      onCategoriesChange(categories.map((c) => (c.id === id ? json.category : c)));
      setEditingId(null);
      toast.success("Category updated");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update category");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete category "${name}"? Agents in this category will become uncategorized.`)) return;

    setIsDeletingId(id);
    try {
      const res = await fetch(`/api/agents/categories/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Failed to delete category");
      }
      onCategoriesChange(categories.filter((c) => c.id !== id));
      toast.success("Category deleted");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete category");
    } finally {
      setIsDeletingId(null);
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className="pm-sheet">
        <SheetHeader className="pm-sheet-header">
          <span className="pm-eyebrow">Agent Organization</span>
          <SheetTitle className="pm-title">Manage Categories</SheetTitle>
          <SheetDescription className="pm-desc">
            Create, rename, recolor, or delete agent categories. Agents in a deleted category become uncategorized.
          </SheetDescription>
        </SheetHeader>

        {/* Add form */}
        <form onSubmit={handleAdd} className="pm-form">
          <span className="pm-form-title">New Category</span>

          <div className="detail-field">
            <Label className="detail-label">Name</Label>
            <Input
              value={newName}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. Infrastructure"
              className="detail-input"
            />
          </div>

          <div className="detail-field">
            <Label className="detail-label">Slug (auto-derived, editable)</Label>
            <Input
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              placeholder="e.g. infrastructure"
              className="detail-input"
              pattern="[a-z0-9-]+"
            />
          </div>

          <div className="detail-field">
            <Label className="detail-label">Color</Label>
            <div className="cat-color-swatches">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="cat-color-swatch"
                  style={{
                    backgroundColor: c,
                    outline: newColor === c ? `2px solid ${c}` : "none",
                    outlineOffset: "2px",
                  }}
                  onClick={() => setNewColor(c)}
                  aria-label={c}
                />
              ))}
            </div>
          </div>

          <div className="detail-field">
            <Label className="detail-label">Description (optional)</Label>
            <Input
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Short description"
              className="detail-input"
            />
          </div>

          {formError && <p className="detail-field-error">{formError}</p>}

          <Button type="submit" disabled={isAdding} className="pm-submit-btn">
            {isAdding ? "Creating…" : "Create Category →"}
          </Button>
        </form>

        {/* Category list */}
        <div className="pm-groups">
          {categories.length === 0 && (
            <div className="pm-empty">No categories yet. Create one above.</div>
          )}

          {categories.map((cat) => {
            const isEditing = editingId === cat.id;

            if (isEditing) {
              return (
                <div key={cat.id} className="pm-model-edit">
                  <span className="pm-model-edit-id">Editing: <strong>{cat.slug}</strong></span>

                  <div className="detail-field">
                    <Label className="detail-label">Name</Label>
                    <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="detail-input" />
                  </div>

                  <div className="detail-field">
                    <Label className="detail-label">Color</Label>
                    <div className="cat-color-swatches">
                      {PRESET_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          className="cat-color-swatch"
                          style={{
                            backgroundColor: c,
                            outline: editColor === c ? `2px solid ${c}` : "none",
                            outlineOffset: "2px",
                          }}
                          onClick={() => setEditColor(c)}
                          aria-label={c}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="detail-field">
                    <Label className="detail-label">Description</Label>
                    <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} className="detail-input" />
                  </div>

                  <div className="pm-edit-actions">
                    <Button size="sm" disabled={isSaving} onClick={() => handleSaveEdit(cat.id)} className="pm-submit-btn" style={{ flex: 1 }}>
                      {isSaving ? "Saving…" : "Save"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingId(null)} className="detail-btn detail-btn--ghost">
                      Cancel
                    </Button>
                  </div>
                </div>
              );
            }

            return (
              <div key={cat.id} className="pm-model-row">
                <div className="pm-model-info">
                  <div className="pm-model-name-row">
                    <span className="cat-color-dot" style={{ backgroundColor: cat.color }} />
                    <span className="pm-model-name">{cat.name}</span>
                  </div>
                  <span className="pm-model-id">{cat.slug}</span>
                </div>
                <div className="pm-model-actions">
                  <button onClick={() => startEdit(cat)} className="pm-action-btn">Edit</button>
                  <button
                    onClick={() => handleDelete(cat.id, cat.name)}
                    disabled={isDeletingId === cat.id}
                    className="pm-action-btn pm-action-btn--danger"
                  >
                    {isDeletingId === cat.id ? "…" : "Delete"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

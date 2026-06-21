"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type CmRepo = {
  id: string;
  owner: string;
  name: string;
  default_branch: string;
  source: string;
  priority: number;
  enabled: boolean;
  run_config: Record<string, unknown> | null;
};

export function CmReposTab() {
  const [repos, setRepos] = useState<CmRepo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isRunningSelected, setIsRunningSelected] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingPriority, setEditingPriority] = useState<Record<string, number>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [addOwner, setAddOwner] = useState("");
  const [addName, setAddName] = useState("");

  const fetchRepos = useCallback(async () => {
    try {
      const res = await fetch("/api/cm/repos");
      const json = await res.json();
      setRepos(Array.isArray(json) ? json : []);
    } catch {
      toast.error("Failed to load repos");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchRepos(); }, [fetchRepos]);

  const handleDiscover = async () => {
    setIsDiscovering(true);
    try {
      const res = await fetch("/api/cm/discover", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Discovery failed");
      toast.success(`Discovered ${json.discovered} repos (${json.inserted} new)`);
      await fetchRepos();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Discovery failed");
    } finally {
      setIsDiscovering(false);
    }
  };

  const toggleEnabled = async (repo: CmRepo) => {
    try {
      const res = await fetch(`/api/cm/repos/${repo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !repo.enabled }),
      });
      if (!res.ok) throw new Error("Toggle failed");
      setRepos((prev) => prev.map((r) => (r.id === repo.id ? { ...r, enabled: !r.enabled } : r)));
      toast.success(`${repo.name} ${repo.enabled ? "disabled" : "enabled"}`);
    } catch {
      toast.error("Failed to toggle repo");
    }
  };

  const updatePriority = async (repo: CmRepo) => {
    const newPriority = editingPriority[repo.id];
    if (newPriority === undefined || newPriority === repo.priority) return;
    try {
      const res = await fetch(`/api/cm/repos/${repo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: newPriority }),
      });
      if (!res.ok) throw new Error("Update failed");
      setRepos((prev) => prev.map((r) => (r.id === repo.id ? { ...r, priority: newPriority } : r)));
      toast.success(`Priority updated for ${repo.name}`);
    } catch {
      toast.error("Failed to update priority");
    }
  };

  const deleteRepo = async (repo: CmRepo) => {
    if (!confirm(`Remove ${repo.name} from the pipeline?`)) return;
    try {
      const res = await fetch(`/api/cm/repos/${repo.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setRepos((prev) => prev.filter((r) => r.id !== repo.id));
      toast.success(`${repo.name} removed`);
    } catch {
      toast.error("Failed to remove repo");
    }
  };

  const runNow = async (repo: CmRepo) => {
    try {
      const res = await fetch("/api/cm/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_id: repo.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to enqueue scan");
      toast.success(`Scan enqueued for ${repo.name}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to enqueue scan");
    }
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const runSelected = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setIsRunningSelected(true);
    try {
      const res = await fetch("/api/cm/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_ids: ids }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to enqueue scans");
      toast.success(`${ids.length} scan(s) enqueued`);
      setSelectedIds(new Set());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to enqueue scans");
    } finally {
      setIsRunningSelected(false);
    }
  };

  const addManualRepo = async () => {
    if (!addOwner.trim() || !addName.trim()) {
      toast.warning("Owner and name required");
      return;
    }
    try {
      const res = await fetch("/api/cm/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: addOwner.trim(), name: addName.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to add repo");
      toast.success(`${addName} added`);
      setAddOwner("");
      setAddName("");
      setShowAddForm(false);
      await fetchRepos();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to add repo");
    }
  };

  if (isLoading) {
    return <div className="cm-placeholder" style={{ padding: "40px", textAlign: "center", color: "var(--text-dim)" }}>Loading repos...</div>;
  }

  return (
    <div>
      <div className="rt-actions">
        <Button onClick={handleDiscover} disabled={isDiscovering} className="rt-btn rt-btn--primary" style={{ backgroundColor: "var(--amber)", color: "var(--surface)" }}>
          {isDiscovering ? "Discovering..." : "Discover Now"}
        </Button>
        <Button onClick={() => setShowAddForm(!showAddForm)} className="rt-btn rt-btn--ghost">
          {showAddForm ? "Cancel" : "+ Add Manual"}
        </Button>
        <Button
          onClick={runSelected}
          disabled={selectedIds.size === 0 || isRunningSelected}
          className="rt-btn rt-btn--primary"
          style={{ backgroundColor: selectedIds.size > 0 ? "var(--green, #34d399)" : "var(--border)", color: "var(--surface)" }}
        >
          {isRunningSelected ? "Running..." : `Run Selected (${selectedIds.size})`}
        </Button>
      </div>

      {showAddForm && (
        <div className="rt-add-form">
          <Input value={addOwner} onChange={(e) => setAddOwner(e.target.value)} placeholder="Owner (e.g. my-org)" className="rt-input" />
          <Input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Repo name (e.g. ms-frontend)" className="rt-input" />
          <Button onClick={addManualRepo} className="rt-btn rt-btn--primary" style={{ backgroundColor: "var(--amber)", color: "var(--surface)" }}>Add</Button>
        </div>
      )}

      {repos.length === 0 ? (
        <div className="cm-placeholder" style={{ marginTop: "16px" }}>
          <p>No repos registered. Click &ldquo;Discover Now&rdquo; or add one manually.</p>
        </div>
      ) : (
        <div className="rt-table">
          <div className="rt-header">
            <span className="rt-col rt-col--checkbox">
              <input type="checkbox" onChange={() => {
                if (selectedIds.size === repos.length) setSelectedIds(new Set());
                else setSelectedIds(new Set(repos.map((r) => r.id)));
              }} checked={selectedIds.size === repos.length && repos.length > 0} aria-label="Select all repos" />
            </span>
            <span className="rt-col rt-col--name">Repo</span>
            <span className="rt-col rt-col--source">Source</span>
            <span className="rt-col rt-col--priority">Priority</span>
            <span className="rt-col rt-col--enabled">Active</span>
            <span className="rt-col rt-col--actions">Actions</span>
          </div>
          {repos.map((repo) => (
            <div key={repo.id} className="rt-row">
              <span className="rt-col rt-col--checkbox">
                <input type="checkbox" checked={selectedIds.has(repo.id)} onChange={() => toggleSelected(repo.id)} aria-label={`Select ${repo.name}`} />
              </span>
              <span className="rt-col rt-col--name">
                <span className="rt-repo-name">{repo.owner}/{repo.name}</span>
                <span className="rt-branch">{repo.default_branch}</span>
              </span>
              <span className="rt-col rt-col--source">
                <span className={`rt-source-badge ${repo.source === "auto" ? "rt-source-auto" : "rt-source-manual"}`}>
                  {repo.source}
                </span>
              </span>
              <span className="rt-col rt-col--priority">
                <Input
                  type="number"
                  min={0}
                  value={editingPriority[repo.id] ?? repo.priority}
                  onChange={(e) => setEditingPriority((prev) => ({ ...prev, [repo.id]: parseInt(e.target.value, 10) || 0 }))}
                  onBlur={() => updatePriority(repo)}
                  className="rt-priority-input"
                />
              </span>
              <span className="rt-col rt-col--enabled">
                <Switch checked={repo.enabled} onCheckedChange={() => toggleEnabled(repo)} />
              </span>
              <span className="rt-col rt-col--actions">
                <div className="rt-action-btns">
                  <button onClick={() => runNow(repo)} className="rt-action-btn" title="Run scan now">▶</button>
                  <button onClick={() => deleteRepo(repo)} className="rt-action-btn rt-action-danger" title="Remove">✕</button>
                </div>
              </span>
            </div>
          ))}
        </div>
      )}

      <style jsx>{`
        .rt-actions { display: flex; gap: 8px; margin-bottom: 16px; }
        .rt-btn { font-size: 12px; padding: 8px 20px; border: 1px solid var(--border); cursor: pointer; border-radius: 4px; }
        .rt-btn--primary { border: none; }
        .rt-btn--ghost { background: transparent; color: var(--text-secondary); }
        .rt-add-form { display: flex; gap: 8px; margin-bottom: 16px; align-items: center; }
        .rt-input { flex: 1; }
        .rt-table { border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
        .rt-header { display: flex; padding: 10px 16px; background: var(--surface-overlay); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-dim); border-bottom: 1px solid var(--border); }
        .rt-row { display: flex; padding: 10px 16px; border-bottom: 1px solid var(--border); align-items: center; font-size: 12px; }
        .rt-row:last-child { border-bottom: none; }
        .rt-col--checkbox { flex: 0.3; display: flex; align-items: center; }
        .rt-col--checkbox input { width: 14px; height: 14px; cursor: pointer; }
        .rt-col--name { flex: 3; display: flex; flex-direction: column; gap: 2px; }
        .rt-col--source { flex: 1; }
        .rt-col--priority { flex: 1; }
        .rt-col--enabled { flex: 0.5; }
        .rt-col--actions { flex: 1; }
        .rt-repo-name { color: var(--text-primary); font-family: var(--font-geist-mono), monospace; font-size: 12px; }
        .rt-branch { font-size: 10px; color: var(--text-dim); }
        .rt-source-badge { font-size: 10px; padding: 2px 8px; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.05em; }
        .rt-source-auto { background: rgba(52,211,153,0.1); color: #34d399; }
        .rt-source-manual { background: rgba(251,191,36,0.1); color: #fbbf24; }
        .rt-priority-input { width: 70px; font-size: 12px; text-align: center; }
        .rt-action-btns { display: flex; gap: 4px; }
        .rt-action-btn { background: var(--surface-overlay); border: 1px solid var(--border); border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 11px; color: var(--text-secondary); transition: all 0.15s; }
        .rt-action-btn:hover { background: var(--amber-glow); color: var(--amber); }
        .rt-action-danger:hover { background: rgba(248,113,113,0.1); color: #f87171; }
      `}</style>
    </div>
  );
}

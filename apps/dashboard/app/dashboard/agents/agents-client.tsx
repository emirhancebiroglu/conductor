"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { AgentCategorySection } from "@/app/dashboard/agents/components/agent-category-section";
import { CategoryManager } from "@/app/dashboard/agents/components/category-manager";
import { CreateAgentDrawer } from "@/app/dashboard/agents/components/create-agent-drawer";
import { ProviderManager } from "@/app/dashboard/agents/components/provider-manager";
import { Button } from "@/components/ui/button";
import type {
  AgentConfig,
  AgentCategory,
  ProviderModel,
  RunningJob,
  AgentConfigRow,
  AgentCategoryRow,
  JobRow,
  RunRow,
} from "@conductor/core";

interface Props {
  readonly initialAgents: AgentConfig[];
  readonly initialCategories: AgentCategory[];
  readonly providerModels: ProviderModel[];
  readonly initialRunningJobs: RunningJob[];
}

export function AgentsClient({
  initialAgents,
  initialCategories,
  providerModels,
  initialRunningJobs,
}: Props) {
  const [agents, setAgents] = useState<AgentConfig[]>(initialAgents);
  const [categories, setCategories] = useState<AgentCategory[]>(initialCategories);
  const [models] = useState<ProviderModel[]>(providerModels);
  const [runningJobs, setRunningJobs] = useState<RunningJob[]>(initialRunningJobs);
  const [lastRuns, setLastRuns] = useState<Record<string, { id: string; jobId: string; jobTitle: string; status: string; createdAt: string }>>({});

  const [isCategoryManagerOpen, setIsCategoryManagerOpen] = useState(false);
  const [isCreateDrawerOpen, setIsCreateDrawerOpen] = useState(false);
  const [isProviderManagerOpen, setIsProviderManagerOpen] = useState(false);

  const agentConfigCallbackRef = useRef<((payload: { new: AgentConfigRow }) => void) | null>(null);
  const categoryCallbackRef = useRef<((payload: { new: AgentCategoryRow; eventType: string }) => void) | null>(null);
  const jobsCallbackRef = useRef<((payload: { new: JobRow; old?: JobRow }) => void) | null>(null);
  const runsCallbackRef = useRef<((payload: { new: RunRow }) => void) | null>(null);

  useEffect(() => {
    const supabase = createClient();

    // Fetch last run per agent
    const fetchLastRuns = async () => {
      const { data, error } = (await supabase
        .from("runs")
        .select("id, job_id, agent, status, created_at")
        .order("created_at", { ascending: false })) as unknown as {
        data: RunRow[] | null;
        error: unknown;
      };

      if (!error && data) {
        const latest: Record<string, { id: string; jobId: string; jobTitle: string; status: string; createdAt: string }> = {};
        const jobIds = new Set<string>();
        for (const r of data) {
          if (!latest[r.agent]) {
            latest[r.agent] = { id: r.id, jobId: r.job_id, jobTitle: r.job_id.split("-")[0] ?? "", status: r.status, createdAt: r.created_at };
            jobIds.add(r.job_id);
          }
        }
        if (jobIds.size > 0) {
          const { data: jobsData } = (await supabase.from("jobs").select("id, title").in("id", [...jobIds])) as unknown as { data: { id: string; title: string }[] | null };
          if (jobsData) {
            const titleMap = new Map(jobsData.map((j) => [j.id, j.title ?? ""]));
            for (const run of Object.values(latest)) {
              run.jobTitle = titleMap.get(run.jobId) ?? run.jobTitle;
            }
          }
        }
        setLastRuns(latest);
      }
    };
    void fetchLastRuns();

    // Realtime: agent_config changes
    const handleConfigUpdate = (payload: { new: AgentConfigRow }) => {
      const row = payload.new;
      setAgents((prev) => prev.map((a) =>
        a.agentName === row.agent_name
          ? {
              id: row.id,
              agentName: row.agent_name,
              displayName: row.display_name,
              role: row.role,
              provider: row.provider,
              model: row.model,
              systemPrompt: row.system_prompt,
              skillContent: row.skill_content,
              categoryId: row.category_id,
              enabled: row.enabled,
              laneOverride: row.lane_override,
              order: row.order,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            }
          : a
      ));
    };
    agentConfigCallbackRef.current = handleConfigUpdate;

    const configChannel = supabase
      .channel("agents-page-config-changes")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "agent_config" }, handleConfigUpdate as never)
      .subscribe();

    // Realtime: categories
    const handleCategoryChange = (payload: { new: AgentCategoryRow; eventType: string }) => {
      const row = payload.new;
      const cat: AgentCategory = {
        id: row.id,
        name: row.name,
        slug: row.slug,
        color: row.color,
        description: row.description,
        order: row.order,
        createdAt: row.created_at,
      };
      if (payload.eventType === "INSERT") {
        setCategories((prev) => [...prev, cat].sort((a, b) => a.order - b.order));
      } else if (payload.eventType === "UPDATE") {
        setCategories((prev) => prev.map((c) => (c.id === cat.id ? cat : c)));
      } else if (payload.eventType === "DELETE") {
        setCategories((prev) => prev.filter((c) => c.id !== cat.id));
      }
    };
    categoryCallbackRef.current = handleCategoryChange;

    const categoryChannel = supabase
      .channel("agents-page-category-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "agent_categories" }, handleCategoryChange as never)
      .subscribe();

    // Realtime: jobs — track running agents
    const handleJobsUpdate = (payload: { new: JobRow; old?: JobRow }) => {
      const newJob = payload.new;
      const oldJob = payload.old;
      const hadAgent = !!oldJob?.current_agent;
      const hasAgent = !!newJob.current_agent;

      if (!hadAgent && hasAgent) {
        setRunningJobs((prev) => {
          if (prev.some((j) => j.jobId === newJob.id)) return prev;
          return [...prev, { jobId: newJob.id, jobTitle: newJob.title, agentName: newJob.current_agent!, startedAt: newJob.started_at || new Date().toISOString(), stepMessage: newJob.current_step_message }];
        });
      } else if (hadAgent && hasAgent) {
        setRunningJobs((prev) => prev.map((j) => j.jobId === newJob.id ? { ...j, agentName: newJob.current_agent!, stepMessage: newJob.current_step_message } : j));
      } else if (hadAgent && !hasAgent) {
        setRunningJobs((prev) => prev.filter((j) => j.jobId !== newJob.id));
      }
    };
    jobsCallbackRef.current = handleJobsUpdate;

    const jobsChannel = supabase
      .channel("agents-page-jobs-changes")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "jobs" }, handleJobsUpdate as never)
      .subscribe();

    // Realtime: runs — update last run per agent
    const handleRunInsert = (payload: { new: RunRow }) => {
      const run = payload.new;
      setLastRuns((prev) => ({ ...prev, [run.agent]: { id: run.id, jobId: run.job_id, jobTitle: prev[run.agent]?.jobTitle ?? "", status: run.status, createdAt: run.created_at } }));
    };
    runsCallbackRef.current = handleRunInsert;

    const runsChannel = supabase
      .channel("agents-page-runs-changes")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "runs" }, handleRunInsert as never)
      .subscribe();

    // E2E test bridge
    const handleTestRealtime = (e: Event) => {
      const detail = (e as CustomEvent<{ table: string; payload: Record<string, unknown> }>).detail;
      if (detail.table === "agent_config" && agentConfigCallbackRef.current) agentConfigCallbackRef.current(detail.payload as never);
      else if (detail.table === "agent_categories" && categoryCallbackRef.current) categoryCallbackRef.current(detail.payload as never);
      else if (detail.table === "jobs" && jobsCallbackRef.current) jobsCallbackRef.current(detail.payload as never);
      else if (detail.table === "runs" && runsCallbackRef.current) runsCallbackRef.current(detail.payload as never);
    };
    window.addEventListener("__test_realtime", handleTestRealtime);

    if (typeof window !== "undefined" && process.env["NODE_ENV"] !== "production") {
      (window as unknown as Record<string, unknown>).__simulateRealtimeEvent = (table: string, payload: Record<string, unknown>) => {
        window.dispatchEvent(new CustomEvent("__test_realtime", { detail: { table, payload } }));
      };
    }

    return () => {
      void supabase.removeChannel(configChannel);
      void supabase.removeChannel(categoryChannel);
      void supabase.removeChannel(jobsChannel);
      void supabase.removeChannel(runsChannel);
      window.removeEventListener("__test_realtime", handleTestRealtime);
    };
  }, []);

  // Group agents by category
  const agentsByCategoryId: Record<string, AgentConfig[]> = {};
  const uncategorized: AgentConfig[] = [];

  for (const agent of agents) {
    if (agent.categoryId) {
      if (!agentsByCategoryId[agent.categoryId]) agentsByCategoryId[agent.categoryId] = [];
      agentsByCategoryId[agent.categoryId]!.push(agent);
    } else {
      uncategorized.push(agent);
    }
  }

  const lastRunsSimple: Record<string, { status: string } | undefined> = {};
  for (const [k, v] of Object.entries(lastRuns)) {
    lastRunsSimple[k] = { status: v.status };
  }

  const activeCount = agents.filter((a) => a.enabled).length;
  const runningCount = runningJobs.length;

  return (
    <div className="agents-page">
      {/* ── Header ── */}
      <header className="agents-header">
        <div>
          <p className="agents-eyebrow">System · Realtime</p>
          <h1 className="agents-title">Agents</h1>
        </div>

        <div className="agents-header-right">
          <div className="agents-stats">
            <div className="agents-stat">
              <span className="agents-stat-label">Total</span>
              <span className="agents-stat-value">{agents.length}</span>
            </div>
            <div className="agents-stat-divider" />
            <div className="agents-stat">
              <span className="agents-stat-label">Active</span>
              <span className="agents-stat-value agents-stat-value--green">{activeCount}</span>
            </div>
            <div className="agents-stat-divider" />
            <div className="agents-stat">
              <span className="agents-stat-label">Running</span>
              <span className={`agents-stat-value${runningCount > 0 ? " agents-stat-value--amber" : ""}`}>
                {runningCount > 0 && <span className="agents-running-dot" />}
                {runningCount}
              </span>
            </div>
          </div>

          <div className="agents-action-row">
            <Button variant="outline" onClick={() => setIsProviderManagerOpen(true)} className="agents-providers-btn">
              Providers
            </Button>
            <Button variant="outline" onClick={() => setIsCategoryManagerOpen(true)} className="agents-providers-btn">
              Categories
            </Button>
            <button
              onClick={() => setIsCreateDrawerOpen(true)}
              className="agents-new-btn"
            >
              + New Agent
            </button>
          </div>
        </div>
      </header>

      {/* ── Category sections ── */}
      <div className="agents-categories">
        {categories.map((cat, i) => (
          <AgentCategorySection
            key={cat.id}
            category={cat}
            agents={agentsByCategoryId[cat.id] ?? []}
            runningJobs={runningJobs}
            lastRuns={lastRunsSimple}
            index={i}
          />
        ))}

        {uncategorized.length > 0 && (
          <AgentCategorySection
            category={null}
            agents={uncategorized}
            runningJobs={runningJobs}
            lastRuns={lastRunsSimple}
            index={categories.length}
          />
        )}

        {agents.length === 0 && (
          <div className="agents-empty">
            <p>No agents configured. Create your first agent to get started.</p>
            <button onClick={() => setIsCreateDrawerOpen(true)} className="agents-new-btn" style={{ marginTop: "12px" }}>
              + New Agent
            </button>
          </div>
        )}
      </div>

      {/* ── Panels ── */}
      <CategoryManager
        isOpen={isCategoryManagerOpen}
        onOpenChange={setIsCategoryManagerOpen}
        categories={categories}
        onCategoriesChange={setCategories}
      />

      <CreateAgentDrawer
        isOpen={isCreateDrawerOpen}
        onOpenChange={setIsCreateDrawerOpen}
        categories={categories}
        providerModels={models}
        onAgentCreated={(agent) => setAgents((prev) => [...prev, agent])}
      />

      <ProviderManager
        isOpen={isProviderManagerOpen}
        onOpenChange={setIsProviderManagerOpen}
        models={models}
        onModelsChange={() => { /* provider models are read-only in this context */ }}
      />
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAny = any;

export interface AgentConfig {
  id: string;
  agentName: string;
  displayName: string;
  role: string;
  provider: string;
  model: string;
  systemPrompt: string;
  skillContent: string | null;  // actual skill markdown content (replaces skillPath)
  categoryId: string | null;
  enabled: boolean;
  laneOverride: "cheap" | "premium" | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

// Module-level in-memory cache
const cache = new Map<string, AgentConfig>();

/**
 * Loads all agent configurations from the database and caches them in memory.
 * Handles errors gracefully by logging a warning and returning false.
 */
export async function loadAgentConfig(supabase: SupabaseAny): Promise<boolean> {
  try {
    if (!supabase) {
      console.warn("[agentConfig] Supabase client is undefined. Skipping load.");
      return false;
    }

    const { data, error } = await supabase
      .from("agent_config")
      .select("*")
      .order("order", { ascending: true });

    if (error) {
      console.warn(`[agentConfig] Failed to fetch agent configurations from DB: ${error.message}`);
      return false;
    }

    if (!data || !Array.isArray(data)) {
      console.warn("[agentConfig] No agent configurations found in DB.");
      return false;
    }

    // Clear current cache first
    cache.clear();

    // Map columns from snake_case to camelCase and populate cache
    for (const row of data) {
      const config: AgentConfig = {
        id: row.id,
        agentName: row.agent_name,
        displayName: row.display_name,
        role: row.role,
        provider: row.provider,
        model: row.model,
        systemPrompt: row.system_prompt,
        skillContent: row.skill_content ?? null,
        categoryId: row.category_id ?? null,
        enabled: row.enabled,
        laneOverride: row.lane_override,
        order: row.order,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
      cache.set(config.agentName, config);
    }

    return true;
  } catch (err: any) {
    console.warn(`[agentConfig] Unexpected error in loadAgentConfig: ${err.message || String(err)}`);
    return false;
  }
}

/**
 * Retrieves a single agent configuration from the cache.
 * Returns null if the agent name is not found.
 */
export function getAgentConfig(agentName: string): AgentConfig | null {
  return cache.get(agentName) ?? null;
}

/**
 * Clears the in-memory agent configuration cache.
 */
export function invalidateConfigCache(): void {
  cache.clear();
}

import { AgentConfigSchema, AgentCategorySchema } from "@conductor/core";
import type { AgentConfigRow, AgentCategoryRow } from "@conductor/core";

function safeDate(value: string | null | undefined): string {
  if (!value) return new Date().toISOString();
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

/** Map a raw DB agent_config row (snake_case) to validated AgentConfig (camelCase). */
export function mapAgentRow(row: AgentConfigRow) {
  return AgentConfigSchema.parse({
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
    allowedTools: row.allowed_tools ?? [],
    order: row.order,
    createdAt: safeDate(row.created_at),
    updatedAt: safeDate(row.updated_at),
  });
}

/** Map a raw DB agent_categories row to validated AgentCategory. */
export function mapCategoryRow(row: AgentCategoryRow) {
  return AgentCategorySchema.parse({
    id: row.id,
    name: row.name,
    slug: row.slug,
    color: row.color,
    description: row.description,
    order: row.order,
    createdAt: safeDate(row.created_at),
  });
}

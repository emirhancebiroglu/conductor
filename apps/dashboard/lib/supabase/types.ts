import type {
  ProjectRow,
  JobRow,
  RunRow,
  UsageLogRow,
  ApprovalRow,
  AgentConfigRow,
  ProviderModelRow,
} from "@conductor/core";

export type Database = {
  public: {
    Tables: {
      projects: {
        Row: ProjectRow;
        Insert: Omit<ProjectRow, "id" | "created_at">;
        Update: Partial<Omit<ProjectRow, "id">>;
      };
      jobs: {
        Row: JobRow;
        Insert: Omit<JobRow, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<JobRow, "id">>;
      };
      runs: {
        Row: RunRow;
        Insert: Omit<RunRow, "id" | "created_at">;
        Update: Partial<Omit<RunRow, "id">>;
      };
      usage_log: {
        Row: UsageLogRow;
        Insert: Omit<UsageLogRow, "id" | "created_at">;
        Update: Partial<Omit<UsageLogRow, "id">>;
      };
      approvals: {
        Row: ApprovalRow;
        Insert: Omit<ApprovalRow, "id">;
        Update: Partial<Omit<ApprovalRow, "id">>;
      };
      agent_config: {
        Row: AgentConfigRow;
        Insert: Omit<AgentConfigRow, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<AgentConfigRow, "id">>;
      };
      provider_models: {
        Row: ProviderModelRow;
        Insert: Omit<ProviderModelRow, "id" | "created_at">;
        Update: Partial<Omit<ProviderModelRow, "id">>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};

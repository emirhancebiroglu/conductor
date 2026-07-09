-- cm_finding.description and cm_finding.taint_flow are read/written throughout
-- apps/cm-worker (scan.ts upsert, fix-graph.ts CmFindingRow/rowToFinding) but
-- were never added by any prior migration.
alter table cm_finding add column if not exists description text;
alter table cm_finding add column if not exists taint_flow jsonb;

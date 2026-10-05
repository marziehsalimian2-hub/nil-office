-- =============================================================================
-- NIL Office — Factory Reset DRY RUN REPORT (read-only). Run AFTER migration 0141. Changes NOTHING, stores nothing.
-- The Supabase SQL editor shows only the LAST result of a script, so run each numbered query on its own (select it, Run).
-- Edit the baselines in the first argument if needed: the number given is the LAST USED number (next = value + 1).
-- The same information (stored as a time-limited plan) is available on /settings/system/factory-reset → «اجرای Dry Run».
-- =============================================================================

-- 1) One-glance summary: executable?, totals, unknown tables, FK blockers, admins, storage counts, warnings
select
  (p ->> 'executable')::boolean                           as executable,
  p #>> '{totals,tables}'                                  as tables_to_delete,
  p #>> '{totals,rows_to_delete}'                          as rows_to_delete,
  p #>> '{totals,audit_rows_to_delete}'                    as audit_rows_to_delete,
  p #>> '{totals,storage_objects_to_delete}'               as storage_objects_to_delete,
  p #>> '{storage,preserve_count}'                         as storage_preserved,
  p #>> '{storage,unknown_count}'                          as storage_unknown,
  p -> 'unknown_tables'                                    as unknown_tables,
  p -> 'fk_blockers'                                       as fk_blockers,
  p -> 'missing_manifest_objects'                          as missing_manifest_objects,
  p #>> '{admins_preserved,count}'                         as admins_preserved,
  p -> 'orphan_risks'                                      as orphan_risks,
  p -> 'warnings'                                          as warnings,
  p ->> 'manifest_hash'                                    as manifest_hash
from (select public.system_reset_preview('OPERATIONAL', '{"current_year":1405,"baselines":{"OUTGOING":69,"INCOMING":18}}'::jsonb) as p) x;

-- 2) Rows per table that WOULD be deleted (non-empty only), biggest first
select t ->> 'name' as table_name, t ->> 'module' as module, (t ->> 'rows')::bigint as rows, t ->> 'risk' as risk, t ->> 'storage' as files
from (select public.system_reset_preview('OPERATIONAL', '{"current_year":1405,"baselines":{"OUTGOING":69,"INCOMING":18}}'::jsonb) as p) x,
     jsonb_array_elements(x.p -> 'tables_to_delete') t
where (t ->> 'rows')::bigint > 0
order by (t ->> 'rows')::bigint desc;

-- 3) What is PRESERVED (rows kept per table)
select t ->> 'name' as table_name, t ->> 'method' as method, (t ->> 'rows')::bigint as rows, t ->> 'reason' as reason
from (select public.system_reset_preview('OPERATIONAL', '{"current_year":1405,"baselines":{"OUTGOING":69,"INCOMING":18}}'::jsonb) as p) x,
     jsonb_array_elements(x.p -> 'tables_preserved') t
order by t ->> 'name';

-- 4) Numbering after the reset (current numbers -> value after reset) and the files by class
select 'sequence' as kind, s ->> 'scope' as item, s ->> 'year' as year, s ->> 'from' as current_value, s ->> 'to' as after_reset
from (select public.system_reset_preview('OPERATIONAL', '{"current_year":1405,"baselines":{"OUTGOING":69,"INCOMING":18}}'::jsonb) as p) x,
     jsonb_array_elements(x.p #> '{sequences,number_sequences}') s
union all
select 'storage', action, null, count(*)::text, null from public._srs_storage_classify() group by action
order by 1, 2;

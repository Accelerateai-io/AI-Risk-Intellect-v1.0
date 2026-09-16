-- Truncate all public tables except preserved reference data.
-- Preserved: users, risk_mappings
--
-- Run from CMD (psql must be on PATH):
--   psql -U postgres -d ai_risk_db -f "C:\2026_Projects_Ongoing\AI Risk Intellect\19Jun2026\AI_Risk_Intellect_V1\backend\scripts\truncate-db-except-preserved.sql"
--
-- Or in pgAdmin: open this file and execute (F5).

BEGIN;

-- Preview tables that will be truncated (optional; comment out if not needed)
SELECT tablename AS will_be_truncated
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename NOT IN ('users', 'risk_mappings', 'ingest_link_items', 'ingest_links')
  -- AND tablename NOT IN ('users', 'risk_mappings')
ORDER BY tablename;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN ('users', 'risk_mappings', 'ingest_link_items', 'ingest_links')
      -- AND tablename NOT IN ('users', 'risk_mappings')
  LOOP
    RAISE NOTICE 'Truncating table: %', r.tablename;
    EXECUTE format(
      'TRUNCATE TABLE %I RESTART IDENTITY CASCADE',
      r.tablename
    );
  END LOOP;
END $$;

COMMIT;

-- Preserved tables (should still contain data):
SELECT tablename AS preserved_table
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('users', 'risk_mappings', 'ingest_link_items', 'ingest_links')
  -- AND tablename IN ('users', 'risk_mappings')
ORDER BY tablename;

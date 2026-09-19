-- Events read promotion — sprint 79 (Track A of the billion-dollar
-- program: unbounded audit spine).
--
-- Two inert seams closed:
--
-- 1. org_id backfill. The events.org_id column (and its partial
--    index events_org_created_idx) existed since the base schema,
--    but the dual-write writer never populated it — every row
--    landed with org_id NULL and the org identity buried in
--    payload->>'orgId'. The sprint-79 writer fix populates the
--    column going forward; this backfill repairs the BG-2.2..79
--    historical rows so the indexed org cut covers the full PG
--    corpus, not just post-fix rows.
--
--    The EXISTS guard respects the FK (org_id REFERENCES
--    organisations ON DELETE SET NULL): a payload orgId with no
--    surviving organisations row stays NULL — same posture the FK
--    itself would enforce on delete.
--
-- 2. Entity-tuple index. listForEntity promotes to a PG cut over
--    (payload->>'entityType', payload->>'entityId') — without an
--    expression index that's a sequential scan per timeline render.
--    Partial (entityType present) so the many entity-less analytics
--    rows (ai_call, import_plan_generated, …) stay out of the tree.

UPDATE events e
   SET org_id = (e.payload->>'orgId')::bigint
 WHERE e.org_id IS NULL
   AND e.payload->>'orgId' ~ '^[0-9]+$'
   AND EXISTS (
     SELECT 1 FROM organisations o
      WHERE o.id = (e.payload->>'orgId')::bigint
   );

CREATE INDEX IF NOT EXISTS events_entity_created_idx
  ON events ((payload->>'entityType'), (payload->>'entityId'), created_at)
  WHERE payload->>'entityType' IS NOT NULL;

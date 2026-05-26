-- RBAC role-vocabulary expansion (apex plan III1, slice 1).
--
-- The memberships.role CHECK shipped allowing only (owner | admin | member).
-- Enterprise org charts need the six canonical roles defined in lib/rbac.js:
-- owner, admin, analyst, finance, compliance_officer, viewer. 'member' is kept
-- as a legacy alias (= viewer in the permission matrix) so existing rows stay
-- valid; new seats are assigned one of the six.
--
-- Idempotent + auto-discovered by scripts/db-migrate.js. Drop-then-add the
-- named constraint so re-running converges to the widened set.

ALTER TABLE memberships
  DROP CONSTRAINT IF EXISTS memberships_role_check;

ALTER TABLE memberships
  ADD CONSTRAINT memberships_role_check
  CHECK (role IN ('owner', 'admin', 'analyst', 'finance', 'compliance_officer', 'viewer', 'member'));

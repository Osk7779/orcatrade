// Thin client for the existing OrcaTrade API. The app shell is proxied onto the
// SAME origin (orcatrade.pl/app), so '/api/...' hits the repo-root handlers and
// the magic-link session cookie rides along automatically. No new backend.

export class AuthError extends Error {
  constructor() {
    super('Not signed in');
    this.name = 'AuthError';
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (res.status === 401) throw new AuthError();
  if (!res.ok) throw new Error(`API ${path} failed: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new AuthError();
  if (!res.ok) throw new Error(`API ${path} failed: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (res.status === 401) throw new AuthError();
  if (!res.ok) throw new Error(`API ${path} failed: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// A saved plan as returned (enriched) by GET /api/plans.
export interface PlanInputs {
  productCategory?: string;
  originCountry?: string;
  destinationCountry?: string;
  customsValueEur?: number;
  hsCode?: string;
}
export interface PlanDelta {
  landedDeltaEur?: number;
  landedDeltaPct?: number;
  significant?: boolean;
  primaryDriver?: string | null;
  daysSinceSaved?: number;
  // Per-component movement since save — exposed by lib/plan-diff.js so the
  // detail view can show "what changed" line by line.
  components?: { dutyEur?: number; vatEur?: number; transportEur?: number; brokerageEur?: number };
  dutyRateDelta?: number | null;
}
export interface CostSnapshot {
  perShipmentLandedTotal?: number;
  dutyEur?: number;
  vatEur?: number;
  transportEur?: number;
  brokerageEur?: number;
  dutyRatePct?: number;
}
export interface SavedPlan {
  id: string;
  label?: string;
  savedAt?: string;
  inputs?: PlanInputs;
  snapshot?: CostSnapshot | null;
  current?: CostSnapshot | null;
  delta?: PlanDelta | null;
  // Reproducibility verdict computed once per request (apex III3 surfaced inline).
  reproducible?: boolean | null;
  dataDrifted?: boolean | null;
  dataSnapshotId?: string | null;
  currentDataSnapshotId?: string | null;
}

// GET /api/plans/<id>/reproduce — reproducibility / data-drift verdict (III3)
export interface DriftChange { field: string; label?: string; from: unknown; to: unknown }
export interface Reproduction {
  ok: boolean;
  reproducible: boolean;
  status: 'data-unchanged' | 'data-drifted' | 'drift-snapshot-unavailable' | 'no-snapshot-bound';
  message?: string;
  storedSnapshotId?: string | null;
  currentSnapshotId?: string | null;
  drift?: DriftChange[];
  landedReproduction?: {
    original: { perShipmentLandedTotal?: number; dutyEur?: number };
    current: { perShipmentLandedTotal?: number; dutyEur?: number } | null;
  } | null;
}

// GET/POST /api/account/preferences
export interface Prefs {
  planRevisionEmails?: boolean;
  weeklyDigestEmails?: boolean;
  complianceDeadlineEmails?: boolean;
  monitoringAlerts?: boolean;
  locale?: string;
  updatedAt?: string;
}

// GET /api/portfolio/list
export interface SavedPortfolio {
  id: string;
  label?: string;
  savedAt?: string;
  lineCount?: number;
  snapshot?: {
    blendedDutyRatePct?: number;
    consolidationSavingEur?: number;
    totals?: { perShipmentLandedTotal?: number };
  } | null;
}

// GET /api/account/alerts
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export interface Alert {
  id: string;
  type: string;
  severity: Severity;
  title: string;
  body?: string;
  status: 'open' | 'read' | 'dismissed';
}

// GET /api/account/calendar
export interface Obligation {
  regime?: string;
  title?: string;
  detail?: string;
  citation?: string;
  dueDate?: string;
  daysUntil?: number;
  severity?: Severity;
}

// POST /api/screen
export interface ScreenMatch {
  id?: string;
  name?: string;
  type?: string | null;
  programme?: string | null;
  listSource?: string | null;
  score?: number;
  matchedOn?: string | null;
}
export interface ScreenResult {
  query: string;
  status: 'potential_match' | 'no_match' | 'no_sample_match' | 'invalid';
  authoritative?: boolean;
  listSource?: string | null;
  matchCount?: number;
  matches?: ScreenMatch[];
  advisory?: string;
}

// POST /api/documents { action: 'audit' }
export interface AuditFinding {
  severity: Severity;
  code: string;
  message: string;
}
export interface AuditResult {
  ok: boolean;
  documentType?: string;
  verdict?: 'blocking_issues' | 'review_needed' | 'minor_issues' | 'consistent';
  counts?: Record<string, number>;
  findings?: AuditFinding[];
  advisory?: string;
  extraction?: { extractedFields?: string[]; missingFields?: string[]; confidence?: string };
}

// Shape of GET /api/account/overview (subset we render on the dashboard).
export interface Overview {
  user?: { email?: string };
  plans?: { count?: number; recent?: Array<{ id: string; label?: string; route?: string; landedEur?: number }> };
  portfolios?: { count?: number };
  compliance?: { count?: number; next?: { regime?: string; title?: string; dueDate?: string; daysUntil?: number } };
}

// GET /api/orgs (list) + GET /api/orgs/<id> (detail) — team / RBAC (III1)
export interface Org {
  id: string;
  name: string;
  ownerEmail?: string;
  planTier?: string;
}
export interface OrgMember {
  email: string;
  role: string;
  joinedAt?: string | null;
  invitedAt?: string;
}
export interface OrgDetail {
  ok: boolean;
  org: Org;
  members: OrgMember[];
  myRole: string;
  canManageMembers: boolean;
  assignableRoles: string[];
}

// GET/POST/DELETE /api/orgs/<id>/scim — SCIM provisioning token (owner-only)
export interface ScimStatus {
  ok: boolean;
  configured?: boolean;
  createdAt?: string | null;
  lastUsedAt?: string | null;
  endpoint?: string;
  token?: string; // present only in the POST (mint) response, shown once
}

// /api/documents — types + drafts + approval workflow (apex I5)
export type DraftStatus = 'pending_approval' | 'approved' | 'rejected';
export interface DocType {
  id: string;
  label: string;
  description: string;
}
export interface Draft {
  id: string;
  type: string;
  label?: string;
  status: DraftStatus;
  createdAt: string;
  updatedAt: string;
  decisionNotes?: string;
  decidedAt?: string;
}
export interface DraftWithHtml {
  ok: boolean;
  draft: Draft;
  html: string;
  idempotent?: boolean;
}

// /api/shipments — system-of-record operational entity (L1.3 of the
// strategic plan §4.1.2). Mirrors the data layer in lib/db/shipments.js
// but typed to only the fields the dashboard reads (camelCase).
export type ShipmentStatus =
  | 'planned'
  | 'booked'
  | 'in_transit'
  | 'cleared'
  | 'delivered'
  | 'exception'
  | 'cancelled';

export interface ShipmentDocument {
  docType?: string;
  name?: string;
  externalId?: string;
  url?: string;
  attachedAt?: string;
  draftRef?: string;
}

export interface ShipmentExceptionState {
  reason?: string;
  openedAt?: string;
  previousStatus?: ShipmentStatus;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  acknowledgmentNote?: string;
  [k: string]: unknown;
}

export interface Shipment {
  externalId: string;
  label: string;
  status: ShipmentStatus;
  originCountry?: string | null;
  destinationCountry?: string | null;
  customsValueCents?: number | null;
  weightKg?: number | null;
  containerCount?: number | null;
  goodsExternalId?: string | null;
  supplierExternalId?: string | null;
  plannedDepartureDate?: string | null;
  plannedArrivalDate?: string | null;
  carrier?: string | null;
  bookingRef?: string | null;
  blNumber?: string | null;
  actualDepartureDate?: string | null;
  eta?: string | null;
  lastKnownLocation?: string | null;
  clearedAt?: string | null;
  declarationRef?: string | null;
  dutyPaidCents?: number | null;
  vatPaidCents?: number | null;
  brokeragePaidCents?: number | null;
  deliveredAt?: string | null;
  exceptionState?: ShipmentExceptionState;
  documentVault?: ShipmentDocument[];
  inputsSnapshot?: Record<string, unknown> | null;
  quoteSnapshot?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

// /api/suppliers — Supplier master entity (L1.2 of the strategic plan).
// Typed to fields the dashboard list + detail views read.

export type SupplierSanctionsStatus = 'clear' | 'potential_match' | 'match' | 'pending';

export interface AuditCert {
  standard?: string;
  issuer?: string;
  certNumber?: string;
  issuedAt?: string;
  expiresAt?: string;
  evidenceUrl?: string;
  [k: string]: unknown;
}

export interface FactoryLocation {
  countryCode?: string;
  city?: string;
  role?: string;
  floorAreaSqm?: number;
  [k: string]: unknown;
}

export interface Supplier {
  externalId: string;
  entityName: string;
  legalForm?: string | null;
  hqCountry: string;
  registrationNumber?: string | null;
  registrationAuthority?: string | null;
  website?: string | null;
  factoryLocations?: FactoryLocation[];
  sanctionsLastScreenedAt?: string | null;
  sanctionsLastStatus?: SupplierSanctionsStatus | null;
  sanctionsLastMatchSummary?: Record<string, unknown>;
  auditCerts?: AuditCert[];
  lastOnSiteAuditDate?: string | null;
  eudrDdsEvidence?: Record<string, unknown>;
  trustScore?: number | null;
  trustScoreComputedAt?: string | null;
  trustScoreComponents?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

// /api/goods — Goods master entity (L1.1 of the strategic plan).
// Typed to the fields the dashboard list + detail views read.

export interface ReachSvhcFlag {
  cas?: string;
  name?: string;
  threshold_pct?: number;
  [k: string]: unknown;
}

export interface Goods {
  externalId: string;
  sku: string;
  displayName: string;
  hsCode: string;
  originCountry?: string | null;
  typicalUnitValueCents?: number | null;
  cbamInScope: boolean;
  reachSvhcFlags?: ReachSvhcFlag[];
  restrictedSubstances?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

// Canonical state-transition table. Mirrors lib/db/shipments.js
// VALID_TRANSITIONS exactly — a drift-guard test pins both sides.
// Used by the detail page to render only the legal next-state buttons
// from the shipment's current status.
export const SHIPMENT_VALID_TRANSITIONS: Readonly<Record<ShipmentStatus, ReadonlyArray<ShipmentStatus>>> = Object.freeze({
  planned: Object.freeze(['booked', 'exception', 'cancelled']),
  booked: Object.freeze(['in_transit', 'exception', 'cancelled']),
  in_transit: Object.freeze(['cleared', 'exception', 'cancelled']),
  cleared: Object.freeze(['delivered', 'exception']),
  delivered: Object.freeze(['exception']),
  exception: Object.freeze(['planned', 'booked', 'in_transit', 'cleared', 'delivered', 'cancelled']),
  cancelled: Object.freeze([]),
}) as Readonly<Record<ShipmentStatus, ReadonlyArray<ShipmentStatus>>>;

// Returned by GET /api/shipments/exceptions. Carries the full Shipment
// plus a computed _queue block with SLA fields.
export interface ExceptionQueueItem extends Shipment {
  _queue: {
    ageHours: number | null;
    acknowledged: boolean;
    acknowledgedAt: string | null;
    acknowledgedBy: string | null;
    slaBreached: boolean;
    slaThresholdHours: number;
  };
  exceptionState?: Record<string, unknown>;
}

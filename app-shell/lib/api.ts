// Thin client for the existing OrcaTrade API. The app shell is proxied onto the
// SAME origin (orcatrade.pl/app), so '/api/...' hits the repo-root handlers and
// the magic-link session cookie rides along automatically. No new backend.

export class AuthError extends Error {
  constructor() {
    super('Not signed in');
    this.name = 'AuthError';
  }
}

// Thrown when the API rejects a mutation with a 4xx and the response
// body carries a structured error bag. Used by the edit-mode forms
// to surface server-side validation errors inline (e.g. "hsCode must
// be 6-10 digits" coming back from goods.updateGoods). The handler
// shape is { error: string, errors?: string[] }; we capture both.
export class ApiError extends Error {
  status: number;
  errors: string[];
  constructor(status: number, summary: string, errors: string[]) {
    super(summary);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
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
  // 4xx: read the structured body and surface as ApiError — same
  // contract as apiPatch (PR #122). Callers that need only a binary
  // ok/error don't need to catch ApiError specifically (the message
  // is still useful), but flows that render per-field errors (e.g.
  // supplier re-screen, future POST forms) get them via err.errors.
  if (res.status >= 400 && res.status < 500) {
    let bag: { error?: string; errors?: string[] } = {};
    try { bag = await res.json(); } catch (_) { /* body wasn't JSON */ }
    const summary = bag.error || `API ${path} failed: HTTP ${res.status}`;
    const errors = Array.isArray(bag.errors) ? bag.errors.map(String) : (bag.error ? [bag.error] : []);
    throw new ApiError(res.status, summary, errors);
  }
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

// PATCH wrapper used by the inline edit-mode forms. Unlike apiPost,
// we surface 4xx response bodies as ApiError so the caller can render
// the per-field validation errors the handler returned (e.g. goods
// updateGoods's "hsCode must be 6-10 digits"). Non-4xx failures still
// throw a generic Error so callers don't have to special-case them.
export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new AuthError();
  if (res.status >= 400 && res.status < 500) {
    // 4xx: try to read the structured body. The handler returns
    // { error, errors? } for validation; some endpoints just return
    // { error }. We always surface BOTH.
    let bag: { error?: string; errors?: string[] } = {};
    try { bag = await res.json(); } catch (_) { /* body wasn't JSON */ }
    const summary = bag.error || `API ${path} failed: HTTP ${res.status}`;
    const errors = Array.isArray(bag.errors) ? bag.errors.map(String) : (bag.error ? [bag.error] : []);
    throw new ApiError(res.status, summary, errors);
  }
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
  // Legacy keys (pre-sprint-24).
  planRevisionEmails?: boolean;
  weeklyDigestEmails?: boolean;
  complianceDeadlineEmails?: boolean;
  monitoringAlerts?: boolean;
  // Sprint 24 — operator-wedge email categories. Mirror of PREF_KEYS
  // in lib/notification-prefs.js. Default behaviour is opt-out
  // (server treats absence as true); the UI surfaces each toggle so
  // the user can mute specific categories without affecting others.
  importQuoteReadyEmails?: boolean;
  importDeclineEmails?: boolean;
  importShipmentStatusEmails?: boolean;
  importMessageEmails?: boolean;
  importQueueIntakeEmails?: boolean;
  importCustomerDecisionEmails?: boolean;
  importInsightsDigestEmails?: boolean;
  importLowRatingAlertEmails?: boolean;
  importStalledQueueAlertEmails?: boolean;
  importDeclineSpikeAlertEmails?: boolean;
  importQuoteAcceptanceAlertEmails?: boolean;
  importSupplierConcentrationAlertEmails?: boolean;
  importRatingTrendAlertEmails?: boolean;
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

// Iterable closed taxonomy for the dashboard list filter dropdown.
// Drift-guarded against the ShipmentStatus union AND against
// SHIPMENT_VALID_TRANSITIONS' key set so all three stay in lockstep.
// Order matches the state-machine progression so the filter dropdown
// reads as a natural pipeline: planned → booked → in_transit →
// cleared → delivered, then the off-path states (exception, cancelled).
export const SHIPMENT_STATUSES: ReadonlyArray<ShipmentStatus> = Object.freeze([
  'planned',
  'booked',
  'in_transit',
  'cleared',
  'delivered',
  'exception',
  'cancelled',
]) as ReadonlyArray<ShipmentStatus>;

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

// /api/shipments/<id>/history — per-shipment audit timeline.
// Returns events that name the shipment (entityType='shipment_master',
// entityId=<externalId>) filtered to the customer-visible event types
// the timeline UI renders.

export type ShipmentTimelineEventType =
  | 'shipment_master_created'
  | 'shipment_master_updated'
  | 'shipment_master_status_transition'
  | 'shipment_master_exception_acknowledged'
  | 'shipment_master_archived';

export interface ShipmentTimelineEvent {
  type: ShipmentTimelineEventType;
  at: string;
  actorEmailHash?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  detail?: Record<string, unknown> | null;
  [k: string]: unknown;
}

// Goods master timeline event types — fed by /api/goods/<id>/history.
// Backed by lib/db/goods.js's audit-log emissions (one event per
// mutation per ADR 0005). Same shape as the shipment timeline event,
// different .type values.
export type GoodsTimelineEventType =
  | 'goods_master_created'
  | 'goods_master_updated'
  | 'goods_master_archived';

export interface GoodsTimelineEvent {
  type: GoodsTimelineEventType;
  at: string;
  actorEmailHash?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  detail?: Record<string, unknown> | null;
  [k: string]: unknown;
}

// Supplier master timeline event types — fed by
// /api/suppliers/<id>/history. Same shape, supplier-prefixed types.
export type SupplierTimelineEventType =
  | 'supplier_master_created'
  | 'supplier_master_updated'
  | 'supplier_master_rescreened'
  | 'supplier_master_archived';

export interface SupplierTimelineEvent {
  type: SupplierTimelineEventType;
  at: string;
  actorEmailHash?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  detail?: Record<string, unknown> | null;
  [k: string]: unknown;
}

// Union for the polymorphic TransitionHistory component. Each
// entity-kind variant carries its own type-union and renders its own
// headline/tone via the per-entity-kind lookup table in the component.
//
// Sprint 7: import_request joins shipment / goods / supplier as the
// fourth entity kind the timeline polymorphism handles. (Defined far
// below the others; import_request types live near the rest of the
// ImportRequest interface block.)
export type AuditTimelineEvent =
  | ShipmentTimelineEvent
  | GoodsTimelineEvent
  | SupplierTimelineEvent
  | ImportRequestTimelineEvent;

export type AuditTimelineEventType =
  | ShipmentTimelineEventType
  | GoodsTimelineEventType
  | SupplierTimelineEventType
  | ImportRequestTimelineEventType;

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

// Closed taxonomy for the supplier legalForm dropdown — mirror of
// LEGAL_FORMS in lib/db/suppliers.js. A drift-guard test asserts both
// arrays stay in lockstep (each direction). Order matches the
// backend's frozen array.
export const SUPPLIER_LEGAL_FORMS: ReadonlyArray<string> = Object.freeze([
  'llc', 'gmbh', 'sp_z_o_o', 'ltd', 'sa', 'kft', 'sarl', 'srl', 'sas',
  'inc', 'corp', 'oy', 'ab', 'as', 'bv', 'nv', 'plc', 'cooperative', 'other',
]) as ReadonlyArray<string>;

// Iterable closed taxonomy for the suppliers list-page sanctions
// filter (PR #127). Mirror of SANCTIONS_STATUSES in
// lib/db/suppliers.js + the SupplierSanctionsStatus union above.
// Order matches the operational severity: clear → pending →
// potential_match → match so the dropdown reads naturally from
// "safe to proceed" through "escalate".
//
// 'not_screened' is intentionally NOT in this list — it's a
// pseudo-status meaning "sanctionsLastStatus is null" (the supplier
// has never been screened). The list-page filter handles that
// branch as a separate dropdown option since it's the absence-of-
// status rather than a value.
export const SUPPLIER_SANCTIONS_STATUSES: ReadonlyArray<SupplierSanctionsStatus> = Object.freeze([
  'clear',
  'pending',
  'potential_match',
  'match',
]) as ReadonlyArray<SupplierSanctionsStatus>;

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

// /api/imports — Import Request entity (L1.0 of the strategic plan,
// §4.1.2). The customer-intent primitive that precedes Goods + Supplier
// + Shipment and drives the Operator wedge (managed-import-as-a-service
// take-rate). Mirrors lib/db/import-requests.js exactly; a drift-guard
// test pins both sides.

export type ImportRequestStatus =
  | 'submitted'
  | 'processing'
  | 'awaiting_review'
  | 'quoted'
  | 'customer_approved'
  | 'customer_rejected'
  | 'expired'
  | 'cancelled'
  | 'failed';

// Iterable closed taxonomy for filter dropdowns. Order matches the
// state-machine progression so dropdowns read as a natural pipeline.
export const IMPORT_REQUEST_STATUSES: ReadonlyArray<ImportRequestStatus> = Object.freeze([
  'submitted',
  'processing',
  'awaiting_review',
  'quoted',
  'customer_approved',
  'customer_rejected',
  'expired',
  'cancelled',
  'failed',
]) as ReadonlyArray<ImportRequestStatus>;

// Canonical transition table. Mirrors lib/db/import-requests.js
// VALID_TRANSITIONS exactly — a drift-guard test pins both sides. Used
// by the ops queue to render only the legal next-state buttons.
export const IMPORT_REQUEST_VALID_TRANSITIONS: Readonly<
  Record<ImportRequestStatus, ReadonlyArray<ImportRequestStatus>>
> = Object.freeze({
  submitted: Object.freeze(['processing', 'cancelled', 'failed']),
  processing: Object.freeze(['awaiting_review', 'failed', 'cancelled']),
  awaiting_review: Object.freeze(['quoted', 'cancelled', 'failed', 'processing']),
  quoted: Object.freeze(['customer_approved', 'customer_rejected', 'expired', 'cancelled']),
  customer_approved: Object.freeze([]),
  customer_rejected: Object.freeze([]),
  expired: Object.freeze([]),
  cancelled: Object.freeze([]),
  failed: Object.freeze([]),
}) as Readonly<Record<ImportRequestStatus, ReadonlyArray<ImportRequestStatus>>>;

export type ImportRequestQuantityUnit =
  | 'pieces'
  | 'kg'
  | 'pallets'
  | 'units'
  | 'cartons'
  | 'tonnes'
  | 'litres'
  | 'cubic_metres';

export const IMPORT_REQUEST_QUANTITY_UNITS: ReadonlyArray<ImportRequestQuantityUnit> = Object.freeze([
  'pieces', 'units', 'cartons', 'pallets', 'kg', 'tonnes', 'litres', 'cubic_metres',
]) as ReadonlyArray<ImportRequestQuantityUnit>;

// One entry in the AI-generated factory shortlist. v1's verification
// status is always 'unverified_ai_sample' because the shortlist comes
// from sourcing-quote.shortlistSuppliers (anonymised samples) until the
// verified factory graph (Layer 2 of the billion-dollar direction)
// replaces it.
export interface FactoryCandidate {
  name?: string;
  city?: string;
  region?: string;
  specialty?: string;
  verificationStatus?: 'unverified_ai_sample' | 'team_verified' | 'pending_verification';
  verificationNote?: string;
  recommendation?: 'top_pick' | 'alternative';
  [k: string]: unknown;
}

// One ranked country block in the shortlist payload. Each country
// carries its calculator-derived comparison data + its candidate list.
export interface FactoryShortlistBlock {
  rank?: number;
  country?: string;
  countryRationale?: string | null;
  fobIndex?: number | null;
  leadTimeWeeks?: number | null;
  qualityRisk?: string | null;
  ipRisk?: string | null;
  candidates?: FactoryCandidate[];
  candidateCount?: number;
  // Sprint 28 — learning signal. Set when the org has picked this
  // country (for the same HS prefix 6) in the last 90 days. Powers
  // the "Picked N times" badge on the shortlist UI. null when no
  // past picks exist.
  pastPickSignal?: {
    count: number;
    lastPickedAt: string;
    rationaleCategoryMix: Record<string, number>;
    // Sprint 32 — cross-cohort correlation. avgRating is the
    // rounded-to-1-decimal customer rating across THIS country's
    // past picks; null when no rated picks exist (the customer
    // hasn't rated yet; the count alone is the signal).
    avgRating?: number | null;
    ratedCount?: number;
  } | null;
  // Methodology / metadata sometimes rides as the trailing array
  // element with this shape — older entries may carry it as a sibling
  // field on rank-1.
  _meta?: {
    version?: string;
    classifier?: string;
    classifierHits?: number;
    countriesEvaluated?: string[];
    sampleSource?: string;
    pastPickSource?: string | null;
  };
}

// Single line item in the landed-cost quote. Each value is integer
// cents in EUR (ADR 0004 boundary discipline).
export interface LandedQuoteComponent {
  component: string;
  label: string;
  eurCents: number;
  source: string;
  note?: string | null;
}

// AI-generated prose summary embedded into a landed quote by the
// orchestrator (lib/ai/quote-prose.js). Opus writes 180-220 words of
// natural language explaining the quote, NEVER inventing numbers —
// every figure traces verbatim to a component in `components`. Renders
// above the structured table on /imports/[externalId] when present.
export interface LandedQuoteProse {
  summary: string;
  model: string;
  promptVersion: string;
  generatedAt: string;
}

// EU compliance probe result for a single regime. Calculator-grounded
// — `applies` is the determinator's verdict; `reason` is the
// regulation-cited rationale; `citation` points to the binding
// regulation article. REACH `applies` is tri-state ('maybe' | true |
// false) because REACH applies in principle to any imported article;
// the probe distinguishes "high-relevance category match" from "no
// signal — verify against SDS / SVHC list."
export interface ComplianceProbeResult {
  applies: boolean | 'maybe';
  reason?: string;
  citation?: string;
  confidence?: 'green' | 'amber' | 'red' | string;
  categoryKey?: string | null;
  commodityKey?: string | null;
}

// Whole compliance-probe block embedded in landed_quote by the
// orchestrator at quote time, so the customer sees applicability
// before approval.
export interface ComplianceProbes {
  version: string;
  productCategory: string;
  cbam: ComplianceProbeResult | null;
  eudr: ComplianceProbeResult | null;
  reach: ComplianceProbeResult | null;
}

// Compact compliance summary used by the ops queue cards (sprint 6
// ch 1) so the team can triage by exposure at a glance. Drift-guarded
// against the ComplianceProbes shape — if a regime probe is missing it
// just doesn't appear in the badges.
export type ComplianceBadgeTone = 'in-scope' | 'verify' | 'out-of-scope';

export interface ComplianceBadge {
  regime: 'cbam' | 'eudr' | 'reach';
  short: 'CBAM' | 'EUDR' | 'REACH';
  tone: ComplianceBadgeTone;
}

/**
 * Derive the compact badge list for the ops queue from a landed
 * quote's complianceProbes block. Out-of-scope regimes are suppressed
 * from the badges (they're not what the team is triaging by); the
 * detail page still shows them via the full CompliancePanel.
 *
 * Pure function — exposed for direct testing against the
 * ComplianceProbes shape.
 */
export function deriveComplianceBadges(
  probes: ComplianceProbes | null | undefined,
): ComplianceBadge[] {
  if (!probes) return [];
  const badges: ComplianceBadge[] = [];
  const rows: Array<{ regime: 'cbam' | 'eudr' | 'reach'; short: ComplianceBadge['short']; probe: ComplianceProbeResult | null }> = [
    { regime: 'cbam', short: 'CBAM', probe: probes.cbam },
    { regime: 'eudr', short: 'EUDR', probe: probes.eudr },
    { regime: 'reach', short: 'REACH', probe: probes.reach },
  ];
  for (const { regime, short, probe } of rows) {
    if (!probe) continue;
    let tone: ComplianceBadgeTone;
    if (probe.applies === true) tone = 'in-scope';
    else if (probe.applies === 'maybe') tone = 'verify';
    else continue; // out-of-scope: suppress from queue badges
    badges.push({ regime, short, tone });
  }
  return badges;
}

// Sprint 8 ch 2: compliance-driven filter for /imports/queue triage.
// Lets the team see CBAM-in-scope items first (heaviest paperwork),
// or strip down to verify-only and no-probe items when triaging
// volume. Pure function — pinned by drift-guard tests against
// ComplianceBadgeTone + the regime taxonomy on ComplianceBadge.
export type ComplianceQueueFilter =
  | 'all'
  | 'cbam-in-scope'
  | 'eudr-in-scope'
  | 'reach-in-scope'
  | 'verify'
  | 'no-probes';

export const COMPLIANCE_QUEUE_FILTERS: ReadonlyArray<ComplianceQueueFilter> = Object.freeze([
  'all', 'cbam-in-scope', 'eudr-in-scope', 'reach-in-scope', 'verify', 'no-probes',
]) as ReadonlyArray<ComplianceQueueFilter>;

/**
 * Does this request's badge list satisfy the given filter? Used by
 * /imports/queue to slice the awaiting-review list by compliance
 * complexity.
 *
 *   all            → every request passes (default).
 *   cbam-in-scope  → at least one CBAM badge with tone='in-scope'.
 *   eudr-in-scope  → at least one EUDR badge with tone='in-scope'.
 *   reach-in-scope → at least one REACH badge with tone='in-scope'.
 *   verify         → at least one badge with tone='verify'. Filters in
 *                    "needs human read" items regardless of regime.
 *   no-probes      → badge list is empty. Lets ops drain the
 *                    no-compliance-action items quickly.
 *
 * Pure function — exposed for direct testing.
 */
export function matchesComplianceFilter(
  badges: ComplianceBadge[],
  filter: ComplianceQueueFilter,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'no-probes') return badges.length === 0;
  if (filter === 'verify') return badges.some((b) => b.tone === 'verify');
  if (filter === 'cbam-in-scope') return badges.some((b) => b.regime === 'cbam' && b.tone === 'in-scope');
  if (filter === 'eudr-in-scope') return badges.some((b) => b.regime === 'eudr' && b.tone === 'in-scope');
  if (filter === 'reach-in-scope') return badges.some((b) => b.regime === 'reach' && b.tone === 'in-scope');
  return false;
}

/**
 * Pretty label for the filter chip UI.
 */
export function complianceFilterLabel(filter: ComplianceQueueFilter): string {
  switch (filter) {
    case 'all': return 'All';
    case 'cbam-in-scope': return 'CBAM';
    case 'eudr-in-scope': return 'EUDR';
    case 'reach-in-scope': return 'REACH';
    case 'verify': return 'Verify';
    case 'no-probes': return 'No probes';
    default: return String(filter);
  }
}

// Full landed-cost quote. components stack to totalLandedCents (which
// already includes cargo value as the base).
export interface LandedQuote {
  components: LandedQuoteComponent[];
  cargoValueCents: number;
  totalLandedCents: number;
  orcatradeFeeCents: number;
  orcatradeFeePct: number;
  currency: 'EUR';
  confidenceTier: 'A' | 'B' | 'C';
  confidenceNotes: string[];
  prose?: LandedQuoteProse | null;
  complianceProbes?: ComplianceProbes | null;
  methodology: {
    version?: string;
    fobToLandedRatio?: number;
    weightKgEstimated?: number;
    volumeCbmEstimated?: number;
    urgencyDays?: number;
    customsCalculatorOk?: boolean;
    routingCalculatorOk?: boolean;
    financeCalculatorOk?: boolean;
    hsClassification?: {
      hs6?: string | null;
      label?: string | null;
      chapter?: number | null;
      confidenceTier?: string;
      confidence?: number | null;
      verifyUrl?: string | null;
      dutyEstimate?: unknown;
      source?: string;
    } | null;
  };
  customsCalculatorRaw?: unknown;
  routingCalculatorRaw?: unknown;
  financeCalculatorRaw?: unknown;
}

// Sprint 16 — structured decline reasons. Single source of truth lives
// in lib/db/import-requests.js DECLINE_REASONS; this TS mirror is
// drift-guarded by test/decline-reasons-drift.test.js.
export type DeclineReason =
  | 'price_target_unrealistic'
  | 'compliance_blocker'
  | 'origin_restriction'
  | 'out_of_scope'
  | 'documentation_missing'
  | 'other';

export const DECLINE_REASONS: ReadonlyArray<DeclineReason> = Object.freeze([
  'price_target_unrealistic',
  'compliance_blocker',
  'origin_restriction',
  'out_of_scope',
  'documentation_missing',
  'other',
]) as ReadonlyArray<DeclineReason>;

// Which decline reasons offer a "Revise this request" CTA. Mirror of
// REVISABLE_DECLINE_REASONS in the data layer.
export const REVISABLE_DECLINE_REASONS: ReadonlyArray<DeclineReason> = Object.freeze([
  'price_target_unrealistic',
  'compliance_blocker',
  'origin_restriction',
  'documentation_missing',
  'other',
]) as ReadonlyArray<DeclineReason>;

// Human-readable label per reason — used by the ops decline form +
// the customer-side lineage panel. Headlines + nudges live in
// lib/imports-emails.js DECLINE_REASON_COPY (the customer-facing
// version is longer).
export const DECLINE_REASON_LABELS: Readonly<Record<DeclineReason, string>> = Object.freeze({
  price_target_unrealistic: 'Price target unrealistic',
  compliance_blocker: 'Compliance blocker',
  origin_restriction: 'Origin restriction',
  out_of_scope: 'Out of scope',
  documentation_missing: 'Documentation missing',
  other: 'Other',
}) as Readonly<Record<DeclineReason, string>>;

export interface ImportRequestTeamReviewState {
  decision?: 'approved' | 'sent_back' | 'rejected';
  reviewedByEmailHash?: string;
  reviewedAt?: string;
  edits?: Array<Record<string, unknown>>;
  notes?: string;
  // Sprint 16 — set when decision='rejected'.
  declineReason?: DeclineReason;
  revisable?: boolean;
}

// ── Ops Insights (sprint 17) ─────────────────────────────────────────
// Returned by GET /api/imports/insights?windowDays=N. Three cohorts:
// the funnel (counts per status), the decline-reason breakdown (which
// rejection reasons dominated the window), and the revision conversion
// (the headline closed-loop number — of recoverable declines, how many
// became revisions that made it back into the pipeline). Every count
// is computed in SQL on the data layer; the page renders deterministic
// numbers (ADR 0002 — no LLM in this read path).

export interface OpsInsightsRevisionCohort {
  recoverableDeclined: number;
  revisions: number;
  revisionsProgressed: number;
  // Server-side percentages so the UI never divides by zero.
  // null when the denominator is 0 (rendered as em-dash).
  revisionRate: number | null;
  progressionRate: number | null;
}

// Sprint 29 — top picked countries cohort. Closes the sprint-28
// learning loop: per-request "your team picked Vietnam 4 times"
// badge becomes org-wide narrative "we picked Vietnam 12 times this
// quarter, mostly for lead-time reasons." Top 6 by count, server-
// sorted descending, dominantRationale derived server-side so the
// UI doesn't re-do the work.
export interface OpsInsightsTopPickedCountry {
  country: string;
  count: number;
  lastPickedAt: string | null;
  dominantRationale: string | null;
  rationaleCategoryMix: Record<string, number>;
  // Sprint 32 — cross-cohort correlation. The "Vietnam picks averaged
  // 4.6★" signal that turns the cohort from a count into a
  // justification. null when no rated picks exist for this country
  // yet — the UI surfaces "no ratings yet" rather than a misleading
  // 0★.
  avgRating: number | null;
  ratedCount: number;
}

// Sprint 31 — rating health cohort. Closes the sprint-30 loop:
// per-request CustomerRating becomes an org-wide health surface.
// averageScore is rounded server-side to one decimal place;
// ratedPercentage is the rated count over customer_approved
// denominator (so the "rated 75%" copy is window-honest, not skewed
// by unapproved or stale requests). scoreDistribution is fixed-
// length [1★, 2★, 3★, 4★, 5★] so the UI can iterate without
// sparsity guards.
export interface OpsInsightsRatingCohort {
  averageScore: number | null;
  totalRated: number;
  totalApproved: number;
  ratedPercentage: number | null;
  scoreDistribution: [number, number, number, number, number];
  lowScoreCount: number;
}

// Sprint 38 — single stalled-request row. updatedAt is the last-touch
// timestamp (status set / message posted / evidence attached); the
// stall is computed against it server-side. daysStalled is rounded
// to one decimal — UI doesn't re-round.
export interface OpsInsightsStalledItem {
  externalId: string;
  label: string;
  updatedAt: string;
  daysStalled: number;
}

// Sprint 38 — cohort #6. The first proactive signal. count is the
// org-wide total (not capped); items is the top N (STALLED_QUEUE_CAP
// = 10 on the server) sorted oldest-first; thresholdDays surfaces
// the stall threshold so the UI can render the exact value rather
// than re-coding it.
export interface OpsInsightsStalledQueue {
  thresholdDays: number;
  count: number;
  items: OpsInsightsStalledItem[];
}

// Sprint 40 — a single decline-reason spike. ratio is null when the
// baseline window contains 0 occurrences of this reason (first-time
// signal); otherwise it's the multiplier of current-rate over
// baseline-rate, rounded to one decimal. Rates are per-day, rounded
// to two decimals (matches the comparison the server made).
export interface OpsInsightsDeclineSpike {
  reason: string;
  currentCount: number;
  baselineCount: number;
  currentRate: number;
  baselineRate: number;
  ratio: number | null;
}

// Sprint 52 — org-admin-facing cron observability.
// Mirror of the server's lib/handlers/cron-status.js shape.
// `health` is derived server-side from the per-job KV records;
// 'ok' / 'error' / 'stale' / 'never' are the documented states.
export type CronJobHealth = 'ok' | 'error' | 'stale' | 'never';

export interface CronJobLastRun {
  ranAt: string;
  completedAt: string;
  durationMs: number;
  ok: boolean;
  params?: unknown;
  summary?: unknown;
}

export interface CronJobLastError {
  ranAt: string;
  completedAt: string;
  durationMs: number;
  ok: false;
  error: string;
}

export interface CronJobStatus {
  name: string;
  health: CronJobHealth;
  lastRun: CronJobLastRun | null;
  lastError: CronJobLastError | null;
}

export interface CronStatusResponse {
  ok: boolean;
  asOf: string;
  staleAfterMs: number;
  jobs: CronJobStatus[];
}

// Sprint 47 — outbound webhook subscriptions (v1: management +
// test delivery).
//
// The `secret` field is present ONLY on the create response — it's
// the one-time signing-material reveal. List + delete responses
// NEVER include it. The receiver verifies HMAC-SHA256 against this
// secret over the raw POST body.
export interface WebhookSubscription {
  id: string;
  orgIdNumeric: number;
  label: string;
  url: string;
  eventTypes: string[];
  createdAt: string;
  active: boolean;
  lastDeliveryAt: string | null;
  lastDeliveryStatus: string | null;
  // Sprint 51 — auto-disable bookkeeping. consecutiveAbandonments
  // is the per-sub counter; resetAt is reset to 0 on every
  // successful delivery. When the counter crosses
  // AUTO_DISABLE_THRESHOLD (server-side constant = 5), active
  // flips to false + autoDisabledAt + autoDisabledReason populate.
  consecutiveAbandonments?: number;
  autoDisabledAt?: string | null;
  autoDisabledReason?: string | null;
  reactivatedAt?: string | null;
  // Sprint 59 — signing-secret rotation timestamp. Stamped by
  // POST /api/webhooks/<id>/rotate; the UI surfaces it to confirm
  // when the receiver-side update needs to land.
  secretRotatedAt?: string | null;
  // `secret` is intentionally optional — present ONLY on the
  // create response, absent on list responses (strip discipline).
  secret?: string;
}

export interface WebhookReactivateResponse {
  ok: boolean;
  subscription: WebhookSubscription;
  noOp?: boolean;
}

// Sprint 59 — signing-secret rotation. `secret` is the NEW raw
// secret — returned ONCE on the response, never recoverable
// afterward. Same posture as the sprint-47 create response.
// `subscription` is the post-rotation projection WITH the secret
// stripped (the top-level field is the one-time reveal).
export interface WebhookSecretRotateResponse {
  ok: boolean;
  subscription: WebhookSubscription;
  secret: string;
}

export interface WebhookListResponse {
  ok: boolean;
  webhooks: WebhookSubscription[];
}

export interface WebhookCreateResponse {
  ok: boolean;
  subscription: WebhookSubscription;  // carries the `secret`
}

export interface WebhookEventTypesResponse {
  ok: boolean;
  eventTypes: string[];
}

export interface WebhookTestDelivery {
  ok: boolean;
  status: number;
  durationMs: number;
  error: string | null;
  timedOut: boolean;
}

export interface WebhookTestResponse {
  ok: boolean;
  delivery: WebhookTestDelivery;
}

// Sprint 49 — per-delivery log entry. Same shape the server writes
// to KV via recordDeliveryLog. status === 0 for network failures
// (the AbortController timeout sets timedOut=true alongside).
export interface WebhookDeliveryLogEntry {
  deliveryId: string;
  subscriptionId: string;
  eventType: string;
  deliveredAt: string;
  ok: boolean;
  status: number;
  error: string | null;
  timedOut: boolean;
  durationMs: number;
}

export interface WebhookDeliveriesResponse {
  ok: boolean;
  deliveries: WebhookDeliveryLogEntry[];
}

// Sprint 44 — per-org API keys (v1: read-only).
//
// The raw `key` field is ONLY present on the create response —
// it's the one-time reveal. List + revoke responses NEVER include
// it. The `keyId` is the SHA-256 of the raw value, used as the URL
// segment for DELETE.
// Sprint 56 — per-key scope literal type. Empty scopes array on a
// key means "no narrowing — admin-equivalent" (legacy sprint-44
// behaviour). Non-empty narrows the bearer surface.
export type ApiKeyScope =
  | 'imports:read'
  | 'insights:read'
  | 'audit:read'
  | 'exports:read';

export interface ApiKey {
  keyId: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  redactedKey: string;
  revoked: boolean;
  // Sprint 56 — scopes narrowing the bearer surface. Optional for
  // back-compat with sprint-44 list responses pre-update.
  scopes?: ApiKeyScope[];
}

export interface ApiKeyListResponse {
  ok: boolean;
  keys: ApiKey[];
}

export interface ApiKeyCreateResponse {
  ok: boolean;
  // Raw key — ONE-TIME REVEAL. After this response, the value is
  // unrecoverable (stored hashed at rest). UI must echo to user
  // + warn before they leave the page.
  key: string;
  keyId: string;
  label: string;
  createdAt: string;
  redactedKey: string;
  // Sprint 56 — echo scopes so the UI can render the chip
  // without a list-refresh round-trip.
  scopes?: ApiKeyScope[];
}

// Sprint 56 — GET /api/api-keys/scopes enumerates the curated
// whitelist so the UI's create-form checkboxes don't hardcode
// the list (drift-guard: a server-side add lands without a UI
// PR).
export interface ApiKeyScopesResponse {
  ok: boolean;
  scopes: ApiKeyScope[];
}

// Sprint 42 — per-org operator config (v1: stallThresholdDays).
// Mirrors lib/operator-config.js DEFAULT_OPERATOR_CONFIG shape;
// every knob lives at the top level. As new knobs land, both this
// interface AND the inline UI form below extend.
export interface OperatorConfig {
  stallThresholdDays: number;
  // Sprint 43 — decline-spike sensitivity. The multiplier the
  // sprint-40 classifier uses to decide "spiking vs noise."
  // One-decimal float in [1.5, 10] — 2.0 default, 1.5 = strict,
  // 10 = tolerant.
  declineSpikeRateMultiplier: number;
  // Sprint 60 — supplier-concentration sensitivity. The share
  // the sprint-57 classifier uses to flag dominant-supplier
  // risk. Two-decimal float in [0.50, 0.95] — 0.75 default,
  // 0.50 = strict, 0.85+ = tolerant.
  supplierConcentrationThreshold: number;
}

// Per-knob source — 'default' = using platform default,
// 'custom' = org has set its own value. The UI uses this to
// render a "Reset" affordance only when the knob is customised.
export type OperatorConfigSource = Record<keyof OperatorConfig, 'default' | 'custom'>;

export interface OperatorConfigResponse {
  ok: boolean;
  config: OperatorConfig;
  source: OperatorConfigSource;
  defaults: OperatorConfig;
}

// Sprint 40 — cohort #7. The second proactive signal. spikes is
// sorted biggest-spike-first with null-ratio (first-time reasons)
// at the top. currentDays / baselineDays / minCount / rateMultiplier
// surface the comparison parameters so the UI can name what the
// server measured.
export interface OpsInsightsDeclineSpikeCohort {
  currentDays: number;
  baselineDays: number;
  minCount: number;
  rateMultiplier: number;
  spikes: OpsInsightsDeclineSpike[];
}

// Sprint 53 — cohort #8. Third proactive signal. Quote-acceptance
// rate drift vs prior baseline. Rates are 0..1 floats (server
// rounded to 3 decimals); null when the denominator is 0 so the
// UI can render "no baseline yet" instead of a misleading 0%.
// `delta` is null when either rate is null. `isDegraded` fires
// when currentRate < degradationThreshold × baselineRate AND
// currentQuoted >= minCount.
export interface OpsInsightsQuoteAcceptanceCohort {
  currentDays: number;
  baselineDays: number;
  minCount: number;
  degradationThreshold: number;
  currentApproved: number;
  currentQuoted: number;
  currentRate: number | null;
  baselineApproved: number;
  baselineQuoted: number;
  baselineRate: number | null;
  delta: number | null;
  isDegraded: boolean;
}

// Sprint 57 — cohort #9. Fourth proactive signal. Supplier-
// concentration risk: of all picks in the last `windowDays`, what
// share went to a single dominant country? `topCountry` is null
// when no picks landed in the window; `topCountryShare` is null
// on a 0-denominator (server-side rounded to 3 decimals for
// stability). `isConcentrated` fires when topCountryShare >=
// threshold AND totalPicks >= minCount.
export interface OpsInsightsSupplierConcentrationCohort {
  windowDays: number;
  minCount: number;
  threshold: number;
  totalPicks: number;
  topCountry: string | null;
  topCountryCount: number;
  topCountryShare: number | null;
  isConcentrated: boolean;
}

// Sprint 62 — cohort #10. Fifth proactive signal. Rating-trend
// drift: is the current 7-day avg dropping vs the prior 23-day
// baseline? Disjoint windows (current vs prior, NOT current vs
// rolling-including-current). Averages are one-decimal floats
// (matches sprint-31 rating cohort) + null when the denominator
// is 0 so the UI can render "no baseline yet" rather than 0★.
// `delta` is `baselineAvg - currentAvg` (positive when current
// has dropped) + null when either side is null. `isDeclining`
// fires when delta >= dropThreshold AND currentCount >=
// minCount AND baselineAvg !== null.
export interface OpsInsightsRatingTrendCohort {
  currentDays: number;
  baselineDays: number;
  minCount: number;
  dropThreshold: number;
  currentCount: number;
  currentAvg: number | null;
  baselineCount: number;
  baselineAvg: number | null;
  delta: number | null;
  isDeclining: boolean;
}

export interface OpsInsights {
  funnelByStatus: Partial<Record<ImportRequestStatus, number>>;
  totalInWindow: number;
  declineReasons: Partial<Record<DeclineReason, number>>;
  totalDeclined: number;
  revisionCohort: OpsInsightsRevisionCohort;
  // Sprint 29 — cohort #4. Empty array when no picks landed in the
  // window; the UI renders a coaching empty state in that case.
  topPickedCountries: OpsInsightsTopPickedCountry[];
  totalPicked: number;
  // Sprint 31 — cohort #5. Always present; the UI handles the
  // no-ratings case via averageScore === null.
  ratingCohort: OpsInsightsRatingCohort;
  // Sprint 38 — cohort #6. The proactive watch. Always present; the
  // UI handles the no-stalls case via count === 0.
  stalledQueue: OpsInsightsStalledQueue;
  // Sprint 40 — cohort #7. Decline-reason spike. Always present;
  // the UI handles the no-spike case via spikes.length === 0.
  declineSpike: OpsInsightsDeclineSpikeCohort;
  // Sprint 53 — cohort #8. Quote-acceptance rate drift. Always
  // present; the UI gates the card render on isDegraded.
  quoteAcceptance: OpsInsightsQuoteAcceptanceCohort;
  // Sprint 57 — cohort #9. Supplier-concentration risk. Always
  // present; the UI gates the card render on isConcentrated.
  supplierConcentration: OpsInsightsSupplierConcentrationCohort;
  // Sprint 62 — cohort #10. Rating-trend drift. Always present;
  // the UI gates the card render on isDeclining.
  ratingTrend: OpsInsightsRatingTrendCohort;
}

export interface OpsInsightsResponse {
  ok: boolean;
  windowDays: number;
  insights: OpsInsights;
}

export interface ImportRequestCustomerDecisionState {
  decision?: 'approved' | 'rejected';
  decidedByEmailHash?: string;
  decidedAt?: string;
  notes?: string;
}

export interface ImportRequestFailureState {
  code?: string;
  reason?: string;
  occurredAt?: string;
  recoverable?: boolean;
}

export interface ImportRequest {
  externalId: string;
  orgId?: number;
  createdByEmailHash?: string;
  label: string;
  status: ImportRequestStatus;
  productDescription: string;
  hsCodeGuess?: string | null;
  targetQuantity?: number | null;
  targetQuantityUnit?: ImportRequestQuantityUnit | null;
  targetUnitPriceCents?: number | null;
  originCountry?: string | null;
  destinationCountry: string;
  targetDeliveryDate?: string | null;
  certificationRequirements?: string[];
  intentMetadata?: Record<string, unknown>;
  factoryShortlist?: FactoryShortlistBlock[];
  shortlistGeneratedAt?: string | null;
  landedQuote?: LandedQuote | null;
  quoteGeneratedAt?: string | null;
  quoteExpiresAt?: string | null;
  aiRunIds?: string[];
  teamReviewState?: ImportRequestTeamReviewState;
  customerDecisionState?: ImportRequestCustomerDecisionState;
  failureState?: ImportRequestFailureState;
  linkedShipmentExternalId?: string | null;
  linkedGoodsExternalId?: string | null;
  linkedSupplierExternalId?: string | null;
  // Sprint 16 — revision lineage. Set when this row was created via
  // ?revise=<externalId> on /imports/new. Points back to the prior
  // (rejected or cancelled) request the customer is responding to.
  revisedFromExternalId?: string | null;
  // Sprint 18 — per-request messaging thread. Append-only array of
  // { id, role, body, byEmailHash, at }. Customer + ops messages
  // intermix; the UI styles them by role.
  messages?: ImportRequestMessage[];
  // Sprint 55 — internal ops annotations. Server REDACTS this to
  // an empty array when the reader isn't ops; UI render gates on
  // the user's resolved role as well. Optional so the field can
  // be absent on legacy responses.
  internalNotes?: ImportRequestInternalNote[];
  // Sprint 27 — compliance evidence attachments (cloud-share URLs
  // tagged by regulatory regime). Append-only at the API surface;
  // supersession is a separate event.
  evidenceAttachments?: EvidenceAttachment[];
  // Sprint 30 — customer rating (1-5 + optional comment). Recorded
  // post-approval; last-write-wins on supersession.
  customerRating?: CustomerRating | null;
  // Sprint 21 — per-user read state on the thread. Keyed by actor's
  // email_hash; value is { lastReadAt, lastReadMessageId }. The
  // value is opaque to the UI — unread count is computed by the
  // server and surfaced as unreadMessageCount below.
  messageReadState?: Record<string, { lastReadAt?: string; lastReadMessageId?: string | null }>;
  // Sprint 21 — server-computed unread count for the calling user.
  // Augmented onto every list + get response so the UI can render
  // badges without pulling messages[] for every entry on a list
  // endpoint that should stay light. Counts messages newer than
  // the user's lastReadAt that the user didn't post themselves.
  unreadMessageCount?: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

// ── Per-request messaging thread (sprint 18) ─────────────────────────
// Append-only entries stored in import_requests.messages (JSONB).
// Role drives the UI styling (customer on the left, ops on the right,
// system centred). byEmailHash is the actor hash; raw email never
// stored (ADR 0008). Activity feed picks up message posts via the
// 'import_request_message_posted' event type.

export type ImportRequestMessageRole = 'customer' | 'ops' | 'system';

export const IMPORT_REQUEST_MESSAGE_ROLES: ReadonlyArray<ImportRequestMessageRole> = Object.freeze([
  'customer',
  'ops',
  'system',
]) as ReadonlyArray<ImportRequestMessageRole>;

export const IMPORT_REQUEST_MESSAGE_BODY_MAX = 4000;

export interface ImportRequestMessage {
  id: string;
  role: ImportRequestMessageRole;
  body: string;
  byEmailHash: string;
  at: string;
}

// Sprint 55 — per-request internal ops note. Identical wire shape
// to a message minus the role (notes are inherently ops-only —
// the role is implicit). Server redacts the entire collection
// from non-ops responses.
export const IMPORT_REQUEST_INTERNAL_NOTE_BODY_MAX = 4000;

export interface ImportRequestInternalNote {
  id: string;
  body: string;
  byEmailHash: string;
  at: string;
  // Sprint 61 — edit + soft-delete bookkeeping. editedAt stamps
  // on every successful edit (latest only — prior bodies live in
  // the audit chain, not on the row). deletedAt stamps on soft-
  // delete; the GET projection FILTERS these out so the UI never
  // sees them.
  editedAt?: string | null;
  deletedAt?: string | null;
  deletedByEmailHash?: string | null;
}

export interface ImportRequestInternalNoteResponse {
  ok: boolean;
  importRequest: ImportRequest;
  note: ImportRequestInternalNote;
  noOp?: boolean;
}

// ── Customer rating (sprint 30) ──────────────────────────────────────
// Recorded once per import request after the customer approves the
// quote and the team materialises the triad. Last-write-wins on
// supersession; the audit chain preserves every event so the prior
// rating is recoverable.

export const RATING_MIN = 1;
export const RATING_MAX = 5;
export const RATING_COMMENT_MAX = 2000;

export interface CustomerRating {
  score: number;
  comment: string;
  ratedByEmailHash: string;
  ratedAt: string;
}

// ── Compliance evidence (sprint 27) ──────────────────────────────────
// Append-only entries stored in import_requests.evidence_attachments
// (JSONB). v1 stores cloud-share URLs (SharePoint, GDrive, DropBox,
// signed S3 URLs) rather than uploaded files — what enterprises use
// for compliance docs today. The regime tag groups the UI by
// regulatory regime so a customs broker scanning the dossier can
// jump straight to the EUDR evidence.

export type ComplianceRegime = 'CBAM' | 'EUDR' | 'REACH' | 'origin' | 'other';

export const COMPLIANCE_REGIMES: ReadonlyArray<ComplianceRegime> = Object.freeze([
  'CBAM',
  'EUDR',
  'REACH',
  'origin',
  'other',
]) as ReadonlyArray<ComplianceRegime>;

export const EVIDENCE_LABEL_MAX = 200;
export const EVIDENCE_NOTES_MAX = 1000;

export interface EvidenceAttachment {
  id: string;
  regime: ComplianceRegime;
  label: string;
  url: string;
  uploadedByEmailHash: string;
  uploadedAt: string;
  notes?: string;
}

// ── Onboarding example library (sprint 22) ───────────────────────────
// Curated, calculator-grounded sample requests a first-time customer
// can click "Use this example" on. Each example is a hand-picked
// (HS code, origin, destination, certification mix) tuple that we
// know the orchestrator handles cleanly + produces a realistic quote.
//
// Stored client-side ONLY — these are pure-UI affordances that submit
// through the existing /imports create endpoint with no special path.
// The server never knows the request came from an example.
//
// Why hand-curated rather than synthesised:
//   • Trust signal: "here are real categories we actually source"
//   • Calculator-grounding: each (HS, origin) pair is one we've
//     verified produces a sensible quote (no edge cases in MFN
//     duty / VAT)
//   • Variety: covers compliance scenarios (CBAM exposure, EUDR
//     exposure, REACH non-exposure) so a customer can pick an
//     example matching their actual concern
//
// Adding an example: append to ONBOARDING_EXAMPLES. The id stays
// stable (it becomes a query-param value in the /imports/new URL,
// so renaming would break any in-the-wild links).

export interface OnboardingExample {
  id: string;
  title: string;
  pitch: string;
  // Hint for the chip displayed on the example card — names a
  // compliance regime so the customer can scan for "the one with my
  // concern."
  highlight: 'CBAM-exposed' | 'EUDR-exposed' | 'consumer-CE-marked' | 'apparel-quota';
  // The full FormState shape the example pre-fills. Mirrors the
  // /imports/new form keys so the prefill helper is a 1:1 spread.
  intent: {
    label: string;
    productDescription: string;
    hsCodeGuess: string;
    targetQuantity: number;
    targetQuantityUnit: ImportRequestQuantityUnit;
    targetUnitPriceCents: number;
    originCountry: string;
    destinationCountry: string;
    certifications: string[];
  };
}

export const ONBOARDING_EXAMPLES: ReadonlyArray<OnboardingExample> = Object.freeze([
  {
    id: 'led-grow-lights',
    title: 'LED grow lights · CN → DE',
    pitch: '500 pieces, 300W full-spectrum, CE + RoHS certified. A typical consumer-electronics import where the duty + VAT math drives the landed cost.',
    highlight: 'consumer-CE-marked',
    intent: {
      label: 'LED grow lights · 500 pieces',
      productDescription: '300W full-spectrum LED grow lights with passive cooling. For indoor greenhouse + vertical-farming applications. Need CE + RoHS marks on every unit.',
      hsCodeGuess: '853941',
      targetQuantity: 500,
      targetQuantityUnit: 'pieces',
      targetUnitPriceCents: 13000,
      originCountry: 'CN',
      destinationCountry: 'DE',
      certifications: ['CE', 'RoHS'],
    },
  },
  {
    id: 'aluminium-extrusions',
    title: 'Aluminium extrusions · CN → DE',
    pitch: '20 tonnes of structural extrusions. CBAM-exposed — the carbon levy adds materially to the landed cost and the dossier shows the embedded-emissions math.',
    highlight: 'CBAM-exposed',
    intent: {
      label: 'Aluminium extrusions · 20t',
      productDescription: 'Structural aluminium extrusions (6063 alloy), unalloyed bars and rods. For architectural framing systems.',
      hsCodeGuess: '760421',
      targetQuantity: 20,
      targetQuantityUnit: 'tonnes',
      targetUnitPriceCents: 280000,
      originCountry: 'CN',
      destinationCountry: 'DE',
      certifications: [],
    },
  },
  {
    id: 'apparel-knit',
    title: 'Knit apparel · BD → DE',
    pitch: '3,000 cotton T-shirts from Bangladesh. EU-Bangladesh EBA tariff preference applies — duty is zero with the right certificate of origin.',
    highlight: 'apparel-quota',
    intent: {
      label: 'Cotton T-shirts · 3,000 pieces',
      productDescription: 'Knitted cotton T-shirts, men\'s + women\'s mix, single-jersey 180gsm, plain dye. OEKO-TEX requested for retail compliance.',
      hsCodeGuess: '610910',
      targetQuantity: 3000,
      targetQuantityUnit: 'pieces',
      targetUnitPriceCents: 350,
      originCountry: 'BD',
      destinationCountry: 'DE',
      certifications: ['OEKO-TEX'],
    },
  },
]) as ReadonlyArray<OnboardingExample>;

// Look up an example by id. Returns undefined if not found — the
// /imports/new page falls back to the empty form silently so a stale
// bookmark doesn't render an error.
export function getOnboardingExampleById(id: string): OnboardingExample | undefined {
  return ONBOARDING_EXAMPLES.find((e) => e.id === id);
}

// /api/imports/<id>/whatif — sprint 10. Returns a stateless preview
// of the landed-cost quote with override fields applied to the
// persisted intent. No persistence, no audit log, no LLM prose —
// pure calculator path. The customer can tweak inputs as many
// times as they like without changing the original request.
export interface WhatIfDelta {
  totalLandedCents: { from: number; to: number; deltaCents: number; deltaPct: number | null };
  cargoValueCents: { from: number; to: number; deltaCents: number };
  orcatradeFeeCents: { from: number; to: number; deltaCents: number };
}

export interface WhatIfAppliedInputs {
  productCategory: string;
  originCountry: string;
  destinationCountry: string;
  targetQuantity: number;
  targetUnitPriceCents: number | null;
  hsCode: string;
  hsSource: 'customer_override' | 'ai_lookup' | 'sentinel';
  urgencyWeeks: number;
}

export interface WhatIfResponse {
  ok: boolean;
  whatIfQuote: LandedQuote;
  baselineQuote: LandedQuote | null;
  appliedInputs: WhatIfAppliedInputs;
  delta: WhatIfDelta | null;
}

// Audit-timeline event types for /api/imports/<id>/history. Same shape
// as the other entity timeline events; entity-prefix is import_request.
export type ImportRequestTimelineEventType =
  | 'import_request_created'
  | 'import_request_updated'
  | 'import_request_status_transition'
  | 'import_request_archived'
  | 'import_request_message_posted'
  | 'import_request_evidence_attached'
  | 'import_request_supplier_picked'
  | 'import_request_rated'
  // Sprint 55 — internal ops note appended.
  | 'import_request_internal_note_added'
  // Sprint 61 — internal ops note edit + soft-delete.
  | 'import_request_internal_note_edited'
  | 'import_request_internal_note_deleted';

export interface ImportRequestTimelineEvent {
  type: ImportRequestTimelineEventType;
  at: string;
  actorEmailHash?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  detail?: Record<string, unknown> | null;
  [k: string]: unknown;
}

// ── Org-wide activity feed (sprint 14) ───────────────────────────────
// Fed by GET /api/activity (org-scoped). The event-type allowlist on
// the server (lib/events.js ORG_ACTIVITY_TYPES) excludes personal-
// security events (auth_*, mfa_*, password_*) so this stream only ever
// surfaces shared org activity — visible to every teammate.

export type ActivityEventType =
  | ShipmentTimelineEventType
  | GoodsTimelineEventType
  | SupplierTimelineEventType
  | ImportRequestTimelineEventType
  | 'document_drafted'
  | 'document_approved'
  | 'document_rejected'
  | 'org_member_invited'
  | 'org_member_removed'
  | 'org_member_role_changed';

export interface ActivityEvent {
  type: ActivityEventType;
  at: string;
  actorEmailHash?: string;
  entityType?: string;
  entityId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  detail?: Record<string, unknown> | null;
  [k: string]: unknown;
}

// Derives an in-app target for an activity event. Used by the dashboard
// widget to make each row a clickable link to the entity detail page.
// Returns null if the event has no in-app target (membership events
// land on /team for now). Co-located with the type so a future event
// type addition stays in lockstep with the routing.
export function activityEventHref(e: ActivityEvent): string | null {
  if (!e || !e.entityType || !e.entityId) return null;
  switch (e.entityType) {
    case 'import_request': return `/imports/${e.entityId}`;
    case 'goods_master': return `/goods/${e.entityId}`;
    case 'supplier_master': return `/suppliers/${e.entityId}`;
    case 'shipment_master': return `/shipments/${e.entityId}`;
    default: return null;
  }
}

// One-line headline for an activity row. Deterministic — the activity
// widget shows up to ~20 rows on the dashboard and we don't want to
// pay for an LLM call per row. Falls back to a generic "<type>" when
// the event shape is unfamiliar (so a future allowlist addition
// renders something reasonable until a richer formatter ships).
export function activityEventSummary(e: ActivityEvent): string {
  const entityRef =
    e.entityId
      ? `${e.entityId}`
      : (e.entityType ? `${e.entityType}` : 'item');
  switch (e.type) {
    case 'import_request_created':
      return `New import request submitted (${entityRef})`;
    case 'import_request_updated':
      return `Import request ${entityRef} updated`;
    case 'import_request_status_transition': {
      const toStatus = (e.after as Record<string, unknown> | undefined)?.status;
      return toStatus
        ? `Import request ${entityRef} → ${String(toStatus)}`
        : `Import request ${entityRef} status changed`;
    }
    case 'import_request_archived':
      return `Import request ${entityRef} archived`;
    case 'import_request_message_posted': {
      // Detail carries { messageId, role, length } — surface the role
      // so the feed reads "Customer posted on ir_xxx" vs "Ops posted
      // on ir_xxx" without exposing the message body.
      const role = (e.detail as Record<string, unknown> | undefined)?.role;
      const who = role === 'ops' ? 'Team' : role === 'system' ? 'System' : 'Customer';
      return `${who} posted on import request ${entityRef}`;
    }
    case 'import_request_evidence_attached': {
      // Detail carries { evidenceId, regime, urlHost, hasNotes }.
      // Surface the regime so the activity feed reads "EUDR evidence
      // attached" — the most informative one-liner without exposing
      // the URL host.
      const regime = (e.detail as Record<string, unknown> | undefined)?.regime;
      const tag = typeof regime === 'string' && regime ? regime : 'Compliance';
      return `${tag} evidence attached to import request ${entityRef}`;
    }
    case 'import_request_supplier_picked': {
      // Sprint 28 — supplier-country pick. Detail carries country +
      // hsPrefix6 + rationaleCategory; the dashboard feed reads
      // "Picked CN for ir_xxx" so ops sees the learning signal land
      // in real time.
      const country = (e.detail as Record<string, unknown> | undefined)?.country;
      const tag = typeof country === 'string' && country ? country : 'Supplier';
      return `Picked ${tag} for import request ${entityRef}`;
    }
    case 'import_request_rated': {
      // Sprint 30 — customer rating. Detail carries { score,
      // hasComment, isSupersession }; the feed surfaces a star-rating
      // glyph + the score ("★★★★★ rating on ir_xxx"). A low-score
      // entry gives ops a follow-up signal; high scores reinforce
      // the corridor for sprint-28 picks learning.
      const score = Number((e.detail as Record<string, unknown> | undefined)?.score);
      const stars = Number.isInteger(score) && score >= 1 && score <= 5
        ? '★'.repeat(score) + '☆'.repeat(5 - score)
        : '★';
      return `${stars} rating on import request ${entityRef}`;
    }
    case 'import_request_internal_note_added': {
      // Sprint 55 — internal ops note. The body itself is
      // intentionally NOT in the audit chain detail (privacy
      // posture mirrors sprint 18 messages); the feed surfaces
      // a generic copy so other ops see context being added.
      return `Internal note added on import request ${entityRef}`;
    }
    case 'import_request_internal_note_edited': {
      // Sprint 61 — internal note edit. Surfaces so other ops
      // know a note they may have read earlier has been
      // revised. The body — old and new — is NOT in the chain;
      // open the request to see the current copy.
      return `Internal note edited on import request ${entityRef}`;
    }
    case 'import_request_internal_note_deleted': {
      // Sprint 61 — internal note soft-delete. Surfaces so
      // other ops know an in-flight note has been removed
      // (the row stays in KV for audit reconstruction; the
      // panel filters it out).
      return `Internal note deleted on import request ${entityRef}`;
    }
    case 'goods_master_created':
      return `New product registered (${entityRef})`;
    case 'goods_master_updated':
      return `Product ${entityRef} updated`;
    case 'goods_master_archived':
      return `Product ${entityRef} archived`;
    case 'supplier_master_created':
      return `New supplier registered (${entityRef})`;
    case 'supplier_master_updated':
      return `Supplier ${entityRef} updated`;
    case 'supplier_master_rescreened':
      return `Supplier ${entityRef} re-screened against sanctions`;
    case 'supplier_master_archived':
      return `Supplier ${entityRef} archived`;
    case 'shipment_master_created':
      return `Shipment ${entityRef} booked`;
    case 'shipment_master_updated':
      return `Shipment ${entityRef} updated`;
    case 'shipment_master_status_transition': {
      const toStatus = (e.after as Record<string, unknown> | undefined)?.status;
      return toStatus
        ? `Shipment ${entityRef} → ${String(toStatus)}`
        : `Shipment ${entityRef} status changed`;
    }
    case 'shipment_master_exception_acknowledged':
      return `Shipment ${entityRef} exception acknowledged`;
    case 'shipment_master_archived':
      return `Shipment ${entityRef} archived`;
    case 'document_drafted':
      return `Document drafted`;
    case 'document_approved':
      return `Document approved`;
    case 'document_rejected':
      return `Document rejected`;
    case 'org_member_invited':
      return `Teammate invited`;
    case 'org_member_removed':
      return `Teammate removed`;
    case 'org_member_role_changed':
      return `Teammate role changed`;
    default:
      return String(e.type);
  }
}

// Best-effort kind tag for visual styling — one of a small palette so
// the widget can colour-code rows without proliferating switch
// statements at the render site.
export type ActivityKind = 'import' | 'shipment' | 'goods' | 'supplier' | 'document' | 'team';

export function activityKind(e: ActivityEvent): ActivityKind {
  if (e.type.startsWith('import_request')) return 'import';
  if (e.type.startsWith('shipment_master')) return 'shipment';
  if (e.type.startsWith('goods_master')) return 'goods';
  if (e.type.startsWith('supplier_master')) return 'supplier';
  if (e.type.startsWith('document_')) return 'document';
  return 'team';
}

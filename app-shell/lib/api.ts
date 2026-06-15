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
export type AuditTimelineEvent =
  | ShipmentTimelineEvent
  | GoodsTimelineEvent
  | SupplierTimelineEvent;

export type AuditTimelineEventType =
  | ShipmentTimelineEventType
  | GoodsTimelineEventType
  | SupplierTimelineEventType;

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
  // Methodology / metadata sometimes rides as the trailing array
  // element with this shape — older entries may carry it as a sibling
  // field on rank-1.
  _meta?: {
    version?: string;
    classifier?: string;
    classifierHits?: number;
    countriesEvaluated?: string[];
    sampleSource?: string;
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

export interface ImportRequestTeamReviewState {
  decision?: 'approved' | 'sent_back' | 'rejected';
  reviewedByEmailHash?: string;
  reviewedAt?: string;
  edits?: Array<Record<string, unknown>>;
  notes?: string;
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
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

// Audit-timeline event types for /api/imports/<id>/history. Same shape
// as the other entity timeline events; entity-prefix is import_request.
export type ImportRequestTimelineEventType =
  | 'import_request_created'
  | 'import_request_updated'
  | 'import_request_status_transition'
  | 'import_request_archived';

export interface ImportRequestTimelineEvent {
  type: ImportRequestTimelineEventType;
  at: string;
  actorEmailHash?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  detail?: Record<string, unknown> | null;
  [k: string]: unknown;
}

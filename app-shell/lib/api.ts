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

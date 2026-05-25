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
export interface SavedPlan {
  id: string;
  label?: string;
  savedAt?: string;
  inputs?: PlanInputs;
  snapshot?: { perShipmentLandedTotal?: number } | null;
  current?: { perShipmentLandedTotal?: number } | null;
  delta?: PlanDelta | null;
}

// Shape of GET /api/account/overview (subset we render on the dashboard).
export interface Overview {
  user?: { email?: string };
  plans?: { count?: number; recent?: Array<{ id: string; label?: string; route?: string; landedEur?: number }> };
  portfolios?: { count?: number };
  compliance?: { count?: number; next?: { regime?: string; title?: string; dueDate?: string; daysUntil?: number } };
}

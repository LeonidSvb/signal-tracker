// Types for the v2 frontend rebuild (docs/HANDOFF_2026-07-19_frontend_build.md
// Stage 5+), against mockups/signals_v2_concept.html and docs/SCHEMA.md.

export type Tier = "T1" | "T2" | "T3" | null;

export type ContactStatus = "new" | "sent" | "replied" | "meeting" | "pass";

export type EmailStatus = "verified" | "inferred" | "invalid" | "pending";

export interface Company {
  id: string;
  client_id: string;
  name: string;
  linkedin_url: string | null;
  domain: string | null;
  industry: string | null;
  employees: number | null;
  hq_country: string | null;
  about: string | null;
  tier: Tier;
  rank: number | null;
  tier_reason: string | null;
  ranked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Signal {
  id: string;
  client_id: string;
  company_id: string;
  raw_signal_id: string | null;
  signal_type: string;
  title: string;
  source: string;
  source_url: string | null;
  pub_date: string | null;
  days_ago: number | null;
  country: string | null;
  score: number;
  freshness_score: number | null;
  status: "active" | "stale" | "filled" | "expired";
  expires_at: string | null;
  narrative: string | null;
  angle: string | null;
  event_key: string | null;
  event_summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  client_id: string;
  company_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  title: string | null;
  linkedin_url: string | null;
  email: string | null;
  email_status: EmailStatus | null;
  phone: string | null;
  is_primary: boolean;
  source: string | null;
  created_at: string;
  updated_at: string;
}

// Legacy — company-scoped, still written by the old frontend until cutover.
// Used as a FALLBACK when a company has zero contact_state rows yet (§0 Q1,
// docs/PLAN_2026-07-19_react_migration_prep.md).
export interface AppState {
  id: string;
  client_id: string;
  company_id: string;
  status: ContactStatus;
  updated_at: string;
  updated_by: string;
}

// New (migration 009) — per-contact CRM status.
export interface ContactState {
  id: string;
  client_id: string;
  company_id: string;
  contact_id: string;
  status: ContactStatus;
  updated_by: string | null;
  updated_at: string;
}

// New (migration 008 widened the unique constraint to include contact_id).
export interface ChannelAction {
  id: string;
  client_id: string;
  company_id: string;
  contact_id: string | null;
  event_key: string;
  channel: "email" | "linkedin";
  status: string;
  detail: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: string;
  client_id: string;
  company_id: string;
  author: string;
  body: string;
  created_at: string;
}

// ── Derived, client-side (mirrors pipeline/lib/eventGrouping.mjs's shape) ──

export interface CompanyEvent {
  eventKey: string;
  memberIds: string[];
  members: Signal[];
  pubDate: string | null;
  baseType: string;
  title: string | null;
  summary: string | null; // signals.event_summary — null for single-source events, frontend falls back to title
  status: "active" | "stale";
}

// ── Sidebar list item — slim select per §2.6 (prep doc) ──

export interface CompanyListItem {
  id: string;
  name: string;
  tier: Tier;
  employees: number | null;
  hq_country: string | null;
  sourceCount: number;
  contactCount: number;
  withEmailCount: number;
  origin: "exa" | "job_board" | "both" | null;
  hasLinkedinOnly: boolean; // no contact has an email, at least one has linkedin_url
  status: ContactStatus; // aggregateStatus() over contact_state, fallback app_state
}

export interface PipelineRun {
  id: string;
  client_id: string;
  script: string;
  status: "running" | "success" | "error";
  rows_scraped: number;
  rows_enriched: number;
  errors: Record<string, unknown>;
  started_at: string;
  finished_at: string;
  meta: Record<string, unknown>;
}

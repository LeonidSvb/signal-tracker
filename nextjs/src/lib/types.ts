export type EmailStatus = "validated" | "invalid" | "no_email";

export type LeadStatus = "new" | "sent" | "replied" | "meeting" | "pass";

export interface Contact {
  full_name: string;
  title: string;
  email: string;
  email_status: EmailStatus;
  linkedin_url: string;
  source_level: string;
}

export interface Signal {
  title: string;
  days_ago: number;
  source: string;
  country: string;
  url: string;
}

export interface Lead {
  id: string;
  client_id: string;
  company_name: string;
  company_linkedin_url: string;
  company_domain: string;
  company_industry: string;
  company_employees: number;
  company_hq_country: string;
  company_about: string;
  company_snapshot: string;
  signal_title: string;
  signal_source: string;
  signal_pub_date: string;
  signal_days_ago: number;
  signal_country: string;
  signal_url: string;
  signal_narrative: string;
  angle: string;
  icp_score: number;
  score: number;
  contacts: Contact[];
  all_signals: Signal[];
  created_at: string;
  updated_at: string;
}

export interface AppState {
  id: string;
  lead_id: string;
  client_id: string;
  status: LeadStatus;
  updated_at: string;
  updated_by: string;
}

export interface Note {
  id: string;
  lead_id: string;
  client_id: string;
  author: "leo" | "philippe";
  body: string;
  created_at: string;
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

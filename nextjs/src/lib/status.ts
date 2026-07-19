import type { ContactStatus } from "./types";

// Ported from mockups/signals_v2_concept.html's aggregateStatus() (Stage 6,
// docs/HANDOFF_2026-07-19_frontend_build.md). Company-level status = the most
// advanced status among its contacts, EXCEPT pass doesn't dominate: one contact
// passing shouldn't hide that another is still an active conversation. Only
// returns 'pass' when EVERY contact has passed.
const FUNNEL_RANK: Record<Exclude<ContactStatus, "pass">, number> = {
  new: 0,
  sent: 1,
  replied: 2,
  meeting: 3,
};

export function aggregateStatus(statuses: ContactStatus[]): ContactStatus {
  const active = statuses.filter((s): s is Exclude<ContactStatus, "pass"> => s !== "pass");
  if (!active.length) return "pass";
  return active.reduce((best, s) => (FUNNEL_RANK[s] > FUNNEL_RANK[best] ? s : best), active[0]);
}

// §0 Q1 (docs/PLAN_2026-07-19_react_migration_prep.md): a company's status comes
// from its contact_state rows when any exist; falls back to the legacy
// company-scoped app_state.status when it has none yet, so statuses Leo/Philippe
// already set in the old frontend keep displaying correctly through the
// transition instead of silently reverting to "new".
export function resolveCompanyStatus(
  contactStatuses: ContactStatus[],
  appStateStatus: ContactStatus | null
): ContactStatus {
  if (contactStatuses.length) return aggregateStatus(contactStatuses);
  return appStateStatus ?? "new";
}

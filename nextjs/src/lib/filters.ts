import type { CompanyListItem, ContactStatus, Tier } from "./types";

// Extracted from components/leads/Sidebar.tsx's filter predicate (Stage 6,
// docs/HANDOFF_2026-07-19_frontend_build.md — "filter predicate logic" is a
// mandatory test target) so it's testable without mounting the component.
export interface CompanyFilters {
  statusFilter: ContactStatus | "all";
  tierFilters: Set<Tier>;
  channelFilters: Set<"both" | "linkedin_only">;
  originFilters: Set<"exa" | "job_board">;
  search: string;
}

export function matchesFilters(c: CompanyListItem, f: CompanyFilters): boolean {
  const channelKey: "both" | "linkedin_only" = c.hasLinkedinOnly ? "linkedin_only" : "both";
  const originKeys: ("exa" | "job_board")[] = c.origin === "both" ? ["exa", "job_board"] : c.origin ? [c.origin] : [];

  return (
    (f.statusFilter === "all" || c.status === f.statusFilter) &&
    f.tierFilters.has(c.tier) &&
    f.channelFilters.has(channelKey) &&
    originKeys.some((o) => f.originFilters.has(o)) &&
    (!f.search || c.name.toLowerCase().includes(f.search.toLowerCase()))
  );
}

export function filterCompanies(companies: CompanyListItem[], f: CompanyFilters): CompanyListItem[] {
  return companies.filter((c) => matchesFilters(c, f));
}

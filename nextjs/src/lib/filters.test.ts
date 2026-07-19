import { describe, it, expect } from "vitest";
import { filterCompanies, type CompanyFilters } from "./filters";
import type { CompanyListItem, Tier } from "./types";

function co(over: Partial<CompanyListItem>): CompanyListItem {
  return {
    id: "id", name: "Test Co", tier: "T1", employees: 100, hq_country: "DE",
    sourceCount: 1, contactCount: 2, withEmailCount: 1, origin: "exa",
    hasLinkedinOnly: false, status: "new",
    ...over,
  };
}

const ALL_OPEN: CompanyFilters = {
  statusFilter: "all",
  tierFilters: new Set<Tier>(["T1", "T2", "T3"]),
  channelFilters: new Set<"both" | "linkedin_only">(["both", "linkedin_only"]),
  originFilters: new Set<"exa" | "job_board">(["exa", "job_board"]),
  search: "",
};

describe("filterCompanies", () => {
  it("returns everything when all filters are open", () => {
    const companies = [co({ id: "a" }), co({ id: "b", tier: "T3" })];
    expect(filterCompanies(companies, ALL_OPEN)).toHaveLength(2);
  });

  it("status filter matches the company's resolved status exactly", () => {
    const companies = [co({ id: "a", status: "new" }), co({ id: "b", status: "sent" })];
    const result = filterCompanies(companies, { ...ALL_OPEN, statusFilter: "sent" });
    expect(result.map((c) => c.id)).toEqual(["b"]);
  });

  it("tier filter excludes companies whose tier isn't in the set", () => {
    const companies = [co({ id: "a", tier: "T1" }), co({ id: "b", tier: "T2" })];
    const result = filterCompanies(companies, { ...ALL_OPEN, tierFilters: new Set<Tier>(["T1"]) });
    expect(result.map((c) => c.id)).toEqual(["a"]);
  });

  it("channel filter: hasLinkedinOnly=true maps to the linkedin_only bucket", () => {
    const companies = [co({ id: "a", hasLinkedinOnly: true }), co({ id: "b", hasLinkedinOnly: false })];
    const result = filterCompanies(companies, { ...ALL_OPEN, channelFilters: new Set<"both" | "linkedin_only">(["linkedin_only"]) });
    expect(result.map((c) => c.id)).toEqual(["a"]);
  });

  it("origin filter: a company with origin='both' matches if EITHER exa or job_board is active", () => {
    const companies = [co({ id: "a", origin: "both" })];
    expect(filterCompanies(companies, { ...ALL_OPEN, originFilters: new Set<"exa" | "job_board">(["exa"]) })).toHaveLength(1);
    expect(filterCompanies(companies, { ...ALL_OPEN, originFilters: new Set<"exa" | "job_board">(["job_board"]) })).toHaveLength(1);
    expect(filterCompanies(companies, { ...ALL_OPEN, originFilters: new Set<"exa" | "job_board">() })).toHaveLength(0);
  });

  it("search matches company name case-insensitively as a substring", () => {
    const companies = [co({ id: "a", name: "DMK Deutsches Milchkontor" }), co({ id: "b", name: "Nestlé" })];
    const result = filterCompanies(companies, { ...ALL_OPEN, search: "dmk" });
    expect(result.map((c) => c.id)).toEqual(["a"]);
  });

  it("filters combine with AND — a company must pass every active filter", () => {
    const companies = [
      co({ id: "a", tier: "T1", status: "new" }),
      co({ id: "b", tier: "T1", status: "sent" }),
      co({ id: "c", tier: "T2", status: "new" }),
    ];
    const result = filterCompanies(companies, { ...ALL_OPEN, tierFilters: new Set<Tier>(["T1"]), statusFilter: "new" });
    expect(result.map((c) => c.id)).toEqual(["a"]);
  });
});

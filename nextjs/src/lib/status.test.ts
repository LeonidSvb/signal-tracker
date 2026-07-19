import { describe, it, expect } from "vitest";
import { aggregateStatus, resolveCompanyStatus } from "./status";

describe("aggregateStatus", () => {
  it("most-advanced status wins across contacts", () => {
    expect(aggregateStatus(["new", "sent", "replied"])).toBe("replied");
    expect(aggregateStatus(["meeting", "new"])).toBe("meeting");
  });

  it("pass does not dominate when another contact is still active", () => {
    expect(aggregateStatus(["pass", "sent"])).toBe("sent");
    expect(aggregateStatus(["pass", "new", "meeting"])).toBe("meeting");
  });

  it("only returns pass when EVERY contact has passed", () => {
    expect(aggregateStatus(["pass", "pass"])).toBe("pass");
    expect(aggregateStatus(["pass"])).toBe("pass");
  });

  it("empty list returns pass (no contacts = nothing active)", () => {
    expect(aggregateStatus([])).toBe("pass");
  });

  it("single active status returns itself", () => {
    expect(aggregateStatus(["new"])).toBe("new");
  });
});

describe("resolveCompanyStatus", () => {
  it("uses contact_state aggregation when contacts have state", () => {
    expect(resolveCompanyStatus(["sent", "new"], "pass")).toBe("sent");
  });

  it("falls back to app_state.status when the company has zero contact_state rows", () => {
    expect(resolveCompanyStatus([], "meeting")).toBe("meeting");
  });

  it("falls back to 'new' when there is neither contact_state nor app_state", () => {
    expect(resolveCompanyStatus([], null)).toBe("new");
  });
});

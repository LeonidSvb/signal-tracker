"use client";
import { useState } from "react";
import "../app-shell.css";
import Rail from "@/components/Rail";
import TemplatesPanel from "@/components/settings/TemplatesPanel";
import IcpFilterPanel from "@/components/settings/IcpFilterPanel";
import HealthPanel from "@/components/settings/HealthPanel";

// Real Settings page (Stage 7) — grouped sidebar, 1:1 with reply-agent/settings.html's
// pattern already established in mockups/settings.html and signals_v2_concept.html.
// Templates, ICP Filter and Health are all real inline panels reading live data
// (/api/copy, /api/icp-filter, /api/health) — no external links. Health used to be
// a separate /health route with its own rail (Stage 4); moved in here 2026-07-19
// (Leo: the mockup's separate-page Health link was carelessness to preserve, not a
// deliberate call — Settings' own tab pattern already fit it).

type Section = "templates" | "icpfilter" | "health";

export default function SettingsPage() {
  const [section, setSection] = useState<Section>("templates");

  return (
    <div className="app-shell">
      <Rail />
      <div className="main">
        <div className="settings-shell">
          <div className="settings-nav">
            <div className="settings-nav-head">Settings</div>
            <div className="settings-nav-scroll">
              <div className="settings-group-label">Outreach</div>
              <div className={`settings-nav-item ${section === "templates" ? "active" : ""}`} onClick={() => setSection("templates")}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4M8 16h.01M16 16h.01" /></svg>
                Templates
              </div>
              <div className="settings-group-label">Pipeline</div>
              <div className={`settings-nav-item ${section === "icpfilter" ? "active" : ""}`} onClick={() => setSection("icpfilter")}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" /></svg>
                ICP Filter
              </div>
              <div className="settings-group-label">System</div>
              <div className={`settings-nav-item ${section === "health" ? "active" : ""}`} onClick={() => setSection("health")}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
                Health <span className="settings-nav-badge">live</span>
              </div>
            </div>
          </div>
          <div className="settings-content">
            {section === "templates" && <TemplatesPanel />}
            {section === "icpfilter" && <IcpFilterPanel />}
            {section === "health" && <HealthPanel />}
          </div>
        </div>
      </div>
    </div>
  );
}

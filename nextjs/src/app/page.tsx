"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import "./app-shell.css";
import Rail from "@/components/Rail";
import Sidebar from "@/components/leads/Sidebar";
import DetailPanel from "@/components/leads/DetailPanel";
import ActivityTab from "@/components/leads/ActivityTab";
import { useCompanyList, useCompanyDetail, useNotes, useSetContactStatus } from "@/hooks/useLeads";
import { useSendableStats } from "@/hooks/useSendableStats";

const CLIENT_SLUG = process.env.NEXT_PUBLIC_CLIENT_SLUG ?? "philippe-bosquillon";

export default function Home() {
  const router = useRouter();
  const [moduleTab, setModuleTab] = useState<"leads" | "activity">("leads");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { companies, clientId, loading } = useCompanyList(CLIENT_SLUG);
  const { detail } = useCompanyDetail(selectedId, clientId);
  const { notes, addNote } = useNotes(selectedId);
  const setContactStatus = useSetContactStatus();
  const sendableStats = useSendableStats(clientId);

  // Auto-select the first company once the list loads, matching the mockup's
  // "always show a detail view" default rather than an empty state on first paint.
  if (!selectedId && companies.length && !loading) {
    setSelectedId(companies[0].id);
  }

  const totalTiered = companies.filter((c) => c.tier).length;

  return (
    <div className="app-shell">
      <Rail />
      <div className="main">
        <div className="module-tabbar">
          <button className={`module-tab ${moduleTab === "leads" ? "active" : ""}`} onClick={() => setModuleTab("leads")}>Leads</button>
          <button className={`module-tab ${moduleTab === "activity" ? "active" : ""}`} onClick={() => setModuleTab("activity")}>Activity</button>
        </div>
        <div className="module-body">
          {moduleTab === "leads" && (
            <>
              <Sidebar
                companies={companies}
                selectedId={selectedId}
                onSelect={setSelectedId}
                totalTiered={totalTiered}
                totalCompanies={companies.length}
                sendableStats={sendableStats}
              />
              <div className="detail">
                {detail ? (
                  <DetailPanel
                    detail={detail}
                    clientId={clientId}
                    notes={notes}
                    addNote={addNote}
                    setContactStatus={setContactStatus}
                    onStatusChanged={() => { /* useCompanyList refetches on next mount; live re-sort is a follow-up */ }}
                    onOpenTemplatesGuide={() => router.push("/settings")}
                  />
                ) : (
                  <div className="placeholder">
                    <div className="icon">◇</div>
                    <h3>{loading ? "Loading…" : "Select a company"}</h3>
                    <p>Pick a company from the list to see its signals, contacts, and outreach status.</p>
                  </div>
                )}
              </div>
            </>
          )}
          {moduleTab === "activity" && clientId && <ActivityTab clientId={clientId} />}
        </div>
      </div>
    </div>
  );
}

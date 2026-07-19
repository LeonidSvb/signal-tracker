"use client";
import { useState } from "react";
import type { CompanyDetail } from "@/hooks/useLeads";
import type { ContactStatus, Note } from "@/lib/types";
import EventsList from "./EventsList";
import ContactRow from "./ContactRow";
import NotesPanel from "./NotesPanel";

const TIER_EXPLAIN: Record<string, string> = {
  T1: "Highest priority. Has a fresh 'class A' event (M&A, investment, new leadership) — or 2+ different events within 90 days.",
  T2: "Medium priority. Has a fresh 'class B' event (expansion, contract win, sector signal).",
  T3: "Lower priority. Older or weaker signal — still worth a look, just not urgent.",
};

const EMAIL_STATUS_TEXT: Record<string, string> = {
  pushed: "Pushed to the PlusVibe campaign.",
  validated: "Validated, about to be pushed.",
  skipped_validation: "Skipped — email validation didn't come back sendable.",
  skipped_no_campaign: "Not sent yet — waiting on a PlusVibe campaign to be configured. Leo will handle this automatically once live.",
  skipped_no_email: "No sendable email found for this company yet.",
};

interface Props {
  detail: CompanyDetail;
  clientId: string;
  notes: Note[];
  addNote: (companyId: string, clientId: string, author: string, body: string) => Promise<void>;
  setContactStatus: (clientId: string, companyId: string, contactId: string, status: ContactStatus) => Promise<void>;
  onStatusChanged: () => void; // sidebar's aggregate chip depends on this — parent refetches the list
  onOpenTemplatesGuide: () => void;
}

export default function DetailPanel({ detail, clientId, notes, addNote, setContactStatus, onStatusChanged, onOpenTemplatesGuide }: Props) {
  const { company, events, contacts, contactStatuses, appStateFallback, latestEmailAction } = detail;
  const primaryContact = contacts.find((c) => c.is_primary) ?? contacts[0] ?? null;
  const [openContactId, setOpenContactId] = useState<string | null>(primaryContact?.id ?? null);

  const allNoEmail = contacts.every((c) => !c.email);
  const hasContactStates = contacts.some((c) => contactStatuses[c.id]);
  const bestSignalType = events[0]?.baseType || "HIRING_MID";
  const tierReasonAgeNote =
    "The day count is age of the EVENT (its publish date), not how long ago we found it — a freshly-discovered but old story still counts as stale.";

  async function handleSetStatus(contactId: string, status: ContactStatus) {
    await setContactStatus(clientId, company.id, contactId, status);
    onStatusChanged();
  }

  const metaParts = [
    company.industry,
    company.employees ? `${company.employees.toLocaleString()} employees` : null,
    company.hq_country,
  ].filter(Boolean) as string[];

  return (
    <div className="detail-inner">
      <div className="card">
        <div className="card-head">
          <div>
            <div className="co-name">{company.name}</div>
            <div className="co-meta">
              {metaParts.map((p, i) => <span key={i} className="dot-sep">{p}</span>)}
              {company.domain && (
                <span className="dot-sep">
                  <a href={`https://${company.domain}`} target="_blank" rel="noopener noreferrer">{company.domain} ↗</a>
                </span>
              )}
              {company.linkedin_url && (
                <span className="dot-sep">
                  <a href={company.linkedin_url} target="_blank" rel="noopener noreferrer">LinkedIn ↗</a>
                </span>
              )}
            </div>
          </div>
          {company.tier && (
            <div className="tier-block">
              <span className={`tier-big chip-${company.tier}`}>
                {company.tier}
                <span className="tip-box">{TIER_EXPLAIN[company.tier]} Rank is an internal sort order within the tier, not shown as a raw number.</span>
              </span>
              <div className="tier-reason">
                {company.tier_reason}{" "}
                <span className="tip" style={{ verticalAlign: "-1px" }}>
                  <svg className="info-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
                  </svg>
                  <span className="tip-box" style={{ right: 0, left: "auto" }}>{tierReasonAgeNote}</span>
                </span>
              </div>
            </div>
          )}
        </div>

        {allNoEmail && (
          <div className="channel-only-banner">⚠ No verified email at this company — LinkedIn is the only channel for all {contacts.length} contacts.</div>
        )}

        <EventsList events={events} />

        <div className="section">
          <div className="section-label">
            Contacts ({contacts.length})
            <span className="tip">
              <svg className="info-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
              </svg>
              <span className="tip-box">Each contact has their own LinkedIn outreach status — click a row to see their status buttons and copy-ready text. Primary starts expanded.</span>
            </span>
          </div>
          <div className="contacts-list">
            {contacts.map((c) => (
              <ContactRow
                key={c.id}
                companyId={company.id}
                companyName={company.name}
                clientId={clientId}
                contact={c}
                signalType={bestSignalType}
                rank={company.rank}
                hqCountry={company.hq_country}
                status={contactStatuses[c.id] ?? (hasContactStates ? "new" : appStateFallback ?? "new")}
                isOpen={openContactId === c.id}
                onToggleOpen={() => setOpenContactId((cur) => (cur === c.id ? null : c.id))}
                onSetStatus={(status) => handleSetStatus(c.id, status)}
                onOpenTemplatesGuide={onOpenTemplatesGuide}
              />
            ))}
          </div>
        </div>

        <div className="section">
          <div className="section-label">Email</div>
          <div className="email-status">
            <span className="ico">{allNoEmail ? "—" : latestEmailAction ? "✉" : "◐"}</span>
            {allNoEmail
              ? "No email on file for any contact — LinkedIn is the only channel here."
              : latestEmailAction
                ? (EMAIL_STATUS_TEXT[latestEmailAction.status] ?? latestEmailAction.status)
                : "Not sent yet — hasn't been through the email routing stage."}
          </div>
        </div>

        <div className="section">
          <div className="section-label">Notes</div>
          <NotesPanel companyId={company.id} clientId={clientId} notes={notes} onAdd={addNote} />
        </div>
      </div>
    </div>
  );
}

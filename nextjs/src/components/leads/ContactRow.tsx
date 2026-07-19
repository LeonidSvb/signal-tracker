"use client";
import { useState, useEffect } from "react";
import type { Contact, ContactStatus } from "@/lib/types";
import { avatarColor, initials } from "./helpers";

const STATUSES: { key: ContactStatus; label: string }[] = [
  { key: "new", label: "New" },
  { key: "sent", label: "Sent" },
  { key: "replied", label: "Replied" },
  { key: "meeting", label: "Meeting" },
  { key: "pass", label: "Pass" },
];

const OUTREACH_CHIP_COLOR: Record<ContactStatus, string> = {
  new: "var(--muted-2)", sent: "var(--accent)", replied: "#7C3AED", meeting: "var(--pos)", pass: "var(--neg)",
};

// Small, stable lookup tables duplicated from pipeline/lib/copyEngine.mjs's
// langForCountry()/marketFocusForCountry() — that module can't be imported into
// Next.js (top-level side effects resolve file paths via import.meta.url, same
// cross-boundary risk ADR-009 flags for localizeMessage()). These two functions
// are tiny and stable enough that duplication is safer than a broken import.
function langForCountry(country: string | null): "de" | "fr" | "nl" | "en" {
  if (country && ["DE", "AT", "CH"].includes(country)) return "de";
  if (country && ["FR", "LU"].includes(country)) return "fr";
  if (country && ["NL", "BE"].includes(country)) return "nl";
  return "en";
}
const MARKET_FOCUS: Record<string, string> = { DE: "Germany", FR: "France", NL: "the Netherlands", BE: "Belgium" };
function marketFocusForCountry(country: string | null): string {
  return (country && MARKET_FOCUS[country]) || "Europe";
}

function statusInline(status: string | null) {
  if (status === "verified") return <span className="c-status verified"><span className="c-status-dot" />Verified</span>;
  if (status === "pending") return <span className="c-status pending"><span className="c-status-dot" />Pending</span>;
  return <span className="c-status none"><span className="c-status-dot" />No email</span>;
}

const EMAIL_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </svg>
);
const LI_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z" /><rect x="2" y="9" width="4" height="12" /><circle cx="4" cy="4" r="2" />
  </svg>
);

interface Props {
  companyId: string;
  clientId: string;
  contact: Contact;
  signalType: string; // best/primary signal type — drives which copy_templates.json key to fill
  rank: number | null;
  hqCountry: string | null;
  status: ContactStatus;
  isOpen: boolean;
  onToggleOpen: () => void;
  onSetStatus: (status: ContactStatus) => void;
  onOpenTemplatesGuide: () => void;
}

export default function ContactRow({
  companyId, clientId, contact, signalType, rank, hqCountry, status, isOpen, onToggleOpen, onSetStatus, onOpenTemplatesGuide,
}: Props) {
  const [lang, setLang] = useState<"en" | "de" | "fr" | "nl">("en");
  const [copy, setCopy] = useState<{ connect: string | null; qualify: string | null } | null>(null);
  const [copyLoading, setCopyLoading] = useState(false);
  const [translated, setTranslated] = useState<{ connect: string | null; qualify: string | null } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const firstName = (contact.first_name || contact.full_name || "").split(" ")[0];
  const marketFocus = marketFocusForCountry(hqCountry);
  const nativeLang = langForCountry(hqCountry);
  const emailHref = contact.email_status === "verified" && contact.email ? `mailto:${contact.email}` : null;

  useEffect(() => {
    if (!isOpen || copy || status === "pass") return;
    setCopyLoading(true);
    fetch("/api/copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signalType, rank,
        vars: { first_name: firstName, company: "", market_focus: marketFocus },
      }),
    })
      .then((r) => r.json())
      .then((d) => setCopy({ connect: d.connect, qualify: d.qualify }))
      .catch(() => setCopy({ connect: null, qualify: null }))
      .finally(() => setCopyLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  async function toggleTranslate() {
    if (lang !== "en") { setLang("en"); return; }
    if (nativeLang === "en") return;
    setLang(nativeLang);
    if (translated || !copy) return;
    const [connectRes, qualifyRes] = await Promise.all([
      copy.connect ? fetch("/api/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: copy.connect, lang: nativeLang }) }).then((r) => r.json()) : null,
      copy.qualify ? fetch("/api/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: copy.qualify, lang: nativeLang }) }).then((r) => r.json()) : null,
    ]);
    setTranslated({
      connect: connectRes?.translated ?? copy.connect,
      qualify: qualifyRes?.translated ?? copy.qualify,
    });
  }

  function activeText(field: "connect" | "qualify"): string {
    const src = lang === "en" ? copy : translated || copy;
    return (src?.[field] || "").replace(/\{first_name\}/g, firstName);
  }

  function copyToClipboard(field: "connect" | "qualify") {
    navigator.clipboard.writeText(activeText(field)).catch(() => {});
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1400);
  }

  function copyActions(field: "connect" | "qualify") {
    return (
      <div className="cb-actions" onClick={(e) => e.stopPropagation()}>
        <button className={`btn btn-copy ${copiedField === field ? "copied" : ""}`} onClick={() => copyToClipboard(field)}>
          {copiedField === field ? "✓ Copied" : "⧉ Copy text"}
        </button>
        {nativeLang !== "en" && (
          <button className={`btn btn-translate ${lang !== "en" ? "on" : ""}`} onClick={toggleTranslate}>
            {lang !== "en" ? `✓ Showing ${nativeLang.toUpperCase()}` : `🌐 Translate to ${nativeLang.toUpperCase()}`}
          </button>
        )}
        <button className="btn-guide" onClick={onOpenTemplatesGuide}>Full copy guide ↗</button>
      </div>
    );
  }

  function renderCopyBox() {
    if (status === "pass") {
      return <div className="copy-box"><div className="cb-label" style={{ color: "var(--muted)" }}>Marked as pass — no further copy needed, no more nudges.</div></div>;
    }
    if (copyLoading) {
      return <div className="copy-box"><div className="cb-label">Loading copy…</div></div>;
    }
    if (status === "new") {
      return (
        <div className="copy-box">
          <div className="cb-label">Ready to send — connection request</div>
          <div className="cb-msg">{activeText("connect")}</div>
          {copyActions("connect")}
        </div>
      );
    }
    if (status === "sent" || status === "replied") {
      return (
        <div className="copy-box">
          <div className="cb-label">{status === "sent" ? "Waiting on a reply — once they answer, use this" : "They replied — qualifying question"}</div>
          <div className="cb-msg">{activeText("qualify")}</div>
          <div className="cb-aside">
            If the answer is a clear no — don't propose a call, simply move on. If they're clearly engaged, it's
            fine to ask a bit more (decision-maker? other roles open? rough timeline?) — but leave the actual
            pitch for Leo.
          </div>
          {copyActions("qualify")}
        </div>
      );
    }
    if (status === "meeting") {
      // Real finding (Stage 3): the actual playbook has NO scripted step-3/follow-up
      // message — "Follow-up'ов от Philippe НЕТ." Any reply routes to Leo from here;
      // showing an honest note instead of a fabricated "propose a call" script.
      return (
        <div className="copy-box">
          <div className="cb-label">Engaged — Philippe's LinkedIn part is done here</div>
          <div className="cb-aside" style={{ marginBottom: 0 }}>
            There's no further scripted LinkedIn message for this stage — Philippe sends the connection note and
            first message only, per the playbook. Any reply from here routes to Leo, who takes the conversation
            forward directly (not through this tool).
          </div>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="c-row-wrap">
      <div className={`c-row ${contact.is_primary ? "primary" : ""}`} onClick={onToggleOpen}>
        <div className="c-avatar" style={{ background: avatarColor(contact.full_name || firstName) }}>
          {initials(contact.full_name || firstName)}
        </div>
        <div className="c-info">
          <span className="c-name">{contact.full_name}</span>
          <span className="c-title">{contact.title || ""}</span>
        </div>
        {statusInline(contact.email_status)}
        <span
          className="c-outreach-chip"
          style={{ background: "var(--surface)", border: `1px solid ${OUTREACH_CHIP_COLOR[status]}`, color: OUTREACH_CHIP_COLOR[status] }}
        >
          {STATUSES.find((s) => s.key === status)?.label}
        </span>
        <div className="c-actions" onClick={(e) => e.stopPropagation()}>
          {emailHref ? (
            <a className="c-icon-btn" href={emailHref} title={contact.email ?? ""}>{EMAIL_ICON}</a>
          ) : (
            <span className="c-icon-btn disabled">{EMAIL_ICON}</span>
          )}
          {contact.linkedin_url && (
            <a className="c-icon-btn li" href={contact.linkedin_url} target="_blank" rel="noopener noreferrer" title="Open LinkedIn profile">{LI_ICON}</a>
          )}
        </div>
        <span className={`c-chev ${isOpen ? "open" : ""}`}>▸</span>
      </div>
      {isOpen && (
        <div className="c-outreach-body">
          <div className="status-row" onClick={(e) => e.stopPropagation()}>
            {STATUSES.map((s) => (
              <button
                key={s.key}
                className={`status-btn ${status === s.key ? `on ${s.key}` : ""}`}
                onClick={(e) => { e.stopPropagation(); onSetStatus(s.key); }}
              >
                {s.label}
              </button>
            ))}
          </div>
          {renderCopyBox()}
        </div>
      )}
    </div>
  );
}

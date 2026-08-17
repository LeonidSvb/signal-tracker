"use client";
import { useState, useEffect } from "react";
import type { Contact, ContactStatus } from "@/lib/types";
import { avatarColor, initials, capitalizeName } from "./helpers";

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
  companyName: string;
  clientId: string;
  contact: Contact;
  signalType: string; // best/primary signal type — drives which copy_templates.json key to fill
  pubDate: string | null; // needed for the HIRING_EXEC/MID/STALE split, see /api/copy
  jobTitle: string | null; // needed for the HIRING_EXEC vs MID exec-title-band check
  activeHiringCount: number; // 2+ active HIRING events at this company -> HIRING_SURGE
  fact: string | null; // real signal fact — drives /api/copy's AI hook+bridge generation
  rank: number | null;
  hqCountry: string | null;
  status: ContactStatus;
  isOpen: boolean;
  onToggleOpen: () => void;
  onSetStatus: (status: ContactStatus) => void;
  onOpenTemplatesGuide: () => void;
}

export default function ContactRow({
  companyId, companyName, clientId, contact, signalType, pubDate, jobTitle, activeHiringCount, fact, rank, hqCountry, status, isOpen, onToggleOpen, onSetStatus, onOpenTemplatesGuide,
}: Props) {
  // channel (2026-08-17): LinkedIn vs Email. liMode only matters for channel=linkedin —
  // whether LinkedIn goes through a connect-note step, or skips straight to InMail (no
  // accept-gate, needs a subject line). Both channel and liMode key the copy cache (a
  // liMode switch changes the underlying content even though channel stays "linkedin"),
  // so flipping between them never re-triggers a paid AI call once fetched once.
  const [channel, setChannel] = useState<"linkedin" | "email">("linkedin");
  const [liMode, setLiMode] = useState<"connect_note" | "connect_no_note" | "inmail">("connect_note");
  const [lang, setLang] = useState<"en" | "de" | "fr" | "nl">("en");
  const [copyByKey, setCopyByKey] = useState<Record<string, Record<string, string | null>>>({});
  const [copyLoading, setCopyLoading] = useState(false);
  const [translatedByKey, setTranslatedByKey] = useState<Record<string, Record<string, string | null>>>({});
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const isDirectMessage = channel === "email" || liMode === "inmail"; // no connect/accept gate
  const cacheKey = channel === "linkedin" ? `linkedin:${liMode}` : "email";
  const copy = copyByKey[cacheKey] ?? null;
  const translated = translatedByKey[cacheKey] ?? null;
  // Which two copy_templates.json-fill fields represent "the thing to send at this
  // contact status" for the current channel/mode — mirrors the funnel everywhere else
  // in the app: New/Sent/Replied/Meeting/Pass, just resolved into different text per
  // channel. Meeting/Pass are special-cased in renderCopyBox (no scripted copy either way).
  const STAGE_FIELD: Record<"new" | "sent" | "replied", { field: string; label: string }> = isDirectMessage
    ? {
        new: { field: "initial", label: channel === "email" ? "Ready to send — initial email" : "Ready to send — InMail" },
        sent: { field: "followup", label: "Follow-up — if no reply after a few days" },
        replied: { field: "replyQualify", label: "They replied — qualifying question" },
      }
    : {
        new: { field: "connect", label: "Ready to send — connection request" },
        sent: { field: "qualify", label: "Waiting on a reply — once they answer, use this" },
        replied: { field: "qualify", label: "They replied — qualifying question" },
      };

  const firstName = capitalizeName((contact.first_name || contact.full_name || "").split(" ")[0]);
  const fullName = capitalizeName(contact.full_name);
  const marketFocus = marketFocusForCountry(hqCountry);
  const nativeLang = langForCountry(hqCountry);
  const emailHref = contact.email_status === "verified" && contact.email ? `mailto:${contact.email}` : null;
  const hasEmail = !!contact.email;

  useEffect(() => {
    if (!isOpen || copyByKey[cacheKey] || status === "pass") return;
    setCopyLoading(true);
    fetch("/api/copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signalType, pubDate, jobTitle, activeHiringCount, fact, rank, channel, liMode,
        vars: { first_name: firstName, company: companyName, market_focus: marketFocus },
      }),
    })
      .then((r) => r.json())
      .then((d) => setCopyByKey((prev) => ({ ...prev, [cacheKey]: d })))
      .catch(() => setCopyByKey((prev) => ({ ...prev, [cacheKey]: {} })))
      .finally(() => setCopyLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, cacheKey]);

  async function toggleTranslate() {
    if (lang !== "en") { setLang("en"); return; }
    if (nativeLang === "en") return;
    setLang(nativeLang);
    if (translated || !copy) return;
    const fields = isDirectMessage ? ["initial", "followup", "replyQualify"] : ["connect", "qualify"];
    const results = await Promise.all(
      fields.map((f) => (copy[f] ? fetch("/api/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: copy[f], lang: nativeLang }) }).then((r) => r.json()) : null))
    );
    const next: Record<string, string | null> = {};
    fields.forEach((f, i) => { next[f] = results[i]?.translated ?? copy[f]; });
    setTranslatedByKey((prev) => ({ ...prev, [cacheKey]: next }));
  }

  function activeText(field: string): string {
    const src = lang === "en" ? copy : translated || copy;
    return (src?.[field] || "").replace(/\{first_name\}/g, firstName);
  }

  function copyToClipboard(field: string) {
    navigator.clipboard.writeText(activeText(field)).catch(() => {});
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1400);
  }

  function copyActions(field: string) {
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

  function renderChannelTabs() {
    return (
      <div className="channel-tabs" onClick={(e) => e.stopPropagation()}>
        <button className={`channel-tab ${channel === "linkedin" ? "on" : ""}`} onClick={() => setChannel("linkedin")}>LinkedIn</button>
        {hasEmail && <button className={`channel-tab ${channel === "email" ? "on" : ""}`} onClick={() => setChannel("email")}>Email</button>}
      </div>
    );
  }

  // liMode selector (2026-08-17) — per-CONTACT choice, not a global setting: LinkedIn
  // sometimes disables the connection-note field (weekly invite cap), and not every
  // contact has Open Profile/accepts InMail, so Philippe picks per contact based on
  // what LinkedIn actually shows him in the moment.
  function renderLiModeSelector() {
    if (channel !== "linkedin") return null;
    const OPTIONS: { key: typeof liMode; label: string }[] = [
      { key: "connect_note", label: "Connect + note" },
      { key: "connect_no_note", label: "Connect, no note" },
      { key: "inmail", label: "InMail direct" },
    ];
    return (
      <div className="li-mode-row" onClick={(e) => e.stopPropagation()}>
        {OPTIONS.map((o) => (
          <button key={o.key} className={`li-mode-btn ${liMode === o.key ? "on" : ""}`} onClick={() => setLiMode(o.key)}>{o.label}</button>
        ))}
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
    if (status === "meeting") {
      // Real finding (Stage 3): the actual playbook has NO scripted step-3/follow-up
      // message — "Follow-up'ов от Philippe НЕТ." Philippe runs this stage himself,
      // directly in his own LinkedIn/inbox — Leo has no access and this tool doesn't
      // script it. Honest note instead of a fabricated "propose a call" script.
      return (
        <div className="copy-box">
          <div className="cb-label">Engaged — Philippe takes it from here</div>
          <div className="cb-aside" style={{ marginBottom: 0 }}>
            There's no further scripted message for this stage — Philippe continues the conversation himself,
            directly in his own LinkedIn/inbox (not through this tool). Any reply before this point routes to Leo.
          </div>
        </div>
      );
    }
    const stage = STAGE_FIELD[status as "new" | "sent" | "replied"];
    if (!stage) return null;
    const showSubject = stage.field === "initial" && copy?.subject;
    return (
      <div className="copy-box">
        <div className="cb-label">{stage.label}</div>
        {showSubject && <div className="cb-subject"><b>Subject:</b> {activeText("subject")}</div>}
        <div className="cb-msg">{activeText(stage.field)}</div>
        {status === "replied" && (
          <div className="cb-aside">
            If the answer is a clear no — don't propose a call, simply move on. If they're clearly engaged, it's
            fine to ask a bit more (decision-maker? other roles open? rough timeline?) — but leave the actual
            pitch for Leo.
          </div>
        )}
        {copyActions(stage.field)}
      </div>
    );
  }

  return (
    <div className="c-row-wrap">
      <div className={`c-row ${contact.is_primary ? "primary" : ""}`} onClick={onToggleOpen}>
        <div className="c-avatar" style={{ background: avatarColor(fullName || firstName) }}>
          {initials(fullName || firstName)}
        </div>
        <div className="c-info">
          <span className="c-name">{fullName}</span>
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
          {renderChannelTabs()}
          {renderLiModeSelector()}
          {renderCopyBox()}
        </div>
      )}
    </div>
  );
}

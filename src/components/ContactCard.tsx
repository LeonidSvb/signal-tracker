"use client";
import { useState } from "react";
import type { Contact } from "@/lib/types";

interface Props {
  contact: Contact;
  priority: "primary" | "secondary";
}

const LI_ICON = (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/>
    <rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/>
  </svg>
);
const EMAIL_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
    <rect x="2" y="4" width="20" height="16" rx="2"/>
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
  </svg>
);

export default function ContactCard({ contact, priority }: Props) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  function copyEmail() {
    navigator.clipboard.writeText(contact.email);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const borderTop =
    contact.email_status === "validated"
      ? "border-t-2 border-t-green-600"
      : contact.email_status === "invalid"
      ? "border-t-2 border-t-red-500 bg-red-50/30"
      : "border-t-2 border-t-amber-400";

  return (
    <div className={`border border-slate-200 rounded-lg p-3 relative ${borderTop}`}>
      <span
        className={`absolute top-2 right-2 text-[9px] font-bold uppercase tracking-wide px-1.5 py-px rounded-full ${
          priority === "primary"
            ? "bg-blue-100 text-blue-700"
            : "bg-slate-100 text-slate-400"
        }`}
      >
        {priority}
      </span>

      <div className="text-[15px] font-semibold pr-16">{contact.full_name}</div>
      <div className="text-[13px] text-slate-400 mb-2 min-h-[14px]">{contact.title}</div>

      {/* Channel badge */}
      <div className="mb-2">
        {contact.email_status === "validated" && (
          <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
            ✓ Email verified
          </span>
        )}
        {contact.email_status === "invalid" && (
          <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
            ✗ Email invalid — InMail only
          </span>
        )}
        {(contact.email_status === "no_email" || !contact.email_status) && (
          <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200">
            No email found — InMail only
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-1.5 flex-wrap">
        {contact.email_status === "validated" && contact.email && (
          <>
            <a
              href={`mailto:${contact.email}`}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[13px] font-medium border border-slate-200 bg-white hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
            >
              {EMAIL_ICON}{contact.email}
            </a>
            <button
              onClick={copyEmail}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[13px] font-medium border transition-colors ${
                copied ? "border-green-500 text-green-600" : "border-slate-200 bg-white hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50"
              }`}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </>
        )}
        {contact.email_status === "invalid" && contact.email && !revealed && (
          <button
            onClick={() => setRevealed(true)}
            className="text-[11px] text-slate-400 underline underline-offset-2 bg-transparent border-0 cursor-pointer"
          >
            Show invalid email ▾
          </button>
        )}
        {contact.email_status === "invalid" && revealed && (
          <span className="text-[11px] text-red-500 line-through italic">{contact.email}</span>
        )}
        {contact.linkedin_url && (
          <a
            href={contact.linkedin_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[13px] font-medium bg-sky-50 border border-sky-200 text-sky-700 hover:bg-sky-100 transition-colors"
          >
            {LI_ICON}LinkedIn
          </a>
        )}
      </div>
    </div>
  );
}

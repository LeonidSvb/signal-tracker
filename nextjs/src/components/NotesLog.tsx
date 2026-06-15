"use client";
import { useState, useRef, useEffect } from "react";
import type { Note } from "@/lib/types";

interface Props {
  notes: Note[];
  leadId: string;
  clientId: string;
  currentUser: "leo" | "philippe";
  onAdd: (leadId: string, clientId: string, author: "leo" | "philippe", body: string) => Promise<void>;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) +
    " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export default function NotesLog({ notes, leadId, clientId, currentUser, onAdd }: Props) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [notes]);

  async function send() {
    const text = body.trim();
    if (!text) return;
    setSending(true);
    await onAdd(leadId, clientId, currentUser, text);
    setBody("");
    setSending(false);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
  }

  return (
    <div className="flex flex-col gap-2">
      {notes.length > 0 && (
        <div className="max-h-48 overflow-y-auto flex flex-col gap-2 mb-1">
          {notes.map((n) => (
            <div
              key={n.id}
              className={`flex flex-col max-w-[85%] ${n.author === currentUser ? "self-end items-end" : "self-start items-start"}`}
            >
              <span className="text-[10px] text-slate-400 mb-0.5">
                {n.author} · {formatTime(n.created_at)}
              </span>
              <div
                className={`text-[13px] px-3 py-2 rounded-lg leading-relaxed ${
                  n.author === "leo"
                    ? "bg-slate-100 text-slate-700"
                    : "bg-blue-100 text-blue-900"
                }`}
              >
                {n.body}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
      <div className="flex gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKey}
          placeholder="Last contact, response, next action... (Ctrl+Enter to send)"
          className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-[14px] font-[inherit] text-slate-800 resize-none min-h-[60px] outline-none focus:border-blue-400 transition-colors"
          rows={2}
        />
        <button
          onClick={send}
          disabled={!body.trim() || sending}
          className="self-end px-3 py-2 rounded-lg text-[13px] font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  );
}

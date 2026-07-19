"use client";
import { useState } from "react";
import type { Note } from "@/lib/types";

// Flat append-only list, matches mockups/signals_v2_concept.html's renderNotes() —
// same shape as the old React NotesLog.tsx conceptually (notes table already
// exists, already company-scoped), but the OLD component's chat-bubble visual
// style doesn't match this design system; rebuilt against the mockup's plain
// list instead (Stage 5 finding).

interface Props {
  companyId: string;
  clientId: string;
  notes: Note[];
  onAdd: (companyId: string, clientId: string, author: string, body: string) => Promise<void>;
}

export default function NotesPanel({ companyId, clientId, notes, onAdd }: Props) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    await onAdd(companyId, clientId, "leo", body);
    setText("");
    setSending(false);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
  }

  return (
    <>
      <div className="notes-list">
        {notes.length ? (
          notes.map((n) => (
            <div className="note" key={n.id}>
              <div className="note-meta">{n.author} · {n.created_at.slice(0, 16).replace("T", " ")}</div>
              {n.body}
            </div>
          ))
        ) : (
          <div className="note-empty">No notes yet — anything that doesn't fit a status (a phone call, "HR said role is filled", etc.) goes here.</div>
        )}
      </div>
      <div className="notes-input-row">
        <textarea
          className="notes-input"
          rows={2}
          placeholder="Add a note…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
        />
        <button className="btn btn-copy notes-send" onClick={send} disabled={sending || !text.trim()}>Add</button>
      </div>
    </>
  );
}

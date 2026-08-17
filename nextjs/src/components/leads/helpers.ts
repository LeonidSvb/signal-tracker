// Ported from mockups/signals_v2_concept.html's avatarColor()/initials() — deterministic
// per-name color so the same company/contact always gets the same avatar color across
// renders and sessions (not random).
const AVATAR_COLORS = ["#4F5FD1", "#0EA5A5", "#D97706", "#DC2626", "#7C3AED", "#059669", "#DB2777"];

export function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

// Real data doesn't have a stored "outlet name" column (signals.source is a broad
// category like 'exa'/'linkedin', not "FoodBev Media") — derive a readable label
// from the source_url's hostname instead of fabricating a name.
export function hostnameLabel(url: string | null): string {
  if (!url) return "source";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 40);
  }
}

export function formatEmployees(n: number | null): string | null {
  return n ? `${n.toLocaleString()}p` : null;
}

// Human labels for signals.signal_type (see docs/SIGNALS_REGISTRY.md for what each
// means to Philippe) — the raw DB values (HIRING/CLEVEL/MA/EXPAND/INVEST/CONTRACT/
// NICHE/SECTOR) meant nothing at a glance in the sidebar card.
export const SIGNAL_TYPE_LABEL: Record<string, string> = {
  HIRING: "Hiring",
  CLEVEL: "New C-Level",
  MA: "M&A",
  EXPAND: "Expansion",
  INVEST: "Investment",
  CONTRACT: "Contract/Partnership",
  NICHE: "Sector news",
  SECTOR: "Sector news",
};
export function signalTypeLabel(type: string | null): string | null {
  if (!type) return null;
  return SIGNAL_TYPE_LABEL[type.toUpperCase()] ?? type;
}

// Relative age for the sidebar card. "Xd ago" up to ~2 months, then "Xmo ago" —
// matches the freshness windows docs/SIGNALS_REGISTRY.md scores on (≤7d / 8-14d /
// 15-30d), so the label itself hints at how hot the signal still is.
export function timeAgo(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 60) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// Scraped contact names sometimes come in as all-lowercase ("oliver jaensch") —
// found live 2026-08-17: this leaked verbatim into the outbound LinkedIn copy
// text itself ("oliver, saw..."), not just the sidebar display. Title-case every
// word except lowercase name particles (von/van/de/der/...), which stay lowercase
// unless they're the first word.
const NAME_PARTICLES = new Set(["von", "van", "der", "den", "de", "du", "la", "le", "af", "el"]);
export function capitalizeName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .split(/\s+/)
    .map((w, i) => {
      if (!w) return w;
      if (i > 0 && NAME_PARTICLES.has(w.toLowerCase())) return w.toLowerCase();
      return w[0].toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

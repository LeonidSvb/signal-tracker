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

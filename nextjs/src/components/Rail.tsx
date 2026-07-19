"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Shared icon rail across all real routes (Stage 5, docs/HANDOFF_2026-07-19_frontend_build.md).
// Structure/behavior ported from outreach-cockpit's src/components/shell/IconRail.tsx
// (avatar, module icons, spacer, Settings pinned to bottom) — re-parametrized with
// our own modules and design tokens (.rail/.rail-icon from app-shell.css) instead of
// cockpit's Tailwind classes, since this app's design system is plain CSS classes
// ported from mockups/signals_v2_concept.html, not cockpit's Tailwind palette.

const ITEMS = [
  {
    href: "/",
    label: "Leads",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2 3 7l9 5 9-5-9-5z" />
        <path d="M3 12l9 5 9-5M3 17l9 5 9-5" />
      </svg>
    ),
  },
  {
    href: "/analytics",
    label: "Analytics",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 20V10M12 20V4M6 20v-6" />
      </svg>
    ),
  },
];

const SETTINGS_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 0 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 0 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 0 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 0 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />
  </svg>
);

export default function Rail() {
  const pathname = usePathname();
  return (
    <div className="rail">
      <div className="rail-avatar">PB</div>
      {ITEMS.map((item) => (
        <Link key={item.href} href={item.href} className={`rail-icon ${pathname === item.href ? "active" : ""}`}>
          {item.icon}
          <span className="rail-tip">{item.label}</span>
        </Link>
      ))}
      <div className="rail-spacer" />
      <Link href="/settings" className={`rail-icon ${pathname === "/settings" ? "active" : ""}`}>
        {SETTINGS_ICON}
        <span className="rail-tip">Settings</span>
      </Link>
    </div>
  );
}

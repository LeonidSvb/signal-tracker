// Pure staleness rule for email validation (B-D1/B-D3, PLAN_2026-07-18_backend_hardening.md).
// Shared by validate_contacts.mjs (the weekly fleet-wide validator) and route_email.mjs
// (which trusts a recent verdict instead of re-spending) — one definition of "fresh
// enough" so the two stages never disagree. No side-effecting imports (no supabase.mjs)
// so this stays trivially unit-testable.

export const STALE_DAYS = 90;

// contact: { email, email_status, email_validated_at }
export function needsValidation(contact, now = Date.now()) {
  if (!contact.email) return false;
  if (contact.email_status === 'invalid') return false; // terminal — dead stays dead
  if (!contact.email_validated_at) return true;
  const ageDays = (now - new Date(contact.email_validated_at).getTime()) / 86_400_000;
  return ageDays >= STALE_DAYS;
}

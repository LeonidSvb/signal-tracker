import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

// Real ICP Filter panel data (Stage 7, docs/HANDOFF_2026-07-19_frontend_build.md).
// Reads pipeline/config/icp_filter.json directly — plain JSON, same safe
// readFileSync pattern as /api/copy (no cross-boundary .mjs import risk).
// This file is real and in production use (filter_icp.mjs, rank_leads.mjs,
// lib/staleness.mjs) — confirmed live 2026-07-19, see CHANGELOG [Unreleased].
// Read-only: this route never writes back to the file.

const ICP_FILTER_PATH = join(process.cwd(), '../pipeline/config/icp_filter.json');

export async function GET() {
  try {
    const config = JSON.parse(readFileSync(ICP_FILTER_PATH, 'utf8'));
    return NextResponse.json(config);
  } catch (e: any) {
    return NextResponse.json({ error: `could not read icp_filter.json: ${e.message}` }, { status: 500 });
  }
}

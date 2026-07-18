// Flat JSON file cache, keyed by an arbitrary string. Used to avoid re-paying for
// Exa/LLM calls on companies we've already resolved — persists across script runs and crashes.
// Load once at stage start, mutate in memory, save() periodically + at the end.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export function loadCache(path) {
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return {}; }
}

export function saveCache(path, cache) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cache, null, 2));
}

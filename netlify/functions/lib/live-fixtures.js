'use strict';

// Sportmonks Football API v3: 5=FT, 7=AET, 8=FT_PEN.
const FINISHED_STATES = new Set([5, 7, 8]);
const MAX_LIVE_MATCH_AGE_MS = 4 * 60 * 60 * 1000;

function showInLive(stateId, kickoffTs, now = Date.now()) {
  const kickoff = Number(kickoffTs);
  if (!Number.isFinite(kickoff) || kickoff <= 0) return false;
  if (FINISHED_STATES.has(Number(stateId))) return false;
  // State data may remain stale: never keep a past match in Live indefinitely.
  // Allow a generous window for delays, extra time and penalty shootouts.
  return kickoff > now - MAX_LIVE_MATCH_AGE_MS;
}

module.exports = { showInLive, MAX_LIVE_MATCH_AGE_MS };

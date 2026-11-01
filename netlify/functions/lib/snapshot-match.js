'use strict';

const { supabaseRequest } = require('./supabase');

// Save the calendar identity of an actual prematch snapshot, never a prediction.
// Ignore duplicates so an existing official XI or historical match cannot be downgraded.
function matchRowFromSnapshot(snapshot) {
  const fixture = snapshot?.raw_fixture;
  const fixtureId = Number(snapshot?.sportmonks_fixture_id);
  if (!fixture || !Number.isSafeInteger(fixtureId) || fixtureId <= 0 ||
      Number(fixture.id) !== fixtureId) {
    throw new Error('Snapshot fixture identity mismatch');
  }

  const parseUtc = value => {
    if (typeof value !== 'string') return NaN;
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
      ? value.replace(' ', 'T') + 'Z' : value;
    return Date.parse(normalized);
  };
  const storedKickoff = parseUtc(snapshot.kickoff_at);
  const providerKickoff = parseUtc(fixture.starting_at);
  const captured = parseUtc(snapshot.captured_at);
  if (![storedKickoff, providerKickoff, captured].every(Number.isFinite) ||
      captured >= storedKickoff ||
      Math.abs(providerKickoff - storedKickoff) > 10 * 60 * 1000) {
    throw new Error('Snapshot kickoff missing or inconsistent with fixture');
  }

  const participants = Array.isArray(fixture.participants) ? fixture.participants : [];
  const home = participants.find(p => p?.meta?.location === 'home');
  const away = participants.find(p => p?.meta?.location === 'away');
  const leagueId = Number(fixture.league_id);
  const idValid = x => Number.isSafeInteger(Number(x)) && Number(x) > 0;
  if (!home?.name || !away?.name || !idValid(home.id) || !idValid(away.id) ||
      !idValid(leagueId) || !snapshot.league_code) {
    throw new Error('Snapshot lacks valid league or home/away teams');
  }

  return {
    sportmonks_fixture_id: fixtureId,
    league_id: leagueId,
    league_code: snapshot.league_code,
    league_name: fixture.league?.name || null,
    season_id: idValid(fixture.season_id) ? Number(fixture.season_id) : null,
    starting_at: new Date(providerKickoff).toISOString(),
    status: fixture.state?.short_name || fixture.state?.name || null,
    home_team_id: Number(home.id),
    home_team_name: String(home.name),
    away_team_id: Number(away.id),
    away_team_name: String(away.name),
    venue_id: idValid(fixture.venue_id) ? Number(fixture.venue_id) : null,
    venue_name: fixture.venue?.name || null,
    lineups_confirmed: false, // Do not treat probable lineups as official.
    raw_data: fixture,
    updated_at: new Date(captured).toISOString()
  };
}

async function recordMissingMatch(snapshot, write = supabaseRequest) {
  const row = matchRowFromSnapshot(snapshot);
  const saved = await write('matches', {
    method: 'POST',
    query: '?on_conflict=sportmonks_fixture_id',
    body: row,
    prefer: 'resolution=ignore-duplicates,return=representation'
  });
  if (!Array.isArray(saved)) throw new Error('Unexpected Supabase insert response');
  return saved.length > 0;
}

module.exports = { matchRowFromSnapshot, recordMissingMatch };

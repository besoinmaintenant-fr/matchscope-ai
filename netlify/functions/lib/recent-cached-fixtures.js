'use strict';
const {supabaseRequest} = require('./supabase');

const IDS = Object.freeze({PL:8,BL:82,LL:564,SA:384,L1:301});
const FINISHED = new Set(['FT','AET','FT_PEN','FT-PEN','FINISHED','ENDED']);
const FRESHNESS_MS = 18 * 60 * 60 * 1000;
const PAST_MS = 4 * 60 * 60 * 1000;
const HORIZON_MS = 35 * 24 * 60 * 60 * 1000;

function cachedFixtureFromRow(row, nowMs = Date.now()) {
  const updated = Date.parse(row?.updated_at);
  const kickoff = Date.parse(row?.starting_at);
  const fixtureId = Number(row?.sportmonks_fixture_id);
  const leagueCode = String(row?.league_code || '');
  const leagueId = Number(row?.league_id);
  const stateId = Number(row?.raw_data?.state_id);
  const status = String(row?.status || '').trim().toUpperCase();
  if (!Number.isFinite(nowMs) || !Number.isFinite(updated) || !Number.isFinite(kickoff) ||
      updated > nowMs + 60000 || updated < nowMs - FRESHNESS_MS ||
      kickoff < nowMs - PAST_MS || kickoff > nowMs + HORIZON_MS ||
      !Number.isSafeInteger(fixtureId) || fixtureId <= 0 ||
      IDS[leagueCode] !== leagueId ||
      !row?.home_team_name || !row?.away_team_name ||
      FINISHED.has(status) || [5,7,8].includes(stateId)) return null;
  const homeId = Number(row.home_team_id);
  const awayId = Number(row.away_team_id);
  return {
    id: fixtureId,
    league_id: leagueId,
    league: {id:leagueId,name:row.league_name || leagueCode},
    starting_at: new Date(kickoff).toISOString(),
    state_id: Number.isSafeInteger(stateId) && stateId > 0 ? stateId : null,
    participants: [
      {id:Number.isSafeInteger(homeId)&&homeId>0?homeId:null,
        name:String(row.home_team_name),meta:{location:'home'}},
      {id:Number.isSafeInteger(awayId)&&awayId>0?awayId:null,
        name:String(row.away_team_name),meta:{location:'away'}}
    ],
    venue: {name:row.venue_name || 'Stade à confirmer'},
    _fromRecentCache: true,
    _cacheUpdatedAt: new Date(updated).toISOString()
  };
}

async function recentCachedFixtures(nowMs = Date.now(), read = supabaseRequest) {
  if(!Number.isFinite(nowMs)) throw new Error('Invalid current time');
  const encoded = date => encodeURIComponent(new Date(date).toISOString());
  const query = '?select=sportmonks_fixture_id,league_id,league_code,league_name,' +
    'starting_at,status,home_team_id,home_team_name,away_team_id,away_team_name,' +
    'venue_name,updated_at,raw_data' +
    '&starting_at=gte.'+encoded(nowMs-PAST_MS) +
    '&starting_at=lte.'+encoded(nowMs+HORIZON_MS) +
    '&updated_at=gte.'+encoded(nowMs-FRESHNESS_MS) +
    '&order=starting_at.asc&limit=100';
  const rows = await read('matches',{query});
  if(!Array.isArray(rows))throw new Error('Unexpected Supabase matches response');
  return rows.map(row=>cachedFixtureFromRow(row,nowMs)).filter(Boolean);
}

module.exports={cachedFixtureFromRow,recentCachedFixtures};

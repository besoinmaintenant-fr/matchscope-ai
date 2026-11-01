'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { matchRowFromSnapshot, recordMissingMatch } = require('../netlify/functions/lib/snapshot-match');

const snapshot = () => ({
  sportmonks_fixture_id: 42, league_code: 'LL',
  kickoff_at: '2026-11-01T14:00:00.000Z',
  captured_at: '2026-11-01T11:00:00.000Z',
  lineups_official: false,
  raw_fixture: {
    id: 42, league_id: 564, season_id: 11,
    starting_at: '2026-11-01 14:00:00',
    state: { short_name: 'NS' },
    league: { name: 'La Liga' },
    venue_id: 3, venue: { name: 'Stade' },
    participants: [
      {id:1,name:'Home',meta:{location:'home'}},
      {id:2,name:'Away',meta:{location:'away'}}
    ],
    lineups:[{type_id:11,player_name:'Probable player'}]
  }
});

test('records actual fixture identity and correct home/away from archived snapshot', () => {
  const row = matchRowFromSnapshot(snapshot());
  assert.equal(row.sportmonks_fixture_id, 42);
  assert.equal(row.home_team_name, 'Home');
  assert.equal(row.away_team_name, 'Away');
  assert.equal(row.starting_at, '2026-11-01T14:00:00.000Z');
  assert.equal(row.status, 'NS');
});
test('never marks probable XI as confirmed', () => {
  const row = matchRowFromSnapshot(snapshot());
  assert.equal(row.lineups_confirmed, false);
});
test('rejects fixture ID mismatch', () => {
  const v=snapshot();v.raw_fixture.id=43;
  assert.throws(()=>matchRowFromSnapshot(v), /identity/);
});
test('rejects kickoff time inconsistencies rather than saving stale dates', () => {
  const v=snapshot();v.raw_fixture.starting_at='2026-11-02 15:00:00';
  assert.throws(()=>matchRowFromSnapshot(v), /kickoff/);
});
test('rejects snapshots captured after kickoff', () => {
  const v=snapshot();v.captured_at='2026-11-01T15:00:00.000Z';
  assert.throws(()=>matchRowFromSnapshot(v), /kickoff/);
});
test('rejects ambiguous missing participants', () => {
  const v=snapshot();v.raw_fixture.participants=[];
  assert.throws(()=>matchRowFromSnapshot(v), /home\/away/);
});
test('inserts only when absent and does not overwrite existing matches', async () => {
  let calls=0;
  const saved=await recordMissingMatch(snapshot(), async (table,opts)=>{
    calls++;
    assert.equal(table,'matches');
    assert.equal(opts.prefer,'resolution=ignore-duplicates,return=representation');
    assert.equal(opts.body.lineups_confirmed,false);
    return [{sportmonks_fixture_id:42}];
  });
  assert.equal(saved,true);assert.equal(calls,1);
  const existed=await recordMissingMatch(snapshot(),async()=>[]);
  assert.equal(existed,false);
});

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {cachedFixtureFromRow,recentCachedFixtures}=require('../netlify/functions/lib/recent-cached-fixtures');
const NOW=Date.parse('2026-11-01T16:48:00Z');
const match=()=>({
 sportmonks_fixture_id:19715559,league_id:301,league_code:'L1',league_name:'Ligue 1',
 home_team_id:100,home_team_name:'Paris',away_team_id:101,away_team_name:'Monaco',
 starting_at:'2026-11-01T16:15:00Z',status:'NS',
 updated_at:'2026-11-01T10:15:52Z',venue_name:'Stade',
 raw_data:{state_id:1}
});
test('converts a stored same-day fixture but labels it as unverified cache',()=>{
 const item=cachedFixtureFromRow(match(),NOW);
 assert.equal(item.id,19715559);
 assert.equal(item.league_id,301);
 assert.equal(item._fromRecentCache,true);
 assert.equal(item._cacheUpdatedAt,'2026-11-01T10:15:52.000Z');
 assert.equal(item.participants[0].meta.location,'home');
});
test('rejects stale September dates and old refreshes',()=>{
 const row=match();row.updated_at='2026-09-29T00:00:00Z';
 assert.equal(cachedFixtureFromRow(row,NOW),null);
});
test('never treats finished matches as live from cache',()=>{
 for (const status of ['FT','AET','FT_PEN']) {
  const row=match();row.status=status;
  assert.equal(cachedFixtureFromRow(row,NOW),null);
 }
 const row=match();row.raw_data.state_id=5;
 assert.equal(cachedFixtureFromRow(row,NOW),null);
});
test('refuses future matches more than 35 days away and fixtures older than four hours',()=>{
 const far=match();far.starting_at='2027-01-01T00:00:00Z';
 assert.equal(cachedFixtureFromRow(far,NOW),null);
 const old=match();old.starting_at='2026-11-01T11:00:00Z';
 assert.equal(cachedFixtureFromRow(old,NOW),null);
});
test('rejects leagues outside the five target codes and mismatched league IDs',()=>{
 const row=match();row.league_id=271;
 assert.equal(cachedFixtureFromRow(row,NOW),null);
 row.league_code='PL';row.league_id=301;
 assert.equal(cachedFixtureFromRow(row,NOW),null);
});
test('read-only Supabase call uses freshness bounds and never writes',async()=>{
 let seen=false;
 const x=await recentCachedFixtures(NOW,async(table,opts)=>{
  seen=true;assert.equal(table,'matches');
  assert.ok(opts.query.includes('updated_at=gte.'));
  assert.ok(opts.query.includes('starting_at=lte.'));
  assert.ok(!opts.method || opts.method==='GET');
  return [match()];
 });
 assert.ok(seen);assert.equal(x.length,1);
});
test('an empty or outdated cache yields no invented fixtures',async()=>{
 assert.deepEqual(await recentCachedFixtures(NOW,async()=>[]),[]);
 const old=match();old.updated_at='2026-09-29T00:00:00Z';
 assert.deepEqual(await recentCachedFixtures(NOW,async()=>[old]),[]);
});

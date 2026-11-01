'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const { _test, handler }=require('../netlify/functions/history.js');
const NOW=Date.parse('2026-11-01T19:00:00Z');
function row(){
 return {sportmonks_fixture_id:19715591,league_code:'L1',league_name:'Ligue 1',
  home_team_id:123,home_team_name:'Lens',away_team_id:456,away_team_name:'Lyon',
  starting_at:'2026-10-09T18:45:00Z',venue_name:'Stade',
  results:{home_score:2,away_score:1,result_1x2:'1'}};
}
test('a legitimate final score reads from joined Supabase rows',()=>{
 const a=_test.transform(row(),NOW);
 assert.equal(a.score.home,2);assert.equal(a.score.away,1);
 assert.equal(a.actualResult,'1');assert.equal(a.stateId,5);
 assert.equal(a.source,'supabase-archive');assert.equal(a.archived,true);
});
test('never invent a 0-0 from missing result values',()=>{
 const r=row();r.results.home_score=null;
 assert.equal(_test.transform(r,NOW),null);
});
test('reject mismatched 1N2 and unknown leagues',()=>{
 const r=row();r.results.result_1x2='2';
 assert.equal(_test.transform(r,NOW),null);
 r.results.result_1x2='1';r.league_code='SOMETHING';
 assert.equal(_test.transform(r,NOW),null);
});
test('reject future fixtures and negative final scores',()=>{
 const r=row();r.starting_at='2026-11-03T10:00:00Z';
 assert.equal(_test.transform(r,NOW),null);
 r.starting_at='2026-10-09T18:45:00Z';r.results.home_score=-1;
 assert.equal(_test.transform(r,NOW),null);
});
test('history API refuses POST before any database call',async()=>{
 const out=await handler({httpMethod:'POST'});
 assert.equal(out.statusCode,405);
});

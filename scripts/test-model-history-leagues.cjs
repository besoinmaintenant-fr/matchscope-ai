'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {selectedHistoryLeagues,leagueIdsForCodes,DEFAULT_CODES} =
  require('../netlify/functions/lib/model-history-leagues');

test('old incremental calls remain limited to the original model leagues',()=>{
  assert.deepEqual(selectedHistoryLeagues({mode:'incremental'}), ['PL','BL','LL']);
});
test('old unscoped seed requests preserve the original leagues',()=>{
  assert.deepEqual(selectedHistoryLeagues({mode:'seed',part:1}),DEFAULT_CODES);
});
test('explicit extension seed targets only the requested new leagues',()=>{
  assert.deepEqual(selectedHistoryLeagues({mode:'seed',part:1,leagueCodes:['SA','L1']}),['SA','L1']);
  assert.deepEqual(leagueIdsForCodes(['SA','L1']),['384','301']);
});
test('refuses extension on incremental sync',()=>{
  assert.throws(()=>selectedHistoryLeagues({mode:'incremental',leagueCodes:['SA']}),/Only explicit seed/);
});
test('refuses widening existing production league scope',()=>{
  assert.throws(()=>selectedHistoryLeagues({mode:'seed',leagueCodes:['PL','SA']}),/Only explicit seed/);
});
test('refuses unknown and duplicate leagues',()=>{
  assert.throws(()=>selectedHistoryLeagues({mode:'seed',leagueCodes:['XXX']}),/Only explicit seed/);
  assert.throws(()=>selectedHistoryLeagues({mode:'seed',leagueCodes:['SA','SA']}),/Only explicit seed/);
});
test('refuses empty or malformed league requests',()=>{
  assert.throws(()=>selectedHistoryLeagues({mode:'seed',leagueCodes:[]}),/Only explicit seed/);
  assert.throws(()=>selectedHistoryLeagues({mode:'seed',leagueCodes:'SA'}),/Only explicit seed/);
});

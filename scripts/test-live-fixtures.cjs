'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { showInLive, MAX_LIVE_MATCH_AGE_MS } = require('../netlify/functions/lib/live-fixtures');

const NOW = Date.parse('2026-11-01T15:00:00.000Z');

test('upcoming fixtures remain in Live', () => {
  assert.equal(showInLive(1, NOW + 60_000, NOW), true);
});

test('matches genuinely in progress remain visible', () => {
  assert.equal(showInLive(2, NOW - 150 * 60_000, NOW), true);
});

test('full time, after extra time and after penalties are excluded', () => {
  for (const state of [5, 7, 8, '5', '7', '8']) {
    assert.equal(showInLive(state, NOW - 2000, NOW), false);
  }
});

test('an inconsistent future fixture marked finished is excluded', () => {
  assert.equal(showInLive(5, NOW + 3_600_000, NOW), false);
});

test('stale matches do not remain in Live if state updates lag', () => {
  assert.equal(showInLive(2, NOW - MAX_LIVE_MATCH_AGE_MS - 1, NOW), false);
  assert.equal(showInLive(null, NOW - 10 * 3_600_000, NOW), false);
});

test('time boundary is precise', () => {
  assert.equal(showInLive(1, NOW - MAX_LIVE_MATCH_AGE_MS, NOW), false);
  assert.equal(showInLive(1, NOW - MAX_LIVE_MATCH_AGE_MS + 1, NOW), true);
});

test('invalid kickoff is not shown as Live', () => {
  for (const kickoff of [null, undefined, 'bad', 0, -1]) {
    assert.equal(showInLive(1, kickoff, NOW), false);
  }
});

test('probable lineups do not alter eligibility', () => {
  const fixture = { stateId: 1, kickoffTs: NOW + 100000, official: false, lineupStatus: 'predicted' };
  assert.equal(showInLive(fixture.stateId, fixture.kickoffTs, NOW), true);
});

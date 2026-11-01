import test from 'node:test';
import assert from 'node:assert/strict';
import {historySyncIsDue} from '../cloudflare/history-schedule.mjs';

test('daily historic sync only at 03:10 UTC',()=>{
 assert.equal(historySyncIsDue(new Date('2026-11-01T03:10:00Z')),true);
 for(const iso of ['2026-11-01T03:05:00Z','2026-11-01T03:15:00Z','2026-11-01T12:10:00Z'])
   assert.equal(historySyncIsDue(new Date(iso)),false);
});
test('invalid scheduled dates never match daily sync',()=>{
 assert.equal(historySyncIsDue(new Date(NaN)),false);
});

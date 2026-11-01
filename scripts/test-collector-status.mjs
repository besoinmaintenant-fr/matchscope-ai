import test from 'node:test';
import assert from 'node:assert/strict';
import { collectorFailureCounts } from '../cloudflare/collector-status.mjs';

test('successful collection has no failures', () => {
  assert.deepEqual(collectorFailureCounts({success:true, errors:0, results:[{status:'SAVED'}]}),
    {fixtureErrors:0, scorerErrors:0});
});
test('summary errors override HTTP 200/success true', () => {
  assert.deepEqual(collectorFailureCounts({success:true, errors:2, results:[{status:'SAVED'}]}),
    {fixtureErrors:2, scorerErrors:0});
});
test('failed fixture counts even when summary errors is zero', () => {
  assert.deepEqual(collectorFailureCounts({success:true, errors:0, results:[{status:'ERROR'}]}),
    {fixtureErrors:1, scorerErrors:0});
});
test('unavailable scorer data is visible as a failure', () => {
  assert.deepEqual(collectorFailureCounts({success:true, scorerResults:[{status:'SOURCE_UNAVAILABLE'}]}),
    {fixtureErrors:0, scorerErrors:1});
});
test('non-frozen prediction does not masquerade as transport error', () => {
  assert.deepEqual(collectorFailureCounts({success:true, scorerResults:[{status:'NOT_FROZEN'}]}),
    {fixtureErrors:0, scorerErrors:0});
});
test('non-JSON or absent fields never cause a false success count', () => {
  assert.deepEqual(collectorFailureCounts(null), {fixtureErrors:0, scorerErrors:0});
});

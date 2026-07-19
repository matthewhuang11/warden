import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDashboardSession,
  hasValidBearerToken,
  hasValidDashboardSession,
  hasValidSecret,
} from './auth';

test('requires an exact bearer token', () => {
  assert.equal(hasValidBearerToken('Bearer expected-token', 'expected-token'), true);
  assert.equal(hasValidBearerToken('Bearer wrong-token', 'expected-token'), false);
  assert.equal(hasValidBearerToken(null, 'expected-token'), false);
});

test('creates a derived dashboard session without retaining the view token', () => {
  const session = createDashboardSession('private-view-token');
  assert.match(session, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(session, /private-view-token/);
  assert.equal(hasValidDashboardSession(session, 'private-view-token'), true);
  assert.equal(hasValidDashboardSession(session, 'wrong-token'), false);
  assert.equal(hasValidDashboardSession(undefined, 'private-view-token'), false);
  assert.equal(hasValidDashboardSession(session, undefined), false);
});

test('rejects empty and excessively large secrets', () => {
  assert.equal(hasValidSecret('', 'expected-token'), false);
  assert.equal(hasValidSecret('a'.repeat(4097), 'expected-token'), false);
});

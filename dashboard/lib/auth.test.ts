import assert from 'node:assert/strict';
import test from 'node:test';
import { hasValidBearerToken } from './auth';

test('requires an exact bearer token', () => {
  assert.equal(hasValidBearerToken('Bearer team-secret', 'team-secret'), true);
  assert.equal(hasValidBearerToken('Bearer wrong', 'team-secret'), false);
  assert.equal(hasValidBearerToken('team-secret', 'team-secret'), false);
  assert.equal(hasValidBearerToken('Bearer team-secret', undefined), false);
});

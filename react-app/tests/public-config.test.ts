import assert from 'node:assert/strict'
import test from 'node:test'
import { validatePublishableKey } from '../server/publicConfig.js'

test('public build configuration refuses secrets and legacy JWTs without echoing them', () => {
  for (const key of ['', undefined, 'sb_publishable_fixture'])
    validatePublishableKey(key)
  for (const key of [
    'sb_secret_synthetic_fixture',
    'sk-synthetic-model-fixture',
    'eyJsyntheticLegacyJWT',
    42,
  ]) {
    assert.throws(
      () => validatePublishableKey(key),
      (error: Error) => {
        assert.ok(!error.message.includes(String(key)))
        return true
      },
    )
  }
})

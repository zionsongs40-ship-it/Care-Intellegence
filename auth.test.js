const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword } = require('../src/auth');

test('password hashes verify without storing the original password', async () => {
  const passwordHash = await hashPassword('strong-demo-password');
  assert.notEqual(passwordHash, 'strong-demo-password');
  assert.equal(await verifyPassword('strong-demo-password', { passwordHash }), true);
  assert.equal(await verifyPassword('incorrect-password', { passwordHash }), false);
});

test('legacy accounts can be verified for one-time password migration', async () => {
  assert.equal(await verifyPassword('legacy-password', { password: 'legacy-password' }), true);
  assert.equal(await verifyPassword('incorrect-password', { password: 'legacy-password' }), false);
});

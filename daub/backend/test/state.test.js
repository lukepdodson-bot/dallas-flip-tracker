const test   = require('node:test');
const assert = require('node:assert');
const state  = require('../services/commissionState');

test('a painter cannot deliver before the licence is executed', () => {
  assert.throws(() => state.assertTransition('deliver', 'funded', 'painter'), /Cannot deliver/);
  assert.strictEqual(state.assertTransition('deliver', 'active', 'painter'), 'delivered');
});

test('only the buyer or the system accepts; the painter cannot accept for them', () => {
  assert.throws(() => state.assertTransition('accept', 'delivered', 'painter'), /painter cannot accept/);
  assert.strictEqual(state.assertTransition('accept', 'delivered', 'buyer'), 'accepted');
  assert.strictEqual(state.assertTransition('accept', 'delivered', 'system'), 'accepted');
});

test('settlement is reachable only from accepted, and only by the system', () => {
  assert.throws(() => state.assertTransition('settle', 'delivered', 'system'));
  assert.throws(() => state.assertTransition('settle', 'accepted', 'painter'));
  assert.strictEqual(state.assertTransition('settle', 'accepted', 'system'), 'settled');
});

test('a funded commission cancels into a refund, never a plain cancel', () => {
  assert.throws(() => state.assertTransition('cancel', 'funded', 'buyer'), /Cannot cancel/);
  assert.strictEqual(state.assertTransition('refund', 'funded', 'buyer'), 'refunded');
});

test('terminal states admit nothing further', () => {
  for (const terminal of state.TERMINAL) {
    for (const action of Object.keys(state.TRANSITIONS)) {
      assert.strictEqual(state.canTransition(action, terminal), false,
        `${action} should not be reachable from ${terminal}`);
    }
  }
});

test('an admin may act where a role could, but not where the state forbids', () => {
  assert.strictEqual(state.assertTransition('deliver', 'active', 'admin'), 'delivered');
  assert.throws(() => state.assertTransition('deliver', 'quoted', 'admin'), /Cannot deliver/);
});

test('availableActions drives the UI from the same table as the guards', () => {
  assert.deepStrictEqual(state.availableActions('delivered', 'buyer').sort(), ['accept', 'dispute']);
  assert.deepStrictEqual(state.availableActions('settled', 'buyer'), []);
});

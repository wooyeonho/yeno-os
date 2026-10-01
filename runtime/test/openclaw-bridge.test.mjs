import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectOpenClawInbound } from '../lib/openclaw-bridge.mjs';

const event = {
  from: 'telegram:1001',
  content: '/status',
  metadata: { senderId: '1001', messageId: 'm_42' },
};
const context = { channelId: 'telegram', accountId: 'main', conversationId: 'telegram:1001' };

test('isolated Telegram DM becomes only an unauthenticated candidate', () => {
  const result = inspectOpenClawInbound(event, context);
  assert.equal(result.accepted, true);
  assert.equal(result.authorizesDispatch, false);
  assert.equal(result.authentication, 'unverified');
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes('1001'), false);
});

test('other channels, group conversations, and unsupported commands fail closed', () => {
  assert.equal(inspectOpenClawInbound(event, { ...context, channelId: 'slack' }).reason, 'unsupported_channel');
  assert.equal(inspectOpenClawInbound(event, { ...context, conversationId: 'telegram:-10002' }).reason, 'unbound_direct_message');
  assert.equal(inspectOpenClawInbound({ ...event, content: 'run this' }, context).reason, 'unsupported_message');
  assert.equal(inspectOpenClawInbound({ ...event, metadata: { ...event.metadata, senderId: '1002' } }, context).reason, 'unbound_direct_message');
});

test('malformed hook data cannot grant dispatch', () => {
  for (const value of [null, {}, { ...event, metadata: null }]) {
    assert.equal(inspectOpenClawInbound(value, context).authorizesDispatch, false);
  }
  assert.equal(inspectOpenClawInbound(event, { ...context, accountId: '../other' }).accepted, false);
});

test('self-asserted owner and transport claims grant no BLACKHOLE authority', () => {
  const result = inspectOpenClawInbound({
    ...event,
    owner: true,
    authenticated: true,
    metadata: { ...event.metadata, owner: true, authorized: true },
  }, { ...context, scopes: ['operator.admin'], owner: true });
  assert.equal(result.accepted, true);
  assert.equal(result.authentication, 'unverified');
  assert.equal(result.authorizesDispatch, false);
  assert.equal('principal' in result, false);
});

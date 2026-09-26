import test from 'node:test';
import assert from 'node:assert/strict';
import {parseInvitation} from '../src/native-pairing.ts';
const invitation = {version:1, id:'12345678-1234-4234-8234-123456789012', origin:'https://pc.example.ts.net:9443', token:'a'.repeat(43), expiresAt:'2026-09-25T11:00:00.000Z'};
test('QR parser accepts only unexpired private HTTPS enrollment data', () => {
  const now = Date.parse('2026-09-25T10:59:00Z');
  assert.equal(parseInvitation(JSON.stringify(invitation), now).origin, invitation.origin);
  for (const change of [{origin:'http://pc.example.ts.net:9443'}, {origin:'https://evil.example'}, {origin:'https://pc.example.ts.net:9443/path'}, {token:'short'}, {expiresAt:'invalid'}, {version:2}]) {
    assert.throws(()=>parseInvitation(JSON.stringify({...invitation,...change}),now));
  }
  assert.throws(()=>parseInvitation(JSON.stringify(invitation),Date.parse(invitation.expiresAt)));
  assert.throws(()=>parseInvitation('a'.repeat(4097),now));
});

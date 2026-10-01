import { createHash } from 'node:crypto';

// OpenClaw v2026.2.13 emits this shape from its message_received plugin hook.
// The hook is fire-and-forget and its sender metadata is not a BLACKHOLE
// principal. This module only classifies a candidate; it never dispatches.
const DIGITS = /^[1-9][0-9]{0,19}$/;
const ID = /^[a-zA-Z0-9_-]{1,80}$/;

export function inspectOpenClawInbound(event, context) {
  if (!event || typeof event !== 'object' || !context || typeof context !== 'object') {
    return { accepted: false, reason: 'invalid_hook_shape', authorizesDispatch: false };
  }
  if (context.channelId !== 'telegram') {
    return { accepted: false, reason: 'unsupported_channel', authorizesDispatch: false };
  }
  const metadata = event.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { accepted: false, reason: 'missing_metadata', authorizesDispatch: false };
  }
  // Only a direct message with stable numeric Telegram sender and chat IDs is
  // suitable for correlation. Group messages and usernames are ambiguous.
  const senderId = String(metadata.senderId ?? '');
  const chatId = String(context.conversationId ?? '').replace(/^telegram:/, '');
  const messageId = String(metadata.messageId ?? '');
  const accountId = String(context.accountId ?? '');
  if (!DIGITS.test(senderId) || !DIGITS.test(chatId) || senderId !== chatId ||
      !ID.test(accountId) || !ID.test(messageId)) {
    return { accepted: false, reason: 'unbound_direct_message', authorizesDispatch: false };
  }
  // No free-form command passthrough. Even /status is merely a request for
  // later owner-authenticated handling, not a status disclosure here.
  if (typeof event.content !== 'string' || event.content.trim() !== '/status') {
    return { accepted: false, reason: 'unsupported_message', authorizesDispatch: false };
  }
  const fingerprint = createHash('sha256')
    .update(['openclaw-telegram-v1', accountId, senderId, messageId].join('\0'))
    .digest('hex');
  return {
    accepted: true,
    action: 'status_candidate',
    fingerprint,
    authentication: 'unverified',
    authorizesDispatch: false,
  };
}

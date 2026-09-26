import {z} from 'zod';

const invitationSchema = z.strictObject({
  version:z.literal(1), id:z.string().uuid(),
  origin:z.string().regex(/^https:\/\/[a-z0-9.-]+\.ts\.net:9443$/),
  token:z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresAt:z.iso.datetime(),
}).readonly();
export type Invitation = z.infer<typeof invitationSchema>;
export class InvitationError extends Error {
  constructor() { super('초대가 올바르지 않거나 만료되었습니다. PC에서 새 QR을 만들어 주세요.'); this.name='InvitationError'; }
}
export function parseInvitation(raw:string, now=Date.now()):Invitation {
  if(raw.length>4096) throw new InvitationError();
  let value:unknown;
  try { value=JSON.parse(raw); } catch { throw new InvitationError(); }
  const result=invitationSchema.safeParse(value);
  if(!result.success||Date.parse(result.data.expiresAt)<=now) throw new InvitationError();
  return result.data;
}

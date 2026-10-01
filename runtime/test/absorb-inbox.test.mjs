import test from 'node:test';
import assert from 'node:assert/strict';
import * as inbox from '../lib/absorb-inbox.mjs';
import {initialAbsorbInbox,hash} from '../lib/gap-state.mjs';
import {rows,at} from './helpers/gap-fixture.mjs';
const payload={gapId:hash('gap'),searchFingerprint:hash('search'),candidate:rows(1)[0]};
test('base four draft kinds remain exact; duplicates converge and no promotion or active state exists',()=>{
 const inputs={'research-draft':payload,'local-document':{artifactId:'local',artifactSha256:hash('artifact'),summary:'document'},'ledger-tool':{ledgerId:'EXTRA-136',ledgerFingerprint:hash('ledger'),summary:'tool'},'self-beautification':{surface:'jarvis',evidenceSha256:hash('screenshot'),finding:'overflow'}};
 let registry=initialAbsorbInbox();for(const [kind,payload] of Object.entries(inputs)){registry=inbox.addAbsorbDraft(registry,{kind,payload,at,synthetic:true}).inbox;assert.deepEqual(inbox.addAbsorbDraft(registry,{kind,payload,at,synthetic:true}).inbox,registry);assert.throws(()=>inbox.addAbsorbDraft(registry,{kind,payload:{...payload,extra:true},at}));}
 assert.equal(registry.entries.length,4);assert.ok(Object.keys(inbox).every(n=>!/promote|activate/i.test(n)));assert.throws(()=>inbox.addAbsorbDraft(registry,{kind:'absorbed-opensource',payload,at}));for(const entry of registry.entries){assert.equal(entry.status,'draft');assert.equal(entry.authorizesDispatch,false);}
});
test('noAbility stays in inbox and rejects active/dispatch tampering or unknown target',()=>{
 const {inbox:box,entry}=inbox.addAbsorbDraft(initialAbsorbInbox(),{kind:'research-draft',payload,at,synthetic:true});const next=inbox.recordNoAbility(box,entry.id,'no executable manifest or fixtures');assert.equal(next.entries[0].status,'noAbility');assert.equal(box.entries[0].status,'draft');assert.throws(()=>inbox.recordNoAbility(box,'missing','reason'));
 for(const patch of [{authorizesDispatch:true},{status:'active'},{noAbility:'not consistent'},{payload:{...payload,run:'install'}}])assert.throws(()=>inbox.validateAbsorbInbox({version:1,entries:[{...entry,...patch}]}));
});

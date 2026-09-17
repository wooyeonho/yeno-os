import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {classifyRequest,httpsReadiness,parseTrustedProxies,parseAllowedHosts,createBootRecord,validateBootRecords,appendBoot,restartEvidence,MAX_BOOTS} from '../lib/https-evidence.mjs';

const hosts=parseAllowedHosts('Core.Example.com, staging.example.com');
const proxies=parseTrustedProxies('10.0.0.5, ::ffff:10.0.0.6,bad host');

test('HTTPS classification: TLS socket or trusted-proxy header only; forwarded headers from anyone else are ignored, fail-closed',()=>{
  assert.deepEqual(proxies,['10.0.0.5','10.0.0.6']);
  const tls=classifyRequest({socketEncrypted:true,host:'core.example.com',allowedHosts:hosts});
  assert.equal(tls.scheme,'https');assert.equal(tls.via,'direct-tls');assert.equal(tls.publicHost,'core.example.com');
  assert.equal(httpsReadiness(tls).state,'LIVE_VERIFIED');assert.deepEqual(httpsReadiness(tls).blockers,[]);

  const viaProxy=classifyRequest({remoteAddress:'::ffff:10.0.0.5',host:'staging.example.com',headers:{'x-forwarded-proto':'https'},trustedProxies:proxies,allowedHosts:hosts});
  assert.equal(viaProxy.scheme,'https');assert.equal(viaProxy.via,'trusted-proxy');assert.equal(viaProxy.forwarded.trusted,true);
  assert.equal(httpsReadiness(viaProxy).state,'LIVE_VERIFIED');

  const spoofed=classifyRequest({remoteAddress:'203.0.113.9',host:'core.example.com',headers:{'x-forwarded-proto':'https'},trustedProxies:proxies,allowedHosts:hosts});
  assert.equal(spoofed.scheme,'http');assert.equal(spoofed.via,'untrusted-forwarded-header');assert.equal(spoofed.forwarded.ignored,true);
  assert.equal(httpsReadiness(spoofed).state,'WIRED_UNVERIFIED');assert.deepEqual(httpsReadiness(spoofed).blockers,['forwarded_header_from_untrusted_source_ignored']);

  const noProxies=classifyRequest({remoteAddress:'10.0.0.5',host:'core.example.com',headers:{'x-forwarded-proto':'https'},trustedProxies:[],allowedHosts:hosts});
  assert.equal(noProxies.scheme,'http','without an owner-listed proxy no header is trusted');

  const multi=classifyRequest({remoteAddress:'10.0.0.5',host:'core.example.com',headers:{'x-forwarded-proto':'https, http'},trustedProxies:proxies,allowedHosts:hosts});
  assert.equal(multi.scheme,'http');assert.equal(multi.via,'trusted-proxy-ambiguous');assert.deepEqual(httpsReadiness(multi).blockers,['forwarded_proto_ambiguous']);
  assert.equal(classifyRequest({remoteAddress:'10.0.0.5',host:'core.example.com',headers:{'x-forwarded-proto':'http'},trustedProxies:proxies,allowedHosts:hosts}).scheme,'http');

  const local=classifyRequest({socketEncrypted:true,host:'127.0.0.1:8080',allowedHosts:hosts});
  assert.equal(local.publicHost,null);assert.equal(httpsReadiness(local).state,'WIRED_UNVERIFIED','TLS to a non-public host is not staging');
  assert.equal(httpsReadiness(local).localhostCountsAsStaging,false);
  assert.equal(httpsReadiness(classifyRequest({host:'127.0.0.1',allowedHosts:[]})).state,'BLOCKED');
  assert.equal(classifyRequest({socketEncrypted:'yes',host:'core.example.com',allowedHosts:hosts}).scheme,'http','truthy strings are not TLS');
  assert.equal(classifyRequest().scheme,'http');
});

test('restart evidence: durableStoreReload is separate from processRestartVerified, which needs a boot between run and reload',()=>{
  const b1=createBootRecord({bootId:randomUUID(),bootedAt:'2026-09-16T00:00:00.000Z',revisionAtBoot:0,pid:100});
  const b2=createBootRecord({bootId:randomUUID(),bootedAt:'2026-09-16T00:10:00.000Z',revisionAtBoot:12,pid:101});
  let boots=appendBoot([],b1).records;boots=appendBoot(boots,b2).records;
  assert.equal(appendBoot(boots,b2).added,false,'same boot id is idempotent');
  assert.throws(()=>appendBoot(boots,createBootRecord({bootId:randomUUID(),bootedAt:'2026-09-15T00:00:00.000Z',revisionAtBoot:1,pid:5})),/older/);
  assert.throws(()=>validateBootRecords([b2,b1]),/chronological/);
  assert.throws(()=>validateBootRecords([{...b1,token:'x'}]),/shape/);
  assert.throws(()=>createBootRecord({bootId:'boot-1',bootedAt:b1.bootedAt,revisionAtBoot:0,pid:1}),/UUID/);
  const many=Array.from({length:MAX_BOOTS},(_,i)=>createBootRecord({bootId:randomUUID(),bootedAt:`2026-09-16T01:${String(i).padStart(2,'0')}:00.000Z`,revisionAtBoot:i,pid:1+i}));
  const capped=appendBoot(many,createBootRecord({bootId:randomUUID(),bootedAt:'2026-09-16T02:00:00.000Z',revisionAtBoot:99,pid:999})).records;
  assert.equal(capped.length,MAX_BOOTS);assert.equal(capped[0].bootId,many[1].bootId,'bounded, oldest dropped');

  const none=restartEvidence({selfTests:[],boots,currentBootId:b2.bootId});
  assert.equal(none.state,'WIRED_UNVERIFIED');assert.deepEqual(none.blockers,['durable_reload_not_checked']);assert.equal(none.processRestartVerified.currentBootKnown,true);

  // Ran and reloaded inside the same process (after b2): reload only.
  const sameProcess={id:'st-1',startedAt:'2026-09-16T00:11:00.000Z',durableReload:{matched:true,at:'2026-09-16T00:12:00.000Z'}};
  const reloadOnly=restartEvidence({selfTests:[sameProcess],boots});
  assert.equal(reloadOnly.state,'SYNTHETIC_VERIFIED');assert.equal(reloadOnly.durableStoreReload.verified,true);assert.equal(reloadOnly.processRestartVerified.verified,false);
  assert.deepEqual(reloadOnly.blockers,['process_restart_not_observed_after_self_test']);

  // Ran under b1, reloaded under b2: a real process restart is proven.
  const across={id:'st-2',startedAt:'2026-09-16T00:05:00.000Z',durableReload:{matched:true,at:'2026-09-16T00:11:00.000Z'}};
  const restarted=restartEvidence({selfTests:[across],boots,currentBootId:b2.bootId});
  assert.equal(restarted.state,'LIVE_VERIFIED');assert.deepEqual(restarted.processRestartVerified.proofs,[{selfTestId:'st-2',startedAt:across.startedAt,reloadedAt:across.durableReload.at}]);assert.deepEqual(restarted.blockers,[]);
  assert.equal(restartEvidence({selfTests:[across],boots:[b1]}).processRestartVerified.verified,false,'no boot record after the run -> not proven');
  assert.equal(restartEvidence({selfTests:[{...across,durableReload:{matched:true}}],boots}).processRestartVerified.verified,false,'legacy reload record without a time proves reload only');
  assert.equal(restartEvidence({selfTests:[across],boots,recovered:true}).state,'BLOCKED');
  assert.throws(()=>restartEvidence({selfTests:[],boots:[{...b1,version:2}]}),/shape/);
});

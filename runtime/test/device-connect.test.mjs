import test from 'node:test';
import assert from 'node:assert/strict';
import {deviceConnect} from '../public/device-connect.mjs';
const ID = 'bdc3c4ea-3276-4c2d-93c1-5b0410e75258';
function setup(json, onConnected = () => {}) {
  const nodes = new Map();
  for (const id of ['device-connect','device-connect-status','device-connect-reference','remember-browser']) nodes.set(id, {
    textContent:'', hidden:false, disabled:false, checked:true, handlers:{},
    addEventListener(event, fn) {this.handlers[event] = fn;},
  });
  const events = {handlers:{},addEventListener(event, fn) {this.handlers[event] = fn;}};
  const connection = deviceConnect({document:{getElementById:id=>nodes.get(id)},json,onConnected,isLive:()=>true,events});
  return {nodes,connection,click:()=>nodes.get('device-connect').handlers.click()};
}
const settle = () => new Promise(resolve=>setImmediate(resolve));
test('only an explicit click starts pairing; polling and reopen carry no key or public reference as authentication', async t => {
  const calls = []; let pending = false, approved = false, connected;
  const page = setup(async (route, init = {}) => {
    calls.push({route,init});
    if (init.method === 'POST') {pending = true; assert.deepEqual(JSON.parse(init.body),{remember:true});}
    if (!pending) throw Object.assign(new Error('not started'),{status:401});
    return approved ? {authenticated:true,device:{id:'session'}} : {status:'pending',id:ID};
  }, value => {connected = value;});
  t.after(()=>page.connection.stop());
  await settle(); assert.equal(calls.length,1); assert.equal(calls[0].init.method,undefined);
  await page.click(); assert.equal(page.nodes.get('device-connect-reference').textContent,ID);
  assert.equal(connected,undefined);
  approved = true; await page.click(); assert.equal(connected.authenticated,true);
  for (const call of calls) assert.equal(call.init.headers?.Authorization,undefined);
  assert.equal(calls.filter(call=>call.init.method==='POST').length,1);
});
test('lost responses keep the request waiting; expired requests require an explicit new click', async t => {
  let mode = 'pending', posts = 0;
  const page = setup(async (route, init = {}) => {
    if (init.method === 'POST') posts++;
    if (mode === 'lost') throw new TypeError('lost response');
    if (mode === 'expired') throw Object.assign(new Error('expired'),{status:410});
    return {status:'pending',id:ID};
  });
  t.after(()=>page.connection.stop());
  await settle(); assert.equal(posts,0); assert.equal(page.nodes.get('device-connect-reference').textContent,ID);
  mode = 'lost'; await page.click(); assert.equal(page.nodes.get('device-connect-reference').textContent,ID);
  mode = 'expired'; await page.click(); assert.equal(page.nodes.get('device-connect-reference').hidden,true);
  assert.equal(posts,0);
  mode = 'pending'; await page.click(); assert.equal(posts,1);
});
test('storage activation failure is visible and does not claim a connected operating room', async t => {
  const page = setup(async()=>({authenticated:true}),()=>{throw new Error('보관된 작업이 다릅니다.');});
  t.after(()=>page.connection.stop()); await settle();
  assert.equal(page.nodes.get('device-connect-status').textContent,'보관된 작업이 다릅니다.');
});

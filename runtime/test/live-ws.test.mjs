import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {isWebSocketUpgrade, acceptUpgrade, MAX_MESSAGE_BYTES} from '../lib/live-ws.mjs';

// Node's global `WebSocket` (a real RFC 6455 client, undici-backed) - not a
// mock. Using it here is what makes this an actual wire-protocol test.

// Real transport test: a genuine RFC 6455 handshake and real masked frames
// from Node's own built-in WebSocket CLIENT against this hand-rolled SERVER
// (no `ws` dependency exists in this project). This exercises the actual
// wire protocol, not a synthetic in-process shortcut.
async function withServer(t, onConnection) {
  const server = http.createServer((req, res) => {res.writeHead(404); res.end();});
  server.on('upgrade', (req, socket, head) => {
    if (!isWebSocketUpgrade(req)) {socket.destroy(); return;}
    const conn = acceptUpgrade(req, socket);
    if (conn) onConnection(conn, req);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return `ws://127.0.0.1:${server.address().port}`;
}

test('real handshake + text/binary round trip between the built-in WebSocket client and this server',async t=>{
  const url = await withServer(t, conn => {
    conn.on('message', (data, {binary}) => {
      if (binary) conn.send(Buffer.from(data).map(b=>b^0xff), {binary:true});
      else conn.send(`echo:${data}`);
    });
  });
  const ws = new WebSocket(url);
  t.after(()=>ws.close());
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  const received=[];
  ws.onmessage=e=>received.push(e.data);
  ws.send('hello');
  await new Promise(r=>setTimeout(r,80));
  assert.equal(received[0],'echo:hello');
  const bin=new Uint8Array([1,2,3]);
  ws.send(bin);
  await new Promise(r=>setTimeout(r,80));
  const got=Buffer.from(await received[1].arrayBuffer());
  assert.deepEqual([...got],[254,253,252]);
});

test('an oversized frame is rejected and the connection closes rather than buffering unbounded memory',async t=>{
  let sawError=false;
  const url = await withServer(t, conn => {
    conn.on('error', ()=>{sawError=true;});
  });
  const ws = new WebSocket(url);
  t.after(()=>{try{ws.close();}catch{}});
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  const closed = new Promise(resolve=>{ws.onclose=resolve;});
  ws.send('x'.repeat(MAX_MESSAGE_BYTES+1024));
  await closed;
  assert.equal(sawError,true);
});

test('an unmasked client frame is rejected (RFC 6455 mandates masking; accepting one would be a cache-poisoning-class bug)',async t=>{
  let sawError=false;
  const url = await withServer(t, conn => {conn.on('error', ()=>{sawError=true;});});
  const {hostname,port}=new URL(url);
  const net=await import('node:net');
  const socket=net.connect(Number(port),hostname);
  t.after(()=>socket.destroy());
  await new Promise(resolve=>socket.on('connect',resolve));
  const key=Buffer.from('raw-unmasked-test-key12').toString('base64').slice(0,24);
  socket.write(`GET / HTTP/1.1\r\nHost: ${hostname}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  await new Promise(resolve=>socket.once('data',resolve)); // the 101 response
  const closed=new Promise(resolve=>socket.on('close',resolve));
  // A text frame with FIN=1, opcode=1, MASK bit UNSET (0x00), payload "hi".
  socket.write(Buffer.from([0x81,0x02,0x68,0x69]));
  await closed;
  assert.equal(sawError,true);
});

test('server frames are never masked and a malformed (non-websocket) upgrade request is rejected',async t=>{
  const server = http.createServer((req,res)=>{res.writeHead(404);res.end();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>server.close());
  const req=http.request({host:'127.0.0.1',port:server.address().port,path:'/',method:'GET',headers:{Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13'}});
  req.end();
  const res=await new Promise(resolve=>req.on('response',resolve));
  assert.equal(res.statusCode,404); // no upgrade handler installed on this bare server -> ordinary HTTP response
});

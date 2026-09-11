import {decodeState,encodeState} from './engine.mjs';
const b64=bytes=>btoa(String.fromCharCode(...bytes));
const unb64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
async function keyFor(password,salt){
 if(typeof password!=='string'||password.length<12||password.length>256)throw new Error('백업 암호는 12~256자로 입력하세요.');
 if(!globalThis.crypto?.subtle)throw new Error('이 브라우저에서는 암호화 백업을 지원하지 않습니다. HTTPS 또는 지원 브라우저에서 열어 주세요.');
 const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:210000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function encryptBackup(state,password){
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('BLACKHOLE-A03-v1')},await keyFor(password,salt),new TextEncoder().encode(encodeState(state))));
 // Chunk-safe conversion: bounded state may exceed the JS spread argument limit.
 let binary='';for(let i=0;i<ciphertext.length;i++)binary+=String.fromCharCode(ciphertext[i]);
 return JSON.stringify({format:'BLACKHOLE-A03-encrypted',version:1,salt:b64(salt),iv:b64(iv),data:btoa(binary)});
}
export async function decryptBackup(text,password){
 if(typeof text!=='string'||text.length>2100000)throw new Error('백업 크기를 확인하세요.');
 const b=JSON.parse(text);
 if(b.format!=='BLACKHOLE-A03-encrypted'||b.version!==1||typeof b.salt!=='string'||typeof b.iv!=='string'||typeof b.data!=='string')throw new Error('한끼안부 암호화 백업이 아닙니다.');
 const salt=unb64(b.salt),iv=unb64(b.iv);if(salt.length!==16||iv.length!==12)throw new Error('백업 형식이 손상되었습니다.');
 let plaintext;try{plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('BLACKHOLE-A03-v1')},await keyFor(password,salt),unb64(b.data));}catch{throw new Error('암호가 다르거나 백업 파일이 손상되었습니다. 기존 기록은 유지됩니다.');}
 const state=decodeState(new TextDecoder('utf-8',{fatal:true}).decode(plaintext));state.stopped=true;return state;
}

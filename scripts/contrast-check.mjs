import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const css=fs.readFileSync(path.join(root,'runtime/public/jarvis.css'),'utf8');
const tokens=Object.fromEntries([...css.matchAll(/(--j-[\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map(([,key,value])=>[key,value]));
const linear=channel=>{const v=channel/255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;};
const luminance=hex=>{
  const rgb=[1,3,5].map(index=>linear(parseInt(hex.slice(index,index+2),16)));
  return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;
};
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);};
const rows=[
  ['상단 바 글자','muted','bg'],['상단 바 링크','muted','bg'],['연결 상태','ink','bg'],
  ['말풍선','ink','bg'],['진행 표시','muted','bg'],['안내','warn','bg'],
  ['승인 안내','warn','bg'],['입력 글자','ink','bg'],['입력 placeholder','muted','bg'],
  ['조종 의지','ink','glass'],['조종 생명','ink','glass'],['조종 권한','ink','glass'],
  ['조종 설명','muted','glass'],['실패 안내','fail','glass'],
];
console.log('| 요소 | 전경 | 배경 | 비율 | AA 일반 텍스트 |');
console.log('|---|---|---|---:|---|');
for(const [label,foreground,background] of rows){
  const fg=tokens[`--j-${foreground}`],bg=tokens[`--j-${background}`];
  if(!fg||!bg)throw new Error(`missing token: ${foreground}/${background}`);
  const ratio=contrast(fg,bg);
  console.log(`| ${label} | ${fg} | ${bg} | ${ratio.toFixed(2)}:1 | ${ratio>=4.5?'통과':'미달'} |`);
}

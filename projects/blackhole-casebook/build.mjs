import fs from 'node:fs';
const root=new URL('./',import.meta.url);
const engine=fs.readFileSync(new URL('engine.mjs',root),'utf8').replace(/^export /gm,'');
const template=fs.readFileSync(new URL('template.html',root),'utf8');
fs.writeFileSync(new URL('BLACKHOLE_CASEBOOK.html',root),template.replace('/* CASE_ENGINE */',engine));

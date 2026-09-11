import fs from 'node:fs';
const root=new URL('./',import.meta.url);
const source=name=>fs.readFileSync(new URL(name,root),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const html=fs.readFileSync(new URL('template.html',root),'utf8').replace('/* ENGINE */',source('engine.mjs')).replace('/* BACKUP */',source('backup.mjs'));
fs.writeFileSync(new URL('BLACKHOLE_HANKKI.html',root),html);

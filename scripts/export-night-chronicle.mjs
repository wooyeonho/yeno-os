import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {openStore} from '../runtime/lib/store.mjs';
import {validateNightCycle} from '../runtime/lib/night-cycle-state.mjs';
const require=createRequire(new URL('../runtime/package.json',import.meta.url));
const {zipSync,strToU8}=require('fflate');
const xml=value=>String(value).replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[character]));

export function chronicleEpub(cycleDate,markdown){
 const title=`BLACKHOLE 밤사이 보고 ${cycleDate}`;
 const chapter=`<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ko"><head><title>${title}</title></head><body><h1>${title}</h1><pre>${xml(markdown)}</pre></body></html>`;
 const nav=`<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ko"><head><title>목차</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">${title}</a></li></ol></nav></body></html>`;
 const opf=`<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">blackhole-night-${cycleDate}</dc:identifier><dc:title>${title}</dc:title><dc:language>ko</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>`;
 const files={
  mimetype:[strToU8('application/epub+zip'),{level:0}],
  'META-INF/container.xml':strToU8('<?xml version="1.0" encoding="utf-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
  'OEBPS/chapter.xhtml':strToU8(chapter),
  'OEBPS/nav.xhtml':strToU8(nav),
  'OEBPS/content.opf':strToU8(opf),
 };
 return Buffer.from(zipSync(files));
}

export function exportNightChronicle(dataDir,outputDir,cycleDate){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(cycleDate))throw Error('Invalid cycle date');
 const store=openStore(dataDir);validateNightCycle(store.state.nightCycle);
 const report=store.state.nightCycle.reports.find(row=>row.cycleDate===cycleDate);
 if(!report)throw Error('Stored night report not found');
 fs.mkdirSync(outputDir,{recursive:true});
 const markdownPath=path.join(outputDir,`${cycleDate}-chronicle.md`),epubPath=path.join(outputDir,`${cycleDate}-chronicle.epub`);
 fs.writeFileSync(markdownPath,report.markdown,{encoding:'utf8',flag:'wx'});
 fs.writeFileSync(epubPath,chronicleEpub(cycleDate,report.markdown),{flag:'wx'});
 const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 if(sha(markdownPath)!==report.sha256)throw Error('Chronicle source hash mismatch');
 return {cycleDate,sourceSha256:report.sha256,markdown:{path:markdownPath,sha256:sha(markdownPath)},epub:{path:epubPath,sha256:sha(epubPath)},generatedNarration:false,published:false};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==5){console.error('Usage: node scripts/export-night-chronicle.mjs DATA_DIR OUTPUT_DIR YYYY-MM-DD');process.exit(2);}
 try{console.log(JSON.stringify(exportNightChronicle(process.argv[2],process.argv[3],process.argv[4])));}
 catch(error){console.error(`Chronicle export failed: ${error.message}`);process.exitCode=1;}
}

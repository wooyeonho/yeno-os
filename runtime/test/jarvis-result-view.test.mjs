import test from 'node:test';
import assert from 'node:assert/strict';
import {parseArtifactBlocks} from '../public/jarvis-scene-model.mjs';

test('document markup becomes headings, paragraphs, lists and fenced code',()=>{
  const blocks=parseArtifactBlocks('# 제목\n\n작성 시각: 지금\n\n## 입력\n- 첫째\n- 둘째\n\n```js\nconst x = 1;\n```');
  assert.deepEqual(blocks,[
    {type:'heading',level:1,text:'제목'},
    {type:'paragraph',text:'작성 시각: 지금'},
    {type:'heading',level:2,text:'입력'},
    {type:'list',items:['첫째','둘째']},
    {type:'code',text:'const x = 1;'},
  ]);
});

test('unsupported and dangerous-looking content remains literal text',()=>{
  const markup='<img src=x onerror=alert(1)>\n<script>alert(1)</script>';
  assert.deepEqual(parseArtifactBlocks(markup),[{type:'paragraph',text:markup}]);
  assert.deepEqual(parseArtifactBlocks('### 1\n\n**굵게** `code`'),[
    {type:'heading',level:3,text:'1'},
    {type:'paragraph',text:'굵게 code'},
  ]);
});

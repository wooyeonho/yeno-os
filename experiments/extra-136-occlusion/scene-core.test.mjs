import test from 'node:test';
import assert from 'node:assert/strict';
import {projectObject} from './scene-core.mjs';

test('depth plane makes a centered object visible through the opening only when behind it', () => {
  const front=projectObject({position:50,depth:20});
  const rear=projectObject({position:50,depth:70});
  assert.equal(front.visibility,'front');
  assert.equal(front.layer,'front');
  assert.equal(rear.visibility,'through');
  assert.equal(rear.layer,'behind');
  assert.ok(front.radius>rear.radius);
  assert.ok(front.y>rear.y,'closer objects project lower in the room');
});

test('an object behind the portal disappears outside the aperture while a foreground object remains visible', () => {
  const hidden=projectObject({position:0,depth:70});
  const exposed=projectObject({position:0,depth:20});
  assert.equal(hidden.visibility,'hidden');
  assert.equal(exposed.visibility,'front');
  assert.equal(projectObject({position:50,depth:50}).layer,'front');
});

test('position and depth reject values outside their explicit 0–100 controls', () => {
  for(const input of [{position:-1,depth:10},{position:50,depth:101},{position:NaN,depth:50},{position:'50',depth:50}])
    assert.throws(()=>projectObject(input),/range/);
});

'use strict';

const assert = require('node:assert/strict');
const core = require('../assets/js/offline-core.js');

assert.equal(core.draftKey('u1', 'opening'), 'u1|opening');
assert.equal(core.connectionLabel({ online:false, pending:2 }), 'Нет соединения · ожидает отправки: 2');
assert.equal(core.connectionLabel({ online:true, pending:0 }), 'Онлайн');
assert.equal(core.connectionLabel({ online:true, pending:3 }), 'Онлайн · ожидает отправки: 3');
assert.equal(core.connectionLabel({ online:true, pending:3, syncing:true }), 'Синхронизация · 3');

const summary = core.summarize([
  { itemKey:'a', text:'A', checkedByUser:true },
  { itemKey:'b', text:'B', checkedByUser:true, requiredPhotoCount:1, photoCount:0 },
  { itemKey:'c', text:'C', checkedByUser:true, requiredPhotoCount:2, photoCount:2 }
]);
assert.equal(summary.total, 3);
assert.equal(summary.done, 2);
assert.equal(summary.percent, 67);
assert.equal(summary.requiredPhotos, 3);
assert.equal(summary.missingPhotos, 1);
assert.equal(summary.items[1].checked, false);
assert.equal(summary.items[2].checked, true);

assert.equal(core.retryDelay(0), 2000);
assert.equal(core.retryDelay(1), 4000);
assert.equal(core.retryDelay(20), 300000);
assert.equal(core.isDuplicateError({ code:'23505' }), true);
assert.equal(core.isDuplicateError({ message:'duplicate key value violates unique constraint' }), true);
assert.equal(core.isDuplicateError({ code:'500' }), false);

console.log('offline-core tests: OK');

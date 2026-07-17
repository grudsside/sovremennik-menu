import assert from 'node:assert/strict';
import core from '../assets/js/notification-history-core.js';

const { compareRows, createNotificationHistoryController } = core;

function deferred(){
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function notification(prefix, number, userId, createdAt, readAt = null){
  return {
    id:`${prefix}-${String(number).padStart(4, '0')}`,
    user_id:userId,
    title:`Уведомление ${prefix}-${number}`,
    body:`Текст ${number}`,
    event_type:'manual',
    url:'/#home',
    status:'created',
    sent_at:null,
    created_at:createdAt,
    read_at:readAt
  };
}

function history(prefix, count, userId, startMs = Date.UTC(2026, 0, 2)){
  return Array.from({ length:count }, (_, index) => notification(
    prefix,
    index + 1,
    userId,
    new Date(startMs - index * 1000).toISOString()
  ));
}

function pageFrom(rows, { cursor, limit }){
  const sorted = rows.slice().sort(compareRows);
  let start = 0;
  if(cursor){
    const index = sorted.findIndex(row => (
      row.created_at === cursor.createdAt && String(row.id) === String(cursor.id)
    ));
    assert.notEqual(index, -1, `Cursor row ${cursor.id} must exist in the test dataset.`);
    start = index + 1;
  }
  const selected = sorted.slice(start, start + limit + 1);
  return {
    rows:selected.slice(0, limit),
    hasMore:selected.length > limit
  };
}

function harness(){
  const pageRequests = [];
  const countRequests = [];
  const markReadRequests = [];
  const markAllRequests = [];
  return {
    pageRequests,
    countRequests,
    markReadRequests,
    markAllRequests,
    api:{
      fetchPage(args){
        const request = { ...args, ...deferred() };
        pageRequests.push(request);
        return request.promise;
      },
      fetchUnreadCount(args){
        const request = { ...args, ...deferred() };
        countRequests.push(request);
        return request.promise;
      },
      markRead(args){
        const request = { ...args, ...deferred() };
        markReadRequests.push(request);
        return request.promise;
      },
      markAllRead(args){
        const request = { ...args, ...deferred() };
        markAllRequests.push(request);
        return request.promise;
      }
    }
  };
}

async function eventually(predicate, message){
  for(let attempt = 0; attempt < 100; attempt += 1){
    if(predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.fail(message);
}

function ids(rows){ return rows.map(row => row.id); }

async function paginationAndRealtimeRace(){
  const test = harness();
  const controller = createNotificationHistoryController({
    ...test.api,
    pageSize:20,
    refreshDelay:0
  });
  const original = history('a', 45, 'employee-a');
  const current = original.slice();
  controller.activate('employee-a');

  const initial = controller.loadInitial();
  assert.equal(test.pageRequests.length, 1);
  test.pageRequests[0].resolve(pageFrom(current, test.pageRequests[0]));
  await initial;
  assert.equal(controller.getState().rows.length, 20);

  const more = controller.loadMore();
  assert.equal(test.pageRequests.length, 2);
  const newRows = Array.from({ length:25 }, (_, index) => notification(
    'new',
    index + 1,
    'employee-a',
    new Date(Date.UTC(2026, 0, 2) + (25 - index) * 1000).toISOString()
  ));
  current.unshift(...newRows);
  controller.requestTopRefresh();

  // Realtime is queued: it must not start a conflicting top-page request
  // while the cursor page is still in flight.
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(test.pageRequests.length, 2);

  test.pageRequests[1].resolve(pageFrom(current, test.pageRequests[1]));
  await more;
  await eventually(() => test.pageRequests.length === 3, 'Queued Realtime refresh did not start.');
  test.pageRequests[2].resolve(pageFrom(current, test.pageRequests[2]));
  await eventually(() => test.pageRequests.length === 4, 'Top refresh did not continue to the loaded-history anchor.');
  test.pageRequests[3].resolve(pageFrom(current, test.pageRequests[3]));
  await controller.waitForIdle();

  let state = controller.getState();
  assert.equal(state.rows[0].id, newRows[0].id);
  assert.equal(state.rows.length, 65);
  assert.equal(new Set(ids(state.rows)).size, state.rows.length);
  assert.equal(state.hasMore, true);

  const finalPage = controller.loadMore();
  assert.equal(test.pageRequests.length, 5);
  test.pageRequests[4].resolve(pageFrom(current, test.pageRequests[4]));
  await finalPage;
  state = controller.getState();
  assert.deepEqual(ids(state.rows), ids(current.slice().sort(compareRows)));
  assert.equal(new Set(ids(state.rows)).size, 70);
  assert.equal(state.hasMore, false);
}

async function staleUserResponseIsIgnored(){
  const test = harness();
  const controller = createNotificationHistoryController({
    ...test.api,
    pageSize:20,
    refreshDelay:0
  });
  const employeeA = history('a', 30, 'employee-a');
  const employeeB = history('b', 25, 'employee-b', Date.UTC(2026, 0, 3));
  const firstToken = controller.activate('employee-a');

  const firstA = controller.loadInitial();
  test.pageRequests[0].resolve(pageFrom(employeeA, test.pageRequests[0]));
  await firstA;
  const oldMore = controller.loadMore();
  assert.equal(test.pageRequests.length, 2);
  controller.requestTopRefresh();
  assert.equal(controller.getState().topRefreshPending, true);

  const deactivated = controller.deactivate();
  const secondToken = controller.activate('employee-b');
  assert.ok(deactivated.generation > firstToken.generation);
  assert.ok(secondToken.generation > deactivated.generation);
  const firstB = controller.loadInitial();
  assert.equal(test.pageRequests.length, 3);

  // The new employee's request finishes first. The old employee's delayed
  // response then arrives in reverse order and must be ignored completely.
  test.pageRequests[2].resolve(pageFrom(employeeB, test.pageRequests[2]));
  await firstB;
  test.pageRequests[1].resolve(pageFrom(employeeA, test.pageRequests[1]));
  assert.equal(await oldMore, false);

  let state = controller.getState();
  assert.equal(state.userId, 'employee-b');
  assert.equal(state.loadingMore, false);
  assert.equal(state.actionLoading, false);
  assert.equal(state.topRefreshPending, false);
  assert.ok(state.rows.every(row => row.user_id === 'employee-b'));

  const moreB = controller.loadMore();
  assert.equal(test.pageRequests.length, 4);
  test.pageRequests[3].resolve(pageFrom(employeeB, test.pageRequests[3]));
  await moreB;
  state = controller.getState();
  assert.equal(state.rows.length, 25);
  assert.equal(state.hasMore, false);
  assert.ok(state.rows.every(row => row.user_id === 'employee-b'));
}

async function markAllWithConcurrentNotification(){
  const test = harness();
  const controller = createNotificationHistoryController({
    ...test.api,
    pageSize:20,
    refreshDelay:0
  });
  const existing = history('read', 3, 'employee-a');
  const current = existing.slice();
  controller.activate('employee-a');

  const initial = controller.loadInitial();
  test.pageRequests[0].resolve(pageFrom(current, test.pageRequests[0]));
  await initial;
  const initialCount = controller.refreshUnread();
  await eventually(() => test.countRequests.length === 1, 'Initial count request did not start.');
  test.countRequests[0].resolve(3);
  await initialCount;

  const markAll = controller.markAll();
  await eventually(() => test.markAllRequests.length === 1, 'Mark-all request did not start.');

  const newRow = notification(
    'concurrent',
    1,
    'employee-a',
    new Date(Date.UTC(2026, 0, 2) + 1000).toISOString()
  );
  current.unshift(newRow);
  controller.requestTopRefresh();
  const realtimeCount = controller.refreshUnread();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(test.pageRequests.length, 1, 'Realtime list refresh must wait for mark-all.');
  await eventually(() => test.countRequests.length === 2, 'Realtime count request did not start.');

  // This count was requested before mark-all completed. It may legitimately
  // be stale, but the post-update count must run after it and become final.
  test.countRequests[1].resolve(4);
  await realtimeCount;
  const readAt = new Date().toISOString();
  existing.forEach(row => { row.read_at = readAt; });
  test.markAllRequests[0].resolve(existing.map(row => ({ id:row.id, read_at:readAt })));
  await eventually(() => test.countRequests.length === 3, 'Post mark-all count request did not start.');
  test.countRequests[2].resolve(1);
  await eventually(() => test.pageRequests.length === 2, 'Queued Realtime top refresh did not start after mark-all.');
  test.pageRequests[1].resolve(pageFrom(current, test.pageRequests[1]));
  await markAll;
  await controller.waitForIdle();

  const state = controller.getState();
  assert.equal(state.unreadCount, 1);
  assert.equal(state.rows[0].id, newRow.id);
  assert.equal(state.rows[0].read_at, null);
  assert.ok(state.rows.slice(1).every(row => Boolean(row.read_at)));
}

async function individualReadRequiresDatabaseConfirmation(){
  const test = harness();
  const controller = createNotificationHistoryController({
    ...test.api,
    pageSize:20,
    refreshDelay:0
  });
  const rows = history('one', 1, 'employee-a');
  controller.activate('employee-a');
  const initial = controller.loadInitial();
  test.pageRequests[0].resolve(pageFrom(rows, test.pageRequests[0]));
  await initial;

  const failedRead = controller.markOne(rows[0].id);
  await eventually(() => test.markReadRequests.length === 1, 'Individual read request did not start.');
  assert.equal(controller.getState().rows[0].read_at, null);
  test.markReadRequests[0].reject(new Error('Controlled database failure'));
  await assert.rejects(failedRead, /Controlled database failure/);
  assert.equal(controller.getState().rows[0].read_at, null);
  assert.equal(controller.getState().actionLoading, false);

  const successfulRead = controller.markOne(rows[0].id);
  await eventually(() => test.markReadRequests.length === 2, 'Retry read request did not start.');
  const readAt = new Date().toISOString();
  test.markReadRequests[1].resolve({ id:rows[0].id, read_at:readAt });
  await eventually(() => test.countRequests.length === 1, 'Post-read count request did not start.');
  test.countRequests[0].resolve(0);
  const confirmed = await successfulRead;
  assert.equal(confirmed.read_at, readAt);
  assert.equal(controller.getState().rows[0].read_at, readAt);
  assert.equal(controller.getState().unreadCount, 0);
}

await paginationAndRealtimeRace();
await staleUserResponseIsIgnored();
await markAllWithConcurrentNotification();
await individualReadRequiresDatabaseConfirmation();
console.log('Notification history race checks passed.');

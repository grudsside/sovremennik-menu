/* Race-safe state controller for employee notification history. */
(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  if(root) root.SovremennikNotificationHistory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';

  function cursorFrom(row){
    if(!row?.created_at || !row?.id) return null;
    return { createdAt:String(row.created_at), id:String(row.id) };
  }

  function sameCursor(left, right){
    if(!left || !right) return left === right;
    return left.createdAt === right.createdAt && left.id === right.id;
  }

  function compareRows(left, right){
    const byCreated = String(right?.created_at || '').localeCompare(String(left?.created_at || ''));
    if(byCreated) return byCreated;
    return String(right?.id || '').localeCompare(String(left?.id || ''));
  }

  function uniqueSortedRows(rows, preferredRows = []){
    const byId = new Map();
    (rows || []).forEach(row => {
      if(row?.id) byId.set(String(row.id), row);
    });
    (preferredRows || []).forEach(row => {
      if(row?.id) byId.set(String(row.id), row);
    });
    return Array.from(byId.values()).sort(compareRows);
  }

  function createNotificationHistoryController(options){
    if(!options?.fetchPage || !options?.fetchUnreadCount || !options?.markRead || !options?.markAllRead){
      throw new Error('Notification history API is incomplete.');
    }

    const pageSize = Number(options.pageSize || 20);
    const refreshDelay = Number(options.refreshDelay ?? 25);
    const schedule = options.setTimeout || setTimeout;
    const cancelSchedule = options.clearTimeout || clearTimeout;
    let generation = 0;
    let topRefreshTimer = null;
    let countChain = Promise.resolve();
    let countRequest = 0;
    let state = freshState(false, '');

    function freshState(active, userId){
      return {
        generation,
        active,
        userId:userId || '',
        rows:[],
        unreadCount:0,
        nextCursor:null,
        hasMore:false,
        loaded:false,
        initialLoading:false,
        loadingMore:false,
        topRefreshing:false,
        listBusy:false,
        actionLoading:false,
        topRefreshPending:false,
        lastAppliedCountRequest:0,
        error:''
      };
    }

    function snapshot(){
      return {
        ...state,
        rows:state.rows.slice(),
        nextCursor:state.nextCursor ? { ...state.nextCursor } : null
      };
    }

    function emit(){
      if(typeof options.onChange === 'function') options.onChange(snapshot());
    }

    function token(){
      return { generation:state.generation, userId:state.userId };
    }

    function isCurrent(requestToken){
      return Boolean(
        requestToken
        && state.active
        && state.generation === requestToken.generation
        && state.userId === requestToken.userId
      );
    }

    function clearTopRefreshTimer(){
      if(topRefreshTimer !== null){
        cancelSchedule(topRefreshTimer);
        topRefreshTimer = null;
      }
    }

    function activate(userId){
      clearTopRefreshTimer();
      generation += 1;
      countRequest = 0;
      countChain = Promise.resolve();
      state = freshState(true, String(userId || ''));
      emit();
      return token();
    }

    function deactivate(){
      clearTopRefreshTimer();
      generation += 1;
      countRequest = 0;
      countChain = Promise.resolve();
      state = freshState(false, '');
      emit();
      return token();
    }

    function normalizedPage(page){
      const rows = uniqueSortedRows((page?.rows || []).slice(0, pageSize));
      const hasMore = Boolean(page?.hasMore);
      return {
        rows,
        hasMore,
        nextCursor:hasMore && rows.length ? cursorFrom(rows[rows.length - 1]) : null
      };
    }

    function schedulePendingTopRefresh(delay = refreshDelay){
      if(!state.active || state.listBusy || state.actionLoading || !state.topRefreshPending || topRefreshTimer !== null) return;
      topRefreshTimer = schedule(() => {
        topRefreshTimer = null;
        performTopRefresh().catch(error => {
          if(typeof options.onBackgroundError === 'function') options.onBackgroundError(error);
        });
      }, Math.max(0, delay));
    }

    function finishListOperation(requestToken){
      if(!isCurrent(requestToken)) return;
      state.listBusy = false;
      state.initialLoading = false;
      state.loadingMore = false;
      state.topRefreshing = false;
      emit();
      schedulePendingTopRefresh(0);
    }

    async function loadInitial({ reset = true } = {}){
      if(!state.active || state.listBusy || state.actionLoading) return false;
      const requestToken = token();
      state.listBusy = true;
      state.initialLoading = true;
      state.error = '';
      if(reset){
        state.rows = [];
        state.nextCursor = null;
        state.hasMore = false;
        state.loaded = false;
      }
      emit();
      try {
        const page = normalizedPage(await options.fetchPage({
          userId:requestToken.userId,
          cursor:null,
          limit:pageSize
        }));
        if(!isCurrent(requestToken)) return false;
        state.rows = page.rows;
        state.nextCursor = page.nextCursor;
        state.hasMore = page.hasMore;
        state.loaded = true;
        state.error = '';
        emit();
        return true;
      } catch(error) {
        if(isCurrent(requestToken)){
          state.error = options.loadError || 'Не удалось загрузить уведомления. Попробуйте ещё раз';
          emit();
        }
        throw error;
      } finally {
        finishListOperation(requestToken);
      }
    }

    async function loadMore(){
      if(!state.active || state.listBusy || state.actionLoading || !state.loaded || !state.hasMore || !state.nextCursor) return false;
      const requestToken = token();
      const requestCursor = { ...state.nextCursor };
      state.listBusy = true;
      state.loadingMore = true;
      state.error = '';
      emit();
      try {
        const page = normalizedPage(await options.fetchPage({
          userId:requestToken.userId,
          cursor:requestCursor,
          limit:pageSize
        }));
        if(!isCurrent(requestToken) || !sameCursor(state.nextCursor, requestCursor)) return false;
        state.rows = uniqueSortedRows(state.rows, page.rows);
        state.nextCursor = page.nextCursor;
        state.hasMore = page.hasMore;
        state.error = '';
        emit();
        return true;
      } catch(error) {
        if(isCurrent(requestToken)){
          state.error = options.loadError || 'Не удалось загрузить уведомления. Попробуйте ещё раз';
          emit();
        }
        throw error;
      } finally {
        finishListOperation(requestToken);
      }
    }

    async function performTopRefresh(){
      if(!state.active || state.listBusy || state.actionLoading || !state.topRefreshPending) return false;
      const requestToken = token();
      const existingIds = new Set(state.rows.map(row => String(row.id)));
      state.topRefreshPending = false;
      state.listBusy = true;
      state.topRefreshing = true;
      emit();
      try {
        let refreshCursor = null;
        let page = null;
        let freshRows = [];
        do {
          page = normalizedPage(await options.fetchPage({
            userId:requestToken.userId,
            cursor:refreshCursor,
            limit:pageSize
          }));
          if(!isCurrent(requestToken)) return false;
          freshRows = uniqueSortedRows(freshRows, page.rows);
          const reachedLoadedHistory = page.rows.some(row => existingIds.has(String(row.id)));
          if(!state.loaded || !state.rows.length || reachedLoadedHistory || !page.hasMore) break;
          refreshCursor = page.nextCursor;
        } while(refreshCursor);
        if(!isCurrent(requestToken)) return false;
        if(!state.loaded || !state.rows.length){
          state.rows = freshRows;
          state.nextCursor = page.nextCursor;
          state.hasMore = page.hasMore;
          state.loaded = true;
        } else {
          // Fresh top-page rows are authoritative, while already loaded older
          // pages and their cursor remain intact. If more than one page of new
          // rows arrived, keep paging until an existing row is reached.
          state.rows = uniqueSortedRows(state.rows, freshRows);
        }
        state.error = '';
        emit();
        return true;
      } catch(error) {
        if(isCurrent(requestToken)){
          state.error = options.loadError || 'Не удалось загрузить уведомления. Попробуйте ещё раз';
          emit();
        }
        throw error;
      } finally {
        finishListOperation(requestToken);
      }
    }

    function requestTopRefresh(){
      if(!state.active) return false;
      state.topRefreshPending = true;
      schedulePendingTopRefresh();
      return true;
    }

    function refreshUnread(){
      if(!state.active) return Promise.resolve(null);
      const requestToken = token();
      const sequence = ++countRequest;
      const run = countChain.catch(() => null).then(async () => {
        if(!isCurrent(requestToken)) return null;
        const count = await options.fetchUnreadCount({ userId:requestToken.userId });
        if(!isCurrent(requestToken) || sequence < state.lastAppliedCountRequest) return null;
        state.lastAppliedCountRequest = sequence;
        state.unreadCount = Math.max(0, Number(count) || 0);
        emit();
        return state.unreadCount;
      });
      countChain = run.catch(() => null);
      return run;
    }

    async function waitForUnreadIdle(requestToken = token()){
      while(isCurrent(requestToken)){
        const observed = countChain;
        await observed.catch(() => null);
        if(observed === countChain) return true;
      }
      return false;
    }

    async function markOne(id){
      if(!state.active || state.listBusy || state.actionLoading) return null;
      const row = state.rows.find(item => String(item.id) === String(id));
      if(!row) return null;
      const requestToken = token();
      state.actionLoading = true;
      emit();
      try {
        let confirmed = row;
        if(!row.read_at){
          confirmed = await options.markRead({ userId:requestToken.userId, row:{ ...row } });
          if(!isCurrent(requestToken)) return null;
          if(!confirmed?.id || !confirmed?.read_at){
            throw new Error('Notification read status was not confirmed.');
          }
          state.rows = state.rows.map(item => String(item.id) === String(confirmed.id)
            ? { ...item, read_at:confirmed.read_at }
            : item);
          emit();
          await refreshUnread();
          await waitForUnreadIdle(requestToken);
        }
        if(!isCurrent(requestToken)) return null;
        return state.rows.find(item => String(item.id) === String(id)) || confirmed;
      } finally {
        if(isCurrent(requestToken)){
          state.actionLoading = false;
          emit();
          schedulePendingTopRefresh(0);
        }
      }
    }

    async function markAll(){
      if(!state.active || state.listBusy || state.actionLoading || state.unreadCount === 0) return false;
      const requestToken = token();
      state.actionLoading = true;
      emit();
      try {
        const result = await options.markAllRead({ userId:requestToken.userId });
        if(!isCurrent(requestToken)) return false;
        const confirmedRows = Array.isArray(result) ? result : (result?.rows || []);
        const confirmedReadAt = Array.isArray(result) ? null : result?.readAt;
        const confirmed = new Map((confirmedRows || [])
          .filter(row => row?.id && row?.read_at)
          .map(row => [String(row.id), row.read_at]));
        if(confirmed.size){
          state.rows = state.rows.map(row => confirmed.has(String(row.id))
            ? { ...row, read_at:confirmed.get(String(row.id)) }
            : row);
          emit();
        }
        await refreshUnread();
        await waitForUnreadIdle(requestToken);
        if(!isCurrent(requestToken)) return false;
        if(state.unreadCount === 0 && confirmedReadAt){
          state.rows = state.rows.map(row => row.read_at ? row : { ...row, read_at:confirmedReadAt });
          emit();
        }
        requestTopRefresh();
        return true;
      } finally {
        if(isCurrent(requestToken)){
          state.actionLoading = false;
          emit();
          schedulePendingTopRefresh(0);
        }
      }
    }

    async function waitForIdle(){
      const requestToken = token();
      while(isCurrent(requestToken)){
        await waitForUnreadIdle(requestToken);
        if(
          topRefreshTimer === null
          && !state.listBusy
          && !state.topRefreshPending
          && !state.actionLoading
        ) return true;
        await new Promise(resolve => schedule(resolve, 0));
      }
      return false;
    }

    return {
      activate,
      deactivate,
      getState:snapshot,
      isCurrent,
      loadInitial,
      loadMore,
      markAll,
      markOne,
      refreshUnread,
      requestTopRefresh,
      waitForIdle,
      waitForUnreadIdle
    };
  }

  return {
    compareRows,
    createNotificationHistoryController,
    cursorFrom,
    sameCursor,
    uniqueSortedRows
  };
});

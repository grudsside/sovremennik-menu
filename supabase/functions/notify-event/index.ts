import { corsHeaders, json, requireUser, adminClient, sendPushToUsers, listAdminManagerIds, listAllActiveIds } from '../_shared/push.ts';

function taskUrl() { return '/#home'; }
function controlUrl() { return '/#control'; }
function scheduleUrl() { return '/#schedule'; }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  try {
    await requireUser(req);
    const supabase = adminClient();
    const body = await req.json();
    const eventType = body.event_type || body.eventType;
    const data = body.data || {};
    let userIds: string[] = [];
    let title = 'Современник';
    let text = 'Новое уведомление';
    let url = '/';
    let sourceTable = '';
    let sourceId = data.id || '';
    let extra: Record<string, unknown> = {};

    if (eventType === 'task_assigned' || eventType === 'task_completed') {
      const taskId = data.task_id || data.taskId;
      const { data: task, error } = await supabase.from('tasks').select('*').eq('id', taskId).maybeSingle();
      if (error || !task) throw error || new Error('Task not found');
      sourceTable = 'tasks'; sourceId = task.id; url = taskUrl();
      extra = { is_vip: Boolean(task.is_vip), requireInteraction: Boolean(task.is_vip) };
      if (eventType === 'task_assigned') {
        userIds = [task.assignee_id];
        if (task.is_vip) userIds.push(...await listAdminManagerIds(supabase));
        title = task.is_vip ? 'VIP-задача' : 'Новая задача';
        text = task.title || 'Вам назначена новая задача';
      } else {
        userIds = [task.creator_id, ...await listAdminManagerIds(supabase)];
        title = 'Задача завершена';
        text = task.title || 'Сотрудник завершил задачу';
      }
    } else if (eventType === 'checklist_submitted') {
      userIds = await listAdminManagerIds(supabase);
      sourceTable = 'checklist_submissions'; sourceId = data.submission_id || data.id || '';
      title = 'Отправлен чек-лист';
      text = `${data.employee_name || 'Сотрудник'}: ${data.checklist_title || 'чек-лист'}`;
      url = controlUrl();
    } else if (eventType === 'revision_submitted') {
      userIds = await listAdminManagerIds(supabase);
      sourceTable = 'coffee_revisions'; sourceId = data.revision_id || data.id || '';
      title = 'Отправлена ревизия';
      text = `${data.employee_name || 'Сотрудник'} отправил ревизию кофе${data.revision_date ? ' за ' + data.revision_date : ''}`;
      url = controlUrl();
    } else if (eventType === 'error_report_submitted') {
      userIds = await listAdminManagerIds(supabase);
      sourceTable = 'error_reports'; sourceId = data.report_id || data.id || '';
      title = 'Новое сообщение об ошибке';
      text = `${data.employee_name || 'Сотрудник'} сообщил об ошибке`;
      url = controlUrl();
      extra = { requireInteraction: true };
    } else if (eventType === 'schedule_event_added') {
      userIds = await listAllActiveIds(supabase);
      sourceTable = 'schedule_events'; sourceId = data.event_id || data.id || '';
      title = 'Обновлено расписание';
      text = data.title ? `${data.title}${data.event_date ? ' · ' + data.event_date : ''}` : 'Добавлено событие в расписание';
      url = scheduleUrl();
    } else {
      return json({ ok: false, error: 'Unknown event_type' }, 400);
    }

    const eventKeyBase = `${eventType}:${sourceId || crypto.randomUUID()}`;
    const results = await sendPushToUsers({ userIds, eventType, eventKeyBase, title, body: text, url, sourceTable, sourceId, extra });
    return json({ ok: true, results });
  } catch (error) {
    return json({ ok: false, error: error?.message || String(error) }, 400);
  }
});

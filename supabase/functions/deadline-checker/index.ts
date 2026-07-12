import { corsHeaders, json, adminClient, sendPushToUsers } from '../_shared/push.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const expected = Deno.env.get('NOTIFICATION_CRON_SECRET') || '';
    const received = req.headers.get('x-cron-secret') || '';
    if (expected && received !== expected) return json({ ok:false, error:'Invalid cron secret' }, 401);

    const supabase = adminClient();
    const now = new Date();
    const in24h = new Date(now.getTime() + 24*60*60*1000).toISOString();
    const { data: tasks, error } = await supabase
      .from('tasks')
      .select('*')
      .neq('status', 'done')
      .not('due_at', 'is', null)
      .lte('due_at', in24h);
    if (error) throw error;

    const allResults: any[] = [];
    for (const task of tasks || []) {
      const due = new Date(task.due_at);
      const diff = due.getTime() - now.getTime();
      let eventType = '';
      let title = '';
      let text = '';
      const recipients = [task.assignee_id];
      let requireInteraction = false;

      if (diff < 0) {
        eventType = 'task_overdue';
        title = 'Задача просрочена';
        text = task.title || 'Просрочена задача';
        requireInteraction = true;
      } else if (diff <= 60*60*1000) {
        eventType = 'task_deadline_1h';
        title = 'Дедлайн через 1 час';
        text = task.title || 'Скоро дедлайн задачи';
        requireInteraction = Boolean(task.is_vip);
      } else {
        eventType = 'task_deadline_24h';
        title = 'Дедлайн в течение суток';
        text = task.title || 'Скоро дедлайн задачи';
      }

      const results = await sendPushToUsers({
        userIds: recipients,
        eventType,
        eventKeyBase: `${eventType}:${task.id}`,
        title,
        body: text,
        url: '/#home',
        sourceTable: 'tasks',
        sourceId: task.id,
        extra: { is_vip: Boolean(task.is_vip), requireInteraction }
      });
      allResults.push({ task_id: task.id, eventType, recipients, results });
    }

    return json({ ok: true, checked: (tasks || []).length, results: allResults });
  } catch (error) {
    return json({ ok:false, error: error?.message || String(error) }, 400);
  }
});

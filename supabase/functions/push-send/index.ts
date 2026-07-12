import { corsHeaders, json, requireUser, adminClient, sendPushToUsers, listAllActiveIds } from '../_shared/push.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  try {
    const { user, profile } = await requireUser(req);
    const supabase = adminClient();
    const body = await req.json();
    let userIds: string[] = [];

    if (body.mode === 'self') {
      userIds = [user.id];
    } else {
      if (!['admin','manager'].includes(profile?.role)) return json({ ok:false, error:'Only admin/manager can send manual pushes' }, 403);
      if (body.user_id) userIds = [body.user_id];
      else if (body.role) {
        const { data, error } = await supabase.from('profiles').select('id').eq('is_active', true).eq('role', body.role);
        if (error) throw error;
        userIds = (data || []).map((r: any) => r.id);
      } else userIds = await listAllActiveIds(supabase);
    }

    const title = body.title || 'Современник';
    const text = body.body || 'Тестовое уведомление';
    const eventKeyBase = `manual:${crypto.randomUUID()}`;
    const results = await sendPushToUsers({ userIds, eventType:'manual', eventKeyBase, title, body:text, url: body.url || '/', extra:{ requireInteraction: Boolean(body.requireInteraction) } });
    return json({ ok: true, results });
  } catch (error) {
    return json({ ok: false, error: error?.message || String(error) }, 400);
  }
});

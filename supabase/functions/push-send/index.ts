import {
  adminClient,
  corsHeaders,
  errorResponse,
  json,
  listAllActiveIds,
  readJsonBody,
  requireUser,
  sendPushToUsers,
} from "../_shared/push.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "POST only" }, 405);
  }

  try {
    const { user, profile } = await requireUser(req);
    const supabase = adminClient();
    const body = await readJsonBody(req);
    let userIds: string[] = [];

    if (body.mode === "self") {
      userIds = [user.id];
    } else {
      if (!["admin", "manager"].includes(profile.role)) {
        return json({
          ok: false,
          error: "Only admin/manager can send manual pushes",
        }, 403);
      }

      const requestedUserId = typeof body.user_id === "string"
        ? body.user_id
        : "";
      const requestedRole = typeof body.role === "string" ? body.role : "";

      if (requestedUserId) {
        userIds = [requestedUserId];
      } else if (requestedRole) {
        const { data, error } = await supabase
          .from("profiles")
          .select("id")
          .eq("is_active", true)
          .eq("role", requestedRole);
        if (error) throw error;
        userIds = (data || []).map((row: { id: string }) => row.id);
      } else {
        userIds = await listAllActiveIds(supabase);
      }
    }

    const title = typeof body.title === "string" && body.title
      ? body.title
      : "Современник";
    const text = typeof body.body === "string" && body.body
      ? body.body
      : "Тестовое уведомление";
    const url = typeof body.url === "string" && body.url ? body.url : "/";
    const eventKeyBase = `manual:${crypto.randomUUID()}`;
    const results = await sendPushToUsers({
      userIds,
      eventType: "manual",
      eventKeyBase,
      title,
      body: text,
      url,
      extra: { requireInteraction: Boolean(body.requireInteraction) },
    });
    return json({ ok: true, results });
  } catch (error) {
    return errorResponse(error);
  }
});

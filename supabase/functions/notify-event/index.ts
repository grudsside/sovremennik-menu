import {
  adminClient,
  corsHeaders,
  errorResponse,
  json,
  listAdminManagerIds,
  readJsonBody,
  requireUser,
  sendPushToUsers,
} from "../_shared/push.ts";

function taskUrl() {
  return "/#home";
}

function controlUrl() {
  return "/#control";
}

function scheduleUrl() {
  return "/#schedule";
}

function unique(ids: string[]) {
  return Array.from(new Set((ids || []).filter(Boolean)));
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "POST only" }, 405);
  }

  try {
    await requireUser(req);
    const supabase = adminClient();
    const body = await readJsonBody(req);
    const eventType = stringValue(body.event_type) ||
      stringValue(body.eventType);
    const data = recordValue(body.data);
    let userIds: string[] = [];
    let title = "Современник";
    let text = "Новое уведомление";
    let url = "/";
    let sourceTable = "";
    let sourceId = stringValue(data.id);
    let extra: Record<string, unknown> = {};

    if (eventType === "task_assigned" || eventType === "task_completed") {
      const taskId = stringValue(data.task_id) || stringValue(data.taskId);
      if (!taskId) {
        return json({ ok: false, error: "Task id required" }, 400);
      }

      const { data: task, error } = await supabase
        .from("tasks")
        .select("*")
        .eq("id", taskId)
        .maybeSingle();
      if (error) throw error;
      if (!task) return json({ ok: false, error: "Task not found" }, 404);

      sourceTable = "tasks";
      sourceId = task.id;
      url = taskUrl();
      extra = {
        is_vip: Boolean(task.is_vip),
        requireInteraction: Boolean(task.is_vip),
      };

      if (eventType === "task_assigned") {
        userIds = [task.assignee_id];
        title = task.is_vip ? "VIP-задача" : "Новая задача";
        text = task.title || "Вам назначена новая задача";
      } else {
        userIds = unique([task.creator_id, task.assignee_id]);
        title = "Задача завершена";
        text = task.title || "Задача завершена";
      }
    } else if (eventType === "checklist_submitted") {
      userIds = await listAdminManagerIds(supabase);
      sourceTable = "checklist_submissions";
      sourceId = stringValue(data.submission_id) || stringValue(data.id);
      title = "Отправлен чек-лист";
      text = `${stringValue(data.employee_name) || "Сотрудник"}: ${
        stringValue(data.checklist_title) || "чек-лист"
      }`;
      url = controlUrl();
    } else if (eventType === "revision_submitted") {
      userIds = await listAdminManagerIds(supabase);
      sourceTable = "coffee_revisions";
      sourceId = stringValue(data.revision_id) || stringValue(data.id);
      title = "Отправлена ревизия";
      const revisionDate = stringValue(data.revision_date);
      text = `${stringValue(data.employee_name) || "Сотрудник"} отправил ревизию кофе${
        revisionDate ? ` за ${revisionDate}` : ""
      }`;
      url = controlUrl();
    } else if (eventType === "error_report_submitted") {
      userIds = await listAdminManagerIds(supabase);
      sourceTable = "error_reports";
      sourceId = stringValue(data.report_id) || stringValue(data.id);
      title = "Новое сообщение об ошибке";
      text = `${stringValue(data.employee_name) || "Сотрудник"} сообщил об ошибке`;
      url = controlUrl();
      extra = { requireInteraction: true };
    } else if (eventType === "schedule_event_added") {
      userIds = await listAdminManagerIds(supabase);
      sourceTable = "schedule_events";
      sourceId = stringValue(data.event_id) || stringValue(data.id);
      title = "Обновлено расписание";
      const eventTitle = stringValue(data.title);
      const eventDate = stringValue(data.event_date);
      text = eventTitle
        ? `${eventTitle}${eventDate ? ` · ${eventDate}` : ""}`
        : "Добавлено событие в расписание";
      url = scheduleUrl();
    } else {
      return json({ ok: false, error: "Unknown event_type" }, 400);
    }

    const eventKeyBase = `${eventType}:${sourceId || crypto.randomUUID()}`;
    const results = await sendPushToUsers({
      userIds,
      eventType,
      eventKeyBase,
      title,
      body: text,
      url,
      sourceTable,
      sourceId,
      extra,
    });
    return json({ ok: true, recipients: unique(userIds), results });
  } catch (error) {
    return errorResponse(error);
  }
});

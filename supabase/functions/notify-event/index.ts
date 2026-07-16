import { EdgeFunctionError } from "../_shared/auth.ts";
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
import {
  requireOwnedRecord,
  requireScheduleEventAccess,
  requireTaskAssignedAccess,
  requireTaskCompletedAccess,
} from "./authorization.ts";

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

function requiredString(
  data: Record<string, unknown>,
  keys: string[],
  message: string,
) {
  for (const key of keys) {
    const value = stringValue(data[key]).trim();
    if (value) return value;
  }
  throw new EdgeFunctionError(400, message);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "POST only" }, 405);
  }

  try {
    const { profile } = await requireUser(req);
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
    let sourceId = "";
    let eventKeySource = "";
    let extra: Record<string, unknown> = {};

    if (eventType === "task_assigned" || eventType === "task_completed") {
      const taskId = requiredString(
        data,
        ["task_id", "taskId"],
        "Task id required",
      );
      const { data: task, error } = await supabase
        .from("tasks")
        .select("id, creator_id, assignee_id, is_vip, title, status")
        .eq("id", taskId)
        .maybeSingle();
      if (error) throw error;
      if (!task) throw new EdgeFunctionError(404, "Task not found");

      sourceTable = "tasks";
      sourceId = task.id;
      url = taskUrl();
      extra = {
        is_vip: Boolean(task.is_vip),
        requireInteraction: Boolean(task.is_vip),
      };

      if (eventType === "task_assigned") {
        requireTaskAssignedAccess(profile, task);
        userIds = [task.assignee_id];
        title = task.is_vip ? "VIP-задача" : "Новая задача";
        text = task.title || "Вам назначена новая задача";
      } else {
        requireTaskCompletedAccess(profile, task);
        userIds = unique([task.creator_id, task.assignee_id]);
        title = "Задача завершена";
        text = task.title || "Задача завершена";
      }
    } else if (eventType === "checklist_submitted") {
      const submissionId = requiredString(
        data,
        ["submission_id", "id"],
        "Checklist submission id required",
      );
      const { data: submission, error } = await supabase
        .from("checklist_submissions")
        .select("id, employee_id, employee_name, checklist_title")
        .eq("id", submissionId)
        .maybeSingle();
      if (error) throw error;
      if (!submission) {
        throw new EdgeFunctionError(404, "Checklist submission not found");
      }
      requireOwnedRecord(profile, { owner_id: submission.employee_id });

      userIds = await listAdminManagerIds(supabase);
      sourceTable = "checklist_submissions";
      sourceId = submission.id;
      title = "Отправлен чек-лист";
      text = `${submission.employee_name || "Сотрудник"}: ${
        submission.checklist_title || "чек-лист"
      }`;
      url = controlUrl();
    } else if (eventType === "revision_submitted") {
      const revisionDate = requiredString(
        data,
        ["revision_date"],
        "Revision date required",
      );
      const { data: revision, error } = await supabase
        .from("coffee_revisions")
        .select("revision_date, employee_id, employee_name")
        .eq("revision_date", revisionDate)
        .maybeSingle();
      if (error) throw error;
      if (!revision) {
        throw new EdgeFunctionError(404, "Revision not found");
      }
      requireOwnedRecord(profile, { owner_id: revision.employee_id });

      userIds = await listAdminManagerIds(supabase);
      sourceTable = "coffee_revisions";
      // coffee_revisions uses a date primary key while notification_events
      // source_id is UUID. Keep the date in the dedupe key and store NULL in
      // source_id instead of failing the whole notification insert.
      eventKeySource = revision.revision_date;
      title = "Отправлена ревизия";
      text = `${
        revision.employee_name || "Сотрудник"
      } отправил ревизию кофе за ${revision.revision_date}`;
      url = controlUrl();
    } else if (eventType === "error_report_submitted") {
      const reportId = requiredString(
        data,
        ["report_id", "id"],
        "Error report id required",
      );
      const { data: report, error } = await supabase
        .from("error_reports")
        .select("id, employee_id, employee_name")
        .eq("id", reportId)
        .maybeSingle();
      if (error) throw error;
      if (!report) throw new EdgeFunctionError(404, "Error report not found");
      requireOwnedRecord(profile, { owner_id: report.employee_id });

      userIds = await listAdminManagerIds(supabase);
      sourceTable = "error_reports";
      sourceId = report.id;
      title = "Новое сообщение об ошибке";
      text = `${report.employee_name || "Сотрудник"} сообщил об ошибке`;
      url = controlUrl();
      extra = { requireInteraction: true };
    } else if (eventType === "schedule_event_added") {
      const eventId = requiredString(
        data,
        ["event_id", "id"],
        "Schedule event id required",
      );
      const { data: scheduleEvent, error } = await supabase
        .from("schedule_events")
        .select("id, created_by, title, event_date")
        .eq("id", eventId)
        .maybeSingle();
      if (error) throw error;
      if (!scheduleEvent) {
        throw new EdgeFunctionError(404, "Schedule event not found");
      }
      requireScheduleEventAccess(profile, scheduleEvent);

      userIds = await listAdminManagerIds(supabase);
      sourceTable = "schedule_events";
      sourceId = scheduleEvent.id;
      title = "Обновлено расписание";
      text = scheduleEvent.title
        ? `${scheduleEvent.title} · ${scheduleEvent.event_date}`
        : "Добавлено событие в расписание";
      url = scheduleUrl();
    } else {
      throw new EdgeFunctionError(400, "Unknown event_type");
    }

    const eventKeyBase = `${eventType}:${eventKeySource || sourceId}`;
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

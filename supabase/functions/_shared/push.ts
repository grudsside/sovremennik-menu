import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import {
  EdgeFunctionError,
  normalizeFunctionError,
  validateProfileAccess,
} from "./auth.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export function errorResponse(error: unknown) {
  const normalized = normalizeFunctionError(error);
  return json({ ok: false, error: normalized.message }, normalized.status);
}

export async function readJsonBody(
  req: Request,
): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new EdgeFunctionError(400, "Invalid JSON");
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof EdgeFunctionError) throw error;
    throw new EdgeFunctionError(400, "Invalid JSON");
  }
}

export function adminClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function requireUser(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  const match = auth.match(/^Bearer\s+(\S+)$/i);
  if (!match) throw new EdgeFunctionError(401, "Auth required");

  const supabase = adminClient();
  const { data, error } = await supabase.auth.getUser(match[1]);
  if (error || !data?.user) {
    throw new EdgeFunctionError(401, "Invalid auth");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileError) {
    throw new EdgeFunctionError(500, "Profile lookup failed");
  }

  const activeProfile = validateProfileAccess(profile);
  if (activeProfile.id !== data.user.id) {
    throw new EdgeFunctionError(403, "Profile required");
  }

  return { user: data.user, profile: activeProfile };
}

export function setupWebPush() {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY") || "";
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY") || "";
  const subject = Deno.env.get("VAPID_SUBJECT") ||
    "mailto:admin@sovremennik.local";
  if (!publicKey || !privateKey) {
    throw new Error("VAPID keys are not configured");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

export async function listAdminManagerIds(
  supabase: ReturnType<typeof adminClient>,
) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("is_active", true)
    .in("role", ["admin", "manager"]);
  if (error) throw error;
  return (data || []).map((row: { id: string }) => row.id);
}

export async function listAllActiveIds(
  supabase: ReturnType<typeof adminClient>,
) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("is_active", true);
  if (error) throw error;
  return (data || []).map((row: { id: string }) => row.id);
}

export async function loadPrefs(
  supabase: ReturnType<typeof adminClient>,
  userId: string,
) {
  const { data } = await supabase
    .from("notification_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  return data || {};
}

export function prefAllows(prefs: any, eventType: string, extra?: any) {
  if (extra?.is_vip && prefs.vip_tasks === false) return false;
  const keyMap: Record<string, string> = {
    task_assigned: "task_assigned",
    task_completed: "task_completed",
    task_deadline_24h: "task_deadline_24h",
    task_deadline_1h: "task_deadline_1h",
    task_overdue: "task_overdue",
    checklist_submitted: "checklist_submitted",
    revision_submitted: "revision_submitted",
    error_report_submitted: "error_report_submitted",
    schedule_event_added: "schedule_event_added",
  };
  const key = keyMap[eventType];
  if (!key) return true;
  return prefs[key] !== false;
}

export async function sendPushToUsers(params: {
  userIds: string[];
  eventType: string;
  eventKeyBase: string;
  title: string;
  body: string;
  url?: string;
  sourceTable?: string;
  sourceId?: string;
  extra?: Record<string, unknown>;
}) {
  const supabase = adminClient();
  const uniqueUserIds = Array.from(
    new Set((params.userIds || []).filter(Boolean)),
  );
  const results: any[] = [];
  let pushSetupError: unknown = null;
  let pushIsReady = false;

  for (const userId of uniqueUserIds) {
    const eventKey = `${params.eventKeyBase}:${userId}`;
    const { data: existing } = await supabase
      .from("notification_events")
      .select("id,status")
      .eq("user_id", userId)
      .eq("event_key", eventKey)
      .maybeSingle();
    if (existing) {
      results.push({ userId, skipped: true, reason: "duplicate" });
      continue;
    }
    const { data: eventRow, error: eventError } = await supabase
      .from("notification_events")
      .insert({
        user_id: userId,
        event_type: params.eventType,
        event_key: eventKey,
        source_table: params.sourceTable || null,
        source_id: params.sourceId || null,
        title: params.title,
        body: params.body,
        url: params.url || null,
        status: "created",
      })
      .select("id")
      .single();
    if (eventError) {
      results.push({ userId, error: eventError.message });
      continue;
    }

    // The in-app history is independent from device Push preferences. Every
    // addressed event is stored first; preferences only control Web Push.
    const prefs = await loadPrefs(supabase, userId);
    if (!prefAllows(prefs, params.eventType, params.extra)) {
      await supabase
        .from("notification_events")
        .update({ status: "preference_disabled" })
        .eq("id", eventRow.id);
      results.push({ userId, skipped: true, reason: "preference" });
      continue;
    }

    const { data: subs, error: subsError } = await supabase
      .from("push_subscriptions")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true);
    if (subsError) {
      await supabase
        .from("notification_events")
        .update({ status: "error", error: subsError.message })
        .eq("id", eventRow.id);
      results.push({ userId, error: subsError.message });
      continue;
    }
    if (!subs?.length) {
      await supabase
        .from("notification_events")
        .update({ status: "no_subscription" })
        .eq("id", eventRow.id);
      results.push({ userId, sent: 0, reason: "no_subscription" });
      continue;
    }

    if (!pushIsReady && !pushSetupError) {
      try {
        setupWebPush();
        pushIsReady = true;
      } catch (error) {
        pushSetupError = error;
      }
    }
    if (pushSetupError) {
      const message = pushSetupError instanceof Error
        ? pushSetupError.message
        : String(pushSetupError);
      await supabase
        .from("notification_events")
        .update({ status: "error", error: message })
        .eq("id", eventRow.id);
      results.push({ userId, error: message });
      continue;
    }

    let sent = 0;
    let lastError = "";
    for (const sub of subs) {
      try {
        const subscription = sub.subscription_json || {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh_key, auth: sub.auth_key },
        };
        await webpush.sendNotification(
          subscription,
          JSON.stringify({
            title: params.title,
            body: params.body,
            url: params.url || "/",
            tag: params.eventKeyBase,
            event_key: eventKey,
            requireInteraction: Boolean(params.extra?.requireInteraction),
          }),
        );
        sent += 1;
      } catch (error) {
        const pushError = error as {
          message?: unknown;
          statusCode?: unknown;
        };
        lastError = typeof pushError.message === "string"
          ? pushError.message
          : String(error);
        if ([404, 410].includes(Number(pushError.statusCode))) {
          await supabase
            .from("push_subscriptions")
            .update({ is_active: false })
            .eq("id", sub.id);
        }
      }
    }
    await supabase
      .from("notification_events")
      .update({
        status: sent ? "sent" : "error",
        error: sent ? null : lastError,
        sent_at: sent ? new Date().toISOString() : null,
      })
      .eq("id", eventRow.id);
    results.push({ userId, sent, error: sent ? undefined : lastError });
  }
  return results;
}

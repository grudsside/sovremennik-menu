// Supabase Edge Function: checklist-photo-retention
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { evaluateRetentionAccess } from "./authorization.ts";

const PHOTO_BUCKET = "checklist-photo-reports";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function clampLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 100;
  return Math.max(1, Math.min(500, Math.round(parsed)));
}

function safeEqual(left: string, right: string): boolean {
  if (!left || !right || left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function validatesProjectServiceKey(
  supabaseUrl: string,
  key: string,
): Promise<boolean> {
  const verifier = createClient(supabaseUrl, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const result = await verifier.from("profiles").select("id").limit(1);
  return !result.error;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const configuredCronSecret = Deno.env.get(
    "CHECKLIST_PHOTO_RETENTION_SECRET",
  ) || "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ ok: false, error: "Function configuration error" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const jwt = (req.headers.get("Authorization") || "").replace(
    /^Bearer\s+/i,
    "",
  ).trim();
  const apiKeyHeader = (req.headers.get("apikey") || "").trim();
  const cronSecretHeader = req.headers.get("x-cron-secret") || "";
  let serviceRoleAuthorized = false;
  let profile: Record<string, unknown> | null = null;
  let profileError: unknown = null;

  if (jwt && apiKeyHeader && safeEqual(jwt, apiKeyHeader)) {
    serviceRoleAuthorized = safeEqual(jwt, serviceRoleKey) ||
      await validatesProjectServiceKey(supabaseUrl, jwt);
  }

  if (jwt && !serviceRoleAuthorized) {
    const requester = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const auth = await requester.auth.getUser(jwt);
    if (!auth.error && auth.data.user) {
      const result = await admin
        .from("profiles")
        .select("id, role, is_active")
        .eq("id", auth.data.user.id)
        .maybeSingle();
      profile = result.data;
      profileError = result.error;
    } else {
      profileError = auth.error || new Error("Invalid auth");
    }
  }

  const access = evaluateRetentionAccess({
    profile,
    profileError,
    cronSecretHeader,
    configuredCronSecret,
    serviceRoleAuthorized,
  });
  if (!access.ok) {
    return json(
      { ok: false, error: access.error, code: access.code },
      access.status,
    );
  }

  const body = await req.json().catch(() => ({}));
  if (body.action !== "cleanup") {
    return json({ ok: false, error: "Unknown action" }, 400);
  }
  const limit = clampLimit(body.limit);
  const dryRun = body.dry_run === true;
  const now = new Date().toISOString();

  const candidates = await admin
    .from("checklist_submission_photos")
    .select(
      "id, submission_id, storage_path, thumbnail_path, expires_at, retained, deleted_at",
    )
    .eq("retained", false)
    .is("deleted_at", null)
    .lte("expires_at", now)
    .order("expires_at", { ascending: true })
    .limit(limit);

  if (candidates.error) {
    return json({ ok: false, error: candidates.error.message }, 400);
  }

  const rows = candidates.data || [];
  if (dryRun || rows.length === 0) {
    return json({
      ok: true,
      actor: access.actor,
      dryRun,
      candidates: rows.length,
      deleted: 0,
      photoIds: rows.map((row) => row.id),
    });
  }

  const objectPaths = Array.from(
    new Set(
      rows.flatMap((row) => [row.storage_path, row.thumbnail_path]).filter(
        Boolean,
      ),
    ),
  );
  if (objectPaths.length > 0) {
    const removed = await admin.storage.from(PHOTO_BUCKET).remove(objectPaths);
    if (removed.error) {
      return json({ ok: false, error: removed.error.message }, 400);
    }
  }

  const photoIds = rows.map((row) => row.id);
  const marked = await admin
    .from("checklist_submission_photos")
    .update({
      deleted_at: now,
      deleted_reason: "retention_90_days",
    })
    .in("id", photoIds)
    .is("deleted_at", null);
  if (marked.error) {
    return json({ ok: false, error: marked.error.message }, 400);
  }

  const submissionIds = Array.from(
    new Set(rows.map((row) => row.submission_id).filter(Boolean)),
  );
  if (submissionIds.length > 0) {
    const expired = await admin
      .from("checklist_submissions")
      .update({ photo_upload_status: "expired" })
      .in("id", submissionIds)
      .neq("photo_upload_status", "not_required");
    if (expired.error) {
      return json({ ok: false, error: expired.error.message }, 400);
    }
  }

  return json({
    ok: true,
    actor: access.actor,
    dryRun: false,
    candidates: rows.length,
    deleted: rows.length,
    removedObjects: objectPaths.length,
    photoIds,
    submissionIds,
  });
});

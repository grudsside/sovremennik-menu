// Supabase Edge Function: admin-maintenance
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { evaluateAdminAccess } from "./authorization.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const allowedSections = new Set([
  "tasks",
  "method",
  "theory",
  "checklists",
  "revisions",
  "techcards",
  "schedule",
  "reportError",
  "control",
]);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
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
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ ok: false, error: "Function configuration error" }, 500);
  }

  const jwt = (req.headers.get("Authorization") || "").replace(
    /^Bearer\s+/i,
    "",
  ).trim();
  if (!jwt) return json({ ok: false, error: "Auth required" }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const requester = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: authData, error: authError } = await requester.auth.getUser(
    jwt,
  );
  if (authError || !authData.user) {
    return json({ ok: false, error: "Invalid auth" }, 401);
  }

  let { data: profile, error: profileError } = await requester
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", authData.user.id)
    .maybeSingle();
  let access = evaluateAdminAccess(profile, profileError);

  if (!access.ok && access.code === "profile_not_found") {
    const fallback = await admin
      .from("profiles")
      .select("id, role, is_active")
      .eq("id", authData.user.id)
      .maybeSingle();
    profile = fallback.data;
    profileError = fallback.error;
    access = evaluateAdminAccess(profile, profileError);
  }
  if (!access.ok) {
    return json(
      { ok: false, error: access.error, code: access.code },
      access.status,
    );
  }

  const body = await req.json().catch(() => ({}));
  if (body.action !== "set") {
    return json({ ok: false, error: "Unknown action" }, 400);
  }

  const sectionId = String(body.sectionId || "").trim();
  const isClosed = body.isClosed;
  if (!allowedSections.has(sectionId)) {
    return json({ ok: false, error: "Unsupported section" }, 400);
  }
  if (typeof isClosed !== "boolean") {
    return json({ ok: false, error: "isClosed must be boolean" }, 400);
  }

  const result = await admin
    .from("section_maintenance")
    .upsert({
      section_id: sectionId,
      is_closed: isClosed,
      updated_at: new Date().toISOString(),
      updated_by: authData.user.id,
    }, { onConflict: "section_id" })
    .select("section_id, is_closed, updated_at, updated_by")
    .single();

  if (result.error) {
    return json({ ok: false, error: result.error.message }, 400);
  }
  return json({ ok: true, maintenance: result.data });
});

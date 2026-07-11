// Supabase Edge Function: admin-employees
// Deploy with: supabase functions deploy admin-employees
// Required secrets are already available in Supabase Functions runtime:
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function normalizeRole(role: string) {
  const value = String(role || "").trim().toLowerCase();
  if (["admin", "barista", "waiter"].includes(value)) return value;
  if (value === "администратор") return "admin";
  if (value === "бариста") return "barista";
  if (value === "официант") return "waiter";
  return "waiter";
}

function loginToEmail(login: string) {
  return `${String(login || "").trim().toLowerCase()}@sovremennik.local`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace("Bearer ", "");
  if (!jwt) return json({ ok: false, error: "Auth required" }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: authData, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !authData.user) return json({ ok: false, error: "Invalid auth" }, 401);

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", authData.user.id)
    .single();

  if (profileError || !profile || profile.role !== "admin" || !profile.is_active) {
    return json({ ok: false, error: "Admin only" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const action = body.action;

  if (action === "create") {
    const name = String(body.name || "").trim();
    const login = String(body.login || "").trim().toLowerCase();
    const password = String(body.password || "").trim();
    const role = normalizeRole(body.role || "waiter");

    if (!name || !login || !password) return json({ ok: false, error: "Name, login and password are required" }, 400);

    const email = loginToEmail(login);
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, login, role },
    });
    if (created.error) return json({ ok: false, error: created.error.message }, 400);

    const userId = created.data.user.id;
    const upsert = await admin.from("profiles").upsert({
      id: userId,
      login,
      name,
      role,
      is_active: true,
    });
    if (upsert.error) return json({ ok: false, error: upsert.error.message }, 400);

    return json({ ok: true, employee: { id: userId, name, login, role, is_active: true } });
  }

  if (action === "delete") {
    const userId = String(body.userId || "").trim();
    if (!userId) return json({ ok: false, error: "userId is required" }, 400);

    const { data: target } = await admin.from("profiles").select("login").eq("id", userId).single();
    if (target?.login === "grigory") return json({ ok: false, error: "Cannot delete start admin" }, 400);

    await admin.from("profiles").update({ is_active: false }).eq("id", userId);
    const deleted = await admin.auth.admin.deleteUser(userId);
    if (deleted.error) return json({ ok: false, error: deleted.error.message }, 400);
    return json({ ok: true });
  }

  return json({ ok: false, error: "Unknown action" }, 400);
});

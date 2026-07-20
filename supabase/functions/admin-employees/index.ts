// Supabase Edge Function: admin-employees
// Deploy with: supabase functions deploy admin-employees
// Required secrets are already available in Supabase Functions runtime:
// SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { evaluateAdminAccess, normalizeRole } from "./authorization.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const editableRoles = new Set(["admin", "manager", "barista", "waiter"]);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function loginToEmail(login: string) {
  return `${String(login || "").trim().toLowerCase()}@sovremennik.local`;
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
    return json({
      ok: false,
      error: "Function configuration error",
      code: "missing_runtime_secret",
    }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) {
    return json(
      { ok: false, error: "Auth required", code: "auth_required" },
      401,
    );
  }

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
    return json(
      { ok: false, error: "Invalid auth", code: "invalid_auth" },
      401,
    );
  }

  let { data: profile, error: profileError } = await requester
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", authData.user.id)
    .maybeSingle();

  let access = evaluateAdminAccess(profile, profileError);

  // An inactive profile may be hidden by RLS. Use the service client only to
  // distinguish an absent profile from an explicitly disabled account.
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
  const action = body.action;

  if (action === "create") {
    const name = String(body.name || "").trim();
    const login = String(body.login || "").trim().toLowerCase();
    const password = String(body.password || "").trim();
    const role = normalizeRole(body.role || "waiter");

    if (!name || !login || !password) {
      return json(
        { ok: false, error: "Name, login and password are required" },
        400,
      );
    }

    const email = loginToEmail(login);
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, login, role },
    });
    if (created.error) {
      return json({ ok: false, error: created.error.message }, 400);
    }

    const userId = created.data.user.id;
    const upsert = await admin.from("profiles").upsert({
      id: userId,
      login,
      name,
      role,
      is_active: true,
    });
    if (upsert.error) {
      return json({ ok: false, error: upsert.error.message }, 400);
    }

    return json({
      ok: true,
      employee: { id: userId, name, login, role, is_active: true },
    });
  }

  if (action === "set_role") {
    const userId = String(body.userId || "").trim();
    const login = String(body.login || "").trim().toLowerCase();
    const requestedRole = String(body.role || "").trim();
    const role = normalizeRole(requestedRole);

    if (!userId && !login) {
      return json({ ok: false, error: "userId or login is required" }, 400);
    }
    if (!requestedRole || !editableRoles.has(role)) {
      return json({ ok: false, error: "Unsupported role" }, 400);
    }

    let targetQuery = admin
      .from("profiles")
      .select("id, login, name, role, is_active");
    targetQuery = userId
      ? targetQuery.eq("id", userId)
      : targetQuery.eq("login", login);
    const { data: target, error: targetError } = await targetQuery.single();
    if (targetError || !target?.id) {
      return json({ ok: false, error: "Employee not found" }, 404);
    }

    if (target.id === authData.user.id && role !== "admin") {
      return json(
        { ok: false, error: "Cannot change current admin role" },
        400,
      );
    }

    if (
      target.is_active === true &&
      normalizeRole(target.role) === "admin" &&
      role !== "admin"
    ) {
      const { count, error: countError } = await admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin")
        .eq("is_active", true);
      if (countError) {
        return json({ ok: false, error: countError.message }, 400);
      }
      if ((count || 0) <= 1) {
        return json(
          { ok: false, error: "Cannot demote the last active admin" },
          400,
        );
      }
    }

    const updated = await admin
      .from("profiles")
      .update({ role })
      .eq("id", target.id)
      .select("id, login, name, role, is_active")
      .single();
    if (updated.error) {
      return json({ ok: false, error: updated.error.message }, 400);
    }
    return json({ ok: true, employee: updated.data });
  }

  if (action === "set_active") {
    const userId = String(body.userId || "").trim();
    const login = String(body.login || "").trim().toLowerCase();
    const isActive = body.isActive;

    if (!userId && !login) {
      return json({ ok: false, error: "userId or login is required" }, 400);
    }
    if (typeof isActive !== "boolean") {
      return json({ ok: false, error: "isActive must be boolean" }, 400);
    }

    let targetQuery = admin
      .from("profiles")
      .select("id, login, name, role, is_active");
    targetQuery = userId
      ? targetQuery.eq("id", userId)
      : targetQuery.eq("login", login);
    const { data: target, error: targetError } = await targetQuery.single();

    if (targetError || !target?.id) {
      return json({ ok: false, error: "Employee not found" }, 404);
    }
    if (!isActive && target.id === authData.user.id) {
      return json({ ok: false, error: "Cannot deactivate current admin" }, 400);
    }

    if (!isActive && normalizeRole(target.role) === "admin") {
      const { count, error: countError } = await admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin")
        .eq("is_active", true);
      if (countError) {
        return json({ ok: false, error: countError.message }, 400);
      }
      if ((count || 0) <= 1) {
        return json({
          ok: false,
          error: "Cannot deactivate the last active admin",
        }, 400);
      }
    }

    const updated = await admin
      .from("profiles")
      .update({ is_active: isActive })
      .eq("id", target.id)
      .select("id, login, name, role, is_active")
      .single();

    if (updated.error) {
      return json({ ok: false, error: updated.error.message }, 400);
    }
    return json({ ok: true, employee: updated.data });
  }

  if (action === "delete") {
    return json({
      ok: false,
      error: "Permanent employee deletion is disabled. Use set_active instead.",
    }, 400);
  }

  return json({ ok: false, error: "Unknown action" }, 400);
});

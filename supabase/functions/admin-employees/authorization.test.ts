import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  evaluateAdminAccess,
  normalizeRole,
} from "./authorization.ts";

Deno.test("normalizes supported admin aliases", () => {
  assertEquals(normalizeRole("admin"), "admin");
  assertEquals(normalizeRole("Администратор"), "admin");
});

Deno.test("allows an active administrator", () => {
  assertEquals(
    evaluateAdminAccess({ id: "admin-id", role: "admin", is_active: true }),
    { ok: true, role: "admin" },
  );
});

Deno.test("distinguishes a missing profile", () => {
  assertEquals(evaluateAdminAccess(null), {
    ok: false,
    status: 403,
    code: "profile_not_found",
    error: "Profile not found",
  });
});

Deno.test("distinguishes an inactive profile", () => {
  assertEquals(
    evaluateAdminAccess({ id: "admin-id", role: "admin", is_active: false }),
    {
      ok: false,
      status: 403,
      code: "account_disabled",
      error: "Account disabled",
    },
  );
});

Deno.test("distinguishes a non-admin role", () => {
  assertEquals(
    evaluateAdminAccess({ id: "manager-id", role: "manager", is_active: true }),
    {
      ok: false,
      status: 403,
      code: "admin_role_required",
      error: "Admin role required",
    },
  );
});

Deno.test("distinguishes a profile lookup error", () => {
  assertEquals(
    evaluateAdminAccess(undefined, new Error("database unavailable")),
    {
      ok: false,
      status: 500,
      code: "profile_lookup_failed",
      error: "Profile lookup failed",
    },
  );
});

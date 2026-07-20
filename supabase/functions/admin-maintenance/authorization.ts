export type AdminProfileRecord = {
  id?: unknown;
  role?: unknown;
  is_active?: unknown;
};

export type AdminAccessDecision =
  | { ok: true; role: "admin" }
  | {
    ok: false;
    status: number;
    code:
      | "profile_lookup_failed"
      | "profile_not_found"
      | "account_disabled"
      | "admin_role_required";
    error: string;
  };

export function normalizeRole(role: unknown): string {
  const value = String(role || "").trim().toLowerCase();
  if (["admin", "manager", "barista", "waiter"].includes(value)) return value;
  if (value === "администратор") return "admin";
  if (value === "руководитель" || value === "менеджер") return "manager";
  if (value === "бариста") return "barista";
  if (value === "официант") return "waiter";
  return "waiter";
}

export function evaluateAdminAccess(
  profile: AdminProfileRecord | null | undefined,
  lookupError?: unknown,
): AdminAccessDecision {
  if (lookupError) {
    return {
      ok: false,
      status: 500,
      code: "profile_lookup_failed",
      error: "Profile lookup failed",
    };
  }
  if (!profile || typeof profile !== "object") {
    return {
      ok: false,
      status: 403,
      code: "profile_not_found",
      error: "Profile not found",
    };
  }
  if (profile.is_active !== true) {
    return {
      ok: false,
      status: 403,
      code: "account_disabled",
      error: "Account disabled",
    };
  }
  if (normalizeRole(profile.role) !== "admin") {
    return {
      ok: false,
      status: 403,
      code: "admin_role_required",
      error: "Admin role required",
    };
  }
  return { ok: true, role: "admin" };
}

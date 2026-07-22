export type RetentionProfile = {
  id?: unknown;
  role?: unknown;
  is_active?: unknown;
} | null;

export type RetentionAccess =
  | { ok: true; actor: "admin" | "cron" | "service_role"; userId: string | null }
  | { ok: false; status: number; error: string; code: string };

function safeEqual(left: string, right: string): boolean {
  if (!left || !right || left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export function evaluateRetentionAccess(input: {
  profile: RetentionProfile;
  profileError?: unknown;
  cronSecretHeader?: string | null;
  configuredCronSecret?: string | null;
  serviceRoleAuthorized?: boolean;
}): RetentionAccess {
  if (input.serviceRoleAuthorized === true) {
    return { ok: true, actor: "service_role", userId: null };
  }

  const cronSecretHeader = String(input.cronSecretHeader || "").trim();
  const configuredCronSecret = String(input.configuredCronSecret || "").trim();

  if (
    configuredCronSecret && cronSecretHeader &&
    safeEqual(cronSecretHeader, configuredCronSecret)
  ) {
    return { ok: true, actor: "cron", userId: null };
  }

  if (input.profileError) {
    return {
      ok: false,
      status: 403,
      error: "Active administrator profile required",
      code: "profile_lookup_failed",
    };
  }

  if (!input.profile || typeof input.profile !== "object") {
    return {
      ok: false,
      status: 403,
      error: "Active administrator profile required",
      code: "profile_not_found",
    };
  }

  const id = typeof input.profile.id === "string"
    ? input.profile.id.trim()
    : "";
  if (!id || input.profile.is_active !== true || input.profile.role !== "admin") {
    return {
      ok: false,
      status: 403,
      error: "Active administrator profile required",
      code: "admin_required",
    };
  }

  return { ok: true, actor: "admin", userId: id };
}

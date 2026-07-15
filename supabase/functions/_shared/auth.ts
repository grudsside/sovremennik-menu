export const SUPPORTED_ROLES = ["admin", "manager", "barista", "waiter"] as const;

export type SupportedRole = (typeof SUPPORTED_ROLES)[number];

export type ActiveProfile = {
  id: string;
  role: SupportedRole;
  is_active: true;
};

export class EdgeFunctionError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "EdgeFunctionError";
    this.status = status;
  }
}

export function validateProfileAccess(profile: unknown): ActiveProfile {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new EdgeFunctionError(403, "Profile required");
  }

  const record = profile as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id) throw new EdgeFunctionError(403, "Profile required");

  if (record.is_active !== true) {
    throw new EdgeFunctionError(403, "Active profile required");
  }

  const role = typeof record.role === "string" ? record.role : "";
  if (!SUPPORTED_ROLES.includes(role as SupportedRole)) {
    throw new EdgeFunctionError(403, "Supported role required");
  }

  return { id, role: role as SupportedRole, is_active: true };
}

export function normalizeFunctionError(error: unknown): {
  status: number;
  message: string;
} {
  if (error instanceof EdgeFunctionError) {
    return { status: error.status, message: error.message };
  }

  return { status: 500, message: "Internal error" };
}

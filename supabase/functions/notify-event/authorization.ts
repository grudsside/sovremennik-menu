import {
  type ActiveProfile,
  EdgeFunctionError,
} from "../_shared/auth.ts";

export type TaskNotificationRecord = {
  id: string;
  creator_id: string | null;
  assignee_id: string | null;
  status: string;
};

export type OwnedNotificationRecord = {
  owner_id: string | null;
};

export type ScheduleNotificationRecord = {
  created_by: string | null;
};

export function isAdminOrManager(profile: ActiveProfile) {
  return profile.role === "admin" || profile.role === "manager";
}

export function requireOwnedRecord(
  profile: ActiveProfile,
  record: OwnedNotificationRecord,
) {
  if (!record.owner_id || record.owner_id !== profile.id) {
    throw new EdgeFunctionError(403, "Event source ownership required");
  }
}

export function requireTaskAssignedAccess(
  profile: ActiveProfile,
  task: TaskNotificationRecord,
) {
  requireOwnedRecord(profile, { owner_id: task.creator_id });
}

export function requireTaskCompletedAccess(
  profile: ActiveProfile,
  task: TaskNotificationRecord,
) {
  if (task.status !== "done") {
    throw new EdgeFunctionError(409, "Task is not completed");
  }

  if (task.assignee_id === profile.id || isAdminOrManager(profile)) return;

  throw new EdgeFunctionError(403, "Task completion access required");
}

export function requireScheduleEventAccess(
  profile: ActiveProfile,
  event: ScheduleNotificationRecord,
) {
  if (!isAdminOrManager(profile)) {
    throw new EdgeFunctionError(403, "Schedule role required");
  }

  if (!event.created_by || event.created_by !== profile.id) {
    throw new EdgeFunctionError(403, "Schedule event ownership required");
  }
}

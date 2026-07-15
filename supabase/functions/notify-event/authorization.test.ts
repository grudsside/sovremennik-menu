import {
  type ActiveProfile,
  EdgeFunctionError,
  type SupportedRole,
} from "../_shared/auth.ts";
import {
  requireOwnedRecord,
  requireScheduleEventAccess,
  requireTaskAssignedAccess,
  requireTaskCompletedAccess,
} from "./authorization.ts";

function profile(role: SupportedRole, id = `test-${role}`): ActiveProfile {
  return { id, role, is_active: true };
}

function expectAllowed(action: () => void) {
  action();
}

function expectRejected(
  action: () => void,
  status: number,
  message: string,
) {
  try {
    action();
  } catch (error) {
    if (!(error instanceof EdgeFunctionError)) {
      throw new Error("Expected EdgeFunctionError");
    }
    if (error.status !== status) {
      throw new Error(`Expected HTTP ${status}, got ${error.status}`);
    }
    if (error.message !== message) {
      throw new Error(`Expected ${message}, got ${error.message}`);
    }
    return;
  }
  throw new Error("Expected request to be rejected");
}

Deno.test("task assignment creator is allowed", () => {
  expectAllowed(() =>
    requireTaskAssignedAccess(profile("waiter", "creator"), {
      id: "task-1",
      creator_id: "creator",
      assignee_id: "assignee",
      status: "open",
    })
  );
});

Deno.test("task assignment non-creator is rejected", () => {
  expectRejected(
    () =>
      requireTaskAssignedAccess(profile("admin", "other-admin"), {
        id: "task-1",
        creator_id: "creator",
        assignee_id: "assignee",
        status: "open",
      }),
    403,
    "Event source ownership required",
  );
});

Deno.test("completed task assignee is allowed", () => {
  expectAllowed(() =>
    requireTaskCompletedAccess(profile("barista", "assignee"), {
      id: "task-1",
      creator_id: "creator",
      assignee_id: "assignee",
      status: "done",
    })
  );
});

Deno.test("completed task admin and manager are allowed", () => {
  for (const role of ["admin", "manager"] as const) {
    expectAllowed(() =>
      requireTaskCompletedAccess(profile(role), {
        id: "task-1",
        creator_id: "creator",
        assignee_id: "assignee",
        status: "done",
      })
    );
  }
});

Deno.test("open task completion notification is rejected", () => {
  expectRejected(
    () =>
      requireTaskCompletedAccess(profile("admin"), {
        id: "task-1",
        creator_id: "creator",
        assignee_id: "assignee",
        status: "open",
      }),
    409,
    "Task is not completed",
  );
});

Deno.test("unrelated employee cannot announce task completion", () => {
  expectRejected(
    () =>
      requireTaskCompletedAccess(profile("waiter", "other"), {
        id: "task-1",
        creator_id: "creator",
        assignee_id: "assignee",
        status: "done",
      }),
    403,
    "Task completion access required",
  );
});

Deno.test("owned submission, revision and error source is allowed", () => {
  expectAllowed(() =>
    requireOwnedRecord(profile("waiter", "owner"), { owner_id: "owner" })
  );
});

Deno.test("another employee source is rejected", () => {
  expectRejected(
    () =>
      requireOwnedRecord(profile("admin", "other"), { owner_id: "owner" }),
    403,
    "Event source ownership required",
  );
});

Deno.test("schedule creator admin and manager are allowed", () => {
  for (const role of ["admin", "manager"] as const) {
    const currentProfile = profile(role, `${role}-creator`);
    expectAllowed(() =>
      requireScheduleEventAccess(currentProfile, {
        created_by: currentProfile.id,
      })
    );
  }
});

Deno.test("schedule event rejects unsupported role", () => {
  expectRejected(
    () =>
      requireScheduleEventAccess(profile("barista", "creator"), {
        created_by: "creator",
      }),
    403,
    "Schedule role required",
  );
});

Deno.test("schedule event rejects another admin", () => {
  expectRejected(
    () =>
      requireScheduleEventAccess(profile("admin", "other-admin"), {
        created_by: "creator",
      }),
    403,
    "Schedule event ownership required",
  );
});

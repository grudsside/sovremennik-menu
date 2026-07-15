import {
  EdgeFunctionError,
  validateProfileAccess,
  type SupportedRole,
} from "./auth.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectAllowed(role: SupportedRole) {
  const profile = validateProfileAccess({
    id: `test-${role}`,
    role,
    is_active: true,
  });
  assert(profile.role === role, `Expected ${role} to be allowed`);
  assert(profile.is_active === true, "Expected active profile");
}

function expectRejected(profile: unknown, expectedMessage: string) {
  try {
    validateProfileAccess(profile);
  } catch (error) {
    assert(error instanceof EdgeFunctionError, "Expected EdgeFunctionError");
    assert(error.status === 403, "Expected HTTP 403");
    assert(error.message === expectedMessage, `Expected ${expectedMessage}`);
    return;
  }
  throw new Error("Expected profile to be rejected");
}

Deno.test("active admin is allowed", () => expectAllowed("admin"));
Deno.test("active manager is allowed", () => expectAllowed("manager"));
Deno.test("active barista is allowed", () => expectAllowed("barista"));
Deno.test("active waiter is allowed", () => expectAllowed("waiter"));

Deno.test("missing profile is rejected", () => {
  expectRejected(null, "Profile required");
});

Deno.test("inactive profile is rejected", () => {
  expectRejected(
    { id: "test-user", role: "waiter", is_active: false },
    "Active profile required",
  );
});

Deno.test("unsupported role is rejected", () => {
  expectRejected(
    { id: "test-user", role: "owner", is_active: true },
    "Supported role required",
  );
});

Deno.test("missing active flag is rejected", () => {
  expectRejected(
    { id: "test-user", role: "waiter" },
    "Active profile required",
  );
});

Deno.test("false-like active flag is rejected", () => {
  expectRejected(
    { id: "test-user", role: "waiter", is_active: 1 },
    "Active profile required",
  );
});

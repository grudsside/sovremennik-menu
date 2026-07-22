import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evaluateRetentionAccess } from "./authorization.ts";

Deno.test("retention accepts an active administrator", () => {
  assertEquals(
    evaluateRetentionAccess({
      profile: { id: "admin-id", role: "admin", is_active: true },
    }),
    { ok: true, actor: "admin", userId: "admin-id" },
  );
});

Deno.test("retention rejects manager and inactive administrator", () => {
  assertEquals(
    evaluateRetentionAccess({
      profile: { id: "manager-id", role: "manager", is_active: true },
    }).ok,
    false,
  );
  assertEquals(
    evaluateRetentionAccess({
      profile: { id: "admin-id", role: "admin", is_active: false },
    }).ok,
    false,
  );
});

Deno.test("retention accepts only the configured cron secret", () => {
  assertEquals(
    evaluateRetentionAccess({
      profile: null,
      cronSecretHeader: "correct-secret",
      configuredCronSecret: "correct-secret",
    }),
    { ok: true, actor: "cron", userId: null },
  );
  assertEquals(
    evaluateRetentionAccess({
      profile: null,
      cronSecretHeader: "wrong-secret",
      configuredCronSecret: "correct-secret",
    }).ok,
    false,
  );
});

Deno.test("retention never accepts an empty cron configuration", () => {
  assertEquals(
    evaluateRetentionAccess({
      profile: null,
      cronSecretHeader: "",
      configuredCronSecret: "",
    }).ok,
    false,
  );
});

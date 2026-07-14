import { validateCronAuth } from './cron-auth.ts';

function assertEquals<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}

Deno.test('allows an exact configured secret match', () => {
  assertEquals(validateCronAuth('test-secret', 'test-secret'), 'ok');
});

Deno.test('rejects a missing header', () => {
  assertEquals(validateCronAuth('test-secret', null), 'unauthorized');
});

Deno.test('rejects an incorrect header', () => {
  assertEquals(validateCronAuth('test-secret', 'wrong-secret'), 'unauthorized');
});

Deno.test('rejects missing environment configuration', () => {
  assertEquals(validateCronAuth(undefined, 'test-secret'), 'missing_configuration');
});

Deno.test('rejects empty environment configuration', () => {
  assertEquals(validateCronAuth('', 'test-secret'), 'missing_configuration');
});

Deno.test('does not trim or normalize secret values', () => {
  assertEquals(validateCronAuth('test-secret', ' test-secret'), 'unauthorized');
  assertEquals(validateCronAuth('test-secret', 'test-secret '), 'unauthorized');
  assertEquals(validateCronAuth(' test-secret', 'test-secret'), 'unauthorized');
});

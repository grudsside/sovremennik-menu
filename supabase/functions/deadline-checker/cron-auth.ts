export type CronAuthStatus = 'ok' | 'missing_configuration' | 'unauthorized';

export function validateCronAuth(
  expectedSecret: string | undefined,
  receivedSecret: string | null,
): CronAuthStatus {
  if (typeof expectedSecret !== 'string' || expectedSecret.length === 0) {
    return 'missing_configuration';
  }

  if (typeof receivedSecret !== 'string' || receivedSecret.length === 0) {
    return 'unauthorized';
  }

  return receivedSecret === expectedSecret ? 'ok' : 'unauthorized';
}

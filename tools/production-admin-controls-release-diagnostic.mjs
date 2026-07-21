import fs from 'node:fs/promises';
import path from 'node:path';

const outputDir = path.join(process.cwd(), 'artifacts', 'production-release');
await fs.mkdir(outputDir, { recursive: true });

try {
  await import('./production-admin-controls-release.mjs');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : null;
  const report = {
    ok: false,
    stage: 'apply-and-verify-production-migrations',
    message,
    stack,
    commit: process.env.GITHUB_SHA || null,
    workflowRun: process.env.GITHUB_RUN_ID || null,
    completedAt: new Date().toISOString(),
  };

  await fs.writeFile(
    path.join(outputDir, 'failure.json'),
    JSON.stringify(report, null, 2),
  );
  await fs.writeFile(
    path.join(outputDir, 'failure-summary.txt'),
    `${message}\n`,
  );

  console.error('Production migration diagnostic:', message);
  if (stack) console.error(stack);
  process.exitCode = 1;
}
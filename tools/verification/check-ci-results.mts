import { pathToFileURL } from 'node:url';

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function attemptFailures(needs: unknown, names: readonly string[], attempt: string): string[] {
  if (!/^[1-9][0-9]*$/u.test(attempt)) return ['missing or invalid current attempt'];
  const dependencies = record(needs);
  return names
    .filter((name) => record(record(dependencies?.[name])?.outputs)?.attempt !== attempt)
    .map((name) => `${name}: expected current attempt ${attempt}`);
}

export function ciVerificationFailures(
  needs: unknown,
  workflowCancelled: boolean,
  attempt = '1',
): string[] {
  const failures: string[] = workflowCancelled ? ['workflow was cancelled'] : [];
  const dependencies = record(needs);
  if (!dependencies) return [...failures, 'invalid CI dependency data'];
  const names = ['select', 'checks', 'persistence'];
  if (Object.keys(dependencies).some((name) => !names.includes(name))) {
    failures.push('unexpected CI dependency; update the required verification set');
  }
  const target = record(record(dependencies.select)?.outputs)?.target;
  if (target !== 'docs' && target !== 'code' && target !== 'full') {
    return [...failures, 'missing or invalid verification target'];
  }
  for (const name of names) {
    const expected = name === 'persistence' && target !== 'full' ? 'skipped' : 'success';
    if (record(dependencies[name])?.result !== expected) {
      failures.push(`${name}: expected ${expected}`);
    }
  }
  failures.push(
    ...attemptFailures(needs, target === 'full' ? names : ['select', 'checks'], attempt),
  );
  return failures;
}

export function persistenceVerificationFailures(
  needs: unknown,
  workflowCancelled: boolean,
  attempt = '1',
): string[] {
  const failures: string[] = workflowCancelled ? ['workflow was cancelled'] : [];
  const dependencies = record(needs);
  if (!dependencies) return [...failures, 'invalid persistence dependency data'];
  const names = ['select', 'persistence-1', 'persistence-2', 'persistence-3'];
  if (Object.keys(dependencies).some((name) => !names.includes(name)))
    failures.push('unexpected persistence dependency');
  if (record(record(dependencies.select)?.outputs)?.target !== 'full')
    failures.push('persistence aggregation requires full target');
  for (const name of names)
    if (record(dependencies[name])?.result !== 'success')
      failures.push(`${name}: expected success`);
  failures.push(...attemptFailures(needs, names, attempt));
  return failures;
}

function main(): void {
  try {
    const cancellation = process.env.WORKFLOW_CANCELLED;
    if (cancellation !== 'true' && cancellation !== 'false') {
      throw new Error('missing or invalid workflow cancellation state');
    }
    const needs: unknown = JSON.parse(process.env.NEEDS_JSON ?? '');
    const scope = process.env.VERIFICATION_SCOPE ?? 'workflow';
    if (scope !== 'workflow' && scope !== 'partitions')
      throw new Error('invalid verification scope');
    const failures = (
      scope === 'partitions' ? persistenceVerificationFailures : ciVerificationFailures
    )(needs, cancellation === 'true', process.env.GITHUB_RUN_ATTEMPT ?? '');
    process.stdout.write(
      `${JSON.stringify({ status: failures.length ? 'FAIL' : 'PASS', failures })}\n`,
    );
    if (failures.length) process.exitCode = 1;
  } catch {
    process.stderr.write('CI verification failed: invalid dependency or cancellation data\n');
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (invokedPath === import.meta.url) main();

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  currentBoundaryFailures,
  eventPullRequest,
  githubRead,
  isBatchBranch,
  isSha,
} from './delivery-context.mts';
import {
  isDocumentationOnlyPath,
  readChangedPaths,
  selectVerificationTarget,
  type VerificationContext,
} from './select-target.mts';

export function deliveryAdmissionFailures(
  paths: readonly string[],
  context: VerificationContext,
  selectedTarget: string,
  verificationResult: string,
  mainOnly: boolean,
): string[] {
  const failures: string[] = [];
  const pr = context.pullRequest;
  if (verificationResult !== 'success') failures.push('required verification did not succeed');
  if (context.eventName !== 'pull_request' || !pr)
    return [...failures, 'missing pull request delivery boundary'];
  if (mainOnly && pr.baseRef !== 'main') failures.push('main admission requires main as base');
  if (selectVerificationTarget(paths, context).target !== selectedTarget)
    failures.push('selected verification target does not match this delivery stage');
  if (!context.batchDeliveryEnabled) return failures;
  if (pr.baseRef === 'main') {
    if (isBatchBranch(pr.headRef) && pr.headRepository === pr.baseRepository) {
      if (selectedTarget !== 'full') failures.push('batch final candidate requires full');
    } else if (!(
      paths.length > 0 &&
      paths.every(isDocumentationOnlyPath) &&
      !pr.headRef.startsWith('batch/')
    )) {
      failures.push('business delivery to main must originate from a same-repository batch');
    }
  } else if (!isBatchBranch(pr.baseRef) || pr.headRepository !== pr.baseRepository) {
    failures.push('integration requires a same-repository batch base');
  }
  return failures;
}

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

async function main(): Promise<void> {
  try {
    const flag = process.env.BATCH_DELIVERY_ENABLED ?? '';
    if (!['', 'false', 'true'].includes(flag)) throw new Error('invalid batch activation setting');
    if (
      process.argv[2] === '--main' &&
      (!/^[1-9][0-9]*$/u.test(process.env.GITHUB_RUN_ATTEMPT ?? '') ||
        process.env.VERIFICATION_ATTEMPT !== process.env.GITHUB_RUN_ATTEMPT)
    )
      throw new Error('main admission requires verification from the current attempt');
    const event: unknown = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? '', 'utf8'));
    const repository = process.env.GITHUB_REPOSITORY ?? '';
    const pr = eventPullRequest(event, repository);
    const checkoutSha = process.env.GITHUB_SHA ?? '';
    if (!pr || !isSha(checkoutSha) || git('rev-parse', 'HEAD') !== checkoutSha)
      throw new Error('invalid event or actual checkout boundary');
    const parents = git('rev-list', '--parents', '-n', '1', checkoutSha).split(' ');
    if (parents.length !== 3 || parents[1] !== pr.baseSha || parents[2] !== pr.headSha)
      throw new Error('checkout does not combine the declared base and head');
    const paths = readChangedPaths(pr.baseSha, checkoutSha);
    const failures = deliveryAdmissionFailures(
      paths,
      {
        eventName: process.env.GITHUB_EVENT_NAME ?? '',
        isDraftPullRequest: false,
        batchDeliveryEnabled: flag === 'true',
        pullRequest: pr,
      },
      process.env.SELECTED_TARGET ?? '',
      process.env.VERIFICATION_RESULT ?? '',
      process.argv[2] === '--main',
    );
    const current = await githubRead(`/repos/${repository}/pulls/${pr.number}`);
    failures.push(...currentBoundaryFailures(pr, current, checkoutSha));
    process.stdout.write(
      `${JSON.stringify({
        status: failures.length ? 'FAIL' : 'PASS',
        failures,
        batchDeliveryEnabled: flag === 'true',
        ...pr,
        checkoutSha,
        tree: git('rev-parse', `${checkoutSha}^{tree}`),
        target: process.env.SELECTED_TARGET,
        workflowRef: process.env.GITHUB_WORKFLOW_REF,
        workflowSha: process.env.GITHUB_WORKFLOW_SHA,
        runId: process.env.GITHUB_RUN_ID,
        runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      })}\n`,
    );
    if (failures.length) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(
      `Delivery admission failed: ${error instanceof Error ? error.message : 'invalid evidence'}\n`,
    );
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (invokedPath === import.meta.url) void main();

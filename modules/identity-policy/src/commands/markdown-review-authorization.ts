import type { Common } from '@zhiju/contracts';
import type { IdentityCommandDeps } from './actor-snapshot.js';
import {
  issueEntryDecision,
  revalidateEntryDecision,
  type AuthorizationEntryBinding,
  type WorkOrderValidationAuthorizationConfig,
  type WorkOrderValidationEntryRequest,
  type WorkOrderValidationEntryRevalidation,
} from './work-order-validation-authorization.js';

/** #279: separate current grants for the four finite Human read purposes. */
export const MARKDOWN_REVIEW_PURPOSES = {
  'artifact.get_file_review_content': 'artifact.file_review.read',
  'artifact.get_file_change_directory': 'artifact.file_diff.read',
  'artifact.resolve_file_review_locations': 'artifact.file_locations.read',
  'artifact.get_markdown_download': 'artifact.markdown_download.read',
} as const;
export type MarkdownReviewOperation = keyof typeof MARKDOWN_REVIEW_PURPOSES;
export function createMarkdownReviewAuthorizationPort(config: {
  capabilityCodes: Readonly<Record<string, string>>;
  now?: (() => Date) | undefined;
}) {
  const now = config.now ?? (() => new Date());
  const shared = config as unknown as WorkOrderValidationAuthorizationConfig;
  function binding(operation: MarkdownReviewOperation): AuthorizationEntryBinding {
    const purpose = MARKDOWN_REVIEW_PURPOSES[operation];
    if (!Object.hasOwn(MARKDOWN_REVIEW_PURPOSES, operation))
      throw new Error('Unsupported Markdown read');
    return {
      commandType: operation,
      commandVersion: '1.0',
      authorizationPurpose: purpose,
      requiredGrantAction: `${purpose}.v1`,
      targetKind: 'CONTENT_ADDRESSED',
      targetObjectTypes: ['artifact.artifact_revision'],
      selectorType: 'TARGET_TYPE',
      capabilityConfigKey: operation,
      targetPayloadMember: 'revisionRef',
      expectedPrincipalKind: 'HUMAN',
      forbidActingFor: true,
    };
  }
  return {
    authorize(
      deps: IdentityCommandDeps,
      operation: MarkdownReviewOperation,
      input: WorkOrderValidationEntryRequest & { targetRef: Common.ContentAddressedRef },
    ) {
      if (input.commandType !== operation || input.commandVersion !== '1.0')
        throw new Error('Markdown operation mismatch');
      return issueEntryDecision(
        shared,
        now,
        undefined,
        deps,
        input,
        input.targetRef,
        binding(operation),
      );
    },
    revalidate(
      deps: IdentityCommandDeps,
      operation: MarkdownReviewOperation,
      input: WorkOrderValidationEntryRevalidation & {
        expectedTargetRef: Common.ContentAddressedRef;
      },
    ) {
      if (input.expectedCommandType !== operation || input.expectedCommandVersion !== '1.0')
        throw new Error('Markdown operation mismatch');
      return revalidateEntryDecision(
        shared,
        now,
        undefined,
        deps,
        input,
        input.expectedTargetRef,
        binding(operation),
      );
    },
  };
}

/** Server-only purposes; a deployment must name every allowed Service principal. */
export const MARKDOWN_SERVICE_PURPOSES = {
  'artifact.register_markdown_representation': 'artifact.markdown_representation.register',
  'integration.request_markdown_render': 'integration.render.request',
  'integration.get_markdown_render_binding': 'integration.markdown_render_binding.read',
} as const;
export type MarkdownServiceOperation = keyof typeof MARKDOWN_SERVICE_PURPOSES;
export function createMarkdownServiceAuthorizationPort(config: {
  capabilityCodes: Readonly<Record<string, string>>;
  allowedServicePrincipalIds: readonly string[];
  now?: (() => Date) | undefined;
}) {
  const now = config.now ?? (() => new Date());
  const shared = config as unknown as WorkOrderValidationAuthorizationConfig;
  function binding(
    operation: MarkdownServiceOperation,
    target: Common.ObjectRef | Common.ContentAddressedRef,
  ): AuthorizationEntryBinding {
    const purpose = MARKDOWN_SERVICE_PURPOSES[operation];
    const attempt =
      operation === 'integration.get_markdown_render_binding' && target.kind === 'OBJECT';
    if (
      !Object.hasOwn(MARKDOWN_SERVICE_PURPOSES, operation) ||
      config.allowedServicePrincipalIds.length === 0
    )
      throw new Error('Unsupported Markdown Service');
    return {
      commandType: operation,
      commandVersion: '1.0',
      authorizationPurpose: purpose,
      requiredGrantAction: `${purpose}.v1`,
      targetKind: attempt ? 'OBJECT' : 'CONTENT_ADDRESSED',
      targetObjectTypes: [attempt ? 'integration.render_attempt' : 'artifact.artifact_revision'],
      selectorType: 'TARGET_TYPE',
      capabilityConfigKey: operation,
      targetPayloadMember: attempt ? 'attemptRef' : 'revisionRef',
      expectedPrincipalKind: 'SERVICE',
      forbidActingFor: true,
      allowedServicePrincipalIds: config.allowedServicePrincipalIds,
    };
  }
  return {
    authorize(
      deps: IdentityCommandDeps,
      operation: MarkdownServiceOperation,
      input: WorkOrderValidationEntryRequest & {
        targetRef: Common.ObjectRef | Common.ContentAddressedRef;
      },
    ) {
      if (input.commandType !== operation || input.commandVersion !== '1.0')
        throw new Error('Markdown operation mismatch');
      return issueEntryDecision(
        shared,
        now,
        undefined,
        deps,
        input,
        input.targetRef,
        binding(operation, input.targetRef),
      );
    },
    revalidate(
      deps: IdentityCommandDeps,
      operation: MarkdownServiceOperation,
      input: WorkOrderValidationEntryRevalidation & {
        expectedTargetRef: Common.ObjectRef | Common.ContentAddressedRef;
      },
    ) {
      if (input.expectedCommandType !== operation || input.expectedCommandVersion !== '1.0')
        throw new Error('Markdown operation mismatch');
      return revalidateEntryDecision(
        shared,
        now,
        undefined,
        deps,
        input,
        input.expectedTargetRef,
        binding(operation, input.expectedTargetRef),
      );
    },
  };
}

import {
  ContractRegistry,
  operationPayloadSchemaRef,
  PreparationError,
  assertPreparationClosed,
  type PreparationSession,
} from '@zhiju/contracts';
import type { createPreparationProjectService } from '@zhiju/enterprise-project';
import type { createCustomerZipIntakeService } from '@zhiju/integration-gateway';
import type { VerifiedHumanResolution } from '@zhiju/identity-policy';
import type {
  WorkspaceDispatchRequest,
  WorkspaceVerifiedAccess,
  WorkspaceZipUploadRequest,
} from '../workspace/controller.js';

export const PREPARATION_PUBLIC_OPERATIONS = new Map([
  ['project.find_preparation_enterprises', 'QUERY'],
  ['project.get_project_preparation_request', 'QUERY'],
  ['integration.get_customer_zip_intake', 'QUERY'],
  ['project.request_project_preparation', 'COMMAND'],
  ['integration.request_customer_zip_intake', 'COMMAND'],
  ['integration.restart_customer_zip_upload', 'COMMAND'],
]);

export interface PreparationWorkspaceServices {
  project: ReturnType<typeof createPreparationProjectService>;
  integration: ReturnType<typeof createCustomerZipIntakeService>;
  /** Binds the actual verifier context to the owning session verifier. */
  run<T>(
    access: WorkspaceVerifiedAccess,
    human: VerifiedHumanResolution,
    action: (session: PreparationSession) => Promise<T>,
  ): Promise<T>;
}

/** Finite adapter. Queries never call a command or drive the owning processes. */
export function createPreparationWorkspaceEntry(services: PreparationWorkspaceServices) {
  const registry = new ContractRegistry();
  function invalid(): never {
    throw new PreparationError('API_VALUE_INVALID');
  }
  return {
    async execute(
      request: WorkspaceDispatchRequest,
      human: VerifiedHumanResolution,
    ): Promise<unknown> {
      if (
        request.version !== '1.0' ||
        PREPARATION_PUBLIC_OPERATIONS.get(request.operation) !== request.kind
      )
        invalid();
      const body = request.body;
      if (request.kind === 'QUERY') {
        assertPreparationClosed(
          body,
          [
            'queryId',
            'type',
            'version',
            'scopeRef',
            'consistencyRequirement',
            'correlationId',
            'requestedAt',
            'payload',
          ],
          ['integrity'],
        );
        if (body.consistencyRequirement !== 'AUTHORITATIVE') invalid();
      }
      return services.run(request, human, async (session) => {
        let data: unknown;
        const body = request.body as Record<string, unknown>;
        const payload = body.payload;
        const definition = registry.getOperation(request.operation, '1.0');
        const payloadSchema = definition ? operationPayloadSchemaRef(definition) : undefined;
        if (!payloadSchema || !registry.validateCoreContract(payloadSchema, payload).valid)
          invalid();
        if (request.kind === 'QUERY') {
          const envelope = {
            queryId: body.queryId,
            queryType: request.operation,
            queryVersion: '1.0',
            scopeRef: body.scopeRef,
            requester: human.principalRef,
            authenticationContextRef: {
              kind: 'CONTENT_ADDRESSED',
              objectType: 'zhiju.identity.authentication_context',
              objectId: body.queryId,
              scope: {},
              contentHash: session.authenticationContextHash,
            },
            consistencyRequirement: 'AUTHORITATIVE',
            correlationId: body.correlationId,
            requestedAt: body.requestedAt,
            payload,
          };
          if (!registry.validateOperation(request.operation, '1.0', envelope).valid) invalid();
        }
        if (request.operation === 'project.find_preparation_enterprises')
          data = await services.project.findEnterprises(
            session,
            payload as Parameters<typeof services.project.findEnterprises>[1],
          );
        else if (request.operation === 'project.get_project_preparation_request')
          data = await services.project.getRequest(
            session,
            payload as Parameters<typeof services.project.getRequest>[1],
          );
        else if (request.operation === 'integration.get_customer_zip_intake')
          data = await services.integration.get(session, {
            scopeRef: body.scopeRef,
            payload,
            correlationId: body.correlationId,
          } as Parameters<typeof services.integration.get>[1]);
        else if (request.operation === 'project.request_project_preparation')
          data = await services.project.request(
            session,
            body as unknown as Parameters<typeof services.project.request>[1],
          );
        else if (request.operation === 'integration.request_customer_zip_intake')
          data = await services.integration.request(
            session,
            body as unknown as Parameters<typeof services.integration.request>[1],
          );
        else
          data = await services.integration.restart(
            session,
            body as unknown as Parameters<typeof services.integration.restart>[1],
          );
        if (!registry.validateOperationResult(request.operation, '1.0', data).valid)
          throw new PreparationError('DEPENDENCY_UNAVAILABLE');
        const result = data as Record<string, unknown>;
        if (request.kind === 'QUERY')
          return {
            queryId: body.queryId,
            status: 'OK',
            data,
            snapshotAt: new Date().toISOString(),
            sourceWatermarks: result.sourceWatermarks,
            stalenessStatus: 'FRESH',
            redactions: [],
          };
        return {
          commandId: body.commandId,
          status: result.disposition === 'IDEMPOTENT_REPLAY' ? 'DUPLICATE' : 'COMMITTED',
          data,
        };
      });
    },
    async upload(
      request: WorkspaceZipUploadRequest,
      human: VerifiedHumanResolution,
    ): Promise<unknown> {
      return services.run(request, human, (session) =>
        services.integration.upload(session, {
          intakeId: request.intakeId,
          token: request.token,
          stream: request.bytes,
          ...(request.contentLength === undefined ? {} : { contentLength: request.contentLength }),
        }),
      );
    },
  };
}

import { Module, type DynamicModule } from '@nestjs/common';

import { HealthController } from './health.controller.js';
import {
  WORKSPACE_TRANSPORT_RUNTIME,
  WorkspaceController,
  type WorkspaceTransportRuntime,
} from './workspace/controller.js';

/**
 * The API application module. `GET /health` is always mounted: a readiness
 * probe must be able to answer 200 without leaking whether the workspace trust
 * configuration is present. The workspace HTTP surface is registered only when
 * the trusted runtime could actually be created from the environment; otherwise
 * the process degrades closed and the workspace routes do not exist at all,
 * rather than serving a half-configured business entry point.
 */
@Module({ controllers: [HealthController] })
export class AppModule {
  static register(runtime?: WorkspaceTransportRuntime): DynamicModule {
    if (runtime === undefined) {
      return { module: AppModule, controllers: [HealthController] };
    }
    return {
      module: AppModule,
      controllers: [HealthController, WorkspaceController],
      providers: [{ provide: WORKSPACE_TRANSPORT_RUNTIME, useValue: runtime }],
    };
  }
}

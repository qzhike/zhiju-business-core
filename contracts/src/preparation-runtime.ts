import type { Common } from './generated/types/common.js';
export interface PreparationProcessObservation {
  sessionId: string;
  systemPromptSha256: string;
  promptStatus: 'completed' | 'error' | 'aborted';
  processStopped: true;
  providerCancellationAcknowledged: false;
  eventBytes: number;
  eventSha256: string;
}
export interface LocalAnalysisSource {
  sourceId: string;
  sourceRef: Common.TypedReference;
  role: 'CUSTOMER_MATERIAL' | 'TEMPLATE';
  displayName: string;
  format: 'md' | 'docx';
  sha256: string;
  bytes: Uint8Array;
}
export interface LocalAnalysisPackage {
  runRef: Common.ObjectRef;
  attemptRef: Common.ObjectRef;
  adapterRef: Common.ObjectRef;
  runFencingToken: number;
  contractRef: Common.ContentAddressedRef;
  contextRef: Common.SnapshotRef;
  analysisRequestKey: string;
  instructions: { sha256: string; bytes: Uint8Array };
  sources: LocalAnalysisSource[];
  vocabulary: Record<string, unknown>;
  requirementBindings: { sourceId: string; locator: string; requirementCode: string }[];
  deadline: string;
}
export interface LocalAnalysisOutput {
  runRef: Common.ObjectRef;
  attemptRef: Common.ObjectRef;
  adapterRef: Common.ObjectRef;
  runFencingToken: number;
  packageHash: Common.ContentHash;
  profileHash: Common.ContentHash;
  manifestSha256: string;
  jsonSha256: string;
  markdownSha256: string;
  extractionSha256: string;
  validationContextSha256: string;
  observation: PreparationProcessObservation;
  reportJson: string;
  narrativeMarkdown: string;
}

export interface PreparationAnalysisRuntimePort {
  readonly profileHash: Common.ContentHash;
  readonly binding: {
    profile: 'workspace.macos_manual_omp@1';
    profileHash: Common.ContentHash;
    provider: string;
    modelId: string;
  };
  verify(): Promise<void>;
  enqueue(requestRef: Common.ObjectRef): Promise<void>;
  pending(): Promise<Common.ObjectRef[]>;
  invoke(
    input: LocalAnalysisPackage,
    revalidate: () => Promise<void>,
    signal?: AbortSignal,
  ): Promise<LocalAnalysisOutput>;
  read(input: LocalAnalysisPackage): Promise<{
    status: 'NOT_INVOKED' | 'PENDING' | 'UNKNOWN' | 'COMPLETE';
    output?: LocalAnalysisOutput;
  }>;
}

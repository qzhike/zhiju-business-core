import type { Artifact, Common } from '@zhiju/contracts';

/** Called only after lawful owning setup has read back these exact references. */
export function markdownReviewLink(input: {
  artifactRef: Common.ObjectRef;
  revisionRef: Common.ContentAddressedRef;
  fromRevisionRef?: Common.ContentAddressedRef;
  representationRef?: Artifact.RepresentationRef;
}): string {
  const binding = { ...input, baselineKind: input.fromRevisionRef ? 'REVISION' : 'EMPTY_INITIAL' };
  return `/projects/${input.revisionRef.scope.projectId}/artifacts/${input.artifactRef.objectId}/revisions/${input.revisionRef.objectId}?binding=${Buffer.from(JSON.stringify(binding)).toString('base64url')}`;
}

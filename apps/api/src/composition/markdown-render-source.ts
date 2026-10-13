import { isDeepStrictEqual } from 'node:util';
import type { Common } from '@zhiju/contracts';
import type { MarkdownReviewService } from '@zhiju/artifact';
import {
  markdownNotFound,
  verifyMarkdownRoundTrip,
  type MarkdownReadAuthority,
} from '@zhiju/artifact';
import type { MarkdownCanonicalPort } from '@zhiju/integration-gateway';

/** The renderer receives bytes only through a currently authorized owning ART read. */
export function createMarkdownRenderSource(config: {
  review: MarkdownReviewService;
  authorityFor(revisionRef: Common.ContentAddressedRef): MarkdownReadAuthority;
}): MarkdownCanonicalPort {
  async function read(revisionRef: Common.ContentAddressedRef) {
    return config.review.read(
      config.authorityFor(revisionRef),
      'artifact.register_markdown_representation',
      revisionRef,
    );
  }
  return {
    async read(revisionRef) {
      const source = await read(revisionRef);
      return {
        content: source.payload,
        canonicalContentRef: source.facts.revision.object_locator,
        identityMap: source.identityMap,
      };
    },
    async verify(input) {
      const source = await read(input.revisionRef);
      if (!isDeepStrictEqual(source.identityMap, input.identityMap)) return markdownNotFound();
      verifyMarkdownRoundTrip({
        content: source.payload,
        renderedBytes: input.bytes,
        enterpriseId: source.facts.root.enterprise_id,
        identityDerivation: {
          originalIntentRef: `revision:${input.revisionRef.objectId}`,
          candidateOutputId: input.revisionRef.objectId,
        },
        identityMap: source.identityMap,
        identityBinding: { artifactRef: source.artifactRef, baseRevisionRef: input.revisionRef },
      });
      return input.revisionRef.contentHash;
    },
  };
}

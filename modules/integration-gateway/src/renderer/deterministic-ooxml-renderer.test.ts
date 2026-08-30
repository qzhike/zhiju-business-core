import { readFileSync } from 'node:fs';

import type { Artifact } from '@zhiju/contracts';
import { hashCanonicalContentPayload, type CanonicalContentPayload } from '@zhiju/shared-kernel';
import { describe, expect, it } from 'vitest';

import {
  DOCX_RENDERER_PROFILE,
  RendererInputError,
  XLSX_RENDERER_PROFILE,
  renderCanonicalContent,
  resolveRendererProfile,
} from './deterministic-ooxml-renderer.js';
import { InMemoryRenderObjectStorage } from './in-memory-render-object-storage.js';

function fixture(name: 'document' | 'workbook'): Artifact.CanonicalContentPayload {
  const url = new URL(
    `../../../../tests/fixtures/contracts/canonical-content/${name}-golden.json`,
    import.meta.url,
  );
  const parsed = JSON.parse(readFileSync(url, 'utf8')) as { payload: unknown };
  return parsed.payload as Artifact.CanonicalContentPayload;
}

function hash(payload: Artifact.CanonicalContentPayload) {
  return hashCanonicalContentPayload(payload as unknown as CanonicalContentPayload);
}

describe('IM-05 WI-05 deterministic OOXML renderer', () => {
  it.each([
    ['document', DOCX_RENDERER_PROFILE, 'word/document.xml'],
    ['workbook', XLSX_RENDERER_PROFILE, 'xl/workbook.xml'],
  ] as const)('renders the same %s input to identical OOXML bytes', (name, profile, marker) => {
    const payload = fixture(name);
    const first = renderCanonicalContent({
      payload,
      declaredInputHash: hash(payload),
      profile,
    });
    const second = renderCanonicalContent({
      payload,
      declaredInputHash: hash(payload),
      profile,
    });

    expect(second.bytes).toEqual(first.bytes);
    expect(second.checksum).toEqual(first.checksum);
    expect(first.bytes.subarray(0, 2).toString('ascii')).toBe('PK');
    expect(first.bytes.includes(Buffer.from(marker, 'utf8'))).toBe(true);
  });

  it('rejects content/profile and declared hash substitutions', () => {
    const document = fixture('document');
    expect(() =>
      renderCanonicalContent({
        payload: document,
        declaredInputHash: hash(document),
        profile: XLSX_RENDERER_PROFILE,
      }),
    ).toThrow(RendererInputError);
    const wrongHash = { ...hash(document), digest: 'ff'.repeat(32) };
    expect(() =>
      renderCanonicalContent({
        payload: document,
        declaredInputHash: wrongHash,
        profile: DOCX_RENDERER_PROFILE,
      }),
    ).toThrow(/declared input hash/);
    for (const mismatch of [
      { ...DOCX_RENDERER_PROFILE, outputFormat: 'workbook.xlsx' },
      { ...DOCX_RENDERER_PROFILE, rendererId: 'zhiju.renderer.xlsx.minimal' },
      { ...DOCX_RENDERER_PROFILE, rendererVersion: '2.0.0' },
    ]) {
      expect(() => resolveRendererProfile(mismatch)).toThrow(
        /format, renderer ID, or renderer version/,
      );
    }
  });

  it('keeps local object locators immutable and free of credential-like data', async () => {
    const storage = new InMemoryRenderObjectStorage();
    const bytes = Buffer.from('first');
    const first = await storage.putImmutable({
      locator: 'integration/render/source/document.json',
      bytes,
      mediaType: 'application/json',
    });
    await expect(
      storage.putImmutable({
        locator: first.locator,
        bytes: Buffer.from('different'),
        mediaType: 'application/json',
      }),
    ).rejects.toThrow(/different bytes/);
    await expect(
      storage.putImmutable({
        locator: 'integration/render/presigned-token/output.docx',
        bytes,
        mediaType: 'application/octet-stream',
      }),
    ).rejects.toThrow(/credential-like/);
    await expect(storage.read(first.locator)).resolves.toMatchObject({
      locator: first.locator,
      bytes,
    });
  });
});

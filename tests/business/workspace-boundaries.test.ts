import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  checkManifestData,
  evaluateImport,
  scanSourceText,
} from '../../tools/architecture/check-boundaries.mjs';

describe('UI-SHELL-004 experience boundaries', () => {
  const file = resolve('apps/workspace-web/src/Counterexample.tsx');
  const manifestFields = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ];
  it.each([
    "import { Repository } from '@zhiju/artifact'; const element = <div />;",
    "export { Repository } from '@zhiju/identity-policy';",
    "import type { Receipt } from '@zhiju/contracts';",
    "const load = () => import('@zhiju/task-execution');",
    'const load = () => import(`@zhiju/artifact`);',
    'const load = () => import(name);',
    "const load = () => require('pg');",
    "type Private = import('@zhiju/api/composition').Private;",
    "import P from '../../../modules/artifact/dist/index.js';",
    "import P from '/private/repo/modules/artifact/src/index.js';",
    "import P from '../repositories/customer.js';",
    "import P from '@aws-sdk/client-s3';",
    "import P from 'node:child_process';",
  ])('rejects source counterexample: %s', (source) => {
    expect(scanSourceText(file, source).length).toBeGreaterThan(0);
  });
  it('accepts approved static and dynamic imports without false positives in text', () => {
    expect(
      scanSourceText(
        file,
        "import { Link } from 'react-router'; const load = () => import('./fixtures/adapter.js'); const text = \"import('pg')\";",
      ),
    ).toEqual([]);
  });
  it.each(manifestFields)('checks application manifest %s', (field) => {
    expect(
      checkManifestData(resolve('apps/workspace-web/package.json'), {
        [field]: { '@zhiju/contracts': 'workspace:*' },
      }).length,
    ).toBeGreaterThan(0);
    expect(
      checkManifestData(resolve('apps/workspace-bff/package.json'), { [field]: { pg: '8.23.0' } })
        .length,
    ).toBeGreaterThan(0);
    expect(
      checkManifestData(resolve('apps/workspace-web/package.json'), {
        [field]: { react: '19.3.0' },
      }),
    ).toEqual([]);
  });
  describe.each([
    { application: 'workspace-web', dependency: 'react', version: '19.3.0' },
    { application: 'workspace-bff', dependency: 'fastify', version: '5.12.0' },
  ])('$application manifest targets', ({ application, dependency, version }) => {
    const manifest = resolve(`apps/${application}/package.json`);
    describe.each(manifestFields)('%s', (field) => {
      it.each([
        'npm:pg@8.23.0',
        'workspace:@zhiju/artifact@*',
        'file:../../modules/artifact',
        'link:../../modules/artifact',
        '../../modules/artifact',
        '/private/repo/modules/artifact',
        'https://example.com/private-package.tgz',
        'git+https://example.com/private-package.git',
      ])('rejects an approved name pointing to %s', (target) => {
        const violations = checkManifestData(manifest, { [field]: { [dependency]: target } });
        expect(violations.length).toBeGreaterThan(0);
        expect(violations.join('\n')).toContain(field);
        expect(violations.join('\n')).toContain(target);
      });
      it('accepts the approved exact registry version', () => {
        expect(checkManifestData(manifest, { [field]: { [dependency]: version } })).toEqual([]);
      });
    });
  });
  it.each(manifestFields)('accepts the BFF default catalog in %s', (field) => {
    expect(
      checkManifestData(resolve('apps/workspace-bff/package.json'), {
        [field]: { fastify: 'catalog:' },
      }),
    ).toEqual([]);
  });
  it.each([
    '@zhiju/api',
    'kysely',
    'pg',
    '@anthropic-ai/sdk',
    '@aws-sdk/client-s3',
    'openai',
    '../../../contracts/dist/index.js',
  ])('rejects BFF dependency %s', (specifier) => {
    expect(evaluateImport({ importerKind: 'app:workspace-bff', specifier }).length).toBeGreaterThan(
      0,
    );
  });
  it('accepts approved BFF HTTP/OIDC infrastructure', () => {
    expect(
      evaluateImport({ importerKind: 'app:workspace-bff', specifier: 'openid-client' }),
    ).toEqual([]);
    expect(
      evaluateImport({ importerKind: 'app:workspace-bff', specifier: '@nestjs/common' }),
    ).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  checkManifestData,
  evaluateImport,
  scanSourceText,
} from '../../tools/architecture/check-boundaries.mjs';

describe('UI-SHELL-004 experience boundaries', () => {
  const file = resolve('apps/workspace-web/src/Counterexample.tsx');
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
  it.each(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'])(
    'checks application manifest %s',
    (field) => {
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
    },
  );
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

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sourceRoots = [
  join(repositoryRoot, 'packages', 'shared-kernel', 'src'),
  join(repositoryRoot, 'contracts', 'src'),
  ...readdirSync(join(repositoryRoot, 'modules'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(repositoryRoot, 'modules', entry.name, 'src')),
  ...readdirSync(join(repositoryRoot, 'apps'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(repositoryRoot, 'apps', entry.name, 'src')),
];

const importPattern = /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gu;

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : [];
  });
}

function packageKind(path) {
  const normalized = relative(repositoryRoot, path).split(sep).join('/');
  if (normalized.startsWith('packages/shared-kernel/')) return 'shared-kernel';
  if (normalized.startsWith('contracts/')) return 'contracts';
  if (normalized.startsWith('modules/')) return `module:${normalized.split('/')[1]}`;
  if (normalized.startsWith('apps/')) return `app:${normalized.split('/')[1]}`;
  return 'unknown';
}

export function evaluateImport({ importerKind, specifier }) {
  const violations = [];
  if (specifier.includes('/src/') || specifier.endsWith('/src')) {
    violations.push('imports must use package public exports, never another package src path');
  }
  if (importerKind === 'shared-kernel' && specifier.startsWith('@zhiju/')) {
    violations.push('shared-kernel cannot depend on another Zhiju package');
  }
  if (
    importerKind === 'contracts' &&
    specifier.startsWith('@zhiju/') &&
    specifier !== '@zhiju/shared-kernel'
  ) {
    violations.push('contracts may depend only on shared-kernel');
  }
  if (importerKind.startsWith('module:') && specifier.startsWith('@zhiju/')) {
    const allowed = new Set(['@zhiju/contracts', '@zhiju/shared-kernel']);
    if (!allowed.has(specifier)) {
      violations.push('business modules cannot import another business module');
    }
  }
  if (
    (importerKind === 'shared-kernel' ||
      importerKind === 'contracts' ||
      importerKind.startsWith('module:')) &&
    (specifier.startsWith('@nestjs/') || specifier === 'fastify')
  ) {
    violations.push('NestJS/Fastify are restricted to the composition/transport layer');
  }
  return violations;
}

function scanSourceFile(path) {
  const importerKind = packageKind(path);
  const text = readFileSync(path, 'utf8');
  const violations = [];
  for (const match of text.matchAll(importPattern)) {
    const specifier = match[1];
    if (specifier === undefined) continue;
    for (const reason of evaluateImport({ importerKind, specifier })) {
      violations.push(`${relative(repositoryRoot, path)} imports ${specifier}: ${reason}`);
    }
  }
  return violations;
}

function checkManifest(path) {
  const packageJson = JSON.parse(readFileSync(path, 'utf8'));
  const kind = packageKind(path);
  const dependencies = Object.keys(packageJson.dependencies ?? {});
  return dependencies.flatMap((specifier) =>
    evaluateImport({ importerKind: kind, specifier }).map(
      (reason) => `${relative(repositoryRoot, path)} declares ${specifier}: ${reason}`,
    ),
  );
}

function selfTest() {
  const examples = [
    { importerKind: 'module:task-execution', specifier: '@zhiju/artifact' },
    { importerKind: 'contracts', specifier: '@zhiju/identity-policy' },
    { importerKind: 'shared-kernel', specifier: '@nestjs/common' },
    { importerKind: 'app:api', specifier: '@zhiju/artifact/src/internal' },
  ];
  if (examples.some((example) => evaluateImport(example).length === 0)) {
    throw new Error('architecture policy self-test failed to reject a prohibited dependency');
  }
}

selfTest();
const sourceViolations = sourceRoots
  .filter((path) => statSync(path).isDirectory())
  .flatMap(walk)
  .flatMap(scanSourceFile);
const manifestViolations = [
  join(repositoryRoot, 'packages', 'shared-kernel', 'package.json'),
  join(repositoryRoot, 'contracts', 'package.json'),
  ...readdirSync(join(repositoryRoot, 'modules'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(repositoryRoot, 'modules', entry.name, 'package.json')),
].flatMap(checkManifest);
const violations = [...sourceViolations, ...manifestViolations];

if (violations.length > 0) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`architecture_boundaries=PASS source_roots=${sourceRoots.length}`);
}

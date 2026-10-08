import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sourceRoots = [
  join(repositoryRoot, 'packages', 'shared-kernel', 'src'),
  join(repositoryRoot, 'contracts', 'src'),
  ...readdirSync(join(repositoryRoot, 'modules'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(repositoryRoot, 'modules', entry.name, 'src')),
  ...readdirSync(join(repositoryRoot, 'apps'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(repositoryRoot, 'apps', entry.name)),
];

const experienceLibraries = {
  'app:workspace-web': new Set([
    'react',
    'react-dom',
    'react-router',
    '@tanstack/react-query',
    '@radix-ui/react-dialog',
    '@radix-ui/react-alert-dialog',
    'react-markdown',
    'remark-gfm',
    '@types/react',
    '@types/react-dom',
    'vite',
    '@vitejs/plugin-react',
    'tailwindcss',
    '@tailwindcss/vite',
    'typescript',
    '@types/node',
    'vitest',
    '@testing-library/react',
    '@testing-library/dom',
    '@testing-library/user-event',
    'jsdom',
  ]),
  'app:workspace-bff': new Set([
    '@nestjs/common',
    '@nestjs/core',
    '@nestjs/platform-fastify',
    'fastify',
    'reflect-metadata',
    'rxjs',
    'openid-client',
    '@fastify/cookie',
    'typescript',
    '@types/node',
    'vitest',
  ]),
};

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'dist', 'dist-types'].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : /\.(?:[cm]?ts|tsx)$/u.test(path) ? [path] : [];
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

export function evaluateImport({ importerKind, specifier, importerPath }) {
  const violations = [];
  const libraries = experienceLibraries[importerKind];
  if (libraries) {
    if (specifier.startsWith('.')) {
      if (importerPath && packageKind(resolve(dirname(importerPath), specifier)) !== importerKind) {
        violations.push('Web/BFF relative imports must stay inside their application');
      }
      if (/(?:^|\/)\.{2}\/(?:modules|contracts|packages|apps)(?:\/|$)/u.test(specifier)) {
        violations.push('Web/BFF cannot import private repository paths');
      }
    } else {
      const packageName = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0];
      const safeBffBuiltin =
        importerKind === 'app:workspace-bff' &&
        ['node:crypto', 'node:http', 'node:https', 'node:url'].includes(specifier);
      if (!libraries.has(packageName) && !safeBffBuiltin) {
        violations.push(
          'Web/BFF may use only approved experience dependencies, not business/infrastructure/provider clients',
        );
      }
    }
    if (/(?:^|\/)(?:repositories?|persistence|internal)(?:\/|$)/iu.test(specifier)) {
      violations.push('Web/BFF cannot import repositories or private implementation');
    }
  }
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

export function scanSourceText(path, text) {
  const importerKind = packageKind(path);
  const violations = [];
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const check = (expression) => {
    if (!expression) return;
    if (!ts.isStringLiteralLike(expression)) {
      if (experienceLibraries[importerKind])
        violations.push(
          `${relative(repositoryRoot, path)}: nonliteral module loading is forbidden in Web/BFF`,
        );
      return;
    }
    const specifier = expression.text;
    for (const reason of evaluateImport({ importerKind, specifier, importerPath: path })) {
      violations.push(`${relative(repositoryRoot, path)} imports ${specifier}: ${reason}`);
    }
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) check(node.moduleSpecifier);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference))
      check(node.moduleReference.expression);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      check(node.argument.literal);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    )
      check(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

function scanSourceFile(path) {
  return scanSourceText(path, readFileSync(path, 'utf8'));
}

export function checkManifestData(path, packageJson) {
  const kind = packageKind(path);
  const dependencies = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ].flatMap((field) => Object.keys(packageJson[field] ?? {}));
  return dependencies.flatMap((specifier) =>
    evaluateImport({ importerKind: kind, specifier }).map(
      (reason) => `${relative(repositoryRoot, path)} declares ${specifier}: ${reason}`,
    ),
  );
}

function checkManifest(path) {
  return checkManifestData(path, JSON.parse(readFileSync(path, 'utf8')));
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  selfTest();
  const sourceViolations = sourceRoots
    .filter((path) => existsSync(path) && statSync(path).isDirectory())
    .flatMap(walk)
    .flatMap(scanSourceFile);
  const manifestViolations = [
    join(repositoryRoot, 'packages', 'shared-kernel', 'package.json'),
    join(repositoryRoot, 'contracts', 'package.json'),
    ...readdirSync(join(repositoryRoot, 'modules'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(repositoryRoot, 'modules', entry.name, 'package.json')),
    ...readdirSync(join(repositoryRoot, 'apps'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(repositoryRoot, 'apps', entry.name, 'package.json')),
  ].flatMap(checkManifest);
  const violations = [...sourceViolations, ...manifestViolations];

  if (violations.length > 0) {
    console.error(violations.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`architecture_boundaries=PASS source_roots=${sourceRoots.length}`);
  }
}

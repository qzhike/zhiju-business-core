import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// PG-020 / Technology-Baseline §3: migrations run only from the deployment job
// (tools/persistence). Application startup, modules and Runtime Roles must
// never reference Flyway or the migration tooling, so no code path can start
// migrating at boot. The layout test enforces the migrations/ directory
// contract from migrations/README.md: allowed directories, version ranges,
// file types and `Vdddd__snake_case.sql` naming.

const repoRoot = join(import.meta.dirname, '../..');
const appSourceRoots = ['apps', 'modules', 'packages'].map((dir) => join(repoRoot, dir));

function walk(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' || entry.name === 'dist' ? [] : walk(path);
    }
    return [path];
  });
}

function tsFiles(dir: string): string[] {
  return walk(dir).filter((file) => file.endsWith('.ts'));
}

function appSourceFiles(): string[] {
  return appSourceRoots.flatMap((root) =>
    tsFiles(root).filter((file) => file.includes('/src/') && !file.endsWith('.d.ts')),
  );
}

const FORBIDDEN_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bflyway\b/i, reason: 'Flyway usage' },
  { pattern: /tools\/persistence/, reason: 'persistence gate harness import' },
  { pattern: /migration[s]?\s*\(/i, reason: 'migration execution call' },
  // Kysely's real migration entry points: the Migrator/MigrationProvider API
  // and its migrateToLatest/migrateTo/migrateUp/migrateDown commands. Kysely
  // is frozen as a SQL builder only and must not own migrations.
  { pattern: /\bMigrator\b/, reason: 'Kysely Migrator usage' },
  { pattern: /\bMigrationProvider\b/, reason: 'Kysely MigrationProvider usage' },
  { pattern: /\bmigrateToLatest\b/, reason: 'Kysely migrateToLatest call' },
  { pattern: /\bmigrateTo\s*\(/, reason: 'Kysely migrateTo call' },
  { pattern: /\bmigrateUp\b/, reason: 'Kysely migrateUp call' },
  { pattern: /\bmigrateDown\b/, reason: 'Kysely migrateDown call' },
];

// migrations/README.md contract: directory -> allowed version range.
const MIGRATION_VERSION_RANGES: Record<string, [number, number]> = {
  bootstrap: [0, 999],
  identity_policy: [1000, 1999],
  enterprise_project: [2000, 2999],
  task_execution: [3000, 3999],
  artifact: [4000, 4999],
  quality_governance: [5000, 5999],
  release_publication: [6000, 6999],
  integration_gateway: [7000, 7999],
};

// Issue #231 reserves these exact forward versions for TaskExecution; IG cannot reuse them.
const TASK_EXECUTION_RECOVERY_VERSIONS = new Set([7005, 7006, 7007]);
// Issue #235 reserves exactly these two forward versions for formal completion.
const FORMAL_COMPLETION_ALLOCATIONS = new Map([
  [7008, 'artifact'],
  [7009, 'task_execution'],
]);

// Issue #239 explicitly reserves these forward versions for the two owning schemas.
const DELIVERY_COMPLETION_ALLOCATIONS = new Map([
  [7011, 'task_execution'],
  [7012, 'enterprise_project'],
]);

// Issue #244 explicitly reserves this forward version for the cancellation slice.
const RUN_CANCELLATION_ALLOCATIONS = new Map([[7013, 'task_execution']]);

const MIGRATION_NAME_PATTERN = /^V(\d{4})__[a-z][a-z0-9_]*\.sql$/;
const MIGRATION_ROOT_FILES = new Set(['README.md']);

/**
 * Validate one migrations/ entry. Returns violation messages; empty means valid.
 * Pure function so negative cases can be regression-tested without touching
 * the real directory.
 */
export function validateMigrationEntry(directory: string, fileName: string): string[] {
  const violations: string[] = [];
  if (!(directory in MIGRATION_VERSION_RANGES)) {
    violations.push(`unknown migration directory '${directory}'`);
    return violations;
  }
  if (fileName === '.gitkeep') {
    return violations;
  }
  const match = MIGRATION_NAME_PATTERN.exec(fileName);
  if (!match) {
    violations.push(`'${directory}/${fileName}': expected Vdddd__snake_case.sql or .gitkeep`);
    return violations;
  }
  const version = Number(match[1]);
  const range = MIGRATION_VERSION_RANGES[directory] ?? [0, 0];
  const [min, max] = range;
  const recoveryAllocation = TASK_EXECUTION_RECOVERY_VERSIONS.has(version);
  const cancellationOwner = RUN_CANCELLATION_ALLOCATIONS.get(version);
  if (cancellationOwner) {
    return directory === cancellationOwner
      ? []
      : [
          `'${directory}/${fileName}': version ${version} reserved for ${cancellationOwner} run cancellation`,
        ];
  }
  const deliveryOwner = DELIVERY_COMPLETION_ALLOCATIONS.get(version);
  if (deliveryOwner) {
    return directory === deliveryOwner
      ? []
      : [
          `'${directory}/${fileName}': version ${version} reserved for ${deliveryOwner} delivery completion`,
        ];
  }
  const completionOwner = FORMAL_COMPLETION_ALLOCATIONS.get(version);
  if (completionOwner) {
    return directory === completionOwner
      ? []
      : [
          `'${directory}/${fileName}': version ${version} reserved for ${completionOwner} formal completion`,
        ];
  }
  if (directory === 'integration_gateway' && recoveryAllocation) {
    violations.push(
      `'${directory}/${fileName}': version ${version} reserved for task_execution recovery`,
    );
  } else if (
    (version < min || version > max) &&
    !(directory === 'task_execution' && recoveryAllocation)
  ) {
    violations.push(
      `'${directory}/${fileName}': version ${version} outside ${directory} range ${min}-${max}`,
    );
  }
  return violations;
}

function migrationViolations(): string[] {
  const violations: string[] = [];
  const migrationsRoot = join(repoRoot, 'migrations');
  for (const entry of readdirSync(migrationsRoot, { withFileTypes: true })) {
    const path = join(migrationsRoot, entry.name);
    if (!entry.isDirectory()) {
      if (!MIGRATION_ROOT_FILES.has(entry.name)) {
        violations.push(`unexpected file in migrations/: ${entry.name}`);
      }
      continue;
    }
    for (const file of walk(path)) {
      violations.push(...validateMigrationEntry(entry.name, file.slice(path.length + 1)));
    }
  }
  return violations;
}

describe('migration execution is isolated from application code', () => {
  it('has application/module sources to check', () => {
    expect(appSourceFiles().length).toBeGreaterThan(0);
  });

  it('never references Flyway or the migration harness', () => {
    const violations: string[] = [];
    for (const file of appSourceFiles()) {
      const content = readFileSync(file, 'utf8');
      for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
        if (pattern.test(content)) {
          violations.push(`${file}: ${reason}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('flags the Kysely migration API as a violation (negative fixture)', () => {
    // Minimal runtime-migration code that must fail closed: none of the
    // generic patterns below catch it, the dedicated Kysely patterns must.
    const kyselyViolation = `import { Migrator } from 'kysely';
const migrator = new Migrator({ provider });
await migrator.migrateToLatest();`;
    const matched = FORBIDDEN_PATTERNS.filter(({ pattern }) => pattern.test(kyselyViolation));
    expect(matched.map(({ reason }) => reason)).toEqual(
      expect.arrayContaining(['Kysely Migrator usage', 'Kysely migrateToLatest call']),
    );

    const kyselyDowngrade =
      'await migrator.migrateDown();\nawait migrator.migrateTo(2);\nawait migrator.migrateUp();';
    const downgradeMatched = FORBIDDEN_PATTERNS.filter(({ pattern }) =>
      pattern.test(kyselyDowngrade),
    );
    expect(downgradeMatched.map(({ reason }) => reason)).toEqual(
      expect.arrayContaining([
        'Kysely migrateDown call',
        'Kysely migrateTo call',
        'Kysely migrateUp call',
      ]),
    );

    // Plain Kysely query-builder usage stays allowed.
    const legitimateKysely = "import { Kysely, PostgresDialect } from 'kysely';";
    const falsePositives = FORBIDDEN_PATTERNS.filter(({ pattern }) =>
      pattern.test(legitimateKysely),
    );
    expect(falsePositives).toEqual([]);
  });

  it('keeps migration SQL outside of application source trees', () => {
    const offenders: string[] = [];
    for (const root of appSourceRoots) {
      for (const file of tsFiles(root)) {
        if (!file.includes('/src/')) {
          continue;
        }
        const content = readFileSync(file, 'utf8');
        if (/\bCREATE\s+(SCHEMA|TABLE|EXTENSION)\b/i.test(content)) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('migration layout follows the frozen directory/version contract', () => {
  it('enumerates real migration files, not an empty .ts-only list', () => {
    expect(statSync(join(repoRoot, 'migrations')).isDirectory()).toBe(true);
    const sqlFiles = walk(join(repoRoot, 'migrations')).filter((file) => file.endsWith('.sql'));
    expect(sqlFiles.length).toBeGreaterThan(0);
  });

  it('has no violations in the shipped migrations/ tree', () => {
    expect(migrationViolations()).toEqual([]);
  });

  it('rejects each class of layout violation (negative regressions)', () => {
    expect(validateMigrationEntry('bootstrap', 'V0001__platform_bootstrap.sql')).toEqual([]);
    expect(validateMigrationEntry('bootstrap', '.gitkeep')).toEqual([]);
    for (const version of [7005, 7006, 7007]) {
      expect(validateMigrationEntry('task_execution', `V${version}__recovery.sql`)).toEqual([]);
      expect(validateMigrationEntry('integration_gateway', `V${version}__recovery.sql`)).toEqual([
        `'integration_gateway/V${version}__recovery.sql': version ${version} reserved for task_execution recovery`,
      ]);
    }
    expect(validateMigrationEntry('task_execution', 'V7008__unapproved.sql')).toEqual([
      "'task_execution/V7008__unapproved.sql': version 7008 reserved for artifact formal completion",
    ]);
    for (const [version, owner] of FORMAL_COMPLETION_ALLOCATIONS) {
      expect(validateMigrationEntry(owner, `V${version}__completion.sql`)).toEqual([]);
      expect(validateMigrationEntry('integration_gateway', `V${version}__completion.sql`)).toEqual([
        `'integration_gateway/V${version}__completion.sql': version ${version} reserved for ${owner} formal completion`,
      ]);
    }
    for (const [version, owner] of DELIVERY_COMPLETION_ALLOCATIONS) {
      expect(validateMigrationEntry(owner, `V${version}__delivery.sql`)).toEqual([]);
      for (const directory of Object.keys(MIGRATION_VERSION_RANGES).filter(
        (value) => value !== owner,
      ))
        expect(validateMigrationEntry(directory, `V${version}__delivery.sql`)).toEqual([
          `'${directory}/V${version}__delivery.sql': version ${version} reserved for ${owner} delivery completion`,
        ]);
    }
    expect(validateMigrationEntry('integration_gateway', 'V7010__next.sql')).toEqual([]);
    for (const [version, owner] of RUN_CANCELLATION_ALLOCATIONS) {
      expect(validateMigrationEntry(owner, `V${version}__cancellation.sql`)).toEqual([]);
      for (const directory of Object.keys(MIGRATION_VERSION_RANGES).filter(
        (value) => value !== owner,
      ))
        expect(validateMigrationEntry(directory, `V${version}__cancellation.sql`)).toEqual([
          `'${directory}/V${version}__cancellation.sql': version ${version} reserved for ${owner} run cancellation`,
        ]);
    }
    expect(validateMigrationEntry('identity_policy', '.gitkeep')).toEqual([]);

    expect(validateMigrationEntry('not_a_schema', 'V8001__x.sql')).toEqual([
      "unknown migration directory 'not_a_schema'",
    ]);
    expect(validateMigrationEntry('bootstrap', 'schema.sql')).toEqual([
      "'bootstrap/schema.sql': expected Vdddd__snake_case.sql or .gitkeep",
    ]);
    expect(validateMigrationEntry('bootstrap', 'V1__too_short.sql')).toEqual([
      "'bootstrap/V1__too_short.sql': expected Vdddd__snake_case.sql or .gitkeep",
    ]);
    expect(validateMigrationEntry('bootstrap', 'V0002__BadCase.sql')).toEqual([
      "'bootstrap/V0002__BadCase.sql': expected Vdddd__snake_case.sql or .gitkeep",
    ]);
    expect(validateMigrationEntry('identity_policy', 'V0002__wrong_range.sql')).toEqual([
      "'identity_policy/V0002__wrong_range.sql': version 2 outside identity_policy range 1000-1999",
    ]);
    expect(validateMigrationEntry('integration_gateway', 'V8000__wrong_range.sql')).toEqual([
      "'integration_gateway/V8000__wrong_range.sql': version 8000 outside integration_gateway range 7000-7999",
    ]);
  });
});

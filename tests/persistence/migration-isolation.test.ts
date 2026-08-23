import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// PG-020 / Technology-Baseline §3: migrations run only from the deployment job
// (tools/persistence). Application startup, modules and Runtime Roles must
// never reference Flyway or the migration tooling, so no code path can start
// migrating at boot.

const repoRoot = join(import.meta.dirname, '../..');
const appSourceRoots = ['apps', 'modules', 'packages'].map((dir) => join(repoRoot, dir));

function tsFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' || entry.name === 'dist' ? [] : tsFiles(path);
    }
    return entry.name.endsWith('.ts') ? [path] : [];
  });
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
];

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

  it('only ships migrations under migrations/ with the agreed naming', () => {
    expect(statSync(join(repoRoot, 'migrations')).isDirectory()).toBe(true);
    for (const file of tsFiles(join(repoRoot, 'migrations'))) {
      expect(file.endsWith('.sql') || file.endsWith('.gitkeep')).toBe(true);
      if (file.endsWith('.sql')) {
        expect(/V\d{4}__[a-z0-9_]+\.sql$/.exec(file)).not.toBeNull();
      }
    }
  });
});

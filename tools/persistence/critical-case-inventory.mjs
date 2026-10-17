import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { URL } from 'node:url';

// This reviewed expectation is independent of the current Vitest collection.
const criticalCases = JSON.parse(
  readFileSync(new URL('./critical-cases.json', import.meta.url), 'utf8'),
);

export function assertCriticalCaseExecution(root, modules) {
  if (
    !criticalCases ||
    typeof criticalCases !== 'object' ||
    Array.isArray(criticalCases) ||
    Object.keys(criticalCases).length === 0
  )
    throw new Error('invalid empty critical case inventory');
  const actual = new Map();
  for (const module of modules) {
    const file = relative(root, module.moduleId).replaceAll('\\', '/');
    const tests = actual.get(file) ?? [];
    tests.push(...module.children.allTests());
    actual.set(file, tests);
  }

  const failures = [];
  let count = 0;
  for (const [file, names] of Object.entries(criticalCases)) {
    if (
      !/^tests\/persistence\/[a-z0-9-]+\.test\.ts$/.test(file) ||
      !Array.isArray(names) ||
      names.length === 0 ||
      names.some((name) => typeof name !== 'string' || !name) ||
      new Set(names).size !== names.length
    ) {
      throw new Error(`invalid critical case inventory: ${file}`);
    }
    count += names.length;
    const tests = actual.get(file);
    if (!tests) {
      failures.push(`missing file: ${file}`);
      continue;
    }
    const byName = new Map();
    for (const test of tests) {
      const matches = byName.get(test.name) ?? [];
      matches.push(test);
      byName.set(test.name, matches);
    }
    for (const name of names) {
      const matches = byName.get(name) ?? [];
      if (matches.length !== 1)
        failures.push(`expected exactly one case, found ${matches.length}: ${file} > ${name}`);
      for (const test of matches) {
        const state = test.result().state;
        if (state !== 'passed') failures.push(`case did not pass (${state}): ${file} > ${name}`);
      }
    }
    for (const name of byName.keys())
      if (!names.includes(name)) failures.push(`unexpected case: ${file} > ${name}`);
  }
  if (failures.length)
    throw new Error(`critical persistence case inventory failed:\n${failures.join('\n')}`);
  process.stdout.write(
    `[persistence-test] critical inventory passed: files=${Object.keys(criticalCases).length}; tests=${count}\n`,
  );
}

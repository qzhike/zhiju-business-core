// AUTO-GENERATED-MARKER: this file's expected compile failures live behind
// `@ts-expect-error` annotations; the file is compiled as part of `tsc -b`
// via the workspace's tsconfig and never executed. Run `pnpm typecheck` to
// verify that:
//   - positive fixtures compile without errors;
//   - every `@ts-expect-error` annotation actually fires.
//
// The generator is exercised here through the same `renderDependentRequiredUnion`
// shape that `common.scopeRef` uses. Because we do not want to ship a
// synthetic schema alongside every fixture, we reproduce the generated
// TypeScript text inline and let TypeScript prove the discriminators cover
// every legal Ajv-accepted shape.
//
// Cases covered:
//   1. Chain        — { A: [B], B: [C] }
//                     accepted: {}, {A,B,C}, {B,C}; rejected: {A}, {A,B}, {A,C}
//   2. Independent  — { A: [B], C: [D] }
//                     accepted: {}, {A,B}, {C,D}, {A,B,C,D};
//                     rejected: {A}, {C}, {A,D}, {C,B}

// UuidAlias is referenced by every discriminated union below; eslint would
// normally flag it as unused because the file is `.test-d.ts` and is never
// emitted, but we keep it as a private type to mirror how the generator
// emits `readonly T` references.
type UuidAlias = string;

// -----------------------------------------------------------------------------
// Case 1: chain. Reproduces the discriminated union the generator emits for
// `dependentRequired: { A: [B], B: [C] }` over properties { A, B, C }.
// -----------------------------------------------------------------------------

type Chain =
  | { readonly A?: undefined; readonly B?: undefined; readonly C?: undefined }
  | { readonly A: UuidAlias; readonly B: UuidAlias; readonly C: UuidAlias }
  | { readonly A?: undefined; readonly B: UuidAlias; readonly C: UuidAlias };

const chainAccepted1: Chain = {};
const chainAccepted2: Chain = { A: 'x', B: 'x', C: 'x' };
const chainAccepted3: Chain = { B: 'x', C: 'x' };

void chainAccepted1;
void chainAccepted2;
void chainAccepted3;

// Negative — `{A}` alone: A present but B missing.
{
  // @ts-expect-error — A requires B (chain A -> B -> C).
  const bad: Chain = { A: 'x' };
  void bad;
}

// Negative — `{A, B}` without C.
{
  // @ts-expect-error — B requires C (chain A -> B -> C).
  const bad: Chain = { A: 'x', B: 'x' };
  void bad;
}

// Negative — `{A, C}` without B.
{
  // @ts-expect-error — A requires B (chain A -> B -> C).
  const bad: Chain = { A: 'x', C: 'x' };
  void bad;
}

// -----------------------------------------------------------------------------
// Case 2: independent triggers. Reproduces the discriminated union the
// generator emits for `dependentRequired: { A: [B], C: [D] }` over properties
// { A, B, C, D }.
// -----------------------------------------------------------------------------

type Independent =
  | {
      readonly A?: undefined;
      readonly B?: undefined;
      readonly C?: undefined;
      readonly D?: undefined;
    }
  | { readonly A: UuidAlias; readonly B: UuidAlias; readonly C?: UuidAlias; readonly D?: UuidAlias }
  | {
      readonly A?: UuidAlias;
      readonly B?: UuidAlias;
      readonly C: UuidAlias;
      readonly D: UuidAlias;
    };

const indepAccepted1: Independent = {};
const indepAccepted2: Independent = { A: 'x', B: 'x' };
const indepAccepted3: Independent = { C: 'x', D: 'x' };
const indepAccepted4: Independent = { A: 'x', B: 'x', C: 'x', D: 'x' };

void indepAccepted1;
void indepAccepted2;
void indepAccepted3;
void indepAccepted4;

// Negative — `{A}` alone (A requires B).
{
  // @ts-expect-error — A requires B (independent trigger A -> B).
  const bad: Independent = { A: 'x' };
  void bad;
}

// Negative — `{C}` alone (C requires D).
{
  // @ts-expect-error — C requires D (independent trigger C -> D).
  const bad: Independent = { C: 'x' };
  void bad;
}

// Negative — `{A, D}` (A's required sibling B is missing).
{
  // @ts-expect-error — A requires B even when D is present.
  const bad: Independent = { A: 'x', D: 'x' };
  void bad;
}

// Negative — `{C, B}` (C's required sibling D is missing).
{
  // @ts-expect-error — C requires D even when B is present.
  const bad: Independent = { C: 'x', B: 'x' };
  void bad;
}

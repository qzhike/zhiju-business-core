// Composition entry points of the API layer. The transport (or a future
// Workspace BFF) uses these adapters to turn authenticated requests into the
// trusted contexts the owning modules consume; business modules never import
// each other directly.

export {
  ContextSourceSliceEntryError,
  RESOLVE_POLICY_COMMAND,
  RESOLVE_POLICY_PURPOSE,
  createContextSourceSliceEntry,
} from './context-source-slice-entry.js';
export type {
  ContextSourceSliceEntry,
  ContextSourceSliceEntryConfig,
  ContextSourceSliceSession,
} from './context-source-slice-entry.js';

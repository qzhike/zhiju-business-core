# Workspace UI primitives

The upstream components are adapted from the MIT-licensed [shadcn/ui new-york-v4 registry](https://ui.shadcn.com/r/styles/new-york-v4/button.json). The upstream license is preserved in [LICENSE.md](LICENSE.md). Stepper is a local component, not an official shadcn/ui component; it uses the same theme tokens without adding a dependency.

Use the local components from pages with relative `.js` imports. This application uses manual installation; `components.json` describes the source directories and theme. Review any CLI-generated imports and dependency changes before applying them. Do not run `init` over the application or overwrite local components during an upstream update.

Local adaptations preserve the workspace's compact Chinese layout and existing behavior:

- Blue semantic tokens live in `../../styles/theme.css`; muted text uses `--muted-foreground`.
- Buttons default to `outline`. Primary actions explicitly use `variant="default"`. Button height can grow for wrapped labels. Native button type and ref semantics are preserved.
- NativeSelect retains the browser arrow and a single native select node so labels, refs, form values and layout remain intact.
- Label preserves native wrapping-label behavior. Checkbox and file input semantics remain native.
- Card supports `asChild` to preserve section/article semantics. Table preserves the existing scroll container rather than adding a second one.
- Dialog and AlertDialog retain the pinned individual Radix packages. Content owns the portal/overlay; explicit close and confirm actions remain with the caller. No implicit confirmation, extra close action, or animation is added.
- Alert preserves the caller's live-region role; ordinary notices are not automatically announced as errors.
- Stepper renders a read-only ordered list with explicit caller-owned states and current-step identity. It never infers completion from the active index or adds navigation. Status text remains visible at narrow widths; icons and connectors are decorative.
- Business state, request retries, exact versions and authorization belong to the existing page/model layers.

Only add components used by a current page. Review upstream source changes alongside these adaptations, pin new dependency versions, and retain the Experience dependency boundary checks.

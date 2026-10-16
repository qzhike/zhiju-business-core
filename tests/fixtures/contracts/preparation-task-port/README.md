# Preparation TE mapping fixtures

These complete, fixed UUIDv7 values and result objects are synthetic mapping examples. The native preparation TE operations are currently unregistered. Passing these fixtures does not establish that a native TE Task, Receipt, analysis request, Runner invocation or report exists.

TASK results use the approved `definitionSnapshotRef` result field; ANALYSIS_REQUEST payloads use `taskDefinitionSnapshotRef`. The source consumer retains the owning exact definition hash and actual positive aggregate version. Receipt examples demonstrate Project Scope and exact replay comparisons, without assuming that a Receipt object ID equals its command ID or adding an attestation payload.

The real owning journey separately injects a TE test port and verifies zero create, request and read calls while the actual operation registry lacks these selectors. Actual future registered results must pass their owning result schema and the existing original-command readback before EP can persist success.

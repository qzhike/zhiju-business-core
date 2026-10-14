import initial from './analysis-report.json';
import followup from './analysis-report.followup.json';
import startup from './startup-review.json';
import narrative from './analysis-report.md?raw';
import followupNarrative from './analysis-report.followup.md?raw';
import type { FixtureExecution, ReportView, WorkspaceData } from '../model.js';

const reports: ReportView[] = [initial, followup].map((report, index) => ({
  projectId: 'DEMO-PROJECT-01',
  reportId: index === 0 ? startup.reportKey : startup.followup.reportKey,
  version: index + 1,
  title: report.title,
  summary: report.summary,
  narrative: index === 0 ? narrative : followupNarrative,
  limitations: report.limitations,
  attention: report.attentionItems,
  information: index === 0 ? startup.information : startup.followup.information,
  files: startup.files,
}));
const key = 'zhiju-workspace-development-fixture-v1';

interface DemoState {
  selected: Record<string, string[]>;
  executions: FixtureExecution[];
}

function read(): DemoState {
  const raw = sessionStorage.getItem(key);
  if (raw === null) return { selected: {}, executions: [] };
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== 'object' || !('selected' in data) || !('executions' in data)) {
    throw new Error('UI_FIXTURE_STATE_INVALID');
  }
  // Reconstruct from validated fields rather than treating stored data as authoritative.
  const state: DemoState = { selected: {}, executions: [] };
  const stored = data;
  if (!stored.selected || typeof stored.selected !== 'object' || Array.isArray(stored.selected))
    throw new Error('UI_FIXTURE_STATE_INVALID');
  for (const report of reports) {
    const ids: unknown = (stored.selected as Record<string, unknown>)[report.reportId];
    if (ids !== undefined) {
      if (!validSelection(report.reportId, ids)) throw new Error('UI_FIXTURE_STATE_INVALID');
      state.selected[report.reportId] = ids;
    }
  }
  if (!Array.isArray(stored.executions) || stored.executions.length > 100)
    throw new Error('UI_FIXTURE_STATE_INVALID');
  for (const candidate of stored.executions as unknown[]) {
    if (!candidate || typeof candidate !== 'object') throw new Error('UI_FIXTURE_STATE_INVALID');
    const item = candidate as Record<string, unknown>;
    if (
      item.classification !== 'DEVELOPMENT_FIXTURE_ONLY' ||
      typeof item.requestId !== 'string' ||
      !/^DEMO-REQUEST-[a-f0-9-]{36}$/u.test(item.requestId) ||
      item.projectId !== 'DEMO-PROJECT-01' ||
      typeof item.reportId !== 'string' ||
      reports.find((r) => r.reportId === item.reportId)?.version !== item.version ||
      JSON.stringify(item.informationRefs) !==
        JSON.stringify(
          reports
            .find((r) => r.reportId === item.reportId)
            ?.information.map((info) => info.candidateRef),
        ) ||
      !validSelection(item.reportId, item.fileIds) ||
      !item.fileIds.length ||
      typeof item.createdAt !== 'number' ||
      !Number.isFinite(item.createdAt)
    )
      throw new Error('UI_FIXTURE_STATE_INVALID');
    state.executions.push({
      classification: 'DEVELOPMENT_FIXTURE_ONLY',
      requestId: item.requestId,
      projectId: 'DEMO-PROJECT-01',
      reportId: item.reportId,
      version: item.version as number,
      informationRefs: item.informationRefs as string[],
      fileIds: item.fileIds,
      createdAt: item.createdAt,
    });
  }
  return state;
}

function validSelection(reportId: string, ids: unknown): ids is string[] {
  const report = reports.find((r) => r.reportId === reportId);
  return (
    !!report &&
    Array.isArray(ids) &&
    new Set(ids).size === ids.length &&
    ids.every(
      (id: unknown) =>
        typeof id === 'string' && report.files.some((f) => f.id === id && f.selectable),
    )
  );
}

function alreadyIncluded(state: DemoState, ids: string[]): boolean {
  return state.executions.some((request) => request.fileIds.some((id) => ids.includes(id)));
}

function write(state: DemoState) {
  sessionStorage.setItem(key, JSON.stringify(state));
}

export function loadFixture(): WorkspaceData {
  read();
  return {
    classification: 'DEVELOPMENT_FIXTURE_ONLY',
    reports,
    selected: (reportId) => read().selected[reportId] ?? [],
    saveSelection: (reportId, ids) => {
      if (!validSelection(reportId, ids)) throw new Error('UI_FIXTURE_STATE_INVALID');
      const state = read();
      if (alreadyIncluded(state, ids)) throw new Error('UI_SCOPE_ALREADY_INCLUDED');
      state.selected[reportId] = ids;
      write(state);
    },
    confirm: (reportId, ids, intentId) => {
      const report = reports.find((r) => r.reportId === reportId);
      if (!report || !validSelection(reportId, ids) || !ids.length)
        throw new Error('UI_FIXTURE_STATE_INVALID');
      const state = read();
      const requestId = `DEMO-REQUEST-${intentId}`;
      const existing = state.executions.find((item) => item.requestId === requestId);
      if (existing) {
        if (
          existing.reportId !== reportId ||
          JSON.stringify(existing.informationRefs) !==
            JSON.stringify(report.information.map((info) => info.candidateRef)) ||
          JSON.stringify(existing.fileIds) !== JSON.stringify(ids)
        )
          throw new Error('UI_SCOPE_INTENT_MISMATCH');
        return existing;
      }
      if (alreadyIncluded(state, ids)) throw new Error('UI_SCOPE_ALREADY_INCLUDED');
      const item: FixtureExecution = {
        classification: 'DEVELOPMENT_FIXTURE_ONLY',
        requestId,
        projectId: report.projectId,
        reportId,
        version: report.version,
        informationRefs: report.information.map((info) => info.candidateRef),
        fileIds: [...ids],
        createdAt: Date.now(),
      };
      state.executions.push(item);
      state.selected[reportId] = [];
      write(state);
      return item;
    },
    execution: (requestId) => read().executions.find((item) => item.requestId === requestId),
    executions: () => read().executions,
  };
}

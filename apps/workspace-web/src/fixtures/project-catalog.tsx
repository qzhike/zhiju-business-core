// DEVELOPMENT_U1_ADAPTER_ONLY / DEVELOPMENT_U2_ADAPTER_ONLY: the shared project
// document catalog reads only the isolated U1/U2 rehearsal adapters. It is
// presentation state; originals stay read-only and no file content is fetched.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { inputEntryLabels, type InputBatch } from '../intake/model.js';
import { planActionLabels, planLevelLabels, type PlanFile, type PlanView } from '../plan/model.js';
import { fileVersionScope, type MvpStageId } from '../mvp/review-model.js';
import { u1Project } from './u1-data.js';
import { useU1 } from './u1.js';
import { emptySession, planStageFiles, sessionKey, useU2, type StageSession } from './u2.js';
import { u2RevisionBytes, u2VersionLabel } from './u2-data.js';
import './project-catalog.css';
import './project-file-browser.css';

const projectId = u1Project.id;
const base = `/projects/${projectId}`;

type CatalogView = 'ORIGINALS' | 'REVISED';
type OriginalFilter = 'ALL' | 'ISSUES' | 'CONTAINER';
type RevisedFilter = 'ALL' | 'CANDIDATE' | 'FINALIZED';
type RevisionState = 'CANDIDATE' | 'FINALIZED' | 'HISTORY';
type SortField = 'NAME' | 'MODIFIED';

interface SortState {
  field: SortField;
  direction: 'ASC' | 'DESC';
}

interface FileMetadata {
  modifiedAt: string;
  modifiedBy: string;
  detail: string;
  bytes?: number | undefined;
}

interface CatalogState {
  view: CatalogView;
  explicit: boolean;
  search: Record<CatalogView, string>;
  filter: Record<CatalogView, OriginalFilter | RevisedFilter>;
  selected: Record<CatalogView, string | undefined>;
  scroll: Record<CatalogView, number>;
  sort: Record<CatalogView, SortState>;
  collapsed: Record<CatalogView, string[]>;
}

interface CatalogApi extends CatalogState {
  choose: (view: CatalogView) => void;
  setSearch: (view: CatalogView, value: string) => void;
  setFilter: (view: CatalogView, value: OriginalFilter | RevisedFilter) => void;
  clear: (view: CatalogView) => void;
  select: (view: CatalogView, key: string) => void;
  rememberScroll: (view: CatalogView, top: number) => void;
  autoReview: (fileId: string) => void;
  setSort: (view: CatalogView, sort: SortState) => void;
  toggleExpanded: (view: CatalogView, key: string) => void;
}

const CatalogContext = createContext<CatalogApi | null>(null);

const initialState: CatalogState = {
  view: 'ORIGINALS',
  explicit: false,
  search: { ORIGINALS: '', REVISED: '' },
  filter: { ORIGINALS: 'ALL', REVISED: 'ALL' },
  selected: { ORIGINALS: undefined, REVISED: undefined },
  scroll: { ORIGINALS: 0, REVISED: 0 },
  sort: {
    ORIGINALS: { field: 'NAME', direction: 'ASC' },
    REVISED: { field: 'NAME', direction: 'ASC' },
  },
  collapsed: { ORIGINALS: [], REVISED: [] },
};

export function FixtureCatalogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CatalogState>(initialState);
  const value: CatalogApi = {
    ...state,
    choose: (view) => {
      setState((current) => ({ ...current, view, explicit: true }));
    },
    setSearch: (view, text) => {
      setState((current) => ({ ...current, search: { ...current.search, [view]: text } }));
    },
    setFilter: (view, filter) => {
      setState((current) => ({ ...current, filter: { ...current.filter, [view]: filter } }));
    },
    clear: (view) => {
      setState((current) => ({
        ...current,
        search: { ...current.search, [view]: '' },
        filter: {
          ...current.filter,
          [view]: view === 'REVISED' ? ('ALL' as RevisedFilter) : ('ALL' as OriginalFilter),
        },
      }));
    },
    select: (view, key) => {
      setState((current) => ({ ...current, selected: { ...current.selected, [view]: key } }));
    },
    rememberScroll: (view, top) => {
      setState((current) => ({ ...current, scroll: { ...current.scroll, [view]: top } }));
    },
    autoReview: (fileId) => {
      setState((current) => ({
        ...current,
        view: 'REVISED',
        selected: { ...current.selected, REVISED: fileId },
      }));
    },
    setSort: (view, sort) => {
      setState((current) => ({ ...current, sort: { ...current.sort, [view]: sort } }));
    },
    toggleExpanded: (view, key) => {
      setState((current) => ({
        ...current,
        collapsed: {
          ...current.collapsed,
          [view]: current.collapsed[view].includes(key)
            ? current.collapsed[view].filter((entry) => entry !== key)
            : [...current.collapsed[view], key],
        },
      }));
    },
  };
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

function useCatalog(): CatalogApi {
  const value = useContext(CatalogContext);
  if (!value) throw new Error('DEVELOPMENT_CATALOG_ADAPTER_ONLY');
  return value;
}

interface OriginalRow {
  key: string;
  entryId: string;
  batchId: string;
  batchLabel: string;
  zipName: string;
  name: string;
  path: string;
  format: string;
  reading: string;
  container: boolean;
  member: boolean;
  damaged: boolean;
  retained: boolean;
  metadata: FileMetadata;
  uploaded: string;
}

interface RevisionVersion {
  versionId: string;
  label: string;
  state: RevisionState;
  stateLabel: string;
  roundId: string;
  planLabel: string;
  href: string;
  planIndex: number;
  metadata: FileMetadata;
  opinion?: string | undefined;
  finalization?: string | undefined;
}

interface RevisedRow {
  fileId: string;
  title: string;
  level: PlanFile['level'];
  levelLabel: string;
  action: PlanFile['action'];
  actionLabel: string;
  newFile: boolean;
  versions: RevisionVersion[];
  latest: RevisionVersion;
  statusLabel: string;
}

interface CatalogData {
  originals: OriginalRow[];
  batches: { id: string; label: string; zipName: string; rows: OriginalRow[] }[];
  revised: RevisedRow[];
  documentCount: number;
  containerCount: number;
  versionCount: number;
  finalizationCount: number;
  planFile: (fileId: string) => PlanFile | undefined;
  revisedFileIds: ReadonlySet<string>;
}

const levelOrder: readonly PlanFile['level'][] = ['MANUAL', 'PROCEDURE', 'RULE', 'RECORD'];

function stageOfLevel(level: PlanFile['level']): MvpStageId {
  return level === 'MANUAL' ? 'MANUAL' : level === 'PROCEDURE' ? 'PROCEDURES' : 'RULES';
}

const stageByParam: Record<string, MvpStageId> = {
  manual: 'MANUAL',
  procedures: 'PROCEDURES',
  rules: 'RULES',
};

function stageFromParam(param: string | undefined): MvpStageId | undefined {
  return param ? stageByParam[param] : undefined;
}

/** A first review-task entry: a stage page or an exact revision detail. */
function reviewTarget(pathname: string): { stage: MvpStageId; fileId?: string } | undefined {
  const stageMatch = /\/stages\/(manual|procedures|rules)$/u.exec(pathname);
  const stage = stageFromParam(stageMatch?.[1]);
  if (stage) return { stage };
  const detailMatch = /\/results\/([^/]+)\/([^/]+)$/u.exec(pathname);
  const round = detailMatch?.[1] ? decodeURIComponent(detailMatch[1]) : undefined;
  const roundStage = round?.startsWith('MANUAL-')
    ? 'MANUAL'
    : round?.startsWith('PROCEDURES-')
      ? 'PROCEDURES'
      : round?.startsWith('RULES-')
        ? 'RULES'
        : undefined;
  const fileId = detailMatch?.[2] ? decodeURIComponent(detailMatch[2]) : undefined;
  return roundStage && fileId ? { stage: roundStage, fileId } : undefined;
}

function sessionFor(
  plan: PlanView,
  stage: MvpStageId,
  sessions: ReturnType<typeof useU2>['sessions'],
) {
  const key = sessionKey(plan, stage);
  return sessions[key] ?? emptySession(key, stage);
}

function latestVersionId(
  plan: PlanView,
  stage: MvpStageId,
  fileId: string,
  sessions: ReturnType<typeof useU2>['sessions'],
): string | undefined {
  const session = sessionFor(plan, stage, sessions);
  return session.files[fileId]?.versions.at(-1);
}

const originalModification: Record<string, { at: string; by: string }> = {
  C01: { at: '2026-10-18 14:05', by: '文件记录 · 匿名客户（模拟）' },
  C02: { at: '2026-10-19 10:20', by: '文件记录 · 匿名客户（模拟）' },
  C03: { at: '2026-10-19 16:40', by: '示例编辑者（模拟）' },
  C04: { at: '2026-10-17 09:10', by: '文件记录 · 匿名客户（模拟）' },
  C05: { at: '2026-10-17 15:30', by: '文件记录 · 匿名客户（模拟）' },
  C06: { at: '2026-10-18 11:45', by: '示例编辑者（模拟）' },
  C07: { at: '2026-10-18 17:25', by: '文件记录 · 匿名客户（模拟）' },
  C08: { at: '2026-10-16 08:50', by: '文件记录 · 匿名客户（模拟）' },
  'C08-R1': { at: '未提供', by: '未提供' },
  'C08-R2': { at: '未提供', by: '未提供' },
  C09: { at: '2026-10-19 09:35', by: '示例编辑者（模拟）' },
  S01: { at: '2026-10-20 09:25', by: '文件记录 · 匿名客户（模拟）' },
};

function originalMetadata(entry: InputBatch['entries'][number]): FileMetadata {
  if (entry.state === 'FAILED' || entry.state === 'UNSUPPORTED') {
    return {
      modifiedAt: '读取失败',
      modifiedBy: '读取失败',
      detail: `读取失败：${entry.note}`,
      bytes: entry.bytes,
    };
  }
  const value = originalModification[entry.id];
  if (!value) {
    return {
      modifiedAt: '未提供',
      modifiedBy: '未提供',
      detail: '修改记录未提供；批次提交时间不替代内容修改时间。',
      bytes: entry.bytes,
    };
  }
  return {
    modifiedAt: value.at,
    modifiedBy: value.by,
    detail: '来源：文件记录（模拟） · 显示时区 UTC+08:00；初始作者/上传人不替代最后修改者。',
    bytes: entry.bytes,
  };
}

function revisionBytes(fileId: string, versionId: string): number | undefined {
  return u2RevisionBytes(fileId, versionId);
}

function revisionMetadata(fileId: string, versionId: string): FileMetadata {
  const index = Number(versionId.replace(/\D/gu, '')) || 0;
  const day = index >= 3 ? '30' : '29';
  const hour = String(9 + Math.max(0, index - 1) * 2).padStart(2, '0');
  return {
    modifiedAt: `2026-10-${day} ${hour}:20`,
    modifiedBy: 'AI 生成（模拟）',
    detail: '来源：模拟生成记录 · 显示时区 UTC+08:00；意见/定稿不改变内容修改时间。',
    bytes: revisionBytes(fileId, versionId),
  };
}

function revisionOpinion(
  session: StageSession,
  fileId: string,
  versionId: string,
): string | undefined {
  const submission = session.submissions.find((entry) =>
    entry.basis.files.some((ref) => ref.fileId === fileId && ref.versionId === versionId),
  );
  return submission
    ? `意见发起：示例顾问（模拟） · ${submission.submittedAt} · ${submission.requestId}`
    : undefined;
}

function revisionFinalization(
  session: StageSession,
  fileId: string,
  versionId: string,
): string | undefined {
  const current = session.finalization;
  if (current?.files.some((ref) => ref.fileId === fileId && ref.versionId === versionId))
    return `定稿 ${current.finalizationId} · ${current.confirmedAt}`;
  const historical = session.finalizationHistory.find((entry) =>
    entry.finalization.files.some((ref) => ref.fileId === fileId && ref.versionId === versionId),
  );
  return historical
    ? `历史定稿 ${historical.finalization.finalizationId} · ${historical.finalization.confirmedAt}`
    : undefined;
}

function buildCatalogData(u1: ReturnType<typeof useU1>, u2: ReturnType<typeof useU2>): CatalogData {
  const plan = u2.plan;
  const plans = u1.plans.length > 0 ? u1.plans : [plan];
  const retained = new Set(plan.retained.map((item) => item.id));
  const batches = u1.batches.map((batch: InputBatch) => ({
    id: batch.id,
    label: batch.label,
    zipName: batch.zipName,
    rows: batch.entries.map((entry): OriginalRow => {
      const container = entry.format === 'RAR';
      return {
        key: `${batch.id}:${entry.id}`,
        entryId: entry.id,
        batchId: batch.id,
        batchLabel: batch.label,
        zipName: batch.zipName,
        name: entry.path.split('/').at(-1) ?? entry.path,
        path: entry.path,
        format: entry.format,
        reading: inputEntryLabels[entry.state],
        container,
        member: entry.id.includes('-'),
        damaged: entry.state === 'FAILED' || entry.state === 'UNSUPPORTED',
        retained: retained.has(entry.id),
        metadata: originalMetadata(entry),
        uploaded: `批次提交 ${batch.submittedAt}（模拟，不替代内容修改）`,
      };
    }),
  }));
  const originals = batches.flatMap((batch) => batch.rows);
  const revised: RevisedRow[] = [];
  for (const level of levelOrder) {
    for (const file of plan.files.filter(
      (entry) => entry.level === level && entry.action !== 'RETAIN',
    )) {
      const stage = stageOfLevel(file.level);
      const versions: RevisionVersion[] = [];
      for (const [planIndex, candidatePlan] of plans.entries()) {
        const session = sessionFor(candidatePlan, stage, u2.sessions);
        const state = session.files[file.id];
        const currentFinalized = new Set(
          (session.finalization?.files ?? [])
            .filter((ref) => ref.fileId === file.id)
            .map((ref) => ref.versionId),
        );
        const historicalFinalized = new Set(
          session.finalizationHistory.flatMap((entry) =>
            entry.finalization.files
              .filter((ref) => ref.fileId === file.id)
              .map((ref) => ref.versionId),
          ),
        );
        const latest = state?.versions.at(-1);
        for (const versionId of state?.versions ?? []) {
          const revisionState: RevisionState = currentFinalized.has(versionId)
            ? 'FINALIZED'
            : historicalFinalized.has(versionId)
              ? 'HISTORY'
              : versionId === latest
                ? 'CANDIDATE'
                : 'HISTORY';
          versions.push({
            versionId,
            label: u2VersionLabel(versionId),
            state: revisionState,
            stateLabel:
              revisionState === 'FINALIZED'
                ? '已定稿'
                : revisionState === 'HISTORY'
                  ? '历史版本'
                  : '当前候选',
            roundId: `${stage}-${versionId}@${candidatePlan.planId}-v${candidatePlan.version}`,
            planLabel: `${candidatePlan.planId} 第 ${candidatePlan.version} 版`,
            href: `${base}/results/${encodeURIComponent(`${stage}-${versionId}@${candidatePlan.planId}-v${candidatePlan.version}`)}/${encodeURIComponent(file.id)}`,
            planIndex,
            metadata: revisionMetadata(file.id, versionId),
            ...(revisionOpinion(session, file.id, versionId)
              ? { opinion: revisionOpinion(session, file.id, versionId) }
              : {}),
            ...(revisionFinalization(session, file.id, versionId)
              ? { finalization: revisionFinalization(session, file.id, versionId) }
              : {}),
          });
        }
      }
      if (versions.length === 0) continue;
      versions.sort(
        (left, right) =>
          right.planIndex - left.planIndex ||
          right.versionId.localeCompare(left.versionId, undefined, { numeric: true }),
      );
      const latestVersion = versions[0];
      if (!latestVersion) continue;
      const finalizationCount = versions.filter((version) => version.state === 'FINALIZED').length;
      revised.push({
        fileId: file.id,
        title: file.title,
        level: file.level,
        levelLabel: planLevelLabels[file.level],
        action: file.action,
        actionLabel: planActionLabels[file.action],
        newFile: file.action === 'CREATE',
        versions,
        latest: latestVersion,
        statusLabel:
          finalizationCount > 0
            ? `已定稿 ${finalizationCount} 个版本`
            : latestVersion.state === 'CANDIDATE'
              ? latestVersion.label
              : latestVersion.label,
      });
    }
  }
  return {
    originals,
    batches,
    revised,
    documentCount: originals.filter((row) => !row.container).length,
    containerCount: originals.filter((row) => row.container).length,
    versionCount: revised.reduce((count, row) => count + row.versions.length, 0),
    finalizationCount: revised.reduce(
      (count, row) =>
        count + row.versions.filter((version) => version.state === 'FINALIZED').length,
      0,
    ),
    planFile: (fileId) => plan.files.find((file) => file.id === fileId),
    revisedFileIds: new Set(revised.map((row) => row.fileId)),
  };
}

function originalCounterparts(
  entryId: string,
  plan: PlanView,
  data: CatalogData,
): { produced: RevisedRow[]; planned: string[] } {
  const planned = plan.files.filter(
    (file) => file.action !== 'RETAIN' && file.inputSourceIds.includes(entryId),
  );
  const produced = planned.flatMap((file) => {
    const row = data.revised.find((entry) => entry.fileId === file.id);
    return row ? [row] : [];
  });
  return {
    produced,
    planned: planned.filter((file) => !data.revisedFileIds.has(file.id)).map((file) => file.title),
  };
}

function revisedCounterparts(file: PlanFile | undefined, data: CatalogData): OriginalRow[] {
  if (!file) return [];
  const ids = new Set(file.inputSourceIds);
  return data.originals.filter((row) => ids.has(row.entryId));
}

export function FixtureProjectWorkspace() {
  const params = useParams();
  const location = useLocation();
  if (params.projectId !== projectId) return <Outlet />;
  const currentWork = location.pathname === `${base}/work`;
  return (
    <div className={`project-workspace${currentWork ? ' is-current-work' : ''}`}>
      <ProjectCatalog />
      <div className="project-workspace-main">
        <Outlet />
      </div>
    </div>
  );
}

function ProjectCatalog() {
  const u1 = useU1();
  const u2 = useU2();
  const catalog = useCatalog();
  const location = useLocation();
  const navigate = useNavigate();
  const data = useMemo(() => buildCatalogData(u1, u2), [u1, u2]);
  const list = useRef<HTMLDivElement>(null);
  const reviewApplied = useRef(false);
  const [chooser, setChooser] = useState<string | undefined>(undefined);
  const currentWork = location.pathname === `${base}/work`;
  const target = reviewTarget(location.pathname);
  const stage = target?.stage;
  const stagePage = stageFromParam(
    /\/stages\/(manual|procedures|rules)$/u.exec(location.pathname)?.[1],
  );
  const view = catalog.view;

  // A first review-task entry with an available target may open the revised
  // view and locate that target. A later explicit choice always wins.
  useEffect(() => {
    if (catalog.explicit || reviewApplied.current || !stage) return;
    const selected =
      target.fileId && data.revised.some((row) => row.fileId === target.fileId)
        ? target.fileId
        : planStageFiles(u2.plan, stage).find(
            (file) => latestVersionId(u2.plan, stage, file.id, u2.sessions) !== undefined,
          )?.id;
    if (!selected) return;
    reviewApplied.current = true;
    catalog.autoReview(selected);
  }, [catalog, data.revised, stage, target, u2.plan, u2.sessions]);

  const scroll = useRef(catalog.scroll);
  scroll.current = catalog.scroll;
  useEffect(() => {
    const node = list.current;
    if (node) node.scrollTop = scroll.current[view];
  }, [view]);

  const openOriginal = (row: OriginalRow) => {
    const roundId = u1.reportTwoAvailable ? 'ANALYSIS-2' : 'ANALYSIS-1';
    void navigate(
      `${base}/results/${encodeURIComponent(roundId)}/${encodeURIComponent(row.entryId)}`,
    );
  };

  const openRevision = (row: RevisedRow, version: RevisionVersion, exact: boolean) => {
    // An exact version choice always opens that version. Only the ordinary
    // document selection keeps the stage reader in place.
    if (!exact && stagePage && stageOfLevel(row.level) === stagePage) {
      const viewed = sessionFor(u2.plan, stagePage, u2.sessions).files[row.fileId]?.viewedVersionId;
      if (!viewed) return;
      u2.update(stagePage, (current) => ({
        ...current,
        activeFileId: row.fileId,
        scopeId: fileVersionScope(stagePage, {
          fileId: row.fileId,
          title: row.title,
          versionId: viewed,
          versionLabel: u2VersionLabel(viewed),
        }).id,
      }));
      return;
    }
    void navigate(version.href);
  };

  const search = catalog.search[view];
  const filter = catalog.filter[view];
  const visibleOriginals = data.originals.filter((row) => {
    if (
      view === 'ORIGINALS' &&
      filter === 'ISSUES' &&
      !row.damaged &&
      !row.reading.includes('受限')
    )
      return false;
    if (view === 'ORIGINALS' && filter === 'CONTAINER' && !row.container) return false;
    const needle = search.trim().toLocaleLowerCase();
    return (
      needle.length === 0 ||
      `${row.name} ${row.path} ${row.entryId}`.toLocaleLowerCase().includes(needle)
    );
  });
  const visibleRevised = data.revised.filter((row) => {
    if (view === 'REVISED' && filter === 'CANDIDATE' && row.latest.state !== 'CANDIDATE')
      return false;
    if (
      view === 'REVISED' &&
      filter === 'FINALIZED' &&
      !row.versions.some((version) => version.state === 'FINALIZED')
    )
      return false;
    const needle = search.trim().toLocaleLowerCase();
    return (
      needle.length === 0 ||
      `${row.title} ${row.fileId} ${row.levelLabel}`.toLocaleLowerCase().includes(needle)
    );
  });
  const filtered = search.trim().length > 0 || filter !== 'ALL';
  const selected = catalog.selected[view];
  const selectedOriginal = data.originals.find((row) => row.key === selected);
  const selectedRevision = data.revised.find((row) => row.fileId === selected);
  const counterpart = selectedOriginal
    ? originalCounterparts(selectedOriginal.entryId, u2.plan, data)
    : undefined;
  const originalOptions = selectedRevision
    ? revisedCounterparts(data.planFile(selectedRevision.fileId), data)
    : [];

  const selectOriginal = (row: OriginalRow) => {
    catalog.select('ORIGINALS', row.key);
    setChooser(undefined);
    openOriginal(row);
  };
  const selectRevised = (row: RevisedRow, version: RevisionVersion, exact = false) => {
    catalog.select('REVISED', row.fileId);
    setChooser(undefined);
    openRevision(row, version, exact);
  };
  const switchOriginal = (row: OriginalRow) => {
    catalog.choose('ORIGINALS');
    catalog.select('ORIGINALS', row.key);
    setChooser(undefined);
    openOriginal(row);
  };
  const switchRevision = (row: RevisedRow) => {
    catalog.choose('REVISED');
    catalog.select('REVISED', row.fileId);
    setChooser(undefined);
    openRevision(row, row.latest, false);
  };

  return (
    <nav className="project-catalog" aria-label="项目文档">
      <div className="project-catalog-head">
        <p className="eyebrow">项目文档</p>
        <div className="project-catalog-types" role="group" aria-label="文档类型">
          <button
            type="button"
            aria-pressed={view === 'ORIGINALS'}
            onClick={() => {
              if (list.current) catalog.rememberScroll(view, list.current.scrollTop);
              catalog.choose('ORIGINALS');
            }}
          >
            客户原始文档
          </button>
          <button
            type="button"
            aria-pressed={view === 'REVISED'}
            onClick={() => {
              if (list.current) catalog.rememberScroll(view, list.current.scrollTop);
              catalog.choose('REVISED');
            }}
          >
            修订文档
          </button>
        </div>
        <p className="project-catalog-counts" role="status">
          {view === 'ORIGINALS'
            ? `原始文档 ${data.documentCount} 项 · 容器 ${data.containerCount} · 只读`
            : `修订文档 ${data.revised.length} 份 · 版本 ${data.versionCount} · 已定稿 ${data.finalizationCount}`}
        </p>
        <div className="project-catalog-tools">
          <label>
            搜索名称或编号
            <input
              type="search"
              value={search}
              placeholder={view === 'ORIGINALS' ? '名称 / 路径 / 编号' : '名称 / 层级'}
              onChange={(event) => {
                catalog.setSearch(view, event.target.value);
              }}
            />
          </label>
          <label>
            文档筛选
            <select
              value={filter}
              onChange={(event) => {
                catalog.setFilter(view, event.target.value as OriginalFilter | RevisedFilter);
              }}
            >
              <option value="ALL">全部</option>
              {view === 'ORIGINALS' ? (
                <>
                  <option value="ISSUES">读取受限或失败</option>
                  <option value="CONTAINER">容器</option>
                </>
              ) : (
                <>
                  <option value="CANDIDATE">当前候选</option>
                  <option value="FINALIZED">已定稿</option>
                </>
              )}
            </select>
          </label>
          {filtered ? (
            <button
              type="button"
              className="project-catalog-clear"
              onClick={() => {
                catalog.clear(view);
              }}
            >
              清除筛选
            </button>
          ) : null}
        </div>
        {currentWork && (
          <div className="project-browser-tools">
            <label>
              排序
              <select
                value={catalog.sort[view].field}
                onChange={(event) => {
                  catalog.setSort(view, {
                    ...catalog.sort[view],
                    field: event.target.value as SortField,
                  });
                }}
              >
                <option value="NAME">名称</option>
                <option value="MODIFIED">最后修改时间</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                catalog.setSort(view, {
                  ...catalog.sort[view],
                  direction: catalog.sort[view].direction === 'ASC' ? 'DESC' : 'ASC',
                });
              }}
            >
              {catalog.sort[view].direction === 'ASC' ? '升序 ↑' : '降序 ↓'}
            </button>
            <span className="project-browser-timezone">时间 UTC+08:00（模拟）</span>
          </div>
        )}
        <Link className="project-catalog-detail" to={`${base}/files`}>
          清单明细
        </Link>
      </div>
      <div className="project-catalog-list" ref={list}>
        {currentWork ? (
          <FileBrowserList
            data={data}
            plan={u2.plan}
            originals={visibleOriginals}
            revised={visibleRevised}
            openOriginal={openOriginal}
            openRevision={openRevision}
            switchOriginal={switchOriginal}
            switchRevision={switchRevision}
            chooser={chooser}
            setChooser={setChooser}
          />
        ) : view === 'ORIGINALS' ? (
          <>
            {data.batches.map((batch) => {
              const rows = visibleOriginals.filter((row) => row.batchId === batch.id);
              if (rows.length === 0) return null;
              return (
                <section key={batch.id} aria-label={batch.label}>
                  <h3>{batch.label}</h3>
                  <p className="project-catalog-source">{batch.zipName}</p>
                  <ul>
                    {rows.map((row) => (
                      <li key={row.key} className={row.member ? 'is-member' : undefined}>
                        <button
                          type="button"
                          aria-current={catalog.selected.ORIGINALS === row.key ? 'true' : undefined}
                          onClick={() => {
                            selectOriginal(row);
                          }}
                        >
                          <span className="project-catalog-title">{row.name}</span>
                          <small>{row.path}</small>
                          <span className="project-catalog-meta">
                            {row.format} · {row.reading}
                            {row.container ? ' · 容器' : ''}
                            {row.retained ? ' · 沿用原件' : ''}
                          </span>
                        </button>
                        {catalog.selected.ORIGINALS === row.key && (
                          <ProvenanceOriginal
                            row={row}
                            counterparts={counterpart}
                            chooser={chooser === row.key}
                            onChoose={() => {
                              setChooser(row.key);
                            }}
                            onSwitch={switchRevision}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
            {visibleOriginals.length === 0 && (
              <p className="project-catalog-empty">没有符合条件的原始文档。</p>
            )}
          </>
        ) : (
          <>
            {data.revised.length === 0 ? (
              <div className="project-catalog-empty" role="status">
                <p>尚未生成修订文档。</p>
                <p>
                  计划中的预计/新增文件仍留在当前工作与清单明细中，不计为已生成修订；沿用原件仍在客户原始文档。
                </p>
                <button
                  type="button"
                  onClick={() => {
                    catalog.choose('ORIGINALS');
                  }}
                >
                  查看客户原始文档
                </button>
              </div>
            ) : (
              levelOrder.map((level) => {
                const rows = visibleRevised.filter((row) => row.level === level);
                if (rows.length === 0) return null;
                return (
                  <section key={level} aria-label={planLevelLabels[level]}>
                    <h3>{planLevelLabels[level]}</h3>
                    <ul>
                      {rows.map((row) => (
                        <li key={row.fileId}>
                          <button
                            type="button"
                            aria-current={
                              catalog.selected.REVISED === row.fileId ? 'true' : undefined
                            }
                            onClick={() => {
                              selectRevised(row, row.latest);
                            }}
                          >
                            <span className="project-catalog-title">{row.title}</span>
                            <small>
                              {row.newFile ? '新增文件' : row.actionLabel} · {row.statusLabel}
                            </small>
                          </button>
                          {catalog.selected.REVISED === row.fileId && (
                            <>
                              <ProvenanceRevised
                                row={row}
                                options={originalOptions}
                                chooser={chooser === `revised:${row.fileId}`}
                                onChoose={() => {
                                  setChooser(`revised:${row.fileId}`);
                                }}
                                onSwitch={switchOriginal}
                              />
                              <details className="project-catalog-versions">
                                <summary>版本与来源（{row.versions.length}）</summary>
                                <ul>
                                  {row.versions.map((version) => (
                                    <li key={`${version.roundId}:${version.versionId}`}>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          selectRevised(row, version, true);
                                        }}
                                      >
                                        {version.label} · {version.stateLabel}
                                      </button>
                                      <small>
                                        {version.planLabel} · {version.roundId}
                                      </small>
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })
            )}
            {data.revised.length > 0 && visibleRevised.length === 0 && (
              <p className="project-catalog-empty">没有符合条件的修订文档。</p>
            )}
          </>
        )}
      </div>
      <p className="project-catalog-note">
        目录覆盖整个项目；阅读历史轮次不改变该轮固定输入与结果。原件只读，修订文档按精确版本绑定候选、定稿和历史。
      </p>
    </nav>
  );
}

interface BrowserInfo {
  kind: 'ORIGINAL' | 'REVISION';
  original?: OriginalRow;
  revision?: RevisedRow;
  version?: RevisionVersion;
}

interface BrowserRow {
  key: string;
  kind: 'FOLDER' | 'DOCUMENT';
  label: string;
  state?: string;
  metadata?: FileMetadata;
  secondary?: string;
  open?: () => void;
  info: BrowserInfo;
  children?: BrowserRow[];
}

const timePattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/u;

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return '大小未提供';
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function sortBrowserRows(rows: BrowserRow[], sort: SortState): BrowserRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      if (left.row.kind !== right.row.kind) return left.row.kind === 'FOLDER' ? -1 : 1;
      if (sort.field === 'NAME') {
        const compared = left.row.label.localeCompare(right.row.label, 'zh-Hans-CN');
        return (sort.direction === 'ASC' ? compared : -compared) || left.index - right.index;
      }
      const leftTime = left.row.metadata?.modifiedAt;
      const rightTime = right.row.metadata?.modifiedAt;
      const leftValid = leftTime && timePattern.test(leftTime);
      const rightValid = rightTime && timePattern.test(rightTime);
      if (leftValid && !rightValid) return -1;
      if (!leftValid && rightValid) return 1;
      if (!leftValid && !rightValid) return left.index - right.index;
      const compared = (leftTime ?? '').localeCompare(rightTime ?? '');
      return (sort.direction === 'ASC' ? compared : -compared) || left.index - right.index;
    })
    .map((entry) => entry.row);
}

function originalDocumentRow(
  row: OriginalRow,
  originals: readonly OriginalRow[],
  openOriginal: (row: OriginalRow) => void,
): BrowserRow {
  const members = originals.filter((entry) => entry.entryId.startsWith(`${row.entryId}-`));
  return {
    key: row.key,
    kind: 'DOCUMENT',
    label: row.name,
    state: `原件 · ${row.reading}${row.retained ? ' · 沿用原件' : ''}`,
    metadata: row.metadata,
    secondary: `${row.format} · ${formatBytes(row.metadata.bytes)}`,
    open: () => {
      openOriginal(row);
    },
    info: { kind: 'ORIGINAL', original: row },
    ...(members.length > 0
      ? {
          children: members.map((member) => originalDocumentRow(member, originals, openOriginal)),
        }
      : {}),
  };
}

function originalTree(
  data: CatalogData,
  rows: readonly OriginalRow[],
  openOriginal: (row: OriginalRow) => void,
): BrowserRow[] {
  // Keep container ancestry when a member matches a filter, and put each
  // nested member under exactly one container instead of duplicating it as a
  // directory sibling.
  const needed = new Set(rows.map((row) => row.entryId));
  for (const container of data.originals.filter((row) => row.container)) {
    if (
      data.originals.some(
        (member) =>
          member.entryId.startsWith(`${container.entryId}-`) && needed.has(member.entryId),
      )
    )
      needed.add(container.entryId);
  }
  const effective = data.originals.filter((row) => needed.has(row.entryId));
  return data.batches.flatMap((batch) => {
    const batchRows = effective.filter((row) => row.batchId === batch.id && !row.member);
    if (batchRows.length === 0) return [];
    const directories = new Map<string, OriginalRow[]>();
    for (const row of batchRows) {
      const directory = row.path.split('/')[0] ?? '';
      directories.set(directory, [...(directories.get(directory) ?? []), row]);
    }
    const children = [...directories.entries()].map(([directory, entries]) => ({
      key: `${batch.id}:dir:${directory}`,
      kind: 'FOLDER' as const,
      label: directory,
      info: { kind: 'ORIGINAL' as const },
      children: entries.map((row) => originalDocumentRow(row, effective, openOriginal)),
    }));
    return [
      {
        key: batch.id,
        kind: 'FOLDER' as const,
        label: batch.label,
        info: { kind: 'ORIGINAL' as const },
        children,
      },
    ];
  });
}

function revisionTree(
  data: CatalogData,
  rows: readonly RevisedRow[],
  openRevision: (row: RevisedRow, version: RevisionVersion, exact: boolean) => void,
): BrowserRow[] {
  return levelOrder.flatMap((level) => {
    const documents = rows.filter((row) => row.level === level);
    if (documents.length === 0) return [];
    return [
      {
        key: `level:${level}`,
        kind: 'FOLDER' as const,
        label: planLevelLabels[level],
        info: { kind: 'REVISION' as const },
        children: documents.map((row): BrowserRow => ({
          key: row.fileId,
          kind: 'DOCUMENT',
          label: row.title,
          state: `${row.latest.label} · ${row.latest.stateLabel}${row.newFile ? ' · 新增' : ''}`,
          metadata: row.latest.metadata,
          secondary: `${row.actionLabel} · ${formatBytes(row.latest.metadata.bytes)}`,
          open: () => {
            openRevision(row, row.latest, false);
          },
          info: { kind: 'REVISION', revision: row, version: row.latest },
          children: row.versions.map((version) => ({
            key: `${row.fileId}:${version.roundId}`,
            kind: 'DOCUMENT',
            label: version.label,
            state: version.stateLabel,
            metadata: version.metadata,
            secondary: `${version.planLabel} · ${formatBytes(version.metadata.bytes)}`,
            open: () => {
              openRevision(row, version, true);
            },
            info: { kind: 'REVISION', revision: row, version },
          })),
        })),
      },
    ];
  });
}

function FileBrowserList({
  data,
  originals,
  revised,
  plan,
  openOriginal,
  openRevision,
  switchOriginal,
  switchRevision,
  chooser,
  setChooser,
}: {
  data: CatalogData;
  plan: PlanView;
  originals: readonly OriginalRow[];
  revised: readonly RevisedRow[];
  openOriginal: (row: OriginalRow) => void;
  openRevision: (row: RevisedRow, version: RevisionVersion, exact: boolean) => void;
  switchOriginal: (row: OriginalRow) => void;
  switchRevision: (row: RevisedRow) => void;
  chooser: string | undefined;
  setChooser: (value: string | undefined) => void;
}) {
  const catalog = useCatalog();
  const view = catalog.view;
  const sort = catalog.sort[view];
  const collapsed = new Set(catalog.collapsed[view]);
  const tree =
    view === 'ORIGINALS'
      ? originalTree(data, originals, openOriginal)
      : revisionTree(data, revised, openRevision);
  const infoMap = new Map<string, BrowserInfo>();
  const collect = (rows: BrowserRow[]) => {
    for (const row of rows) {
      infoMap.set(row.key, row.info);
      if (row.children) collect(row.children);
    }
  };
  collect(tree);
  const [infoKeys, setInfoKeys] = useState<Record<CatalogView, string | undefined>>({
    ORIGINALS: undefined,
    REVISED: undefined,
  });
  const selectedKey = catalog.selected[view];
  const selectedRowKey = infoKeys[view] ?? selectedKey;
  const selectedInfo = selectedRowKey ? infoMap.get(selectedRowKey) : undefined;
  const filtered = catalog.search[view].trim().length > 0 || catalog.filter[view] !== 'ALL';
  const selectedOriginal = selectedInfo?.original;
  const selectedRevision = selectedInfo?.revision;
  const counterparts = selectedOriginal
    ? originalCounterparts(selectedOriginal.entryId, plan, data)
    : undefined;
  const originalOptions = selectedRevision
    ? revisedCounterparts(data.planFile(selectedRevision.fileId), data)
    : [];

  const renderRows = (rows: BrowserRow[], depth: number): ReactNode =>
    sortBrowserRows(rows, sort).map((row) => (
      <div
        className="browser-row"
        key={row.key}
        style={{ '--browser-depth': depth } as CSSProperties}
      >
        {row.kind === 'FOLDER' ? (
          <div className="browser-folder-line">
            <button
              type="button"
              className="browser-folder"
              aria-expanded={!collapsed.has(row.key)}
              onClick={() => {
                catalog.toggleExpanded(view, row.key);
              }}
            >
              <span aria-hidden="true">{!collapsed.has(row.key) ? '−' : '+'}</span> {row.label}
            </button>
            <span className="browser-time">不适用</span>
            <span className="browser-author">不适用</span>
          </div>
        ) : (
          <div
            className="browser-document"
            data-selected={selectedRowKey === row.key ? 'true' : undefined}
          >
            <div className="browser-line">
              {row.children ? (
                <button
                  type="button"
                  className="browser-expander"
                  aria-expanded={!collapsed.has(row.key)}
                  aria-label={`${collapsed.has(row.key) ? '展开' : '收起'} ${row.label}`}
                  onClick={() => {
                    catalog.toggleExpanded(view, row.key);
                  }}
                >
                  {!collapsed.has(row.key) ? '−' : '+'}
                </button>
              ) : null}
              <button
                type="button"
                className="browser-name"
                aria-label={
                  row.info.kind === 'ORIGINAL'
                    ? `${row.label} ${row.info.original?.path ?? ''} ${
                        row.info.original?.format ?? ''
                      } · ${row.info.original?.reading ?? ''}${
                        row.info.original?.retained ? ' · 沿用原件' : ''
                      }`
                    : row.info.version && row.info.version !== row.info.revision?.latest
                      ? `${row.label} · ${row.state ?? ''}`
                      : `${row.label} ${row.info.revision?.actionLabel ?? ''} · ${row.state ?? ''}`
                }
                onClick={() => {
                  setInfoKeys((current) => ({ ...current, [view]: row.key }));
                  if (row.info.kind === 'ORIGINAL' && row.info.original)
                    catalog.select('ORIGINALS', row.info.original.key);
                  else if (row.info.revision) catalog.select('REVISED', row.info.revision.fileId);
                  row.open?.();
                }}
              >
                {row.label}
              </button>
              <span className="browser-time">{row.metadata?.modifiedAt ?? '未提供'}</span>
              <span className="browser-author">{row.metadata?.modifiedBy ?? '未提供'}</span>
            </div>
            <div className="browser-subline">
              <span>{row.state}</span>
              <span>{row.secondary}</span>
              <button
                type="button"
                className="browser-info"
                aria-pressed={selectedRowKey === row.key}
                onClick={() => {
                  setInfoKeys((current) => ({ ...current, [view]: row.key }));
                  if (row.info.kind === 'ORIGINAL' && row.info.original)
                    catalog.select('ORIGINALS', row.info.original.key);
                  else if (row.info.revision) catalog.select('REVISED', row.info.revision.fileId);
                }}
              >
                文件信息
              </button>
            </div>
          </div>
        )}
        {!collapsed.has(row.key) && row.children ? (
          <div className="browser-children">{renderRows(row.children, depth + 1)}</div>
        ) : null}
      </div>
    ));

  return (
    <>
      <p className="project-browser-scope">
        {filtered
          ? `筛选范围 · ${view === 'ORIGINALS' ? originals.length : revised.length} 个条目（全项目 ${
              view === 'ORIGINALS' ? data.documentCount + data.containerCount : data.revised.length
            }）`
          : '全项目范围'}
      </p>
      <div className="browser-header" aria-hidden="true">
        <span>名称 / 版本与状态</span>
        <span>最后修改时间</span>
        <span>修改人</span>
      </div>
      {tree.length === 0 ? (
        <p className="project-catalog-empty">
          {view === 'ORIGINALS'
            ? data.originals.length === 0
              ? '当前项目没有客户原始文档。'
              : '没有符合条件的原始文档。'
            : data.revised.length === 0
              ? '尚未生成修订文档。'
              : '没有符合条件的修订文档。'}
        </p>
      ) : (
        renderRows(tree, 0)
      )}
      {view === 'REVISED' && data.revised.length === 0 ? (
        <div className="project-catalog-empty" role="status">
          <p>计划中的预计/新增文件仍留在当前工作与清单明细中，不计为已生成修订。</p>
          <button
            type="button"
            onClick={() => {
              catalog.choose('ORIGINALS');
            }}
          >
            查看客户原始文档
          </button>
        </div>
      ) : null}
      {selectedInfo?.kind === 'ORIGINAL' && selectedOriginal ? (
        <section className="project-file-info" aria-label="文件信息">
          <h3>文件信息</h3>
          <dl>
            <dt>完整路径</dt>
            <dd>{selectedOriginal.path}</dd>
            <dt>批次</dt>
            <dd>
              {selectedOriginal.batchLabel} · {selectedOriginal.zipName}
            </dd>
            <dt>类型与大小</dt>
            <dd>
              {selectedOriginal.format} · {formatBytes(selectedOriginal.metadata.bytes)}
            </dd>
            <dt>读取状态</dt>
            <dd>{selectedOriginal.reading}</dd>
            <dt>最后修改</dt>
            <dd>
              {selectedOriginal.metadata.modifiedAt} · {selectedOriginal.metadata.modifiedBy}
            </dd>
            <dt>修改记录</dt>
            <dd>{selectedOriginal.metadata.detail}</dd>
            <dt>上传记录</dt>
            <dd>{selectedOriginal.uploaded}</dd>
          </dl>
          <ProvenanceOriginal
            row={selectedOriginal}
            counterparts={counterparts}
            chooser={chooser === selectedOriginal.key}
            onChoose={() => {
              setChooser(selectedOriginal.key);
            }}
            onSwitch={switchRevision}
          />
        </section>
      ) : null}
      {selectedInfo?.kind === 'REVISION' && selectedRevision ? (
        <section className="project-file-info" aria-label="文件信息">
          <h3>文件信息</h3>
          <dl>
            <dt>文件与层级</dt>
            <dd>
              {selectedRevision.fileId} · {selectedRevision.levelLabel} ·{' '}
              {selectedRevision.actionLabel}
            </dd>
            <dt>当前显示版本</dt>
            <dd>
              {selectedInfo.version?.label ?? selectedRevision.latest.label} ·{' '}
              {selectedInfo.version?.stateLabel ?? selectedRevision.latest.stateLabel}
            </dd>
            <dt>轮次与计划</dt>
            <dd>
              {selectedInfo.version?.planLabel ?? selectedRevision.latest.planLabel} ·{' '}
              {selectedInfo.version?.roundId ?? selectedRevision.latest.roundId}
            </dd>
            <dt>类型与大小</dt>
            <dd>
              {selectedRevision.actionLabel} ·{' '}
              {formatBytes((selectedInfo.version ?? selectedRevision.latest).metadata.bytes)}
            </dd>
            <dt>最后修改</dt>
            <dd>
              {(selectedInfo.version ?? selectedRevision.latest).metadata.modifiedAt} ·{' '}
              {(selectedInfo.version ?? selectedRevision.latest).metadata.modifiedBy}
            </dd>
            <dt>修改记录</dt>
            <dd>{(selectedInfo.version ?? selectedRevision.latest).metadata.detail}</dd>
            {selectedInfo.version?.opinion ? (
              <>
                <dt>意见发起</dt>
                <dd>{selectedInfo.version.opinion}</dd>
              </>
            ) : null}
            {selectedInfo.version?.finalization ? (
              <>
                <dt>定稿记录</dt>
                <dd>{selectedInfo.version.finalization}</dd>
              </>
            ) : null}
          </dl>
          <ProvenanceRevised
            row={selectedRevision}
            options={originalOptions}
            chooser={chooser === `revised:${selectedRevision.fileId}`}
            onChoose={() => {
              setChooser(`revised:${selectedRevision.fileId}`);
            }}
            onSwitch={switchOriginal}
          />
        </section>
      ) : null}
    </>
  );
}

function ProvenanceOriginal({
  row,
  counterparts,
  chooser,
  onChoose,
  onSwitch,
}: {
  row: OriginalRow;
  counterparts: { produced: RevisedRow[]; planned: string[] } | undefined;
  chooser: boolean;
  onChoose: () => void;
  onSwitch: (row: RevisedRow) => void;
}) {
  if (!counterparts || counterparts.produced.length === 0) {
    return (
      <p className="project-catalog-provenance">
        {row.retained
          ? '沿用原件，本轮不生成修订。'
          : counterparts?.planned.length
            ? `计划中的修订尚未生成：${counterparts.planned.join('、')}。`
            : '无关联修订文档。'}
      </p>
    );
  }
  if (counterparts.produced.length === 1) {
    const [row2] = counterparts.produced;
    return row2 ? (
      <button
        type="button"
        className="project-catalog-link-action"
        onClick={() => {
          onSwitch(row2);
        }}
      >
        查看关联修订文档
      </button>
    ) : null;
  }
  return (
    <div className="project-catalog-provenance">
      {chooser ? (
        <div role="group" aria-label="选择关联修订文档">
          {counterparts.produced.map((entry) => (
            <button
              key={entry.fileId}
              type="button"
              onClick={() => {
                onSwitch(entry);
              }}
            >
              {entry.title} · {entry.latest.label}
            </button>
          ))}
        </div>
      ) : (
        <button type="button" className="project-catalog-link-action" onClick={onChoose}>
          查看关联修订文档（{counterparts.produced.length}）
        </button>
      )}
      {counterparts.planned.length > 0 && (
        <p className="muted">尚未生成：{counterparts.planned.join('、')}。</p>
      )}
    </div>
  );
}

function ProvenanceRevised({
  row,
  options,
  chooser,
  onChoose,
  onSwitch,
}: {
  row: RevisedRow;
  options: OriginalRow[];
  chooser: boolean;
  onChoose: () => void;
  onSwitch: (row: OriginalRow) => void;
}) {
  if (row.newFile) {
    return <p className="project-catalog-provenance">无客户原件（新增文件）。</p>;
  }
  if (options.length === 0) {
    return <p className="project-catalog-provenance">未记录对应原件。</p>;
  }
  if (options.length === 1) {
    const [original] = options;
    return original ? (
      <button
        type="button"
        className="project-catalog-link-action"
        onClick={() => {
          onSwitch(original);
        }}
      >
        查看对应原件
      </button>
    ) : null;
  }
  return (
    <div className="project-catalog-provenance">
      {chooser ? (
        <div role="group" aria-label="选择对应原件">
          {options.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => {
                onSwitch(entry);
              }}
            >
              {entry.name}
            </button>
          ))}
        </div>
      ) : (
        <button type="button" className="project-catalog-link-action" onClick={onChoose}>
          查看对应原件（{options.length}）
        </button>
      )}
    </div>
  );
}

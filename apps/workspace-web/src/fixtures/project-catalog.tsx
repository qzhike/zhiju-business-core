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
  type ReactNode,
} from 'react';
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { inputEntryLabels, type InputBatch } from '../intake/model.js';
import { planActionLabels, planLevelLabels, type PlanFile, type PlanView } from '../plan/model.js';
import { fileVersionScope, type MvpStageId } from '../mvp/review-model.js';
import { u1Project } from './u1-data.js';
import { useU1 } from './u1.js';
import { emptySession, planStageFiles, sessionKey, useU2 } from './u2.js';
import { u2VersionLabel } from './u2-data.js';
import './project-catalog.css';

const projectId = u1Project.id;
const base = `/projects/${projectId}`;

type CatalogView = 'ORIGINALS' | 'REVISED';
type OriginalFilter = 'ALL' | 'ISSUES' | 'CONTAINER';
type RevisedFilter = 'ALL' | 'CANDIDATE' | 'FINALIZED';
type RevisionState = 'CANDIDATE' | 'FINALIZED' | 'HISTORY';

interface CatalogState {
  view: CatalogView;
  explicit: boolean;
  search: Record<CatalogView, string>;
  filter: Record<CatalogView, OriginalFilter | RevisedFilter>;
  selected: Record<CatalogView, string | undefined>;
  scroll: Record<CatalogView, number>;
}

interface CatalogApi extends CatalogState {
  choose: (view: CatalogView) => void;
  setSearch: (view: CatalogView, value: string) => void;
  setFilter: (view: CatalogView, value: OriginalFilter | RevisedFilter) => void;
  clear: (view: CatalogView) => void;
  select: (view: CatalogView, key: string) => void;
  rememberScroll: (view: CatalogView, top: number) => void;
  autoReview: (fileId: string) => void;
}

const CatalogContext = createContext<CatalogApi | null>(null);

const initialState: CatalogState = {
  view: 'ORIGINALS',
  explicit: false,
  search: { ORIGINALS: '', REVISED: '' },
  filter: { ORIGINALS: 'ALL', REVISED: 'ALL' },
  selected: { ORIGINALS: undefined, REVISED: undefined },
  scroll: { ORIGINALS: 0, REVISED: 0 },
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
  if (params.projectId !== projectId) return <Outlet />;
  return (
    <div className="project-workspace">
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

  const openRevision = (row: RevisedRow, version: RevisionVersion) => {
    if (stagePage && stageOfLevel(row.level) === stagePage) {
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
  const selectRevised = (row: RevisedRow, version: RevisionVersion) => {
    catalog.select('REVISED', row.fileId);
    setChooser(undefined);
    openRevision(row, version);
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
    openRevision(row, row.latest);
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
        <Link className="project-catalog-detail" to={`${base}/files`}>
          清单明细
        </Link>
      </div>
      <div className="project-catalog-list" ref={list}>
        {view === 'ORIGINALS' ? (
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
                                          selectRevised(row, version);
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

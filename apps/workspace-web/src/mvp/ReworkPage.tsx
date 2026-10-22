import { Link } from 'react-router';
import { JourneyNav, type JourneyReviewStage } from './JourneyNav.js';
import type { StageReworkImpactView } from './StageReviewPage.js';
import './u3.css';

export interface ReworkPageProps {
  projectId: string;
  analysisReportId: string;
  plan: { planId: string; planVersion: number; stateLabel: string };
  reviewStages: readonly JourneyReviewStage[];
  manual: {
    finalizationId?: string | undefined;
    files: readonly { fileId: string; title: string; versionLabel: string }[];
    previous?:
      | {
          finalizationId: string;
          supersededBy: string;
          files: readonly { fileId: string; title: string; versionLabel: string }[];
        }
      | undefined;
    draftVersions: readonly { fileId: string; title: string; versionLabel: string }[];
  };
  procedures: {
    finalizationId?: string | undefined;
    boundManualId?: string | undefined;
    impact?: StageReworkImpactView | undefined;
    latestSet: readonly { fileId: string; title: string; versionLabel: string }[];
  };
  records: {
    impact?: StageReworkImpactView | undefined;
    reviewed: boolean;
    reason: string;
    basisLabel: string;
    files: readonly { fileId: string; title: string; versionLabel: string }[];
  };
  deliveryBlockers: readonly string[];
  actions: {
    announceManualDraft: () => void;
    addDownstreamCandidates: () => void;
    adoptLatestDownstream: () => void;
    adoptLatestRecords: () => void;
  };
  links: {
    manual: string;
    procedures: string;
    records: string;
    recovery: string;
    delivery: string;
    scope: string;
  };
}

function ImpactTable({ impact }: { impact: StageReworkImpactView }) {
  return (
    <>
      <dl className="u3-basis">
        <div>
          <dt>旧依据</dt>
          <dd>{impact.previousBasisId}</dd>
        </div>
        <div>
          <dt>新依据</dt>
          <dd>{impact.newBasisId}</dd>
        </div>
        <div>
          <dt>变化来源</dt>
          <dd>{impact.sourceLabel}</dd>
        </div>
      </dl>
      <div className="u3-table" role="region" aria-label="受影响文件与理由" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th scope="col">受影响文件</th>
              <th scope="col">处理</th>
              <th scope="col">上游提供理由</th>
            </tr>
          </thead>
          <tbody>
            {impact.files.map((file) => (
              <tr key={file.fileId}>
                <th scope="row">{file.title}</th>
                <td>{file.actionLabel}</td>
                <td>{file.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">{impact.note}</p>
    </>
  );
}

export function ReworkPage({
  projectId,
  analysisReportId,
  plan,
  reviewStages,
  manual,
  procedures,
  records,
  deliveryBlockers,
  actions,
  links,
}: ReworkPageProps) {
  return (
    <div className="u3-page">
      <JourneyNav
        current="overview"
        analysisReportId={analysisReportId}
        scopeEnabled
        reviewStages={reviewStages}
      />
      <div className="page-head">
        <div>
          <p className="eyebrow">
            {projectId} · 计划 {plan.planId} 第 {plan.planVersion} 版 · {plan.stateLabel}
          </p>
          <h1 tabIndex={-1}>返工与复核</h1>
          <p className="muted">
            上游重新定稿保留前任依据，并保守标记下游待复核；记录表单复核只绑定精确版本，不是定稿关卡。
          </p>
        </div>
      </div>
      <div className="demo" role="note">
        环境 A · 返工演练 · 新草稿、重新定稿、影响标记与复核均为合成页面状态；刷新重置，不调用 Core
        或 Runner。
      </div>

      <section className="panel" aria-label="质量手册返工">
        <h2>1. 质量手册：草稿不替换当前依据</h2>
        {manual.finalizationId ? (
          <p>
            <strong>当前定稿：</strong>
            {manual.finalizationId} ·{' '}
            {manual.files.map((file) => `${file.title} ${file.versionLabel}`).join('；')}
          </p>
        ) : (
          <p>尚无质量手册模拟定稿；请先完成第一阶段审阅与定稿。</p>
        )}
        {manual.previous && (
          <div className="notice" role="status">
            <strong>上一版定稿仍在历史中：</strong>
            {manual.previous.finalizationId} · 已由 {manual.previous.supersededBy} 替代 ·{' '}
            {manual.previous.files.map((file) => `${file.title} ${file.versionLabel}`).join('；')}
          </div>
        )}
        {manual.draftVersions.length > 0 ? (
          <p className="notice" role="status">
            新草稿已到达：
            {manual.draftVersions.map((file) => `${file.title} ${file.versionLabel}`).join('；')}
            。在显式重新定稿并读回匹配回执之前，第二阶段与最终交付仍以当前定稿为依据。
          </p>
        ) : (
          <p className="muted">
            当前没有更新的手册草稿。可显式模拟一份返工草稿，观察“旧依据仍有效”的下游行为。
          </p>
        )}
        <div className="u3-actions">
          <button className="primary" onClick={actions.announceManualDraft}>
            模拟新手册草稿到达（第 3 版）
          </button>
          <Link className="button" to={links.manual}>
            打开质量手册审阅并重新定稿
          </Link>
        </div>
      </section>

      <section className="panel" aria-label="第二阶段复核">
        <h2>2. 第二阶段：按新手册重新确认完整集合</h2>
        {!manual.finalizationId ? (
          <p className="muted">质量手册定稿后才能核对第二阶段影响。</p>
        ) : procedures.impact ? (
          <>
            <p className="notice" role="status">
              第二阶段标记“依据已变化，待复核”。当前集合仍绑定旧手册{' '}
              {procedures.boundManualId ?? '（未记录）'}，不能推进最终交付。
            </p>
            <ImpactTable impact={procedures.impact} />
            <div className="u3-actions">
              <button onClick={actions.addDownstreamCandidates}>
                模拟新手册依据下的程序候选（第 3 版）
              </button>
              <button onClick={actions.adoptLatestDownstream}>
                模拟已核对并采用第二阶段全部最新候选
              </button>
              <Link className="button primary" to={links.procedures}>
                打开第二阶段审阅并重新定稿
              </Link>
            </div>
          </>
        ) : (
          <p>
            <strong>当前第二阶段定稿：</strong>
            {procedures.finalizationId ?? '尚未定稿'} · 绑定手册{' '}
            {procedures.boundManualId ?? '尚未记录'}
            {procedures.latestSet.length > 0 && (
              <>
                {' '}
                · 完整集合：
                {procedures.latestSet
                  .map((file) => `${file.title} ${file.versionLabel}`)
                  .join('；')}
              </>
            )}
          </p>
        )}
      </section>

      <section className="panel" aria-label="记录表单受影响复核">
        <h2>3. 记录表单：复核精确版本，不增加定稿关卡</h2>
        {records.impact ? (
          <>
            <p className="notice" role="status">
              {records.reason}
            </p>
            <ImpactTable impact={records.impact} />
          </>
        ) : (
          <p>{records.reason}</p>
        )}
        <p>
          <strong>当前复核依据：</strong>
          {records.basisLabel}
        </p>
        {records.files.length > 0 && (
          <ul>
            {records.files.map((file) => (
              <li key={`${file.fileId}:${file.versionLabel}`}>
                {file.title} · {file.versionLabel}
              </li>
            ))}
          </ul>
        )}
        <div className="u3-actions">
          <button onClick={actions.adoptLatestRecords}>模拟已核对并采用记录表单全部最新候选</button>
          <Link className="button primary" to={links.records}>
            打开记录表单审阅并复核
          </Link>
        </div>
      </section>

      <section className="panel" aria-label="最终交付阻断检查">
        <h2>4. 最终交付条件</h2>
        {deliveryBlockers.length === 0 ? (
          <p className="notice" role="status">
            两项上游依据与记录表单复核均已就绪；最终交付仍须在交付页显式确认精确清单。
          </p>
        ) : (
          <ul className="u3-blockers">
            {deliveryBlockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        )}
        <div className="u3-actions">
          <Link className="button primary" to={links.delivery}>
            打开最终交付（模拟）
          </Link>
          <Link to={links.recovery}>查看执行与恢复</Link>
          <Link to={links.scope}>扩大范围？返回 U1 修改范围计划</Link>
        </div>
        <p className="muted">
          未解决的依据变化、未复核记录表单、待回执修改或新候选都会阻止交付；阅读、复核与候选到达本身不构成交付确认。
        </p>
      </section>
    </div>
  );
}

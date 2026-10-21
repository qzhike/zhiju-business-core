import { useState, type ReactNode } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { Link } from 'react-router';
import { MarkdownReviewPage, type MarkdownReviewData } from '../MarkdownReviewPage.js';
import type {
  ReviewDownload,
  ReviewOpinionActions,
  ReviewOpinionModel,
  ReviewWorkspaceInput,
} from '../review/model.js';
import { JourneyNav, type JourneyReviewStage } from './JourneyNav.js';
import { mvpStageLabels, type MvpStageId } from './review-model.js';
import './stage-review.css';

export type StageGenerationStatus =
  'NONE' | 'PENDING' | 'UNKNOWN' | 'FAILED' | 'RECEIVED' | 'MISMATCH';

export interface StageReviewBasisItem {
  label: string;
  detail: string;
}

export interface StageReviewFileView {
  fileId: string;
  title: string;
  levelLabel: string;
  actionLabel: string;
  versionLabel: string;
  latestVersionLabel: string;
  missing: boolean;
}

export interface StageReviewFinalizationView {
  supported: boolean;
  status: 'NONE' | 'PENDING' | 'UNKNOWN' | 'FAILED' | 'MISMATCH' | 'DONE';
  reason: string;
  canConfirm: boolean;
  requestLabel?: string | undefined;
  exactSet: readonly StageReviewFileView[];
  result?:
    | {
        finalizationId: string;
        planLabel: string;
        manualLabel?: string | undefined;
      }
    | undefined;
  onConfirm: () => void;
  onReceipt?: (() => void) | undefined;
  onQuery: () => void;
  onRetry: () => void;
}

export interface StageReviewPageProps {
  stage: MvpStageId;
  projectId: string;
  analysisReportId: string;
  statusMessage?: string | undefined;
  plan: { planId: string; planVersion: number; stateLabel: string };
  reviewStages: readonly JourneyReviewStage[];
  readiness: {
    ready: boolean;
    reason?: string | undefined;
    returnHref?: string | undefined;
    returnLabel?: string | undefined;
  };
  basis: readonly StageReviewBasisItem[];
  upstream: readonly StageReviewBasisItem[];
  files: readonly StageReviewFileView[];
  generation: {
    status: StageGenerationStatus;
    reason: string;
    enabled: boolean;
    onGenerate: () => void;
    onReceipt?: (() => void) | undefined;
    onQuery?: (() => void) | undefined;
  };
  finalization: StageReviewFinalizationView;
  next?: { label: string; href: string; reason: string } | undefined;
  review?:
    | {
        data: MarkdownReviewData;
        opinion: ReviewOpinionModel;
        opinionActions: ReviewOpinionActions;
        workspace: ReviewWorkspaceInput;
        download: ReviewDownload;
        busy: boolean;
        directoryStatus: string;
        onMore: () => Promise<void>;
      }
    | undefined;
  controls: ReactNode;
}

const stageDescriptions: Record<MvpStageId, string> = {
  MANUAL: '审阅质量手册候选，提交意见并用一个匹配的模拟结果定稿精确版本。',
  PROCEDURES: '以已定稿质量手册为依据，联动审阅控制程序与管理制度，整体确认完整版本集合。',
  RECORDS: '以质量手册和第二阶段完整集合为依据，审阅 Markdown 记录表单；不设单独定稿关卡。',
};

const generationLabels: Record<StageGenerationStatus, string> = {
  NONE: '尚未生成候选',
  PENDING: '生成请求待回执',
  UNKNOWN: '生成结果待核验',
  FAILED: '生成失败',
  RECEIVED: '生成回执已到达',
  MISMATCH: '生成回执不匹配',
};

export function StageReviewPage({
  stage,
  projectId,
  analysisReportId,
  statusMessage,
  plan,
  reviewStages,
  readiness,
  basis,
  upstream,
  files,
  generation,
  finalization,
  next,
  review,
  controls,
}: StageReviewPageProps) {
  const [open, setOpen] = useState(false);
  const stageLabel = mvpStageLabels[stage];
  const missing = files.filter((file) => file.missing);
  const title = stage === 'MANUAL' ? '质量手册审阅' : `${stageLabel}审阅`;
  return (
    <div className="stage-review-page">
      <JourneyNav
        current={stage}
        analysisReportId={analysisReportId}
        scopeEnabled
        reviewStages={reviewStages}
      />
      <div className="page-head">
        <div>
          <p className="eyebrow">
            {projectId} · 计划 {plan.planId} 第 {plan.planVersion} 版 · {plan.stateLabel}
          </p>
          <h1 tabIndex={-1}>{title}</h1>
          <p className="muted">{stageDescriptions[stage]}</p>
        </div>
      </div>
      <div className="demo" role="note">
        U2 三阶段审阅演练 · 候选、保存、意见回执与定稿均为合成页面状态；不调用 Core 或
        Runner，刷新清理本页内存。
      </div>
      {statusMessage && (
        <p className="notice" role="status">
          {statusMessage}
        </p>
      )}
      {!readiness.ready ? (
        <section className="panel" role="status">
          <h2>缺少本阶段前置依据</h2>
          <p>{readiness.reason ?? '当前上下文不足，不能开始本阶段。'}</p>
          {readiness.returnHref && (
            <Link className="button primary" to={readiness.returnHref}>
              {readiness.returnLabel ?? '返回核对前置依据'}
            </Link>
          )}
        </section>
      ) : (
        <>
          <section className="panel stage-basis" aria-label="计划与依据">
            <h2>计划与依据</h2>
            <p className="muted">
              页面只读取本项目的已确认计划；直接打开链接不会补造缺失的计划、输入或上游定稿。
            </p>
            <ul>
              {basis.map((item) => (
                <li key={`${item.label}:${item.detail}`}>
                  <strong>{item.label}</strong>
                  <span>{item.detail}</span>
                </li>
              ))}
            </ul>
            <h3>上游定稿依据</h3>
            {upstream.length > 0 ? (
              <ul className="stage-upstream">
                {upstream.map((item) => (
                  <li key={`${item.label}:${item.detail}`}>
                    <strong>{item.label}</strong>
                    <span>{item.detail}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">第一阶段没有上游定稿；以已确认计划与输入依据为准。</p>
            )}
            {missing.length > 0 && generation.status === 'RECEIVED' && (
              <p className="notice" role="status">
                当前缺少文件或版本：{missing.map((file) => file.title).join('、')}
                ；缺失项不能进入定稿。
              </p>
            )}
          </section>
          {!review && (
            <section className="panel stage-generation" aria-label="模拟候选生成">
              <h2>模拟候选生成</h2>
              <p>
                <span className="status-tag">{generationLabels[generation.status]}</span>{' '}
                {generation.reason}
              </p>
              <div className="stage-action-row">
                <button
                  className="primary"
                  disabled={!generation.enabled}
                  onClick={generation.onGenerate}
                >
                  模拟生成本阶段候选
                </button>
                {generation.onReceipt &&
                  (generation.status === 'PENDING' || generation.status === 'UNKNOWN') && (
                    <button onClick={generation.onReceipt}>模拟原生成回执到达</button>
                  )}
                {generation.onQuery &&
                  (generation.status === 'PENDING' ||
                    generation.status === 'UNKNOWN' ||
                    generation.status === 'MISMATCH') && (
                    <button onClick={generation.onQuery}>重新查询原生成请求</button>
                  )}
              </div>
            </section>
          )}
          {review && (
            <MarkdownReviewPage
              data={review.data}
              busy={review.busy}
              directoryStatus={review.directoryStatus}
              onMore={review.onMore}
              download={review.download}
              opinion={review.opinion}
              opinionActions={review.opinionActions}
              workspace={review.workspace}
            />
          )}
          <section className="panel stage-set" aria-label="本阶段完整文件版本">
            <h2>本阶段完整文件版本</h2>
            <p className="muted">
              阶段定稿确认的是下列完整集合，不按逐文件批准拼装；两类文件之间没有审批关卡。
            </p>
            <table>
              <thead>
                <tr>
                  <th scope="col">文件</th>
                  <th scope="col">层级</th>
                  <th scope="col">动作</th>
                  <th scope="col">当前查看</th>
                  <th scope="col">最新候选</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file.fileId}>
                    <th scope="row">{file.title}</th>
                    <td>{file.levelLabel}</td>
                    <td>{file.actionLabel}</td>
                    <td>{file.missing ? '缺失' : file.versionLabel}</td>
                    <td>{file.latestVersionLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="panel stage-finalize" aria-label="阶段定稿">
            <h2>阶段定稿</h2>
            {!finalization.supported ? (
              <>
                <p>
                  记录表单不设单独定稿关卡，也不要求逐文件批准。最终交付清单确认与打包属于
                  U3，目前尚未实现。
                </p>
                <p className="muted">
                  本页可阅读、提交反馈并查看修订候选；不显示已交付、ZIP 可用或真实包下载。
                </p>
              </>
            ) : finalization.status === 'DONE' && finalization.result ? (
              <div className="stage-finalization-result" role="status">
                <h3>模拟阶段定稿已完成</h3>
                <dl>
                  <div>
                    <dt>定稿</dt>
                    <dd>{finalization.result.finalizationId}</dd>
                  </div>
                  <div>
                    <dt>计划</dt>
                    <dd>{finalization.result.planLabel}</dd>
                  </div>
                  {finalization.result.manualLabel && (
                    <div>
                      <dt>手册依据</dt>
                      <dd>{finalization.result.manualLabel}</dd>
                    </div>
                  )}
                  <div>
                    <dt>版本集合</dt>
                    <dd>
                      {finalization.exactSet
                        .map((file) => `${file.title} · ${file.versionLabel}`)
                        .join('；')}
                    </dd>
                  </div>
                </dl>
                <p className="muted">
                  仅本页模拟结果，不是服务器保存、业务批准或 Runner 完成；U2 不提供上游重新定稿。
                </p>
              </div>
            ) : (
              <>
                <p>{finalization.reason}</p>
                {finalization.status === 'FAILED' && (
                  <div className="error" role="alert">
                    <strong>定稿失败</strong>
                    <p>原阅读位置、草稿与依据保留；可显式重新发起一次新请求。</p>
                  </div>
                )}
                {(finalization.status === 'PENDING' ||
                  finalization.status === 'UNKNOWN' ||
                  finalization.status === 'MISMATCH') && (
                  <div
                    className={finalization.status === 'MISMATCH' ? 'error' : 'notice'}
                    role={finalization.status === 'MISMATCH' ? 'alert' : 'status'}
                  >
                    <strong>
                      {finalization.status === 'PENDING'
                        ? '定稿请求待回执'
                        : finalization.status === 'UNKNOWN'
                          ? '定稿结果待核验'
                          : '定稿回执不匹配'}
                    </strong>
                    <p>只查询原请求；重复点击或页面往返不会创建第二个定稿意图。</p>
                    {finalization.requestLabel && (
                      <p className="muted">原请求 {finalization.requestLabel}</p>
                    )}
                  </div>
                )}
                <div className="stage-action-row">
                  <AlertDialog.Root open={open} onOpenChange={setOpen}>
                    <AlertDialog.Trigger asChild>
                      <button className="primary" disabled={!finalization.canConfirm}>
                        {stage === 'MANUAL'
                          ? '确认质量手册定稿（模拟）'
                          : '确认第二阶段完整集合（模拟）'}
                      </button>
                    </AlertDialog.Trigger>
                    <AlertDialog.Portal>
                      <AlertDialog.Overlay className="dialog-overlay" />
                      <AlertDialog.Content className="dialog-content">
                        <AlertDialog.Title>
                          确认{stage === 'MANUAL' ? '质量手册' : '第二阶段'}定稿（模拟）
                        </AlertDialog.Title>
                        <AlertDialog.Description>
                          一次确认下列完整文件/版本集合；不按逐文件批准拼装。只生成页面内模拟回执。
                        </AlertDialog.Description>
                        <ul>
                          {finalization.exactSet.map((file) => (
                            <li key={file.fileId}>
                              {file.title} · {file.versionLabel}
                            </li>
                          ))}
                        </ul>
                        <p className="muted">
                          计划 {plan.planId} 第 {plan.planVersion} 版 · 上游：
                          {upstream.map((item) => `${item.label}（${item.detail}）`).join('；') ||
                            '无'}
                        </p>
                        <div className="dialog-actions">
                          <AlertDialog.Cancel asChild>
                            <button>返回核对</button>
                          </AlertDialog.Cancel>
                          <button
                            className="primary"
                            disabled={!finalization.canConfirm}
                            onClick={() => {
                              finalization.onConfirm();
                              setOpen(false);
                            }}
                          >
                            确认并生成模拟回执
                          </button>
                        </div>
                      </AlertDialog.Content>
                    </AlertDialog.Portal>
                  </AlertDialog.Root>
                  {finalization.onReceipt &&
                    (finalization.status === 'PENDING' ||
                      finalization.status === 'UNKNOWN' ||
                      finalization.status === 'MISMATCH') && (
                      <button onClick={finalization.onReceipt}>模拟原定稿回执到达</button>
                    )}
                  {(finalization.status === 'PENDING' ||
                    finalization.status === 'UNKNOWN' ||
                    finalization.status === 'MISMATCH') && (
                    <button onClick={finalization.onQuery}>重新查询原定稿请求</button>
                  )}
                  {finalization.status === 'FAILED' && (
                    <button onClick={finalization.onRetry}>重新发起定稿（模拟）</button>
                  )}
                </div>
              </>
            )}
            {finalization.supported && finalization.status !== 'DONE' && (
              <p className="muted">
                定稿按钮在缺文件、版本变化、新候选未核对或有待回执修改时保持不可用。
              </p>
            )}
          </section>
          {next && (
            <section className="panel stage-next" aria-label="下一业务阶段">
              <h2>{next.label}</h2>
              <p>{next.reason}</p>
              <Link className="button primary" to={next.href}>
                {next.label}
              </Link>
            </section>
          )}
        </>
      )}
      <section className="panel stage-controls" aria-label="U2 演练控制">
        <h2>U2 演练控制</h2>
        <p className="muted">
          以下控件显式驱动页面状态；不会上传、调用
          Runner、保存服务器记录或按时间推断成功。普通页内导航保留本次演练草稿与历史，刷新会重置。
        </p>
        {controls}
      </section>
    </div>
  );
}

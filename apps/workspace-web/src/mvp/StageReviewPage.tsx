import { Alert } from '../components/ui/alert.js';
import { Badge } from '../components/ui/badge.js';
import { Card } from '../components/ui/card.js';
import { buttonVariants, Button } from '../components/ui/button.js';
import {
  Table,
  TableCaption,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '../components/ui/table.js';
import { MockControls } from '../fixtures/control-slot.js';
import { useRef, useState, type ReactNode } from 'react';
import {
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialog,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../components/ui/alert-dialog.js';
import { Link } from 'react-router';
import { MarkdownReviewPage, type MarkdownReviewData } from '../MarkdownReviewPage.js';
import type {
  ReviewDownload,
  ReviewOpinionActions,
  ReviewOpinionModel,
  ReviewWorkspaceInput,
} from '../review/model.js';
import { JourneyNav, type JourneyReviewStage } from './JourneyNav.js';
import type { MvpStageId } from './review-model.js';
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

export interface StageReworkImpactView {
  changes: readonly {
    sourceLabel: string;
    previousBasisId: string;
    newBasisId: string;
  }[];
  note: string;
  files: readonly {
    fileId: string;
    title: string;
    actionLabel: string;
    reason: string;
  }[];
}

export interface StageReworkView {
  notice?: string | undefined;
  previous?:
    | {
        finalizationId: string;
        supersededBy: string;
        files: readonly { fileId: string; title: string; versionLabel: string }[];
      }
    | undefined;
  impact?: StageReworkImpactView | undefined;
}

export interface StageReviewFinalizationView {
  status: 'NONE' | 'PENDING' | 'UNKNOWN' | 'FAILED' | 'MISMATCH' | 'DONE';
  reason: string;
  canConfirm: boolean;
  /** A newer rechecked set replaces the current finalization while preserving history. */
  refinalize?: boolean | undefined;
  requestLabel?: string | undefined;
  exactSet: readonly StageReviewFileView[];
  result?:
    | {
        finalizationId: string;
        planLabel: string;
        manualLabel?: string | undefined;
        procedureLabel?: string | undefined;
        files: readonly { fileId: string; title: string; versionLabel: string }[];
      }
    | undefined;
  onConfirm: () => void;
  onReceipt?: (() => void) | undefined;
  onQuery: () => void;
  onRetry: () => void;
  onReset?: (() => void) | undefined;
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
  rework?: StageReworkView | undefined;
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
  PROCEDURES: '以已定稿质量手册为依据，整体确认控制程序的精确版本集合。',
  RULES: '以已定稿质量手册和完整控制程序集合为依据，审阅管理制度及记录表单并整体确认精确版本集合。',
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
  rework,
  files,
  generation,
  finalization,
  next,
  review,
  controls,
}: StageReviewPageProps) {
  const [open, setOpen] = useState(false);
  const confirmTrigger = useRef<HTMLButtonElement>(null);
  const confirmationPanel = useRef<HTMLElement>(null);
  const receiptPanel = useRef<HTMLDivElement>(null);
  const missing = files.filter((file) => file.missing);
  const title =
    stage === 'MANUAL'
      ? '质量手册审阅'
      : stage === 'PROCEDURES'
        ? '控制程序审阅'
        : '管理制度及记录表单审阅';
  const finalizationNoun =
    stage === 'MANUAL'
      ? '质量手册定稿'
      : stage === 'PROCEDURES'
        ? '控制程序完整集合'
        : '管理制度及记录表单完整集合';
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
        <Alert asChild variant="warning">
          <p className="notice" role="status">
            {statusMessage}
          </p>
        </Alert>
      )}
      {!readiness.ready ? (
        <Card asChild>
          <section className="panel" role="status">
            <h2>缺少本阶段前置依据</h2>
            <p>{readiness.reason ?? '当前上下文不足，不能开始本阶段。'}</p>
            {readiness.returnHref && (
              <Link className={buttonVariants({ variant: 'default' })} to={readiness.returnHref}>
                {readiness.returnLabel ?? '返回核对前置依据'}
              </Link>
            )}
          </section>
        </Card>
      ) : (
        <>
          {rework?.notice && (
            <Alert asChild variant="warning">
              <p className="notice stage-rework-notice" role="status">
                {rework.notice}
              </p>
            </Alert>
          )}
          {rework?.previous && (
            <Card asChild>
              <section className="panel stage-rework" aria-label="上游定稿历史">
                <h2>上游定稿历史</h2>
                <p className="muted">
                  前一版定稿保留在历史中；只有匹配的新定稿回执才替换当前依据，不覆盖历史。
                </p>
                <p>
                  上一版定稿 <strong>{rework.previous.finalizationId}</strong> · 已由{' '}
                  {rework.previous.supersededBy} 替代
                </p>
                <ul>
                  {rework.previous.files.map((file) => (
                    <li key={file.fileId}>
                      {file.title} · {file.versionLabel}
                    </li>
                  ))}
                </ul>
              </section>
            </Card>
          )}
          {rework?.impact && (
            <Card asChild>
              <section className="panel stage-rework-impact" aria-label="上游依据变化与下游影响">
                <h2>上游依据变化与下游影响</h2>
                <Table>
                  <TableCaption>本次变化的上游依据</TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">变化来源</TableHead>
                      <TableHead scope="col">旧依据</TableHead>
                      <TableHead scope="col">新依据</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rework.impact.changes.map((change) => (
                      <TableRow
                        key={`${change.sourceLabel}:${change.previousBasisId}:${change.newBasisId}`}
                      >
                        <TableHead scope="row">{change.sourceLabel}</TableHead>
                        <TableCell>{change.previousBasisId}</TableCell>
                        <TableCell>{change.newBasisId}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Alert asChild variant="warning">
                  <p className="notice" role="status">
                    本阶段标记“依据已变化，待复核”。影响按阶段保守覆盖，未复核前最终交付保持阻断。
                  </p>
                </Alert>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">受影响文件</TableHead>
                      <TableHead scope="col">处理</TableHead>
                      <TableHead scope="col">上游提供理由</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rework.impact.files.map((file) => (
                      <TableRow key={file.fileId}>
                        <TableHead scope="row">{file.title}</TableHead>
                        <TableCell>{file.actionLabel}</TableCell>
                        <TableCell>{file.reason}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="muted">{rework.impact.note}</p>
              </section>
            </Card>
          )}
          <Card asChild>
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
                <Alert asChild variant="warning">
                  <p className="notice" role="status">
                    当前缺少文件或版本：{missing.map((file) => file.title).join('、')}
                    ；缺失项不能进入定稿。
                  </p>
                </Alert>
              )}
            </section>
          </Card>
          {!review && (
            <Card asChild>
              <section className="panel stage-generation" aria-label="模拟候选生成">
                <h2>模拟候选生成</h2>
                <p>
                  <Badge className="status-tag">{generationLabels[generation.status]}</Badge>{' '}
                  {generation.reason}
                </p>
                <div className="stage-action-row">
                  <Button
                    variant="default"
                    disabled={!generation.enabled}
                    onClick={generation.onGenerate}
                  >
                    模拟生成本阶段候选
                  </Button>
                  {generation.onReceipt &&
                    (generation.status === 'PENDING' || generation.status === 'UNKNOWN') && (
                      <MockControls>
                        <Button onClick={generation.onReceipt}>模拟原生成回执到达</Button>
                      </MockControls>
                    )}
                  {generation.onQuery &&
                    (generation.status === 'PENDING' ||
                      generation.status === 'UNKNOWN' ||
                      generation.status === 'MISMATCH') && (
                      <Button onClick={generation.onQuery}>重新查询原生成请求</Button>
                    )}
                </div>
              </section>
            </Card>
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
          <Card asChild>
            <section className="panel stage-set" aria-label="本阶段完整文件版本">
              <h2>本阶段完整文件版本</h2>
              <p className="muted">
                阶段定稿确认的是下列完整集合，不按逐文件批准拼装；每个业务阶段整体确认，阶段之间不增加额外审批层。
              </p>
              {finalization.status === 'DONE' && (
                <p className="muted">
                  本表是当前阅读选择；本次冻结的定稿集合见“模拟阶段定稿已完成”。
                </p>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">文件</TableHead>
                    <TableHead scope="col">层级</TableHead>
                    <TableHead scope="col">动作</TableHead>
                    <TableHead scope="col">当前查看</TableHead>
                    <TableHead scope="col">最新候选</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {files.map((file) => (
                    <TableRow key={file.fileId}>
                      <TableHead scope="row">{file.title}</TableHead>
                      <TableCell>{file.levelLabel}</TableCell>
                      <TableCell>{file.actionLabel}</TableCell>
                      <TableCell>{file.missing ? '缺失' : file.versionLabel}</TableCell>
                      <TableCell>{file.latestVersionLabel}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          </Card>
          <Card asChild>
            <section
              className="panel stage-finalize"
              aria-label="阶段定稿"
              ref={confirmationPanel}
              tabIndex={-1}
            >
              <h2>阶段定稿</h2>
              {finalization.status === 'DONE' && finalization.result && (
                <div
                  className="stage-finalization-result"
                  role="status"
                  ref={receiptPanel}
                  tabIndex={-1}
                >
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
                    {finalization.result.procedureLabel && (
                      <div>
                        <dt>控制程序依据</dt>
                        <dd>{finalization.result.procedureLabel}</dd>
                      </div>
                    )}
                    <div>
                      <dt>冻结版本集合</dt>
                      <dd>
                        {finalization.result.files
                          .map((file) => `${file.title} · ${file.versionLabel}`)
                          .join('；')}
                      </dd>
                    </div>
                  </dl>
                  <p className="muted">
                    本结果绑定上述冻结版本；之后切换阅读版本不会改写本次定稿。仅本页模拟结果，不是服务器保存、业务批准或
                    Runner 完成；前一版定稿保留在历史中，受影响下游需重新复核。
                  </p>
                </div>
              )}
              {(finalization.status !== 'DONE' || finalization.refinalize) && (
                <>
                  <p>{finalization.reason}</p>
                  {finalization.status === 'FAILED' && (
                    <Alert asChild variant="warning">
                      <div className="error" role="alert">
                        <strong>定稿失败</strong>
                        <p>原阅读位置、草稿与依据保留；可显式重新发起一次新请求。</p>
                      </div>
                    </Alert>
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
                    <AlertDialog open={open} onOpenChange={setOpen}>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="default"
                          ref={confirmTrigger}
                          disabled={!finalization.canConfirm}
                        >
                          {finalization.refinalize ? '重新确认' : '确认'}
                          {finalizationNoun}（模拟）
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent
                        className="dialog-content"
                        onCloseAutoFocus={(event) => {
                          event.preventDefault();
                          if (confirmTrigger.current && !confirmTrigger.current.disabled)
                            confirmTrigger.current.focus();
                          else (receiptPanel.current ?? confirmationPanel.current)?.focus();
                        }}
                      >
                        <AlertDialogTitle>
                          {finalization.refinalize ? '重新确认' : '确认'}
                          {finalizationNoun}（模拟）
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          一次确认下列完整文件/版本集合；不按逐文件批准拼装。
                          {finalization.refinalize
                            ? '前一版定稿会保留在历史中，本次回执替换当前依据。'
                            : '只生成页面内模拟回执。'}
                        </AlertDialogDescription>
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
                          <AlertDialogCancel asChild>
                            <Button>返回核对</Button>
                          </AlertDialogCancel>
                          <Button
                            variant="default"
                            disabled={!finalization.canConfirm}
                            onClick={() => {
                              finalization.onConfirm();
                              setOpen(false);
                            }}
                          >
                            确认并生成模拟回执
                          </Button>
                        </div>
                      </AlertDialogContent>
                    </AlertDialog>
                    {finalization.onReceipt &&
                      (finalization.status === 'PENDING' || finalization.status === 'UNKNOWN') && (
                        <MockControls>
                          <Button onClick={finalization.onReceipt}>模拟原定稿回执到达</Button>
                        </MockControls>
                      )}
                    {(finalization.status === 'PENDING' ||
                      finalization.status === 'UNKNOWN' ||
                      finalization.status === 'MISMATCH') && (
                      <Button onClick={finalization.onQuery}>重新查询原定稿请求</Button>
                    )}
                    {finalization.status === 'FAILED' && (
                      <Button onClick={finalization.onRetry}>重新发起定稿（模拟）</Button>
                    )}
                    {finalization.status === 'MISMATCH' && finalization.onReset && (
                      <Button onClick={finalization.onReset}>重新核对后重试定稿（模拟）</Button>
                    )}
                  </div>
                </>
              )}
              {(finalization.status !== 'DONE' || finalization.refinalize) && (
                <p className="muted">
                  定稿按钮在缺文件、版本变化、新候选未核对或有待回执修改时保持不可用。
                </p>
              )}
            </section>
          </Card>
          {next && (
            <Card asChild>
              <section className="panel stage-next" aria-label="下一业务阶段">
                <h2>{next.label}</h2>
                <p>{next.reason}</p>
                <Link className={buttonVariants({ variant: 'default' })} to={next.href}>
                  {next.label}
                </Link>
              </section>
            </Card>
          )}
        </>
      )}
      {controls}
    </div>
  );
}

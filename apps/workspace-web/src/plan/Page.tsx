import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import {
  matchesPlanReceipt,
  planLevelLabels,
  planStateLabels,
  type PlanState,
  type PlanView,
  type RevisionRequest,
} from './model.js';
import './plan.css';

interface Props {
  plan: PlanView;
  plans: readonly PlanView[];
  notice?: ReactNode | undefined;
  revision?: RevisionRequest | null | undefined;
  generation: {
    enabled: boolean;
    reason: string;
    state: 'NONE' | 'REQUESTED';
    onOpen?: (() => void) | undefined;
  };
  nextStage: {
    entered: boolean;
    onEnter: () => void;
    disabledReason?: string | undefined;
  };
  onConfirm: (intentId: string) => void;
  onFeedback: (text: string) => void;
  onExpand: () => void;
  onQuery: () => void;
  onRetry: () => void;
  onSelectPlan: (planId: string) => void;
  blockedReason?: string | undefined;
  statusMessage?: string | undefined;
  controls?: ReactNode;
  development?: boolean;
}
const statusTone: Partial<Record<PlanState, string>> = {
  PENDING: 'notice',
  FAILED: 'error',
  UNKNOWN: 'error',
  SUPERSEDED: 'notice',
};
export function PlanPage({
  plan,
  plans,
  notice,
  revision,
  generation,
  nextStage,
  onConfirm,
  onFeedback,
  onExpand,
  onQuery,
  onRetry,
  onSelectPlan,
  blockedReason,
  statusMessage,
  controls,
  development = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [expandedGeneration, setExpandedGeneration] = useState(false);
  const intent = useRef(crypto.randomUUID());
  const current = plan.state !== 'SUPERSEDED' && !plan.supersededBy;
  const confirmed = plan.state === 'CONFIRMED' && current;
  const confirmable =
    current && (plan.state === 'DRAFT' || plan.state === 'FAILED') && blockedReason === undefined;
  const exactFiles = plan.files.filter((file) => file.action !== 'RETAIN');
  useEffect(() => {
    if (!open) intent.current = crypto.randomUUID();
  }, [open]);
  const tone = statusTone[plan.state];
  return (
    <div className="plan-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">
            修改范围 · 计划第 {plan.version} 版 · 报告 {plan.reportId} 第 {plan.reportVersion} 版
          </p>
          <h1 tabIndex={-1}>确认修改范围</h1>
          <p className="muted">先核对精确计划与依据；未确认的计划不能进入模拟生成。</p>
        </div>
      </div>
      {development && (
        <div className="demo" role="note">
          U1 范围确认演练 · 合成计划与回执；不创建执行请求、不调用 Core 或
          Runner，刷新清理本页内存。
        </div>
      )}
      {notice}
      {plan.supersededBy && (
        <div className="notice" role="status">
          此计划已被第 {plans.find((item) => item.planId === plan.supersededBy)?.version ?? '新'}
          版计划替代；旧回执保留，但不能用于生成。
        </div>
      )}
      {statusMessage && <p role="status">{statusMessage}</p>}
      {tone && (
        <div
          className={tone}
          role={plan.state === 'FAILED' || plan.state === 'UNKNOWN' ? 'alert' : 'status'}
        >
          <strong>{planStateLabels[plan.state]}</strong>
          {plan.state === 'PENDING' && <p>确认回执尚未到达；重复点击不会创建第二个意图。</p>}
          {plan.state === 'FAILED' && (
            <p>{plan.failure ?? '确认失败，原计划与已选文件保留。'} 可重新确认同一计划。</p>
          )}
          {plan.state === 'UNKNOWN' && (
            <p>不能判断原确认是否生效。请查询同一模拟请求；查询完成前不再次提交。</p>
          )}
        </div>
      )}
      <section className="panel plan-summary" aria-label="计划依据">
        <div className="plan-basis">
          <div>
            <h2>精确输入依据</h2>
            <ul>
              {plan.inputBasis.map((basis) => (
                <li key={basis.batchId}>
                  <strong>{basis.label}</strong> · {basis.batchId} · 来源{' '}
                  {basis.sourceIds.join('、') || '无新增文件'}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2>正式模板依据</h2>
            <ul>
              {plan.templateBasis.map((template) => (
                <li key={template}>{template}</li>
              ))}
            </ul>
          </div>
        </div>
        <dl className="plan-prose">
          <div>
            <dt>当前情况</dt>
            <dd>{plan.currentSituation}</dd>
          </div>
          <div>
            <dt>问题</dt>
            <dd>{plan.problem}</dd>
          </div>
          <div>
            <dt>建议</dt>
            <dd>{plan.proposal}</dd>
          </div>
          <div>
            <dt>影响</dt>
            <dd>{plan.impact}</dd>
          </div>
        </dl>
      </section>
      <section className="panel plan-files" aria-label="本轮精确文件范围">
        <div className="scope-top">
          <h2>本轮精确文件范围</h2>
          <span className="status-tag">
            {exactFiles.length} 份生成 · {plan.retained.length} 份保留不生成
          </span>
        </div>
        <p className="muted">
          文件层级与业务阶段分别表达；已确认过的文件不会因历史确认被永久排除。
        </p>
        <ol className="plan-file-list">
          {exactFiles.map((file) => (
            <li key={file.id}>
              <article className="file-plan">
                <div className="file-plan-main">
                  <div>
                    <small>
                      {planLevelLabels[file.level]} · {file.id} ·{' '}
                      {file.action === 'REVISE' ? '修订' : '新增'}
                    </small>
                    <h3>{file.title}</h3>
                  </div>
                  <span className="status-tag">本轮范围内</span>
                </div>
                <dl className="plan-file-detail">
                  <div>
                    <dt>当前</dt>
                    <dd>{file.current}</dd>
                  </div>
                  <div>
                    <dt>建议</dt>
                    <dd>{file.proposal}</dd>
                  </div>
                  <div>
                    <dt>影响</dt>
                    <dd>{file.impact}</dd>
                  </div>
                </dl>
                <p className="muted">
                  输入：{file.inputSourceIds.join('、')} · 模板：{file.templateSourceIds.join('、')}
                </p>
              </article>
            </li>
          ))}
        </ol>
        {plan.retained.length > 0 && (
          <details className="plan-retained">
            <summary>保留但不生成的客户内部表单</summary>
            <ul>
              {plan.retained.map((item) => (
                <li key={item.id}>
                  <strong>
                    {item.id} · {item.title}
                  </strong>
                  <p>{item.reason}</p>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
      <section className="panel plan-actions" aria-label="范围确认与后续操作">
        {blockedReason && (
          <p className="error" role="alert">
            {blockedReason}
          </p>
        )}
        <div className="plan-action-row">
          <AlertDialog.Root open={open} onOpenChange={setOpen}>
            <AlertDialog.Trigger asChild>
              <button className="primary" disabled={!confirmable}>
                {plan.state === 'FAILED' ? '重新确认这份计划' : '确认这份修改范围'}
              </button>
            </AlertDialog.Trigger>
            <AlertDialog.Portal>
              <AlertDialog.Overlay className="dialog-overlay" />
              <AlertDialog.Content className="dialog-content">
                <AlertDialog.Title>
                  确认计划第 {plan.version} 版{development ? '（演示）' : ''}
                </AlertDialog.Title>
                <AlertDialog.Description>
                  绑定报告 {plan.reportId} 第 {plan.reportVersion} 版、输入依据与以下{' '}
                  {exactFiles.length} 份文件。{development ? '只生成页面内模拟回执。' : ''}
                </AlertDialog.Description>
                <ul>
                  {exactFiles.map((file) => (
                    <li key={file.id}>
                      {file.title} · {planLevelLabels[file.level]} ·{' '}
                      {file.action === 'REVISE' ? '修订' : '新增'}
                    </li>
                  ))}
                </ul>
                <p className="muted">
                  输入依据：{plan.inputBasis.flatMap((basis) => basis.sourceIds).join('、')}
                </p>
                <div className="dialog-actions">
                  <AlertDialog.Cancel asChild>
                    <button>返回核对</button>
                  </AlertDialog.Cancel>
                  <button
                    className="primary"
                    disabled={!confirmable}
                    onClick={() => {
                      if (!confirmable) return;
                      onConfirm(intent.current);
                      setOpen(false);
                    }}
                  >
                    确认并生成模拟回执
                  </button>
                </div>
              </AlertDialog.Content>
            </AlertDialog.Portal>
          </AlertDialog.Root>
          {plan.state === 'PENDING' && <button onClick={onQuery}>查询同一确认请求</button>}
          {plan.state === 'UNKNOWN' && <button onClick={onQuery}>重新查询原请求</button>}
          {plan.state === 'FAILED' && <button onClick={onRetry}>使用新意图重试确认</button>}
          <button disabled={!confirmed} onClick={onExpand}>
            扩大范围：新增变更通知单（演示）
          </button>
        </div>
        {!confirmable && !confirmed && plan.state !== 'PENDING' && plan.state !== 'UNKNOWN' && (
          <p className="muted" role="status">
            {plan.supersededBy
              ? '旧计划不能确认或生成，请核对当前计划版本。'
              : '当前计划状态不允许再次确认。'}
          </p>
        )}
        {plan.receipt && (
          <div className="plan-receipt" role="status">
            <h3>模拟范围确认回执</h3>
            {matchesPlanReceipt(plan, plan.receipt) ? (
              <p>
                <strong>回执与计划、报告版本和输入依据匹配。</strong>
              </p>
            ) : (
              <p role="alert">回执与当前计划不匹配，不能作为确认依据。</p>
            )}
            <dl>
              <div>
                <dt>请求</dt>
                <dd>{plan.receipt.requestId}</dd>
              </div>
              <div>
                <dt>计划</dt>
                <dd>
                  {plan.receipt.planId} · 第 {plan.receipt.planVersion} 版
                </dd>
              </div>
              <div>
                <dt>报告</dt>
                <dd>
                  {plan.receipt.reportId} · 第 {plan.receipt.reportVersion} 版
                </dd>
              </div>
              <div>
                <dt>文件</dt>
                <dd>{plan.receipt.fileIds.join('、')}</dd>
              </div>
              <div>
                <dt>依据</dt>
                <dd>{plan.receipt.inputRefs.join('、')}</dd>
              </div>
            </dl>
            <p className="muted">
              仅本次页面会话的合成回执，不是服务器保存、业务许可或 Runner 执行成功。
            </p>
          </div>
        )}
        <div className="plan-feedback">
          <label>
            范围内反馈（不扩大范围，不需要再次确认）
            <textarea
              rows={3}
              value={feedback}
              onChange={(event) => {
                setFeedback(event.target.value);
              }}
            />
          </label>
          <button
            disabled={!confirmed || feedback.trim().length === 0}
            onClick={() => {
              if (!confirmed || feedback.trim().length === 0) return;
              onFeedback(feedback);
              setFeedback('');
            }}
          >
            提交范围内反馈（模拟修订请求）
          </button>
          {revision && (
            <div className="analysis-receipt" role="status">
              <strong>
                {revision.state === 'RECEIVED'
                  ? '已登记模拟修订请求'
                  : revision.state === 'PENDING'
                    ? '修订请求待回执'
                    : revision.state === 'FAILED'
                      ? '修订请求失败'
                      : '修订请求结果未知'}
              </strong>
              <p>{revision.message}</p>
              <p className="muted">
                原请求 {revision.id} · 计划 {revision.planId} 第 {revision.planVersion} 版
              </p>
            </div>
          )}
        </div>
        <div className="plan-generation">
          <h3>模拟候选生成</h3>
          <p>{generation.reason}</p>
          <button
            className="primary"
            disabled={!generation.enabled || generation.onOpen === undefined}
            onClick={() => {
              if (!generation.enabled) return;
              generation.onOpen?.();
              setExpandedGeneration(true);
            }}
          >
            进入模拟生成（演示）
          </button>
          {(generation.state === 'REQUESTED' || expandedGeneration) && generation.enabled && (
            <p role="status">已登记模拟生成意图；未调用 Runner、未创建候选、未保存服务器记录。</p>
          )}
        </div>
        <div className="plan-next-stage">
          <h3>下一业务阶段（演示）</h3>
          <p>进入下一阶段不重复范围审批；此处只演练交互，不实现 U2 审阅或生成。</p>
          <button
            disabled={!confirmed || nextStage.entered}
            onClick={nextStage.onEnter}
            title={nextStage.disabledReason}
          >
            {nextStage.entered ? '已进入第二阶段（演示）' : '进入第二阶段（演示）'}
          </button>
          {nextStage.entered && (
            <p role="status">范围依据沿用本计划；没有再次弹出范围确认。第二阶段内容尚未交付。</p>
          )}
          {!confirmed && nextStage.disabledReason && (
            <p className="muted">{nextStage.disabledReason}</p>
          )}
        </div>
        {controls}
      </section>
      <section className="panel plan-history" aria-label="计划版本历史">
        <h2>计划版本</h2>
        <ul>
          {plans.map((item) => (
            <li key={item.planId}>
              <button
                aria-current={item.planId === plan.planId ? 'true' : undefined}
                onClick={() => {
                  onSelectPlan(item.planId);
                }}
              >
                第 {item.version} 版 · {planStateLabels[item.state]}
              </button>
              {item.receipt && <small>回执 {item.receipt.requestId}</small>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

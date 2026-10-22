import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { JourneyNav, type JourneyReviewStage } from './JourneyNav.js';
import { mvpDraftStateLabels, type MvpDraft } from './review-model.js';
import './u3.css';

export interface RecoveryFileView {
  fileId: string;
  title: string;
  stageLabel: string;
  stateLabel: string;
  candidateLabel?: string | undefined;
  error?: string | undefined;
  provenance: string;
  correction?: { versionLabel: string; reason: string } | undefined;
}

export interface RecoveryAttemptView {
  attemptId: string;
  requestId: string;
  label: string;
  triggerLabel: string;
  outcomeLabel: string;
  createdAt: string;
  fixedInputs: readonly string[];
  errors: readonly string[];
  note: string;
  files: readonly {
    fileId: string;
    title: string;
    stateLabel: string;
    versionLabel?: string | undefined;
  }[];
}

export interface RecoveryPageProps {
  projectId: string;
  analysisReportId: string;
  plan: { planId: string; planVersion: number; stateLabel: string };
  reviewStages: readonly JourneyReviewStage[];
  batch: {
    requestId: string;
    label: string;
    statusLabel: string;
    statusNote: string;
    fixedInputs: readonly string[];
    errors: readonly string[];
    note: string;
    attempts: readonly RecoveryAttemptView[];
  };
  files: readonly RecoveryFileView[];
  retry: {
    status: string;
    requestLabel?: string | undefined;
    note: string;
    history: readonly {
      requestId: string;
      status: string;
      fileIds: readonly string[];
      note: string;
    }[];
    failedFiles: readonly string[];
    canRetry: boolean;
    canQuery: boolean;
    onRetry: () => void;
    onQuery: () => void;
    onReceipt?: (() => void) | undefined;
  };
  late: {
    note: string;
    records: readonly {
      resultId: string;
      attemptId?: string | undefined;
      disposition: string;
      note: string;
      receivedAt: string;
      filesLabel: string;
    }[];
    onLateAfterBasisChange: () => void;
    onLateAfterNewerAttempt: () => void;
  };
  opinion: {
    draft: MvpDraft;
    history: readonly {
      id: string;
      text: string;
      status: string;
      requestLabel: string;
      basis: string;
    }[];
    onDraftChange: (text: string) => void;
    onSave: () => void;
    saveNote: string;
    canSave: boolean;
  };
  controls: ReactNode;
  links: {
    manual: string;
    procedures: string;
    records: string;
    rework: string;
    delivery: string;
  };
}

const stateLegend = [
  ['等待安排', '尚无执行事实；不能推定为处理中。'],
  ['正在处理', '只显示已提供的处理中事实；不按时间推导完成。'],
  ['部分成功', '成功文件与失败文件分别保留；部分成功不是阶段完成。'],
  ['已知失败', '保留固定输入、原尝试与错误；只能对失败文件建立新尝试。'],
  ['结果待核验', '只查询原尝试；未核对前不启动第二次执行。'],
  ['结果可审阅', '可进入审阅；候选到达不构成定稿或批准。'],
] as const;

export function RecoveryPage({
  projectId,
  analysisReportId,
  plan,
  reviewStages,
  batch,
  files,
  retry,
  late,
  opinion,
  controls,
  links,
}: RecoveryPageProps) {
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
          <h1 tabIndex={-1}>执行与恢复</h1>
          <p className="muted">
            多文件修改批次保留成功候选、原尝试和错误历史；已知失败只重试失败文件，未知结果先核对原请求。
          </p>
        </div>
      </div>
      <div className="demo" role="note">
        环境 A · 执行恢复演练 · 状态、尝试、回执与候选均为合成页面状态；刷新重置，不调用 Core 或
        Runner。
      </div>

      <section className="panel" aria-label="状态说明">
        <h2>状态与下一动作</h2>
        <dl className="u3-legend">
          {stateLegend.map(([label, detail]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="panel" aria-label="当前修改批次">
        <h2>当前修改批次</h2>
        <p>
          <strong>{batch.label}</strong> · {batch.requestId} ·{' '}
          <span className="status-tag">{batch.statusLabel}</span>
        </p>
        <p>{batch.statusNote}</p>
        <p className="muted">{batch.note}</p>
        <div className="u3-table" role="region" aria-label="本批次文件结果" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">文件</th>
                <th scope="col">阶段</th>
                <th scope="col">状态</th>
                <th scope="col">候选/错误</th>
                <th scope="col">来源与历史</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.fileId}>
                  <th scope="row">{file.title}</th>
                  <td>{file.stageLabel}</td>
                  <td>{file.stateLabel}</td>
                  <td>
                    {file.candidateLabel && <div>{file.candidateLabel}</div>}
                    {file.error && <div>{file.error}</div>}
                    {file.correction && (
                      <div>
                        关联修正：{file.correction.versionLabel} · {file.correction.reason}
                      </div>
                    )}
                  </td>
                  <td>{file.provenance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="notice" role="status">
          本项目同时只保留一个活动修改批次；部分成功不显示为阶段完成。
        </p>
      </section>

      <section className="panel" aria-label="失败恢复">
        <h2>失败文件恢复</h2>
        <p>
          <strong>失败文件：</strong>
          {retry.failedFiles.length > 0 ? retry.failedFiles.join('、') : '无'}
        </p>
        <p>{retry.note}</p>
        <p className="muted">重试意图只包含失败文件；成功文件不会被重新生成或覆盖。</p>
        <div className="u3-actions">
          <button className="primary" disabled={!retry.canRetry} onClick={retry.onRetry}>
            仅重试失败文件（模拟）
          </button>
          {retry.onReceipt && <button onClick={retry.onReceipt}>模拟原重试回执到达</button>}
          <button disabled={!retry.canQuery} onClick={retry.onQuery}>
            查询原重试请求
          </button>
        </div>
        <p role="status">
          {retry.status}
          {retry.requestLabel ? ` · 原请求 ${retry.requestLabel}` : ''}
        </p>
        {retry.history.length > 0 && (
          <div className="muted">
            <h3>已结束的重试请求</h3>
            <ul>
              {retry.history.map((entry) => (
                <li key={`${entry.requestId}:${entry.status}`}>
                  {entry.requestId} · {entry.status} · 文件 {entry.fileIds.join('、')} ·{' '}
                  {entry.note}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="panel" aria-label="尝试历史">
        <h2>尝试历史（追加保留）</h2>
        {batch.attempts.map((attempt) => (
          <article key={attempt.attemptId} className="u3-attempt">
            <h3>
              {attempt.label} · {attempt.attemptId}
            </h3>
            <p>
              {attempt.triggerLabel} · {attempt.outcomeLabel} · {attempt.createdAt}
            </p>
            <p>{attempt.note}</p>
            <ul>
              {attempt.files.map((file) => (
                <li key={file.fileId}>
                  {file.title} · {file.stateLabel}
                  {file.versionLabel ? ` · ${file.versionLabel}` : ''}
                </li>
              ))}
            </ul>
            {attempt.fixedInputs.length > 0 && (
              <p className="muted">固定输入：{attempt.fixedInputs.join('；')}</p>
            )}
            {attempt.errors.length > 0 && (
              <ul>
                {attempt.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </section>

      <section className="panel" aria-label="迟到与旧结果">
        <h2>迟到与旧结果</h2>
        <p>{late.note}</p>
        <div className="u3-actions">
          <button onClick={late.onLateAfterBasisChange}>模拟依据变化后的迟到结果</button>
          <button onClick={late.onLateAfterNewerAttempt}>模拟较新尝试后的旧结果</button>
        </div>
        {late.records.length > 0 && (
          <div className="u3-table" role="region" aria-label="迟到结果历史" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th scope="col">结果</th>
                  <th scope="col">原尝试</th>
                  <th scope="col">处置</th>
                  <th scope="col">说明</th>
                  <th scope="col">接收时间</th>
                </tr>
              </thead>
              <tbody>
                {late.records.map((record) => (
                  <tr key={record.resultId}>
                    <th scope="row">{record.resultId}</th>
                    <td>{record.attemptId ?? '无'}</td>
                    <td>{record.disposition}</td>
                    <td>
                      {record.note}
                      <div className="muted">{record.filesLabel}</div>
                    </td>
                    <td>{record.receivedAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted">
          迟到或旧结果只保留来源与历史，不替换当前已接纳版本、阅读、草稿或阶段定稿。
        </p>
      </section>

      <section className="panel" aria-label="下一轮意见">
        <h2>下一轮意见（可继续保存）</h2>
        <p className="muted">
          批次运行期间可以查看结果并保存下一轮意见；输入只在本页内存，刷新会重置，不代表服务器已保存。
        </p>
        <label htmlFor="recovery-note">意见内容</label>
        <textarea
          id="recovery-note"
          value={opinion.draft.text}
          onChange={(event) => {
            opinion.onDraftChange(event.target.value);
          }}
          rows={4}
        />
        <p className="markdown-draft-state">
          {opinion.draft.note} · {mvpDraftStateLabels[opinion.draft.state]}
        </p>
        <div className="u3-actions">
          <button className="primary" disabled={!opinion.canSave} onClick={opinion.onSave}>
            保存下一轮意见（模拟）
          </button>
        </div>
        <p role="status">{opinion.saveNote}</p>
        {opinion.history.length > 0 && (
          <div className="markdown-history">
            <h3>意见与请求历史 · {opinion.history.length} 条</h3>
            <ol>
              {opinion.history.map((entry) => (
                <li key={entry.id}>
                  <p>{entry.text}</p>
                  <small>
                    {entry.status} · {entry.requestLabel} · {entry.basis}
                  </small>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>

      <section className="panel" aria-label="返回与下一步">
        <h2>返回与下一步</h2>
        <p className="muted">失败恢复、迟到结果与意见保存都不改变当前阶段定稿或最终交付清单。</p>
        <div className="u3-actions">
          <Link to={links.manual}>质量手册审阅</Link>
          <Link to={links.procedures}>第二阶段审阅</Link>
          <Link to={links.records}>记录表单审阅</Link>
          <Link to={links.rework}>返工与复核</Link>
          <Link className="button primary" to={links.delivery}>
            最终交付
          </Link>
        </div>
      </section>

      <section className="panel" aria-label="演练控制">
        <h2>演练控制</h2>
        <p className="muted">
          以下控件显式驱动状态；不会执行真实 Runner、不会按时间推断完成，也不会创建第二个原请求。
        </p>
        {controls}
      </section>
    </div>
  );
}

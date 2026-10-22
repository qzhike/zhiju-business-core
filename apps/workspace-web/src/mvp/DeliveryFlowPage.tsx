import { useState, type ReactNode } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { Link } from 'react-router';
import { JourneyNav, type JourneyReviewStage } from './JourneyNav.js';
import {
  downloadStateLabels,
  type DeliveryMember,
  type DeliveryPackage,
  type DeliveryProposal,
  type FrozenDelivery,
  type PackagingStatus,
} from './u3-model.js';
import './u3.css';

export interface DeliveryFlowPageProps {
  projectId: string;
  analysisReportId: string;
  plan: { planId: string; planVersion: number; stateLabel: string };
  reviewStages: readonly JourneyReviewStage[];
  bases: {
    manualLabel: string;
    procedureLabel: string;
    recordsLabel: string;
  };
  blockers: readonly string[];
  proposal: DeliveryProposal;
  selection: {
    selectedIds: readonly string[];
    stale: boolean;
    onToggle: (fileId: string) => void;
    onRecheck: () => void;
  };
  confirmation: {
    status: 'NONE' | 'PENDING' | 'UNKNOWN' | 'FAILED' | 'MISMATCH' | 'DONE';
    requestLabel?: string | undefined;
    note: string;
    history: readonly { requestId: string; status: string; note: string }[];
    canConfirm: boolean;
    onConfirm: () => void;
    onQuery: () => void;
    onMarkEnded?: (() => void) | undefined;
    onReceipt?: (() => void) | undefined;
    frozen?: FrozenDelivery | undefined;
  };
  packaging: {
    status: PackagingStatus;
    note: string;
    requestLabel?: string | undefined;
    canStart: boolean;
    canQuery: boolean;
    canRetry: boolean;
    onStart: () => void;
    onQuery: () => void;
    onRetry: () => void;
    package?: DeliveryPackage | undefined;
  };
  packages: readonly DeliveryPackage[];
  onDownload: (pkg: DeliveryPackage) => void;
  downloadScene: string;
  onDownloadScene: (scene: string) => void;
  controls: ReactNode;
  links: {
    manual: string;
    procedures: string;
    records: string;
    rework: string;
    recovery: string;
  };
}

function selectedMembers(
  proposal: DeliveryProposal,
  selectedIds: readonly string[],
): DeliveryMember[] {
  const selected = new Set(selectedIds);
  return proposal.members.filter((member) => selected.has(member.fileId));
}

function MemberTable({ members }: { members: readonly DeliveryMember[] }) {
  return (
    <div className="u3-table" role="region" aria-label="交付文件与精确版本" tabIndex={0}>
      <table>
        <thead>
          <tr>
            <th scope="col">文件</th>
            <th scope="col">阶段</th>
            <th scope="col">精确版本</th>
            <th scope="col">演练正文</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.fileId}>
              <th scope="row">{member.title}</th>
              <td>{member.stage}</td>
              <td>
                {member.versionLabel} · {member.versionId}
              </td>
              <td>
                <details>
                  <summary>查看 {member.title} 的演练正文</summary>
                  <pre className="u3-content">{member.content}</pre>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PackageView({
  pkg,
  onDownload,
}: {
  pkg: DeliveryPackage;
  onDownload: (pkg: DeliveryPackage) => void;
}) {
  return (
    <article className="u3-package">
      <h3>
        {pkg.label} · {pkg.id}
      </h3>
      <p>
        {pkg.createdAt} · {pkg.availability === 'AVAILABLE' ? '包可用（模拟）' : '包不可用'} ·
        合成演练字节
      </p>
      <p>{pkg.reason}</p>
      <MemberTable members={pkg.frozen.members} />
      <div className="u3-actions">
        <button
          onClick={() => {
            onDownload(pkg);
          }}
          disabled={pkg.availability !== 'AVAILABLE'}
        >
          下载这个演练 ZIP
        </button>
      </div>
      <p className="muted">包可用不等于已下载；下载不表示客户已收到、接受或项目完成。</p>
      {pkg.downloads.length > 0 && (
        <ul>
          {pkg.downloads.map((fact) => (
            <li key={fact.id}>
              {fact.at} · {downloadStateLabels[fact.state]} · {fact.note}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function DeliveryFlowPage({
  projectId,
  analysisReportId,
  plan,
  reviewStages,
  bases,
  blockers,
  proposal,
  selection,
  confirmation,
  packaging,
  packages,
  onDownload,
  downloadScene,
  onDownloadScene,
  controls,
  links,
}: DeliveryFlowPageProps) {
  const [open, setOpen] = useState(false);
  const selected = selectedMembers(proposal, selection.selectedIds);
  const selectionComplete = selected.length === proposal.members.length;
  const confirmationLocked =
    confirmation.status === 'PENDING' ||
    confirmation.status === 'UNKNOWN' ||
    confirmation.status === 'MISMATCH' ||
    confirmation.status === 'DONE';
  const ready =
    blockers.length === 0 && !selection.stale && selectionComplete && !confirmationLocked;
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
          <h1 tabIndex={-1}>最终交付确认</h1>
          <p className="muted">
            一次显式确认冻结精确文件清单；打包失败只重试同一冻结清单，后续改稿不改变历史包。
          </p>
        </div>
      </div>
      <div className="demo" role="note">
        环境 A · 最终交付演练 · 清单、回执、打包与 ZIP 均为合成页面状态；刷新重置，不调用
        Core、Runner 或真实存储。
      </div>

      <section className="panel" aria-label="交付依据">
        <h2>交付依据</h2>
        <dl className="u3-basis">
          <div>
            <dt>质量手册定稿</dt>
            <dd>{bases.manualLabel}</dd>
          </div>
          <div>
            <dt>第二阶段完整集合</dt>
            <dd>{bases.procedureLabel}</dd>
          </div>
          <div>
            <dt>记录表单复核</dt>
            <dd>{bases.recordsLabel}</dd>
          </div>
        </dl>
        {blockers.length > 0 ? (
          <div className="error" role="alert">
            <strong>最终交付当前不可确认</strong>
            <ul>
              {blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
            <p>
              可返回
              <Link to={links.rework}>返工与复核</Link>、
              <Link to={links.records}>记录表单审阅</Link> 或
              <Link to={links.recovery}>执行与恢复</Link>
              处理阻断；本页保留当前选择与上下文。
            </p>
          </div>
        ) : (
          <p className="notice" role="status">
            两项上游依据与记录表单复核均已就绪；确认前请核对下列精确版本。
          </p>
        )}
      </section>

      <section className="panel" aria-label="待交付精确清单">
        <h2>待交付精确清单</h2>
        <p className="muted">
          勾选只表示本次拟交付范围；必须包含全部必需文件。阅读、意见、候选到达或打包回执都不能代替最终确认。
        </p>
        {proposal.members.length === 0 ? (
          <p role="status">当前尚无可用精确版本；请先完成三阶段审阅与复核。</p>
        ) : (
          <div className="u3-table" role="region" aria-label="待交付文件选择" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th scope="col">选择</th>
                  <th scope="col">文件</th>
                  <th scope="col">阶段</th>
                  <th scope="col">精确版本</th>
                  <th scope="col">演练正文</th>
                </tr>
              </thead>
              <tbody>
                {proposal.members.map((member) => (
                  <tr key={member.fileId}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`选择 ${member.title}`}
                        checked={selection.selectedIds.includes(member.fileId)}
                        disabled={confirmation.status !== 'NONE'}
                        onChange={() => {
                          selection.onToggle(member.fileId);
                        }}
                      />
                    </td>
                    <th scope="row">{member.title}</th>
                    <td>{member.stage}</td>
                    <td>
                      {member.versionLabel} · {member.versionId}
                    </td>
                    <td>
                      <details>
                        <summary>查看演练正文</summary>
                        <pre className="u3-content">{member.content}</pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p>
          已选 {selected.length} / {proposal.members.length} 份
          {selection.stale ? ' · 所选版本或依据已变化，需重新核对' : ''}
        </p>
        {confirmationLocked && confirmation.status !== 'DONE' && (
          <p className="notice" role="status">
            原确认请求仍未收敛；清单选择已保留。请查询原请求或显式结束它，不能据此创建第二个确认意图。
          </p>
        )}
        <div className="u3-actions">
          <button disabled={confirmationLocked} onClick={selection.onRecheck}>
            重新核对当前清单（模拟）
          </button>
        </div>
      </section>

      <section className="panel" aria-label="最终确认">
        <h2>最终确认与冻结</h2>
        {confirmation.status === 'DONE' && confirmation.frozen ? (
          <div role="status">
            <h3>清单已冻结（模拟）</h3>
            <p className="muted">
              冻结来自一次匹配的最终确认；新候选、重新阅读或打包不会改变该清单。
            </p>
            <MemberTable members={confirmation.frozen.members} />
          </div>
        ) : (
          <>
            <p>{confirmation.note}</p>
            {confirmation.status !== 'NONE' && (
              <p role="status">
                {confirmation.status === 'PENDING'
                  ? '确认请求待回执'
                  : confirmation.status === 'UNKNOWN'
                    ? '确认结果待核验'
                    : confirmation.status === 'MISMATCH'
                      ? '确认回执与清单或依据不匹配'
                      : confirmation.status === 'FAILED'
                        ? '确认失败（模拟）'
                        : ''}
                {confirmation.requestLabel ? ` · 原请求 ${confirmation.requestLabel}` : ''}
              </p>
            )}
            <div className="u3-actions">
              <AlertDialog.Root open={open} onOpenChange={setOpen}>
                <AlertDialog.Trigger asChild>
                  <button className="primary" disabled={!confirmation.canConfirm || !ready}>
                    确认最终交付清单（模拟）
                  </button>
                </AlertDialog.Trigger>
                <AlertDialog.Portal>
                  <AlertDialog.Overlay className="dialog-overlay" />
                  <AlertDialog.Content className="dialog-content">
                    <AlertDialog.Title>确认最终交付清单（模拟）</AlertDialog.Title>
                    <AlertDialog.Description>
                      一次确认下列精确文件与版本；冻结后新候选不能改变该清单。只生成页面内模拟回执。
                    </AlertDialog.Description>
                    <ul>
                      {selected.map((member) => (
                        <li key={member.fileId}>
                          {member.title} · {member.versionLabel} · {member.versionId}
                        </li>
                      ))}
                    </ul>
                    <p className="muted">
                      手册依据 {bases.manualLabel} · 第二阶段 {bases.procedureLabel} · 记录表单复核{' '}
                      {bases.recordsLabel}
                    </p>
                    <div className="dialog-actions">
                      <AlertDialog.Cancel asChild>
                        <button>返回核对</button>
                      </AlertDialog.Cancel>
                      <button
                        className="primary"
                        disabled={!confirmation.canConfirm || !ready}
                        onClick={() => {
                          confirmation.onConfirm();
                          setOpen(false);
                        }}
                      >
                        确认并冻结清单
                      </button>
                    </div>
                  </AlertDialog.Content>
                </AlertDialog.Portal>
              </AlertDialog.Root>
              {confirmation.onReceipt &&
                (confirmation.status === 'PENDING' ||
                  confirmation.status === 'UNKNOWN' ||
                  confirmation.status === 'MISMATCH') && (
                  <button onClick={confirmation.onReceipt}>模拟原确认回执到达</button>
                )}
              {(confirmation.status === 'PENDING' ||
                confirmation.status === 'UNKNOWN' ||
                confirmation.status === 'MISMATCH') && (
                <>
                  <button onClick={confirmation.onQuery}>重新查询原确认请求</button>
                  {confirmation.onMarkEnded && (
                    <button onClick={confirmation.onMarkEnded}>标记原确认请求已结束（模拟）</button>
                  )}
                </>
              )}
            </div>
            <p className="muted">
              缺必需文件、未解决依据变化、所选版本变化或回执错绑时确认保持不可用；选择与上下文不会丢失。
            </p>
          </>
        )}
        {confirmation.history.length > 0 && (
          <div className="muted">
            <h3>已结束的确认请求</h3>
            <ul>
              {confirmation.history.map((entry) => (
                <li key={`${entry.requestId}:${entry.status}`}>
                  {entry.requestId} · {entry.status} · {entry.note}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {confirmation.status === 'DONE' && confirmation.frozen && (
        <section className="panel" aria-label="打包与下载">
          <h2>打包与下载（同一冻结清单）</h2>
          <p role="status">{packaging.note}</p>
          {packaging.requestLabel && <p className="muted">原打包请求 {packaging.requestLabel}</p>}
          <div className="u3-actions">
            <button className="primary" disabled={!packaging.canStart} onClick={packaging.onStart}>
              {packaging.status === 'NONE' ? '开始打包（模拟）' : '再次打包同一冻结清单（模拟）'}
            </button>
            <button disabled={!packaging.canQuery} onClick={packaging.onQuery}>
              查询原打包请求
            </button>
            <button disabled={!packaging.canRetry} onClick={packaging.onRetry}>
              重试同一冻结清单（模拟）
            </button>
          </div>
          {packaging.package ? (
            <PackageView pkg={packaging.package} onDownload={onDownload} />
          ) : (
            <p className="muted">
              包尚未可用；打包失败或结果待核验时不会重新生成业务文档或重复确认。
            </p>
          )}
          <p className="muted">
            包可用、已请求下载与观察到的下载结果是不同事实；任何一项都不表示客户已收到或项目完成。
          </p>
        </section>
      )}

      <section className="panel" aria-label="历史交付包">
        <h2>历史交付包</h2>
        <p className="muted">
          后续改稿或新确认包不改变历史包的成员与内容；离开页面再返回仍保留在本页内存。
        </p>
        {packages.filter((pkg) => pkg.id !== packaging.package?.id).length === 0 ? (
          <p role="status">尚无历史包。</p>
        ) : (
          packages
            .filter((pkg) => pkg.id !== packaging.package?.id)
            .map((pkg) => <PackageView key={pkg.id} pkg={pkg} onDownload={onDownload} />)
        )}
      </section>

      <section className="panel" aria-label="返回与演练控制">
        <h2>返回与演练控制</h2>
        <div className="u3-actions">
          <Link to={links.manual}>质量手册审阅</Link>
          <Link to={links.procedures}>第二阶段审阅</Link>
          <Link to={links.records}>记录表单审阅</Link>
          <Link to={links.rework}>返工与复核</Link>
          <Link to={links.recovery}>执行与恢复</Link>
        </div>
        <label>
          下载观察场景
          <select
            value={downloadScene}
            onChange={(event) => {
              onDownloadScene(event.target.value);
            }}
          >
            <option value="SENT">响应已开始保存</option>
            <option value="FAILED">下载响应失败/中断</option>
            <option value="UNKNOWN">下载结果待核实</option>
          </select>
        </label>
        {controls}
      </section>
    </div>
  );
}

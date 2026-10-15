import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import * as Dialog from '@radix-ui/react-dialog';
import {
  downloadLabels,
  matchingReceipt,
  receiptLabels,
  selectionIssues,
  selectionKey,
  type DeliveryActions,
  type DeliveryData,
  type DeliveryFile,
  type DeliveryIntent,
  type DeliveryPackage,
  type DeliveryReceipt,
  type DownloadFact,
  type Selection,
  type SelectionCheck,
} from './model.js';
import './delivery.css';

export interface DeliveryPageProps {
  data?: DeliveryData;
  phase?: 'AVAILABLE' | 'LOADING' | 'ERROR' | 'EXPIRED' | 'UNAVAILABLE';
  actions?: DeliveryActions;
  reload?: () => void;
  controls?: ReactNode;
}
export function DeliveryPage(props: DeliveryPageProps) {
  const { projectId } = useParams();
  const phase = props.phase ?? 'AVAILABLE';
  if (
    !props.data ||
    props.data.projectId !== projectId ||
    phase === 'EXPIRED' ||
    phase === 'UNAVAILABLE'
  )
    return (
      <section className="panel delivery-gate">
        <h1 tabIndex={-1}>准备项目交付</h1>
        <p role={phase === 'EXPIRED' || phase === 'ERROR' ? 'alert' : 'status'}>
          {phase === 'EXPIRED'
            ? '访问已失效，已清除本页选择与回执。请重新认证。'
            : phase === 'LOADING'
              ? '正在读取项目交付文件…'
              : phase === 'ERROR'
                ? '项目交付读取失败，请重新读取。'
                : '项目交付资格、批次确认及受控导出尚未接入已注册授权能力，当前无法生成或下载交付包。'}
        </p>
        {props.reload && <button onClick={props.reload}>重新读取</button>}
        <p>
          <Link to="/workbench">返回工作台</Link>
        </p>
        {props.controls}
      </section>
    );
  return <DeliveryWorkspace key={props.data.projectId} {...props} data={props.data} />;
}
function FileFacts({ file }: { file: DeliveryFile }) {
  return (
    <>
      <strong>
        {file.title} · {file.version}
      </strong>
      <small>
        {file.code} · Revision {file.revisionId}
      </small>
      <small>
        {file.provenance.round} · 报告 {file.provenance.reportId} v{file.provenance.reportVersion}
      </small>
      <small>
        体系章节 {file.chapter} {file.chapterTitle}
      </small>
    </>
  );
}
function DeliveryWorkspace({
  data,
  phase = 'AVAILABLE',
  actions,
  reload,
  controls,
}: DeliveryPageProps & { data: DeliveryData }) {
  const [query] = useSearchParams();
  const history = query.get('view') === 'history';
  const [selected, setSelected] = useState<DeliveryFile[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [review, setReview] = useState<Selection | null>(null);
  const [check, setCheck] = useState<SelectionCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [receipt, setReceipt] = useState<DeliveryReceipt | null>(null);
  const [reading, setReading] = useState(false);
  const [returnedPackages, setReturnedPackages] = useState<DeliveryPackage[]>([]);
  const [downloads, setDownloads] = useState<DownloadFact[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const locked = useRef<DeliveryIntent | null>(null);
  const checkGeneration = useRef(0);
  const requestGeneration = useRef(0);
  const alive = useRef(false);
  const downloadLock = useRef(false);
  const readLock = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const historyHeading = useRef<HTMLHeadingElement>(null);
  const receiptPanel = useRef<HTMLElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      checkGeneration.current++;
      requestGeneration.current++;
    };
  }, []);
  const selection: Selection = {
    projectId: data.projectId,
    contextKey: data.contextKey,
    recipient: data.recipient,
    files: selected,
  };
  const issues = selectionIssues(selection, data);
  const reviewIssues = review ? selectionIssues(review, data) : [];
  const readable = phase === 'AVAILABLE';
  const canOperate = readable && data.completeness === 'COMPLETE' && !!actions;
  const packages = [
    ...data.packages,
    ...returnedPackages.filter((pkg) => !data.packages.some((item) => item.id === pkg.id)),
  ];
  if (
    receipt?.state === 'PACKAGE_READY' &&
    receipt.package &&
    !packages.some((pkg) => pkg.id === receipt.package?.id)
  )
    packages.push(receipt.package);
  const pkg = packages.find((item) => item.id === query.get('package'));
  const detail = data.files.find((file) => file.id === detailId);
  const visible = data.files.filter(
    (file) =>
      (filter === 'ALL' || (filter === 'ELIGIBLE') === file.qualification.eligible) &&
      `${file.title} ${file.code} ${file.chapter} ${file.chapterTitle}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
  );
  const chapters = [...new Set(visible.map((file) => file.chapter))].sort((a, b) =>
    a.localeCompare(b, 'zh-CN', { numeric: true }),
  );
  const recheck = (target: Selection) => {
    if (!actions || !canOperate) return;
    const generation = ++checkGeneration.current;
    setCheck(null);
    setCheckError('');
    setChecking(true);
    void Promise.resolve()
      .then(() => actions.check(target))
      .then((result) => {
        if (!alive.current || generation !== checkGeneration.current) return;
        if (!result.token || selectionKey(result.selection) !== selectionKey(target))
          setCheckError('核对结果与本批精确选择不匹配，请重新核对。');
        else setCheck(result);
      })
      .catch(() => {
        if (alive.current && generation === checkGeneration.current)
          setCheckError('核对读取失败，未确认本批。');
      })
      .finally(() => {
        if (alive.current && generation === checkGeneration.current) setChecking(false);
      });
  };
  const request = (intent: DeliveryIntent, read: boolean) => {
    if (!actions || !canOperate || (read ? readLock.current : locked.current !== null)) return;
    const generation = ++requestGeneration.current;
    if (read) {
      readLock.current = true;
      setReading(true);
    } else {
      locked.current = intent;
      setReceipt({ intent, state: 'PENDING' });
    }
    void Promise.resolve()
      .then(() => (read ? actions.read(intent) : actions.confirm(intent)))
      .then((result) => {
        if (
          !alive.current ||
          requestGeneration.current !== generation ||
          locked.current?.id !== intent.id
        )
          return;
        if (matchingReceipt(intent, result) && result.state === 'PACKAGE_READY' && result.package) {
          const fixed = structuredClone(result.package);
          setReturnedPackages((prior) =>
            prior.some((pkg) => pkg.id === fixed.id) ? prior : [...prior, fixed],
          );
        }
        setReceipt(
          matchingReceipt(intent, result)
            ? result
            : { intent, state: 'UNKNOWN', reason: '回执与原意图或固定成员不匹配，需查询原意图。' },
        );
      })
      .catch(() => {
        if (
          alive.current &&
          requestGeneration.current === generation &&
          locked.current?.id === intent.id
        )
          setReceipt({
            intent,
            state: 'UNKNOWN',
            reason: '未取得可靠回执；请查询原意图，不要再次生成。',
          });
      })
      .finally(() => {
        if (alive.current && requestGeneration.current === generation) {
          readLock.current = false;
          setReading(false);
        }
      });
  };
  const download = (target: DeliveryPackage) => {
    if (!actions || !readable || target.availability !== 'AVAILABLE' || downloadLock.current)
      return;
    downloadLock.current = true;
    setDownloading(target.id);
    void Promise.resolve()
      .then(() => actions.download(target))
      .then((fact) => {
        if (!alive.current) return;
        setDownloads((prior) => [
          ...prior,
          fact.packageId === target.id
            ? fact
            : {
                id: crypto.randomUUID(),
                packageId: target.id,
                at: '本次本地观察',
                state: 'UNKNOWN',
              },
        ]);
      })
      .catch(() => {
        if (alive.current)
          setDownloads((prior) => [
            ...prior,
            { id: crypto.randomUUID(), packageId: target.id, at: '本次本地观察', state: 'UNKNOWN' },
          ]);
      })
      .finally(() => {
        if (alive.current) {
          downloadLock.current = false;
          setDownloading(null);
        }
      });
  };
  const detailFocus = () => {
    requestAnimationFrame(() => detailHeading.current?.focus());
  };
  return (
    <div className="delivery-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">{data.projectTitle} / 项目交付</p>
          <h1 tabIndex={-1}>准备项目交付</h1>
          <p className="muted">沿体系章节选择本批文件，跨轮次集中核对。</p>
        </div>
        <Link to="/workbench">返回工作台</Link>
      </div>
      <nav className="delivery-tabs" aria-label="项目交付视图">
        <Link to="?" aria-current={!history ? 'page' : undefined}>
          准备本批
        </Link>
        <Link to="?view=history" aria-current={history ? 'page' : undefined}>
          交付包记录（{packages.length}）
        </Link>
      </nav>
      <p className="delivery-observation" role="status">
        已读取 {data.files.length} 份 ·{' '}
        {data.completeness === 'COMPLETE'
          ? '当前范围完整'
          : data.completeness === 'PARTIAL'
            ? 'PARTIAL · 仅部分范围'
            : 'STALE · 结果已陈旧'}{' '}
        · 观察时间 {data.observedAt}
      </p>
      {(!readable || data.completeness !== 'COMPLETE') && (
        <div className="delivery-warning" role="alert">
          {phase === 'ERROR'
            ? '读取失败，保留上次内容，暂不能确认。'
            : phase === 'LOADING'
              ? '正在更新，保留当前选择与弹窗。'
              : '当前读取范围部分或陈旧，暂不能确认。'}{' '}
          {reload && <button onClick={reload}>重新读取</button>}
        </div>
      )}
      {!history ? (
        <>
          <section className="panel delivery-panel">
            <div className="delivery-tools">
              <label>
                搜索交付文件
                <input
                  type="search"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                  }}
                  placeholder="文件名称、编号或章节"
                />
              </label>
              <label>
                交付条件
                <select
                  value={filter}
                  onChange={(event) => {
                    setFilter(event.target.value);
                  }}
                >
                  <option value="ALL">全部文件</option>
                  <option value="ELIGIBLE">可加入本批</option>
                  <option value="WAITING">暂不能交付</option>
                </select>
              </label>
              <span>
                显示 {visible.length} / {data.files.length} 份
              </span>
            </div>
            <div className="delivery-grid" data-detail={mobileDetail}>
              <div className="delivery-file-list" aria-label="项目文件与交付条件" tabIndex={0}>
                {chapters.length === 0 && (
                  <p className="empty">
                    {data.files.length
                      ? '没有符合条件的文件，请调整搜索或筛选。'
                      : '当前没有项目交付文件。'}
                  </p>
                )}
                {chapters.map((chapter) => (
                  <section key={chapter}>
                    <h2 className="delivery-chapter">
                      {chapter} · {visible.find((file) => file.chapter === chapter)?.chapterTitle}
                    </h2>
                    {visible
                      .filter((file) => file.chapter === chapter)
                      .map((file) => {
                        const chosenFile = selected.find((item) => item.id === file.id);
                        const chosen = chosenFile !== undefined;
                        const unique =
                          data.files.filter((item) => item.id === file.id).length === 1;
                        return (
                          <article className="delivery-file" key={`${file.id}:${file.revisionId}`}>
                            <input
                              type="checkbox"
                              aria-label={`加入本批：${file.title} · ${chosenFile?.version ?? file.version}`}
                              aria-describedby={`delivery-reason-${file.id}`}
                              checked={chosen}
                              disabled={
                                !chosen &&
                                (!file.qualification.eligible || !file.qualification.key || !unique)
                              }
                              onChange={() => {
                                setSelected((prior) =>
                                  chosen
                                    ? prior.filter((item) => item.id !== file.id)
                                    : [...prior, structuredClone(file)],
                                );
                                setCheck(null);
                              }}
                            />
                            <div>
                              <FileFacts file={file} />
                              {chosenFile &&
                                selectionIssues({ ...selection, files: [chosenFile] }, data)
                                  .length > 0 && (
                                  <p className="delivery-reason">
                                    本批保留：{chosenFile.version} · {chosenFile.revisionId}
                                    ；版本或交付条件已变化，请移除后重新选择。
                                  </p>
                                )}
                              <p
                                id={`delivery-reason-${file.id}`}
                                className={
                                  file.qualification.eligible && unique
                                    ? 'muted'
                                    : 'delivery-reason'
                                }
                              >
                                {!unique
                                  ? '文件观察不唯一，暂不能交付'
                                  : `${file.qualification.eligible ? '可加入本批' : '暂不能交付'} · ${file.qualification.reason}`}
                              </p>
                            </div>
                            <button
                              aria-label={`查看 ${file.title}`}
                              onClick={() => {
                                setDetailId(file.id);
                                setMobileDetail(true);
                                detailFocus();
                              }}
                            >
                              查看
                            </button>
                          </article>
                        );
                      })}
                  </section>
                ))}
              </div>
              <section className="delivery-detail" aria-label="文件详情">
                <button
                  className="delivery-narrow"
                  onClick={() => {
                    setMobileDetail(false);
                    requestAnimationFrame(() =>
                      document.querySelector<HTMLElement>('.delivery-file-list')?.focus(),
                    );
                  }}
                >
                  返回文件清单
                </button>
                <h2 tabIndex={-1} ref={detailHeading}>
                  文件详情
                </h2>
                {detail ? (
                  <>
                    <FileFacts file={detail} />
                    <p>{detail.qualification.reason}</p>
                    <p className="muted">页面只展示来源提供的交付资格；内部批准不等于可交付。</p>
                  </>
                ) : (
                  <p className="muted">选择“查看”核对文件版本、来源与等待原因。</p>
                )}
              </section>
            </div>
          </section>
          <div className="delivery-selection" aria-label="本批已选版本">
            <strong>
              本批已选 {selected.length} 份 · 来自{' '}
              {new Set(selected.map((file) => file.provenance.round)).size} 个来源轮次
            </strong>
            {issues.length > 0 && <p role="alert">{issues.join('；')}</p>}
            {selected.map((file) => (
              <button
                key={file.id}
                aria-label={`移除 ${file.title} · ${file.version}`}
                onClick={() => {
                  setSelected((prior) => prior.filter((item) => item.id !== file.id));
                  setCheck(null);
                }}
              >
                {file.title} · {file.version} ×
              </button>
            ))}
          </div>
          <Dialog.Root
            open={review !== null}
            onOpenChange={(open) => {
              if (!open) {
                setReview(null);
                checkGeneration.current++;
                setChecking(false);
              }
            }}
          >
            <div className="delivery-footer">
              <p>确认后固定文件与版本，新候选不会替换已有包。</p>
              <button
                className="primary delivery-desktop-confirm"
                ref={trigger}
                disabled={selected.length === 0 || !canOperate || locked.current !== null}
                onClick={() => {
                  const target = structuredClone(selection);
                  setReview(target);
                  recheck(target);
                }}
              >
                核对本批版本
              </button>
              <span className="delivery-narrow">请在桌面端核对并确认本批版本</span>
            </div>
            <Dialog.Portal>
              <Dialog.Overlay className="dialog-overlay" />
              <Dialog.Content
                className="dialog-content delivery-dialog"
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  if (trigger.current?.disabled) receiptPanel.current?.focus();
                  else trigger.current?.focus();
                }}
              >
                <Dialog.Title>核对本批交付版本</Dialog.Title>
                <Dialog.Description>
                  确认以下精确版本及配套要求。取得包后通过已有渠道自行发送。
                </Dialog.Description>
                {review && (
                  <>
                    <p>接收范围：{review.recipient}</p>
                    <div className="delivery-confirm-list">
                      {review.files.map((file) => (
                        <div key={file.id}>
                          <FileFacts file={file} />
                        </div>
                      ))}
                    </div>
                  </>
                )}
                <h3>配套要求与核验</h3>
                {checking && <p role="status">正在核对本批精确版本与配套…</p>}
                {checkError && <p role="alert">{checkError}</p>}
                {check?.requirements.map((item, index) => (
                  <p key={index}>
                    <strong>{item.title}</strong> · {item.detail}
                  </p>
                ))}
                {[
                  ...reviewIssues,
                  ...(check?.blockers ?? []),
                  ...(!canOperate ? ['当前读取或操作不可用，暂不能确认'] : []),
                ].map((issue, index) => (
                  <p className="delivery-reason" role="alert" key={index}>
                    {issue}
                  </p>
                ))}
                <div className="delivery-dialog-actions">
                  <Dialog.Close asChild>
                    <button>返回调整</button>
                  </Dialog.Close>
                  <button
                    disabled={checking || !canOperate}
                    onClick={() => {
                      if (review) recheck(review);
                    }}
                  >
                    重新核对
                  </button>
                  <button
                    className="primary delivery-desktop-confirm"
                    disabled={
                      !review ||
                      !check ||
                      checking ||
                      !canOperate ||
                      reviewIssues.length > 0 ||
                      check.blockers.length > 0 ||
                      locked.current !== null
                    }
                    onClick={() => {
                      if (
                        !review ||
                        !check ||
                        reviewIssues.length ||
                        check.blockers.length ||
                        selectionKey(check.selection) !== selectionKey(review)
                      )
                        return;
                      request(
                        {
                          id: crypto.randomUUID(),
                          selection: structuredClone(review),
                          checkToken: check.token,
                        },
                        false,
                      );
                      setReview(null);
                    }}
                  >
                    确认版本并生成交付包
                  </button>
                  <span className="delivery-narrow">请使用桌面端确认</span>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </>
      ) : (
        <section className="panel delivery-panel delivery-history">
          <div className="delivery-grid" data-detail={query.has('package')}>
            <div className="delivery-file-list" aria-label="交付包列表" tabIndex={0}>
              <h2>交付包记录</h2>
              {packages.length === 0 && (
                <p className="empty">尚无交付包记录。确认成功与包可用分别记录。</p>
              )}
              {[...packages].reverse().map((item) => (
                <Link
                  className="delivery-package-link"
                  key={item.id}
                  to={`?view=history&package=${encodeURIComponent(item.id)}`}
                  onClick={() => requestAnimationFrame(() => historyHeading.current?.focus())}
                  aria-current={pkg?.id === item.id ? 'page' : undefined}
                >
                  <strong>{item.label}</strong>
                  <small>
                    {item.selection.files.length} 份 · {item.createdAt}
                  </small>
                  <small>{item.availability === 'AVAILABLE' ? '包已可用' : item.reason}</small>
                </Link>
              ))}
            </div>
            <section className="delivery-detail" aria-label="固定交付包详情">
              <Link className="delivery-narrow" to="?view=history">
                返回交付包列表
              </Link>
              <h2 tabIndex={-1} ref={historyHeading}>
                {pkg ? `${pkg.label} · 固定版本` : '交付包详情'}
              </h2>
              {pkg ? (
                <PackageDetails
                  pkg={pkg}
                  downloads={downloads}
                  downloading={downloading !== null}
                  readable={readable}
                  download={actions ? download : undefined}
                />
              ) : (
                <p>
                  {query.has('package')
                    ? '该交付包不存在或当前不可访问。'
                    : '选择一个交付包查看固定版本与下载记录。'}
                </p>
              )}
            </section>
          </div>
        </section>
      )}
      {receipt && (
        <section className="delivery-receipt" role="status" tabIndex={-1} ref={receiptPanel}>
          <strong>{receiptLabels[receipt.state]}</strong>
          <p>
            原意图 {receipt.intent.id} · {receipt.intent.selection.files.length} 份精确版本
          </p>
          {receipt.reason && <p>{receipt.reason}</p>}
          {['PENDING', 'UNKNOWN', 'CONFIRMED', 'GENERATING'].includes(receipt.state) && (
            <button
              disabled={!canOperate || reading}
              onClick={() => {
                request(receipt.intent, true);
              }}
            >
              {reading ? '正在查询原意图…' : '查询原生成意图'}
            </button>
          )}
          {receipt.state === 'PACKAGE_READY' && receipt.package && (
            <Link to={`?view=history&package=${encodeURIComponent(receipt.package.id)}`}>
              查看本批交付包
            </Link>
          )}
          {['REJECTED', 'FAILED', 'PACKAGE_READY'].includes(receipt.state) && (
            <button
              onClick={() => {
                locked.current = null;
                requestGeneration.current++;
                setReceipt(null);
                setCheck(null);
              }}
            >
              开始新的批次核对
            </button>
          )}
        </section>
      )}
      {controls}
    </div>
  );
}
function PackageDetails({
  pkg,
  downloads,
  downloading,
  readable,
  download,
}: {
  pkg: DeliveryPackage;
  downloads: readonly DownloadFact[];
  downloading: boolean;
  readable: boolean;
  download: ((pkg: DeliveryPackage) => void) | undefined;
}) {
  const facts = [
    ...pkg.downloads,
    ...downloads.filter(
      (fact) => fact.packageId === pkg.id && !pkg.downloads.some((saved) => saved.id === fact.id),
    ),
  ];
  return (
    <>
      <p>接收范围：{pkg.selection.recipient}</p>
      <small>
        {pkg.id} · {pkg.createdAt}
      </small>
      {pkg.synthetic && (
        <p className="delivery-warning">合成开发样例 · ZIP 仅供页面验证，不能代替生产受控导出。</p>
      )}
      {pkg.selection.files.map((file) => (
        <div className="delivery-frozen-file" key={file.id}>
          <FileFacts file={file} />
        </div>
      ))}
      <p role="status">
        {pkg.availability === 'AVAILABLE'
          ? '此包可请求下载'
          : pkg.availability === 'EXPIRED'
            ? `下载链接已过期 · ${pkg.reason}`
            : pkg.reason || '当前无法下载'}
      </p>
      <button
        className="primary"
        disabled={!readable || !download || downloading || pkg.availability !== 'AVAILABLE'}
        onClick={() => download?.(pkg)}
      >
        {downloading ? '正在请求下载…' : pkg.synthetic ? '下载合成示例包 .zip' : '下载本交付包'}
      </button>
      <h3>下载记录 · {facts.length}</h3>
      {facts.length === 0 && <p>尚无可核实的下载记录。</p>}
      <ol>
        {facts.map((fact) => (
          <li key={fact.id}>
            {fact.at} · {downloadLabels[fact.state]}
          </li>
        ))}
      </ol>
      <p className="muted">下载请求或响应不证明浏览器保存完成、对外发送、客户收件或项目完成。</p>
    </>
  );
}

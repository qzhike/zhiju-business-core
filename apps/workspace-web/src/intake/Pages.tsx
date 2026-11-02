import { Alert } from '../components/ui/alert.js';
import { Badge } from '../components/ui/badge.js';
import { Card } from '../components/ui/card.js';
import { Label } from '../components/ui/label.js';
import { Input } from '../components/ui/input.js';
import { Button, buttonVariants } from '../components/ui/button.js';
import { NativeSelect } from '../components/ui/native-select.js';
import {
  Table,
  TableCaption,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '../components/ui/table.js';
import { Textarea } from '../components/ui/textarea.js';
import { MockControls } from '../fixtures/control-slot.js';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  matchesCreation,
  stageLabels,
  type Customer,
  type CustomerIntent,
  type CreationIntent,
  type CreationReceipt,
  type InputBatch,
  type InputFormatRule,
  type IntakeProject,
  type IntakeReceipt,
  type Submission,
  type ZipSelection,
  inputBatchLabels,
  inputEntryLabels,
} from './model.js';
import './intake.css';

function ErrorMessage({ children }: { children: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [children]);
  return (
    <Alert asChild variant="warning">
      <div className="error" role="alert" tabIndex={-1} ref={ref}>
        {children}
      </div>
    </Alert>
  );
}
export function NewProjectPage({
  customers,
  unavailable,
  create,
  controls,
  newCustomerAllowed = true,
}: {
  customers: readonly Customer[];
  unavailable?: string;
  create?: (intent: CreationIntent) => Promise<CreationReceipt>;
  controls?: ReactNode;
  newCustomerAllowed?: boolean;
}) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'EXISTING' | 'NEW'>('EXISTING');
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Customer | null>(null);
  const [title, setTitle] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const choices = customers.filter((customer) =>
    `${customer.name} ${customer.code}`.includes(name),
  );
  const pick = (customer: Customer) => {
    setSelected(customer);
    setName(customer.name);
    setOpen(false);
    setActive(-1);
  };
  return (
    <div className="intake-page intake-create-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">项目准备 · 01 / 02</p>
          <h1 tabIndex={-1}>新建项目</h1>
          <p className="muted">明确客户与项目，再准备首轮资料</p>
        </div>
      </div>
      <Card asChild>
        <form
          className="panel form intake-create"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (lock.current) return;
            if (!title.trim() || (mode === 'NEW' ? !name.trim() : selected === null)) {
              setError('请明确选择已有客户或新建客户，并填写项目名称。');
              return;
            }
            if (!create) {
              setError(unavailable ?? '创建能力暂不可用。');
              return;
            }
            const customer: CustomerIntent | null =
              mode === 'NEW'
                ? { kind: 'NEW', name }
                : selected === null
                  ? null
                  : { kind: 'EXISTING', customer: selected };
            if (customer === null) return;
            const intent: CreationIntent = {
              id: crypto.randomUUID(),
              title,
              customer,
            };
            lock.current = true;
            setPending(true);
            setError('');
            void create(intent)
              .then((receipt) => {
                if (!live.current) return;
                if (!matchesCreation(intent, receipt)) {
                  setError('创建结果待核验，回执与原输入不匹配；未进入其他项目。');
                  return;
                }
                void navigate(
                  receipt.recoveryHref ??
                    `/projects/${encodeURIComponent(receipt.project.id)}/intake`,
                );
              })
              .catch(() => {
                if (live.current) setError('未取得匹配创建回执，输入已保留；创建结果待核验。');
              })
              .finally(() => {
                if (live.current) {
                  setPending(false);
                }
              });
            // An uncertain write is never reissued with another intent.
          }}
        >
          {unavailable && (
            <Alert asChild variant="warning">
              <p className="notice" role="status">
                {unavailable}
              </p>
            </Alert>
          )}
          {error && <ErrorMessage>{error}</ErrorMessage>}
          <div className="intake-form-heading">
            <h2>客户与项目</h2>
            <p className="muted">先确定项目归属。创建成功后，继续选择首轮资料。</p>
          </div>
          <div className="intake-customer-mode" role="group" aria-label="客户类型">
            {(['EXISTING', 'NEW'] as const).map((value) => (
              <Button
                key={value}
                type="button"
                className="transition-none"
                variant={mode === value ? 'default' : 'outline'}
                aria-pressed={mode === value}
                disabled={pending || lock.current || (value === 'NEW' && !newCustomerAllowed)}
                onClick={() => {
                  if (mode === value) return;
                  setMode(value);
                  setSelected(null);
                  setName('');
                  setOpen(false);
                  setActive(-1);
                }}
              >
                {value === 'NEW' ? '新建客户' : '选择已有客户'}
              </Button>
            ))}
          </div>
          <div className="customer-field">
            <Label htmlFor="customer-name">客户企业名称</Label>
            <Input
              id="customer-name"
              disabled={pending || lock.current}
              value={name}
              autoComplete="off"
              {...(mode === 'EXISTING'
                ? {
                    role: 'combobox',
                    'aria-expanded': open,
                    'aria-controls': 'customer-options',
                    'aria-autocomplete': 'list' as const,
                    'aria-activedescendant':
                      open && active >= 0 && choices[active]
                        ? `customer-option-${active}`
                        : undefined,
                  }
                : {})}
              onChange={(event) => {
                setName(event.target.value);
                setSelected(null);
                setOpen(true);
                setActive(-1);
              }}
              onFocus={() => {
                if (mode === 'EXISTING') setOpen(true);
              }}
              onBlur={() => {
                setOpen(false);
              }}
              onKeyDown={(event) => {
                if (mode !== 'EXISTING') return;
                if (event.key === 'Escape') {
                  setOpen(false);
                  setActive(-1);
                }
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  setOpen(true);
                  setActive((current) =>
                    choices.length === 0
                      ? -1
                      : (current + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) %
                        choices.length,
                  );
                }
                if (event.key === 'Enter' && open && active >= 0 && choices[active]) {
                  event.preventDefault();
                  pick(choices[active]);
                }
              }}
              aria-required="true"
            />
            {mode === 'EXISTING' && open && (
              <ul
                id="customer-options"
                role="listbox"
                aria-label="已有客户"
                className="customer-options"
              >
                {choices.map((customer, index) => (
                  <li
                    key={customer.id}
                    id={`customer-option-${index}`}
                    role="option"
                    aria-selected={index === active}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      pick(customer);
                    }}
                  >
                    {customer.name} · {customer.code}
                  </li>
                ))}
              </ul>
            )}
            <p className="muted">
              {mode === 'NEW'
                ? '新客户意图，仅在明确创建时提交。'
                : selected
                  ? `已选择 ${selected.code} · 独立客户 ID：${selected.id}`
                  : '请明确选择客户；输入同名不会绑定身份。'}
            </p>
          </div>
          <Label>
            项目名称
            <Input
              value={title}
              disabled={pending || lock.current}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
              autoComplete="off"
              aria-required="true"
            />
          </Label>
          <p className="muted">创建本身不会提交资料或开始分析。未提交输入仅在本页内存保留。</p>
          <Button variant="default" disabled={!create || pending || lock.current} type="submit">
            {pending ? '正在创建…' : '创建项目并继续'}
          </Button>
        </form>
      </Card>
      {controls}
    </div>
  );
}

export interface IntakePageProps {
  submitLabel?: string;
  sampleZip?: ZipSelection;
  continuation?: ReactNode;
  selectedProjectId?: string;
  firstIntakeImmutable?: boolean;
  submissionPending?: boolean;
  projects: readonly IntakeProject[];
  unavailable?: string;
  directoryNotice?: ReactNode;
  receipts: ReadonlyMap<string, readonly IntakeReceipt[]>;
  submit?: (input: Submission) => void;
  retry?: (receipt: IntakeReceipt) => void;
  fixedZip?: ZipSelection;
  batches?: readonly InputBatch[];
  formatRules?: readonly InputFormatRule[];
  controls?: ReactNode;
}
export function IntakePage(props: IntakePageProps) {
  const params = useParams();
  const selectedProjectId = props.selectedProjectId ?? params.projectId;
  const navigate = useNavigate();
  const project = props.projects.find((item) => item.id === selectedProjectId);
  if (!selectedProjectId)
    return (
      <Card asChild>
        <div className="panel">
          <h1 tabIndex={-1}>提交客户资料</h1>
          <p>先明确选择一个项目。</p>
          {props.directoryNotice}
          <Label>
            选择项目
            <NativeSelect
              value=""
              onChange={(event) => {
                if (event.target.value)
                  void navigate(`/projects/${encodeURIComponent(event.target.value)}/intake`);
              }}
            >
              <option value="">请选择项目</option>
              {props.projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.customer.name} · {item.title}
                </option>
              ))}
            </NativeSelect>
          </Label>
        </div>
      </Card>
    );
  if (!project)
    return (
      <Card asChild>
        <section className="panel">
          <h1 tabIndex={-1}>准备首轮客户资料</h1>
          {props.directoryNotice}
          <p role="status">该项目当前不可用或尚未从授权目录读取；未上传文件。</p>
        </section>
      </Card>
    );
  return <ProjectIntake key={project.id} {...props} project={project} />;
}
function formatBytes(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${bytes} B`;
}
export function InputBatches({
  batches,
  formatRules,
}: {
  batches: readonly InputBatch[];
  formatRules?: readonly InputFormatRule[] | undefined;
}) {
  return (
    <section className="intake-batches" aria-label="已接收资料批次">
      <div className="intake-batches-head">
        <h2>资料批次与目录</h2>
        <p className="muted">接收状态不代表读取完成、分析成功或阶段完成。</p>
        <p className="muted">
          客户原件与正式模板只读；批次与成员身份保留，补充批次不会覆盖首轮目录。嵌套 RAR
          成员未解包时明确保留读取限制。
        </p>
      </div>
      {formatRules && (
        <ul className="format-rules" aria-label="支持的输入格式">
          {formatRules.map((rule) => (
            <li key={rule.format} data-disposition={rule.disposition}>
              <strong>{rule.format}</strong> {rule.note}
            </li>
          ))}
        </ul>
      )}
      <ol className="batch-list">
        {batches.map((batch) => (
          <li key={batch.id}>
            <article className="intake-batch" aria-label={batch.label}>
              <header>
                <div>
                  <small>{batch.id}</small>
                  <h3>{batch.label}</h3>
                  <p>
                    {batch.zipName} · 提交于 {batch.submittedAt}
                  </p>
                </div>
                <Badge className="status-tag">{inputBatchLabels[batch.state]}</Badge>
              </header>
              <p className="batch-count">
                {batch.entries.length} 个文件条目
                {batch.answers.length > 0 ? ` · ${batch.answers.length} 条答复` : ''}
              </p>
              {batch.entries.length > 0 && (
                <Table className="batch-entries">
                  <TableCaption>本批目录</TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">来源</TableHead>
                      <TableHead scope="col">文件</TableHead>
                      <TableHead scope="col">格式</TableHead>
                      <TableHead scope="col">大小</TableHead>
                      <TableHead scope="col">接收/读取状态</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batch.entries.map((entry) => (
                      <TableRow key={entry.id} data-state={entry.state}>
                        <TableHead scope="row">{entry.id}</TableHead>
                        <TableCell>
                          <span>{entry.path}</span>
                          <small>{entry.note}</small>
                        </TableCell>
                        <TableCell>{entry.format}</TableCell>
                        <TableCell>{formatBytes(entry.bytes)}</TableCell>
                        <TableCell>{inputEntryLabels[entry.state]}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {batch.answers.map((answer, index) => (
                <p className="batch-answer" key={answer}>
                  答复
                  {batch.answerIds?.[index] ? ` ${batch.answerIds[index]}` : ''}：{answer}
                </p>
              ))}
              {batch.questions && batch.questions.length > 0 && (
                <div className="batch-questions">
                  <strong>待澄清问题</strong>
                  <ul>
                    {batch.questions.map((question) => (
                      <li key={question.id}>
                        {question.id} · {question.title} · {question.state}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {batch.limitations.length > 0 && (
                <div className="batch-limitations">
                  <strong>本批限制</strong>
                  <ul>
                    {batch.limitations.map((limitation) => (
                      <li key={limitation}>{limitation}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="batch-next">下一步：{batch.nextAction}</p>
            </article>
          </li>
        ))}
      </ol>
    </section>
  );
}
function SubmissionFields({
  collapsed,
  summary,
  children,
}: {
  collapsed: boolean | undefined;
  summary: string;
  children: ReactNode;
}) {
  if (collapsed === undefined) return children;
  return (
    <details className="intake-submission" open={!collapsed}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
function ProjectIntake({
  submitLabel = '提交并分析',
  sampleZip,
  continuation,
  project,
  receipts,
  submit,
  retry,
  fixedZip,
  unavailable,
  controls,
  directoryNotice,
  firstIntakeImmutable,
  submissionPending,
  batches,
  formatRules,
}: IntakePageProps & { project: IntakeProject }) {
  const [zip, setZip] = useState<ZipSelection | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const lock = useRef(false);
  const live = useRef(true);
  const picker = useRef<HTMLInputElement>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  const receiptStatus = useRef<HTMLParagraphElement>(null);
  const awaitingFocus = useRef<string | null>(null);
  useEffect(() => {
    const moved = (event: Event) => {
      if (!submitButton.current?.contains(event.target as Node)) awaitingFocus.current = null;
    };
    document.addEventListener('focusin', moved);
    document.addEventListener('pointerdown', moved);
    document.addEventListener('keydown', moved);
    return () => {
      document.removeEventListener('focusin', moved);
      document.removeEventListener('pointerdown', moved);
      document.removeEventListener('keydown', moved);
    };
  }, []);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const history = (receipts.get(project.id) ?? []).filter(
    (receipt) => receipt.input.projectId === project.id,
  );
  const current = history.at(-1);
  useEffect(() => {
    if (current?.input.id !== awaitingFocus.current) return;
    if (!['WAITING', 'UNKNOWN', 'PREPARATION_FAILED'].includes(current.stage)) return;
    awaitingFocus.current = null;
    if (
      document.activeElement === document.body ||
      document.activeElement === submitButton.current
    ) {
      receiptStatus.current?.focus({ preventScroll: true });
      receiptStatus.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [current?.input.id, current?.stage]);
  const replaceable = !firstIntakeImmutable && current?.stage === 'PREPARATION_FAILED';
  useEffect(() => {
    if (current?.stage === 'PREPARATION_FAILED' || current?.stage === 'ANALYSIS_FAILED')
      lock.current = false;
  }, [current?.stage]);
  const frozen = (current !== undefined && !replaceable) || submissionPending === true;
  const shownZip = frozen && current ? current.input.zip : zip;
  const shownNote = frozen && current ? current.input.note : note;
  return (
    <div className="intake-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">
            {project.customer.name} · {project.title} · 02 / 02
          </p>
          <h1 tabIndex={-1}>准备首轮客户资料</h1>
        </div>
      </div>
      <Card asChild>
        <section className="panel intake">
          {directoryNotice}
          {unavailable && (
            <Alert asChild variant="warning">
              <p role="status" className="notice">
                {unavailable}
              </p>
            </Alert>
          )}
          <SubmissionFields
            collapsed={sampleZip ? frozen : undefined}
            summary={frozen && shownZip ? `已提交资料 · ${shownZip.name}` : '选择首轮资料'}
          >
            <div className="upload-zone">
              <h2>把客户现有体系文件放进一个 ZIP</h2>
              <p>
                DOCX / Markdown / XLSX 文件请放在 ZIP 内；旧 XLS 请先转换为 XLSX，PDF
                暂不支持，宏不执行。嵌套 RAR 只列出成员目录时，成员仍保持读取受限。
              </p>
              <Label>
                选择 ZIP 文件
                <input
                  ref={picker}
                  type="file"
                  accept=".zip,application/zip"
                  disabled={frozen}
                  onChange={(event) => {
                    if (!live.current || frozen || lock.current) return;
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (!file) return;
                    if (!file.name.toLowerCase().endsWith('.zip')) {
                      setError('请选择一个 ZIP 包；此前选择已保留。');
                      return;
                    }
                    setZip({ name: file.name, file });
                    setError('');
                  }}
                />
              </Label>
              {sampleZip && (
                <Button
                  type="button"
                  disabled={frozen}
                  onClick={() => {
                    setZip(sampleZip);
                    setError('');
                  }}
                >
                  使用示例资料
                </Button>
              )}
              <p className="muted">
                {firstIntakeImmutable
                  ? 'ZIP 与说明将作为原始客户资料保存，提交后冻结。资料校验通过后安排分析；分析能力暂不可用时，资料会保留并等待。'
                  : '当前页面不读取、解包或分析本地文件。未接入上传能力时，文件不会上传。'}
              </p>
            </div>
            {shownZip && (
              <div className="file-brief">
                <Badge className="status-tag">
                  {current && frozen ? '已提交输入' : 'ZIP · 未提交'}
                </Badge>
                <strong>{shownZip.name}</strong>
                {!frozen && (
                  <Button
                    disabled={frozen}
                    onClick={() => {
                      setZip(null);
                    }}
                  >
                    移除
                  </Button>
                )}
              </div>
            )}
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <Label>
              补充说明（选填）
              <Textarea
                rows={3}
                value={shownNote}
                disabled={frozen}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
              />
            </Label>
          </SubmissionFields>
          {current && (
            <div className="intake-receipt">
              <p role="status" ref={receiptStatus} tabIndex={sampleZip ? -1 : undefined}>
                <strong>{stageLabels[current.stage]}</strong>
              </p>
              <p className="muted">原请求 {current.input.id} · 不自动打开报告或重复提交。</p>
              {current.failures.map((failure, index) => (
                <Alert asChild variant="warning" key={index}>
                  <p className="error">{failure}</p>
                </Alert>
              ))}
              {current.stage === 'READY' && current.reportId && (
                <Link
                  className={buttonVariants({ variant: 'default' })}
                  to={`/projects/${encodeURIComponent(project.id)}/analysis/${encodeURIComponent(current.reportId)}`}
                >
                  查看分析报告
                </Link>
              )}
              {current.stage === 'ANALYSIS_FAILED' && current.retryAllowed && retry && (
                <Button
                  onClick={() => {
                    if (lock.current) return;
                    lock.current = true;
                    retry(current);
                  }}
                >
                  重新分析这份资料
                </Button>
              )}
              {replaceable && (
                <Button
                  onClick={() => {
                    lock.current = false;
                    picker.current?.focus();
                  }}
                >
                  更换 ZIP 包
                </Button>
              )}
            </div>
          )}
          {continuation}
          <div className="work-footer">
            <p className="muted">一次提交 ZIP 与说明，输入提交后冻结。</p>
            <Button
              ref={submitButton}
              variant="default"
              disabled={!submit || !zip || frozen}
              onClick={() => {
                if (!submit || !zip || frozen || lock.current) return;
                lock.current = true;
                setError('');
                const input = { id: crypto.randomUUID(), projectId: project.id, zip, note };
                if (sampleZip) awaitingFocus.current = input.id;
                submit(input);
              }}
            >
              {submissionPending ? '正在提交…' : submitLabel}
            </Button>
          </div>
          {batches && <InputBatches batches={batches} formatRules={formatRules} />}
          <details>
            <summary>查看原始提交与失败历史</summary>
            {history.length === 0 ? (
              <p>尚未提交。</p>
            ) : (
              history.map((receipt, index) => (
                <div key={`${receipt.input.id}-${index}`}>
                  <p>
                    {receipt.input.zip.name} · {receipt.input.id} · {stageLabels[receipt.stage]}
                  </p>
                  <p className="submitted-note">{receipt.input.note || '无补充说明'}</p>
                  {receipt.failures.map((failure, i) => (
                    <p key={i}>{failure}</p>
                  ))}
                </div>
              ))
            )}
          </details>
          <details className="intake-identity">
            <summary>项目归属信息</summary>
            <p className="muted">
              项目 {project.id} · 客户 ID {project.customer.id}
            </p>
          </details>
        </section>
      </Card>
      {fixedZip && (
        <MockControls>
          <Button
            disabled={frozen}
            onClick={() => {
              setZip(fixedZip);
              setError('');
            }}
          >
            带入演示 ZIP 包
          </Button>
        </MockControls>
      )}
      {controls}
    </div>
  );
}

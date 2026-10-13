import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  matchesCreation,
  stageLabels,
  type Customer,
  type CustomerIntent,
  type CreationIntent,
  type CreationReceipt,
  type IntakeProject,
  type IntakeReceipt,
  type Submission,
  type ZipSelection,
} from './model.js';
import './intake.css';

function ErrorMessage({ children }: { children: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [children]);
  return (
    <div className="error" role="alert" tabIndex={-1} ref={ref}>
      {children}
    </div>
  );
}
export function NewProjectPage({
  customers,
  unavailable,
  create,
  controls,
}: {
  customers: readonly Customer[];
  unavailable?: string;
  create?: (intent: CreationIntent) => Promise<CreationReceipt>;
  controls?: ReactNode;
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
    <div className="intake-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">项目准备 · 01 / 02</p>
          <h1 tabIndex={-1}>新建项目</h1>
          <p className="muted">明确客户与项目，再准备首轮资料</p>
        </div>
      </div>
      <form
        className="panel form"
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
              ? { kind: 'NEW', name: name.trim() }
              : selected === null
                ? null
                : { kind: 'EXISTING', customer: selected };
          if (customer === null) return;
          const intent: CreationIntent = {
            id: crypto.randomUUID(),
            title: title.trim(),
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
              void navigate(`/projects/${encodeURIComponent(receipt.project.id)}/intake`);
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
          <p className="notice" role="status">
            {unavailable}
          </p>
        )}
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <div className="customer-field">
          <label htmlFor="customer-name">客户企业名称</label>
          <input
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
          <button
            type="button"
            disabled={pending || lock.current}
            onClick={() => {
              setMode(mode === 'NEW' ? 'EXISTING' : 'NEW');
              setSelected(null);
              setName('');
              setOpen(false);
              setActive(-1);
            }}
          >
            {mode === 'NEW' ? '选择已有客户' : '新建客户'}
          </button>
        </div>
        <label>
          项目名称
          <input
            value={title}
            disabled={pending || lock.current}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            autoComplete="off"
            aria-required="true"
          />
        </label>
        <p className="muted">创建本身不会提交资料或开始分析。未提交输入仅在本页内存保留。</p>
        <button className="primary" disabled={!create || pending || lock.current} type="submit">
          {pending ? '正在创建…' : '创建项目并继续'}
        </button>
      </form>
      {controls}
    </div>
  );
}

export interface IntakePageProps {
  projects: readonly IntakeProject[];
  unavailable?: string;
  directoryNotice?: ReactNode;
  receipts: ReadonlyMap<string, readonly IntakeReceipt[]>;
  submit?: (input: Submission) => void;
  retry?: (receipt: IntakeReceipt) => void;
  fixedZip?: ZipSelection;
  controls?: ReactNode;
}
export function IntakePage(props: IntakePageProps) {
  const params = useParams();
  const navigate = useNavigate();
  const project = props.projects.find((item) => item.id === params.projectId);
  if (!params.projectId)
    return (
      <div className="panel">
        <h1 tabIndex={-1}>提交客户资料</h1>
        <p>先明确选择一个项目。</p>
        {props.directoryNotice}
        <label>
          选择项目
          <select
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
          </select>
        </label>
      </div>
    );
  if (!project)
    return (
      <section className="panel">
        <h1 tabIndex={-1}>准备首轮客户资料</h1>
        {props.directoryNotice}
        <p role="status">该项目当前不可用或尚未从授权目录读取；未上传文件。</p>
      </section>
    );
  return <ProjectIntake key={project.id} {...props} project={project} />;
}
function ProjectIntake({
  project,
  receipts,
  submit,
  retry,
  fixedZip,
  unavailable,
  controls,
  directoryNotice,
}: IntakePageProps & { project: IntakeProject }) {
  const [zip, setZip] = useState<ZipSelection | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const lock = useRef(false);
  const live = useRef(true);
  const picker = useRef<HTMLInputElement>(null);
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
  const replaceable = current?.stage === 'PREPARATION_FAILED';
  useEffect(() => {
    if (current?.stage === 'PREPARATION_FAILED' || current?.stage === 'ANALYSIS_FAILED')
      lock.current = false;
  }, [current?.stage]);
  const frozen = current !== undefined && !replaceable;
  const shownZip = frozen ? current.input.zip : zip;
  const shownNote = frozen ? current.input.note : note;
  return (
    <div className="intake-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">
            {project.customer.name} · {project.title} · 02 / 02
          </p>
          <h1 tabIndex={-1}>准备首轮客户资料</h1>
          <p className="muted">
            固定项目 {project.id} · 客户 ID {project.customer.id}
          </p>
        </div>
      </div>
      <section className="panel intake">
        {directoryNotice}
        {unavailable && (
          <p role="status" className="notice">
            {unavailable}
          </p>
        )}
        <div className="upload-zone">
          <h2>把客户现有体系文件放进一个 ZIP</h2>
          <p>DOCX / Markdown 文件请放在 ZIP 内，无需先逐份匹配模板。</p>
          <label>
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
          </label>
          <p className="muted">
            当前页面不读取、解包或分析本地文件。未接入上传能力时，文件不会上传。
          </p>
        </div>
        {shownZip && (
          <div className="file-brief">
            <span className="status-tag">{current && frozen ? '已提交输入' : 'ZIP · 未提交'}</span>
            <strong>{shownZip.name}</strong>
            {!frozen && (
              <button
                disabled={frozen}
                onClick={() => {
                  setZip(null);
                }}
              >
                移除
              </button>
            )}
          </div>
        )}
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <label>
          补充说明（选填）
          <textarea
            rows={3}
            value={shownNote}
            disabled={frozen}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        </label>
        {current && (
          <div className="intake-receipt">
            <p role="status">
              <strong>{stageLabels[current.stage]}</strong>
            </p>
            <p className="muted">原请求 {current.input.id} · 不自动打开报告或重复提交。</p>
            {current.failures.map((failure, index) => (
              <p className="error" key={index}>
                {failure}
              </p>
            ))}
            {current.stage === 'READY' && current.reportId && (
              <Link
                className="button primary"
                to={`/projects/${encodeURIComponent(project.id)}/analysis/${encodeURIComponent(current.reportId)}`}
              >
                查看分析报告
              </Link>
            )}
            {current.stage === 'ANALYSIS_FAILED' && current.retryAllowed && retry && (
              <button
                onClick={() => {
                  if (lock.current) return;
                  lock.current = true;
                  retry(current);
                }}
              >
                重新分析这份资料
              </button>
            )}
            {replaceable && (
              <button
                onClick={() => {
                  lock.current = false;
                  picker.current?.focus();
                }}
              >
                更换 ZIP 包
              </button>
            )}
          </div>
        )}
        <div className="work-footer">
          <p className="muted">一次提交 ZIP 与说明，输入提交后冻结。</p>
          <button
            className="primary"
            disabled={!submit || !zip || frozen}
            onClick={() => {
              if (!submit || !zip || frozen || lock.current) return;
              lock.current = true;
              setError('');
              submit({ id: crypto.randomUUID(), projectId: project.id, zip, note });
            }}
          >
            提交并分析
          </button>
        </div>
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
      </section>
      {fixedZip && (
        <button
          disabled={frozen}
          onClick={() => {
            setZip(fixedZip);
            setError('');
          }}
        >
          带入演示 ZIP 包
        </button>
      )}
      {controls}
    </div>
  );
}

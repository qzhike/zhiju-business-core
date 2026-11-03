import { useId, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { Card } from '../components/ui/card.js';
import { Button, buttonVariants } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { Label } from '../components/ui/label.js';
import { Alert } from '../components/ui/alert.js';
import { Stepper } from '../components/ui/stepper.js';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../components/ui/table.js';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '../components/ui/dialog.js';
import { ArtifactMarkdown } from '../review/ArtifactMarkdown.js';
import { RawMarkdownDiff } from '../review/RawMarkdownDiff.js';
import { OpinionPanel, useOpinionLayout } from '../review/OpinionPanel.js';
import { Missing } from '../shell.js';
import { MockControls } from './control-slot.js';
import { useRunnerFlow } from './runner-flow-session.js';
import { RunnerDraftEditor } from './runner-draft-editor.js';
import {
  runnerBase,
  runnerSteps,
  runnerLabel,
  roundRouteId,
  fileRouteId,
  readingVersion,
  runnerFilePath,
  latestRunnerRound,
  viewedRunnerRound,
  runnerRoundDrafts,
  runnerDraftKey,
  type RunnerFlowProject,
  type RunnerDraft,
} from './runner-flow-model.js';
import type { RunnerReadingPackage, RunnerReadingFile } from './runner-package.js';
import './project-catalog.css';
import './project-file-browser.css';
import './task-workspace.css';
import './runner-flow.css';

interface RoundProps {
  project: RunnerFlowProject;
  round: RunnerReadingPackage;
  historical: boolean;
}
const roundName = (round: RunnerReadingPackage) =>
  `${runnerLabel(round.identity.step)} · 第 ${round.identity.roundNumber} 轮`;
const roleNames = { initial: '初始底稿', before: '本轮前稿', candidate: '候选稿' };
function fileLink(
  { project, round, historical }: RoundProps,
  file: RunnerReadingFile,
  role?: RunnerDraft['fileRole'],
) {
  const href = runnerFilePath(project, round, file, role);
  return historical ? `${href}${href.includes('?') ? '&' : '?'}from=history` : href;
}

export function RunnerFlowWorkspace() {
  const flow = useRunnerFlow();
  const { projectId } = useParams();
  const project = flow.projects.find((item) => item.id === projectId);
  if (!project)
    return (
      <Card className="p-6">
        <h1 tabIndex={-1}>本地结果会话不可用</h1>
        <p>该项目的结果尚未载入，或本次会话已刷新、清理。请重新准备结果后继续。</p>
        <Link to="/runner-output">重新载入本地结果</Link>
        <p>
          <Link to="/workbench">返回工作台</Link>
        </p>
      </Card>
    );
  return <RunnerProjectPage key={project.id} project={project} />;
}

function RunnerProjectPage({ project }: { project: RunnerFlowProject }) {
  const params = useParams();
  const location = useLocation();
  const [search] = useSearchParams();
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogMode, setCatalogMode] = useState<'initial' | 'candidate'>('initial');
  const flow = useRunnerFlow();
  const navigate = useNavigate();
  const [clearing, setClearing] = useState(false);
  const base = runnerBase(project.id);
  const latest = latestRunnerRound(project);
  const round = params.roundId
    ? project.rounds.find((item) => roundRouteId(item) === params.roundId)
    : viewedRunnerRound(project);
  const historyList = location.pathname === `${base}/history`;
  const historical =
    historyList ||
    Boolean(params.roundId && !params.fileId) ||
    search.get('from') === 'history' ||
    round?.manifestSha256 !== latest.manifestSha256;
  const file = round?.files.find((item) => fileRouteId(item) === params.fileId);
  if (location.pathname === `${base}/results`) return <Navigate to={`${base}/work`} replace />;
  if (!round || (params.fileId && !file)) return <Missing />;
  if (!params.roundId && !historyList && location.pathname !== `${base}/work`) return <Missing />;
  const props = { project, round, historical };
  return (
    <>
      <div
        className={`project-workspace runner-flow${file ? ' is-file-review' : ' has-equal-columns'}`}
      >
        {!file && (
          <RunnerCatalog
            {...props}
            query={catalogQuery}
            setQuery={setCatalogQuery}
            mode={catalogMode}
            setMode={setCatalogMode}
          />
        )}
        <div className="project-workspace-main">
          {file ? (
            <RunnerFileReview
              key={`${round.manifestSha256}:${file.id}:${search.get('source') ?? ''}`}
              {...props}
              file={file}
            />
          ) : (
            <Card className="task-workspace runner-flow-card p-4 sm:p-6">
              <RunnerHeader project={project} history={historyList || Boolean(params.roundId)} />
              {historyList ? (
                <RunnerHistory project={project} />
              ) : (
                <>
                  {round.manifestSha256 !== latest.manifestSha256 && (
                    <Alert className="runner-new-result">
                      <p>有新的轮次可查看。当前仍在阅读{roundName(round)}，原意见保留。</p>
                      <Button
                        onClick={() => {
                          flow.view(project.id, latest.manifestSha256);
                          void navigate(`${base}/work`);
                        }}
                      >
                        查看当前轮次
                      </Button>
                    </Alert>
                  )}
                  {historical && (
                    <p role="status" className="muted">
                      正在回看固定轮次，历史内容与草稿只读。
                    </p>
                  )}
                  <RunnerRoundOverview {...props} />
                </>
              )}
            </Card>
          )}
        </div>
      </div>
      <MockControls>
        <p>本地结果仅保留当前会话；加入新轮次后不会自动切换正在阅读的内容。</p>
        <Link to="/runner-output">准备其他轮次的结果</Link>
        <Button
          variant="outline"
          onClick={() => {
            setClearing(true);
          }}
        >
          移除本地项目及草稿
        </Button>
      </MockControls>
      <Dialog open={clearing} onOpenChange={setClearing}>
        <DialogContent>
          <DialogTitle>移除本地项目</DialogTitle>
          <DialogDescription>
            将清除本次会话中的结果和所有未提交草稿，原始文件不会修改。
          </DialogDescription>
          <div className="runner-actions">
            <DialogClose asChild>
              <Button variant="outline">保留并返回</Button>
            </DialogClose>
            <Button
              onClick={() => {
                flow.clear(project.id);
                void navigate('/workbench');
              }}
            >
              确认移除本地项目
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RunnerHeader({ project, history }: { project: RunnerFlowProject; history: boolean }) {
  const latest = latestRunnerRound(project);
  const base = runnerBase(project.id);
  return (
    <>
      <div className="page-head">
        <div>
          <h1 tabIndex={-1}>{project.title}</h1>
          <p className="eyebrow">本地结果 · {project.rounds.length} 个已接入轮次</p>
        </div>
      </div>
      <section className="panel task-progress" aria-label="业务解读">
        <h2>业务解读</h2>
        <Stepper
          aria-label="业务阶段进度"
          currentStepId={latest.identity.step}
          steps={runnerSteps.map((step) => {
            const result = project.rounds.filter((round) => round.identity.step === step).at(-1);
            return {
              id: step,
              title: runnerLabel(step),
              state:
                step === latest.identity.step
                  ? latest.status === 'WAITING_INPUT' || latest.status === 'FAILED'
                    ? 'ATTENTION'
                    : 'CURRENT'
                  : 'UPCOMING',
              status: result ? runnerLabel(result.status) : '尚无结果',
            };
          })}
        />
        <p className="muted">当前结果：{roundName(latest)} · 人工定稿状态未接入</p>
      </section>
      <nav className="journey-nav" aria-label="项目导航">
        <ol>
          <li>
            <Link to={`${base}/work`} aria-current={!history ? 'page' : undefined}>
              当前工作
            </Link>
          </li>
          <li>
            <Link to={`${base}/history`} aria-current={history ? 'page' : undefined}>
              历史记录
            </Link>
          </li>
        </ol>
      </nav>
    </>
  );
}

function RunnerCatalog(
  props: RoundProps & {
    query: string;
    setQuery: (query: string) => void;
    mode: 'initial' | 'candidate';
    setMode: (mode: 'initial' | 'candidate') => void;
  },
) {
  const rows = props.round.files.filter(
    (file) =>
      file.title.toLocaleLowerCase().includes(props.query.trim().toLocaleLowerCase()) &&
      (props.mode === 'candidate' ? file.candidate : (file.initial ?? file.before)),
  );
  const groups = [
    [1, '1 - 质量手册'],
    [2, '2 - 控制程序'],
    [3, '3 - 管理制度'],
    [4, '4 - 记录表单'],
    [null, '未提供层级'],
  ] as const;
  return (
    <aside className="project-catalog" aria-label="项目文档">
      <div className="project-catalog-head">
        <h2>项目文档</h2>
        <p className="muted">{roundName(props.round)} · 仅显示已接入结果文件</p>
      </div>
      <div className="project-catalog-types" role="group" aria-label="文档类型">
        <Button
          aria-pressed={props.mode === 'initial'}
          onClick={() => {
            props.setMode('initial');
          }}
        >
          底稿
        </Button>
        <Button
          aria-pressed={props.mode === 'candidate'}
          onClick={() => {
            props.setMode('candidate');
          }}
        >
          候选稿
        </Button>
      </div>
      <Label htmlFor="runner-file-query">查找文件</Label>
      <Input
        id="runner-file-query"
        value={props.query}
        onChange={(event) => {
          props.setQuery(event.target.value);
        }}
      />
      {groups.map(([level, title]) => {
        const members = rows.filter((file) => file.level === level);
        return members.length ? (
          <section className="runner-catalog-group" key={level ?? 'unknown'}>
            <h3>{title}</h3>
            <div
              className="task-table-wrap"
              role="region"
              aria-label={`${title}文件列表`}
              tabIndex={0}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>名称</TableHead>
                    <TableHead>版本 / 状态</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((file) => {
                    const role =
                      props.mode === 'candidate'
                        ? 'candidate'
                        : file.initial
                          ? 'initial'
                          : 'before';
                    return (
                      <TableRow key={file.id}>
                        <TableCell>
                          <Link to={fileLink(props, file, role)}>{file.title}</Link>
                        </TableCell>
                        <TableCell>
                          {roleNames[role]}
                          <small>
                            {runnerLabel(file.state)} · {runnerLabel(file.completeness)}
                          </small>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </section>
        ) : null;
      })}
      {rows.length === 0 && (
        <p role="status">
          {props.query
            ? '没有匹配文件。'
            : props.mode === 'candidate'
              ? '本轮尚无候选稿。'
              : '本轮没有可读取的底稿。'}
        </p>
      )}
    </aside>
  );
}

function RunnerIdentity({ round }: { round: RunnerReadingPackage }) {
  return (
    <details className="runner-provenance">
      <summary>查看本轮来源与精确版本</summary>
      <dl>
        <dt>任务</dt>
        <dd>{round.identity.taskId}</dd>
        <dt>阶段</dt>
        <dd>{round.identity.stageId}</dd>
        <dt>轮次</dt>
        <dd>{round.identity.roundId}</dd>
        <dt>交接包摘要</dt>
        <dd>{round.manifestSha256}</dd>
      </dl>
      <p>包内 {round.packageFileCount} 个文件已核对长度与摘要；此结果不代表业务接纳或人工批准。</p>
    </details>
  );
}

function RunnerRoundOverview(props: RoundProps) {
  const { round, historical } = props;
  const candidates = round.files.filter((file) => file.candidate !== null);
  const firstFile = candidates[0] ?? round.files.find((file) => readingVersion(file));
  return (
    <>
      <section className="panel task-next" aria-label="当前任务">
        <h2>{runnerLabel(round.status)}</h2>
        <p>
          {roundName(round)} · {round.files.length} 份文件 · {candidates.length} 份候选稿
        </p>
        <p>
          {round.status === 'WAITING_INPUT'
            ? '请核对本轮问题，准备答复或补充资料。'
            : '核对本轮处理结果及文件内容，记录需要调整的意见。'}
        </p>
        <div className="runner-actions">
          {firstFile && (
            <Link
              className={buttonVariants({ variant: 'outline' })}
              to={fileLink(props, firstFile)}
            >
              {candidates.length ? '审阅本轮文件' : '查看已有底稿'}
            </Link>
          )}
          <RunnerDraftSummary {...props} />
        </div>
      </section>
      <section className="panel" aria-label="本轮结果">
        <h2>本轮结果</h2>
        <ArtifactMarkdown
          key={round.manifestSha256}
          text={round.summary}
          controls={false}
          preserveLineBreaks
          collapseAfter={180}
        />
        <p className="muted">
          {round.changeCount} 项实际修改 · {round.proposalCount} 项结构化建议（未执行）
        </p>
        <RunnerIdentity round={round} />
        {round.limitations.length > 0 && (
          <details>
            <summary>读取与处理限制（{round.limitations.length} 项）</summary>
            {round.limitations.map((item, index) => (
              <ArtifactMarkdown key={index} text={item} controls={false} />
            ))}
          </details>
        )}
      </section>
      <RunnerIssues key={`${round.manifestSha256}:${historical}`} {...props} />
      <section className="panel" aria-label="本轮文件结果">
        <h2>本轮文件结果</h2>
        <div className="task-table-wrap" role="region" aria-label="本轮文件结果列表" tabIndex={0}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>文件</TableHead>
                <TableHead>处理结果</TableHead>
                <TableHead>完整性</TableHead>
                <TableHead>阅读</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {round.files.map((file) => (
                <TableRow key={file.id}>
                  <TableHead scope="row">{file.title}</TableHead>
                  <TableCell>
                    {runnerLabel(file.state)}
                    <small>{file.candidate ? '已有候选 · 未定稿' : '尚无新稿'}</small>
                  </TableCell>
                  <TableCell>{runnerLabel(file.completeness)}</TableCell>
                  <TableCell>
                    {readingVersion(file) ? (
                      <Link to={fileLink(props, file)}>查看文件</Link>
                    ) : (
                      '无可读取正文'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </>
  );
}

type IssueFilter = 'all' | 'open' | 'drafts';
function RunnerIssues(props: RoundProps) {
  const { project, round, historical } = props;
  const prefix = useId();
  const [filter, setFilter] = useState<IssueFilter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const filterFocus = useRef<HTMLButtonElement>(null);
  const entries = round.issues.map((issue, index) => {
    const draft: RunnerDraft = { kind: 'ISSUE', targetId: issue.id, label: issue.title, text: '' };
    const saved = project.drafts[runnerDraftKey(round, draft)]?.text ?? '';
    return { issue, index, draft, saved };
  });
  const filters: { id: IssueFilter; label: string; count: number }[] = [
    { id: 'all', label: '全部', count: entries.length },
    {
      id: 'open',
      label: '待处理',
      count: entries.filter(({ issue }) => issue.status === 'OPEN').length,
    },
    { id: 'drafts', label: '有草稿', count: entries.filter(({ saved }) => saved.trim()).length },
  ];
  const matches = ({ issue, saved }: (typeof entries)[number]) =>
    filter === 'all' || (filter === 'open' ? issue.status === 'OPEN' : Boolean(saved.trim()));
  // Keep the active editor visible while a draft is being cleared.
  const visible = entries.filter((entry) => matches(entry) || entry.issue.id === expanded);
  return (
    <section className="panel runner-issues" aria-label="本轮问题与答复">
      <h2>本轮问题与答复</h2>
      <p className="muted">展开一项查看完整要求并填写答复；逐条提交仅确认本次会话内容。</p>
      {entries.length > 0 && (
        <div className="runner-issue-filters" role="group" aria-label="问题筛选">
          {filters.map((item) => (
            <Button
              key={item.id}
              ref={filter === item.id ? filterFocus : undefined}
              variant="outline"
              aria-pressed={filter === item.id}
              onClick={() => {
                setFilter(item.id);
                setExpanded(null);
              }}
            >
              {item.label}（{item.count}）
            </Button>
          ))}
        </div>
      )}
      {visible.length === 0 && (
        <p role="status">
          {entries.length === 0
            ? '本轮没有登记问题。'
            : filter === 'drafts'
              ? '本轮暂无答复草稿。'
              : '本轮没有待处理问题。'}
        </p>
      )}
      {visible.map((entry) => {
        const { issue, index, draft, saved } = entry;
        const opened = expanded === issue.id;
        const triggerId = `${prefix}-question-${index}`;
        const contentId = `${prefix}-content-${index}`;
        return (
          <article className="runner-issue" key={issue.id}>
            <h3>
              <Button
                id={triggerId}
                variant="ghost"
                className="runner-issue-trigger"
                aria-expanded={opened}
                aria-controls={contentId}
                onClick={() => {
                  setExpanded(opened ? null : issue.id);
                  if (opened && !matches(entry))
                    requestAnimationFrame(() =>
                      filterFocus.current?.focus({ preventScroll: true }),
                    );
                }}
              >
                <span className="runner-issue-title">
                  {index + 1}. {issue.title}
                </span>
                <span className="runner-issue-meta">
                  <span>{runnerLabel(issue.status)}</span>
                  {issue.blocking !== 'NONE' && (
                    <span className="runner-issue-blocking">
                      {issue.blocking === 'COMPLETE'
                        ? '阻断完整性确认'
                        : runnerLabel(issue.blocking)}
                    </span>
                  )}
                  {saved.trim() && (
                    <span className="runner-issue-draft">
                      {project.drafts[runnerDraftKey(round, draft)]?.confirmed
                        ? '已确认（本地）'
                        : '有答复草稿'}
                    </span>
                  )}
                  <span className="runner-issue-chevron" aria-hidden="true">
                    {opened ? '−' : '+'}
                  </span>
                </span>
              </Button>
            </h3>
            <div
              id={contentId}
              className="runner-issue-content"
              role="region"
              aria-labelledby={triggerId}
              hidden={!opened}
            >
              {opened && (
                <>
                  <ArtifactMarkdown text={issue.request} controls={false} />
                  {issue.fileIds.length > 0 && (
                    <p>
                      相关文件：
                      {issue.fileIds.map((id, fileIndex) => {
                        const file = round.files.find((item) => item.id === id);
                        return (
                          <span key={id}>
                            {fileIndex ? '、' : ''}
                            {file ? <Link to={fileLink(props, file)}>{file.title}</Link> : id}
                          </span>
                        );
                      })}
                    </p>
                  )}
                  <details>
                    <summary>原请求与更正说明</summary>
                    <ArtifactMarkdown text={issue.original} controls={false} />
                    <ArtifactMarkdown text={issue.reason} controls={false} />
                    {issue.correction && (
                      <>
                        <h4>请求更正理由</h4>
                        <ArtifactMarkdown text={issue.correction.reason} controls={false} />
                      </>
                    )}
                  </details>
                  {(issue.status === 'OPEN' || saved) && (
                    <>
                      <RunnerDraftEditor
                        project={project}
                        round={round}
                        draft={draft}
                        id={`${prefix}-answer-${index}`}
                        label={`答复草稿：${issue.title}`}
                        readOnly={historical || issue.status !== 'OPEN'}
                      />
                    </>
                  )}
                </>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}

function RunnerHistory({ project }: { project: RunnerFlowProject }) {
  return (
    <section className="panel" aria-label="阶段轮次历史">
      <h2>阶段轮次历史</h2>
      <p>保留各轮收到的结果；查看历史不改变当前进度。</p>
      <div className="task-table-wrap" role="region" aria-label="轮次列表" tabIndex={0}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>轮次</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>文件 / 候选</TableHead>
              <TableHead>草稿</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {project.rounds.toReversed().map((round) => (
              <TableRow key={round.manifestSha256}>
                <TableHead scope="row">
                  <Link to={`${runnerBase(project.id)}/results/${roundRouteId(round)}`}>
                    {roundName(round)}
                  </Link>
                </TableHead>
                <TableCell>{runnerLabel(round.status)}</TableCell>
                <TableCell>
                  {round.files.length} / {round.files.filter((file) => file.candidate).length}
                </TableCell>
                <TableCell>{runnerRoundDrafts(project, round).length} 条未发送</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function RunnerDraftSummary({ project, round, historical }: RoundProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const drafts = runnerRoundDrafts(project, round);
  return (
    <>
      <Button
        ref={trigger}
        variant="outline"
        disabled={!drafts.length}
        onClick={() => {
          setOpen(true);
        }}
      >
        核对本轮意见与答复（{drafts.length}）
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="runner-draft-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus({ preventScroll: true });
          }}
        >
          <DialogTitle>核对本轮意见与答复</DialogTitle>
          <DialogDescription>
            {roundName(round)} ·{' '}
            {historical ? '历史草稿，仅供回看' : '本次会话内容，尚未发送给 Runner'}
          </DialogDescription>
          <ul>
            {drafts.map((draft) => (
              <li key={runnerDraftKey(round, draft)}>
                <strong>
                  {draft.kind === 'ISSUE'
                    ? '问题答复'
                    : `文件意见 · ${roleNames[draft.fileRole ?? 'before']}`}
                  ：{draft.label}
                </strong>
                <p className="muted">
                  {draft.confirmed ? '本次会话已确认' : '编辑中'} · 尚未发送给 Runner
                </p>
                <p className="runner-draft-text">{draft.text}</p>
                {draft.fileSha256 && (
                  <details>
                    <summary>意见对应的精确文件</summary>
                    <p>{draft.fileSha256}</p>
                  </details>
                )}
              </li>
            ))}
          </ul>
          <p>提交和继续修订尚未连接；本次核对不会改变问题状态或生成新稿。</p>
          <div className="runner-actions">
            <DialogClose asChild>
              <Button>返回{historical ? '阅读' : '编辑'}</Button>
            </DialogClose>
            <Button disabled>提交并继续修订</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RunnerFileReview(props: RoundProps & { file: RunnerReadingFile }) {
  const { project, round, file, historical } = props;
  const [search] = useSearchParams();
  const requested = search.get('source');
  const role =
    requested === 'initial' || requested === 'before' || requested === 'candidate'
      ? requested
      : file.candidate
        ? 'candidate'
        : file.before
          ? 'before'
          : 'initial';
  const reading = file[role];
  const flow = useRunnerFlow();
  const [view, setView] = useState<'reading' | 'diff'>(role === 'candidate' ? 'diff' : 'reading');
  const [baseline, setBaseline] = useState<'initial' | 'before'>('initial');
  const [opinionOpen, setOpinionOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const opinionTrigger = useRef<HTMLButtonElement>(null);
  const { width, rememberReading } = useOpinionLayout(root, true, opinionOpen);
  const drawer = width < 1100;
  const latest = latestRunnerRound(project);
  const newerFile = latest.files.find((entry) => entry.id === file.id);
  if (requested && !['initial', 'before', 'candidate'].includes(requested)) return <Missing />;
  if (!reading) return <Missing />;
  const draft: RunnerDraft = {
    kind: 'FILE',
    targetId: file.id,
    label: file.title,
    fileRole: role,
    fileSha256: reading.ref.sha256,
    text: '',
  };
  const close = () => {
    rememberReading();
    setOpinionOpen(false);
    requestAnimationFrame(() => opinionTrigger.current?.focus({ preventScroll: true }));
  };
  const back =
    search.get('from') === 'history'
      ? `${runnerBase(project.id)}/results/${roundRouteId(round)}`
      : `${runnerBase(project.id)}/work`;
  return (
    <Card
      className="runner-flow-file p-4 sm:p-6"
      ref={root}
      data-opinion-layout={drawer ? 'drawer' : 'side'}
    >
      <header>
        <Link to={back}>← 返回{search.get('from') === 'history' ? '历史轮次' : '当前工作'}</Link>
        <h1 tabIndex={-1}>{file.title}</h1>
        <p>
          {roundName(round)} · {roleNames[role]} · {runnerLabel(file.completeness)}
          {historical ? ' · 历史阅读' : ''}
        </p>
      </header>
      {round.manifestSha256 !== latest.manifestSha256 && (
        <Alert className="runner-new-result">
          <p>已有新的轮次；当前文件与意见仍绑定原轮次。</p>
          {newerFile ? (
            <Link
              to={runnerFilePath(project, latest, newerFile)}
              onClick={() => {
                flow.view(project.id, latest.manifestSha256);
              }}
            >
              查看当前轮次文件
            </Link>
          ) : (
            <Link
              to={`${runnerBase(project.id)}/work`}
              onClick={() => {
                flow.view(project.id, latest.manifestSha256);
              }}
            >
              返回当前轮次
            </Link>
          )}
        </Alert>
      )}
      {!file.candidate && <Alert>本轮尚无新稿，以下展示已有底稿。</Alert>}
      <details className="runner-provenance">
        <summary>文件依据与精确版本</summary>
        <p>{reading.ref.relativePath}</p>
        <p>{reading.ref.sha256}</p>
        {[...file.gaps, ...file.limitations].map((text, index) => (
          <ArtifactMarkdown key={index} text={text} controls={false} />
        ))}
      </details>
      <div className="runner-actions markdown-change-toolbar" aria-label="文件审查工具">
        {role === 'candidate' && (
          <>
            <Button
              variant="outline"
              aria-pressed={view === 'diff'}
              onClick={() => {
                setView('diff');
              }}
            >
              修订对照
            </Button>
            <Button
              variant="outline"
              aria-pressed={view === 'reading'}
              onClick={() => {
                setView('reading');
              }}
            >
              完整文件
            </Button>
          </>
        )}
        {view === 'diff' && (
          <>
            <Button
              variant="outline"
              aria-pressed={baseline === 'initial'}
              onClick={() => {
                rememberReading();
                setBaseline('initial');
              }}
            >
              累计变化（初始底稿）
            </Button>
            <Button
              variant="outline"
              aria-pressed={baseline === 'before'}
              onClick={() => {
                rememberReading();
                setBaseline('before');
              }}
            >
              本轮变化（前稿）
            </Button>
          </>
        )}
        <Button
          ref={opinionTrigger}
          aria-expanded={opinionOpen}
          onClick={() => {
            rememberReading();
            setOpinionOpen(!opinionOpen);
          }}
        >
          {opinionOpen ? '收起本文件意见' : '打开本文件意见'}
        </Button>
      </div>
      <div className={`runner-reading-layout${opinionOpen && !drawer ? ' with-opinion' : ''}`}>
        <div className="runner-reading-body">
          {view === 'diff' && file.candidate ? (
            <>
              <p className="muted">
                比较基线：{file[baseline]?.ref.relativePath ?? '空基线（新增文件）'}
              </p>
              <RawMarkdownDiff before={file[baseline]?.text ?? ''} after={file.candidate.text} />
            </>
          ) : (
            <ArtifactMarkdown text={reading.text} />
          )}
        </div>
        {opinionOpen && (
          <OpinionPanel
            stickyTop={72}
            enabled
            open
            drawer={drawer}
            onClose={close}
            context={`${file.title} · ${roundName(round)} · ${roleNames[role]}`}
            excerpt={
              <p>
                {file.title} · {roleNames[role]}；意见只针对当前阅读的精确版本。
              </p>
            }
          >
            <h2>本文件意见</h2>
            <p className="markdown-opinion-context">
              {roundName(round)} · {roleNames[role]}
            </p>
            <RunnerDraftEditor
              project={project}
              round={round}
              draft={draft}
              id="runner-file-opinion"
              label="意见草稿"
              readOnly={historical}
            />
            <RunnerDraftSummary {...props} />
            <Link to={back}>返回{search.get('from') === 'history' ? '历史轮次' : '当前工作'}</Link>
          </OpinionPanel>
        )}
      </div>
    </Card>
  );
}

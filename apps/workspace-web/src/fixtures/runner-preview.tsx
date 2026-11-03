import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useRunnerFlow } from './runner-flow-session.js';
import { runnerBase } from './runner-flow-model.js';
import { Card } from '../components/ui/card.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { Label } from '../components/ui/label.js';
import { Alert } from '../components/ui/alert.js';
import { NativeSelect } from '../components/ui/native-select.js';
import { ArtifactMarkdown } from '../review/ArtifactMarkdown.js';
import { RawMarkdownDiff } from '../review/RawMarkdownDiff.js';
import {
  readRunnerPackage,
  type RunnerReadingPackage,
  type RunnerReadingFile,
} from './runner-package.js';
import './runner-preview.css';

const labels: Record<string, string> = {
  QUALITY_MANUAL: '质量手册',
  CONTROL_PROCEDURES: '控制程序',
  MANAGEMENT_RECORDS: '管理制度及记录表单',
  REVISING: '修订中',
  WAITING_INPUT: '等待输入',
  WAITING_REVIEW: '等待人工审阅',
  COMPLETED: '阶段结束',
  TERMINATED: '阶段终止',
  DRAFT: '审核稿',
  UNCHANGED: '正文未变',
  BLOCKED: '受阻',
  FAILED: '失败',
  NOT_EXECUTED: '未执行',
  COMPLETE: '完整',
  PARTIAL: '部分完整',
  NOT_ASSESSED: '未评估',
  OPEN: '待处理',
  RESOLVED: '已解决',
  WITHDRAWN: '已撤回',
  EDIT: '暂停修改',
  NONE: '非阻断',
};
const label = (value: string) => labels[value] ?? value;

export function FixtureRunnerPreview() {
  const flow = useRunnerFlow();
  const navigate = useNavigate();
  const [flowError, setFlowError] = useState('');
  const [loaded, setLoaded] = useState<RunnerReadingPackage | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState('');
  const request = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      request.current?.abort();
    },
    [],
  );
  function clear() {
    setFlowError('');
    request.current?.abort();
    request.current = null;
    setLoaded(null);
    setError('');
    setBusy(false);
    setSelected('');
    if (input.current) input.current.value = '';
  }
  async function open(files: File[]) {
    clear();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const result = await readRunnerPackage(
        files.map((file) => ({
          path: file.webkitRelativePath,
          size: file.size,
          arrayBuffer: () => file.arrayBuffer(),
        })),
        controller.signal,
      );
      if (request.current !== controller || controller.signal.aborted) return;
      setLoaded(result);
      setSelected(result.files[0]?.id ?? '');
    } catch (cause) {
      if (request.current !== controller || controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : '无法读取交接包。');
    } finally {
      if (request.current === controller) setBusy(false);
    }
  }
  const file = loaded?.files.find((item) => item.id === selected);
  return (
    <Card className="runner-preview">
      <header>
        <Link to="/workbench">返回工作台</Link>
        <h1 tabIndex={-1}>Runner 产物核对</h1>
        <p>
          在本机读取已导出的交接包，文件不会上传。加入项目后可在工作台、文件审查和历史间继续阅读；刷新会清除本地结果和草稿。
        </p>
      </header>
      <section className="runner-package-picker" aria-label="选择本地交接包">
        <Label htmlFor="runner-package-input">选择一个 handoff 目录</Label>
        <Input
          id="runner-package-input"
          type="file"
          ref={input}
          multiple
          {...{ webkitdirectory: '' }}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length) void open(files);
          }}
        />
        <Button variant="outline" onClick={clear} disabled={!loaded && !busy && !error}>
          清除本地阅读
        </Button>
        {busy && <p role="status">正在核对交接包文件、长度与摘要…</p>}
        {error && (
          <Alert variant="destructive" role="alert">
            {error}
          </Alert>
        )}
      </section>
      {loaded && (
        <>
          <section className="runner-package-summary" aria-label="交接包状态">
            <Button
              onClick={() => {
                try {
                  const id = flow.add(loaded);
                  void navigate(`${runnerBase(id)}/work`);
                } catch (cause) {
                  setFlowError(cause instanceof Error ? cause.message : '无法加入项目流程。');
                }
              }}
            >
              加入项目并查看当前工作
            </Button>
            {flowError && (
              <Alert variant="destructive" role="alert">
                {flowError}
              </Alert>
            )}
            <h2>
              {label(loaded.identity.step)} · 第 {loaded.identity.roundNumber} 轮
            </h2>
            <p className="runner-status">
              {label(loaded.status)} · {loaded.files.length} 份文件 ·{' '}
              {loaded.files.filter((item) => item.candidate !== null).length} 份候选稿
            </p>
            <p>
              {loaded.changeCount} 项实际修改 · {loaded.proposalCount} 项结构化建议（未执行）
            </p>
            <p className="muted">
              包内 {loaded.packageFileCount} 个文件的长度与摘要一致。此结果不替代 Runner
              固定工具复核、业务接纳或人工批准。
            </p>
            <details>
              <summary>查看本轮身份与来源</summary>
              <dl>
                <dt>任务</dt>
                <dd>{loaded.identity.taskId}</dd>
                <dt>阶段</dt>
                <dd>{loaded.identity.stageId}</dd>
                <dt>轮次</dt>
                <dd>{loaded.identity.roundId}</dd>
                <dt>交接包摘要</dt>
                <dd>{loaded.manifestSha256}</dd>
              </dl>
            </details>
            <ArtifactMarkdown text={loaded.summary} controls={false} />
            {loaded.limitations.length > 0 && (
              <details>
                <summary>读取与处理限制（{loaded.limitations.length} 项）</summary>
                <ul>
                  {loaded.limitations.map((item, index) => (
                    <li key={index}>
                      <ArtifactMarkdown text={item} controls={false} />
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
          <section aria-label="文件阅读" className="runner-file-reading">
            <Label htmlFor="runner-file">选择文件</Label>
            <NativeSelect
              id="runner-file"
              value={selected}
              onChange={(event) => {
                setSelected(event.target.value);
              }}
            >
              {loaded.files.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </NativeSelect>
            {file && <RunnerFile key={`${loaded.manifestSha256}:${file.id}`} file={file} />}
          </section>
          <section aria-label="本轮问题" className="runner-issues">
            <h2>本轮问题（{loaded.issues.length} 项）</h2>
            <p>
              以下按交接包的当前请求显示；原请求及说明保留供核对。阅读本页不会提交答复或授权修改。
            </p>
            {loaded.issues.map((issue) => (
              <details key={issue.id}>
                <summary>
                  {issue.title} · {label(issue.status)} ·{' '}
                  {issue.blocking === 'COMPLETE' ? '阻断完整性确认' : label(issue.blocking)}
                </summary>
                <ArtifactMarkdown text={issue.request} controls={false} />
                <details>
                  <summary>原请求与说明</summary>
                  <ArtifactMarkdown text={issue.original} controls={false} />
                  <ArtifactMarkdown text={issue.reason} controls={false} />
                  {issue.correction && (
                    <div>
                      <h3>请求更正</h3>
                      <ArtifactMarkdown text={issue.correction.request} controls={false} />
                      <ArtifactMarkdown text={issue.correction.reason} controls={false} />
                      {issue.correction.evidenceIds.length > 0 && (
                        <p>依据编号：{issue.correction.evidenceIds.join('、')}</p>
                      )}
                    </div>
                  )}
                </details>
              </details>
            ))}
          </section>
        </>
      )}
    </Card>
  );
}

function RunnerFile({ file }: { file: RunnerReadingFile }) {
  const [view, setView] = useState<'reading' | 'diff'>('reading');
  const [comparison, setComparison] = useState<'cumulative' | 'round'>('cumulative');
  const reading = file.candidate ?? file.before ?? file.initial;
  const baseline = comparison === 'cumulative' ? file.initial : file.before;
  return (
    <>
      <h2>{file.title}</h2>
      <p>
        {label(file.state)} · 内容{label(file.completeness)} ·{' '}
        {file.candidate ? '本轮候选稿' : '尚无新稿'}
      </p>
      {!file.candidate && <Alert>本轮没有生成候选稿。以下仅展示已有底稿，不计作修订版本。</Alert>}
      {(file.gaps.length > 0 || file.limitations.length > 0) && (
        <details>
          <summary>文件缺口与读取限制</summary>
          <ul>
            {[...file.gaps, ...file.limitations].map((item, index) => (
              <li key={index}>
                <ArtifactMarkdown text={item} controls={false} />
              </li>
            ))}
          </ul>
        </details>
      )}
      {reading && (
        <details>
          <summary>当前阅读文件与精确摘要</summary>
          <p>{reading.ref.relativePath}</p>
          <p>{reading.ref.sha256}</p>
        </details>
      )}
      {file.candidate && (
        <div className="artifact-reading-tools" role="group" aria-label="文件视图">
          <Button
            aria-pressed={view === 'reading'}
            onClick={() => {
              setView('reading');
            }}
          >
            完整文件
          </Button>
          <Button
            aria-pressed={view === 'diff'}
            onClick={() => {
              setView('diff');
            }}
          >
            修订对照
          </Button>
        </div>
      )}
      {view === 'diff' && file.candidate ? (
        <>
          <div className="artifact-reading-tools" role="group" aria-label="比较基线">
            <Button
              aria-pressed={comparison === 'cumulative'}
              onClick={() => {
                setComparison('cumulative');
              }}
            >
              累计变化（初始底稿）
            </Button>
            <Button
              aria-pressed={comparison === 'round'}
              onClick={() => {
                setComparison('round');
              }}
            >
              本轮变化（前稿）
            </Button>
          </div>
          <p>
            {baseline ? `比较基线：${baseline.ref.relativePath}` : '从空基线新增，没有原始正文。'}
          </p>
          {baseline && <p className="runner-hash">基线摘要：{baseline.ref.sha256}</p>}
          <RawMarkdownDiff before={baseline?.text ?? ''} after={file.candidate.text} />
        </>
      ) : reading ? (
        <ArtifactMarkdown text={reading.text} />
      ) : (
        <p>本轮没有可读取的底稿或候选稿。</p>
      )}
    </>
  );
}

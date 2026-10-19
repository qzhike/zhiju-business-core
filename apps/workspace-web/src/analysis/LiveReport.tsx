import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { TrustedProps } from '../workbench/TrustedWorkbench.js';
import { readExactQuery, failureFromUnknown } from '../trusted/client.js';
import { asRecord, type JsonRecord } from '../trusted/values.js';
import { objectRef, preparationHref } from '../intake/live-client.js';
import { AnalysisPage } from './Page.js';
import { initialState, type AnalysisReport, type AnalysisState } from './model.js';
const record = (v: unknown): JsonRecord => {
  const r = asRecord(v);
  if (!r) throw new Error('UI_ANALYSIS_INVALID');
  return r;
};
/** The owning API has validated v0.2. This projection adds no business conclusions. */
const text = (v: unknown): string => {
  if (typeof v !== 'string') throw new Error('UI_ANALYSIS_INVALID');
  return v;
};
const array = (v: unknown): unknown[] => {
  if (!Array.isArray(v)) throw new Error('UI_ANALYSIS_INVALID');
  return v;
};
const strings = (v: unknown): string[] => array(v).map(text);
export function presentPreparationReport(
  value: unknown,
  projectId: string,
  enterpriseId?: string,
): { report: AnalysisReport; usable: boolean } {
  const data = record(value),
    binding = record(data.binding),
    project = record(binding.projectRef),
    content = record(data.content),
    report = record(content.report),
    reportRef = record(binding.reportRef),
    scope = record(project.scope);
  if (
    project.objectId !== projectId ||
    scope.projectId !== projectId ||
    (enterpriseId !== undefined && scope.enterpriseId !== enterpriseId) ||
    project.objectType !== 'zhiju.project.project' ||
    report.schemaVersion !== '0.2.0' ||
    report.stage !== 'ANALYSIS' ||
    reportRef.objectType !== 'zhiju.project.preparation_report' ||
    record(reportRef.scope).projectId !== projectId ||
    record(reportRef.scope).enterpriseId !== scope.enterpriseId ||
    array(data.allowedActions).length !== 0
  )
    throw new Error('UI_ANALYSIS_INVALID');
  const projected: AnalysisReport = {
    projectId,
    reportId: text(reportRef.objectId),
    version: 1,
    title: text(report.title),
    summary: text(report.summary),
    narrative: text(content.narrativeMarkdown),
    limitations: strings(report.limitations),
    attentionItems: array(report.attentionItems).map((v) => {
      const p = record(v),
        r = p.customerRequest === null ? null : record(p.customerRequest);
      return {
        id: text(p.id),
        title: text(p.title),
        kind: text(p.kind),
        audience: text(p.audience),
        reason: text(p.reason),
        question: text(p.question),
        affectedPlannedFileIds: strings(p.affectedPlannedFileIds),
        protectedFactIds: strings(p.protectedFactIds),
        evidenceIds: strings(p.evidenceIds),
        customerRequest: r ? { key: text(r.key), title: text(r.title), text: text(r.text) } : null,
      };
    }),
    evidence: array(report.evidence).map((v) => {
      const p = record(v),
        l = record(p.locator);
      return {
        id: text(p.id),
        sourceId: text(p.sourceId),
        representation: text(p.representation),
        locator: { kind: text(l.kind), value: text(l.value) },
        note: text(p.note),
      };
    }),
    plannedFiles: array(report.plannedFiles).map((v) => {
      const p = record(v);
      return {
        id: text(p.id),
        title: text(p.title),
        customerCode: p.customerCode === null ? null : text(p.customerCode),
        origin: text(p.origin),
      };
    }),
    changes: array(report.changes).map((v) => {
      const p = record(v);
      return {
        id: text(p.id),
        title: text(p.title),
        description: text(p.description),
        targetPlannedFileIds: strings(p.targetPlannedFileIds),
        evidenceIds: strings(p.evidenceIds),
      };
    }),
    checks: array(report.checks).map((v) => {
      const p = record(v);
      return {
        id: text(p.id),
        title: text(p.title),
        result: text(p.result),
        authority: text(p.authority),
        limitations: strings(p.limitations),
      };
    }),
    resolutionProposals: array(report.resolutionProposals).map((v, index) => {
      const p = record(v);
      return {
        id: String(index),
        attentionItemIds: [text(p.previousAttentionItemId)],
        explanation: text(p.reason),
        evidenceIds: strings(p.evidenceIds),
      };
    }),
  };
  return { report: projected, usable: record(data.currentUsability).usable === true };
}
type Props = Omit<TrustedProps, 'selectedKey' | 'onSelect'> & {
  projectId: string;
  enterpriseId: string;
  requestId: string;
};
export function LivePreparationReport(props: Props) {
  const [current, setCurrent] = useState<ReturnType<typeof presentPreparationReport> | null>(null),
    [state, setState] = useState<AnalysisState | null>(null),
    [notice, setNotice] = useState('正在读取服务器已接纳的分析报告…'),
    [revision, setRevision] = useState(0);
  const latest = useRef(props);
  latest.current = props;
  const {
    projectId,
    enterpriseId,
    requestId,
    csrfToken,
    sessionGeneration,
    principalId,
    generation,
    guardRef,
  } = props;
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined, reportId: string | undefined;
    setCurrent(null);
    setState(null);
    const valid = () =>
      !abort.signal.aborted &&
      guardRef.current.generation === generation &&
      guardRef.current.principalId === principalId;
    const read = async () => {
      try {
        const scope = { enterpriseId, projectId },
          data = await readExactQuery(
            'project.get_preparation_analysis_report',
            scope,
            { projectRef: objectRef('zhiju.project.project', projectId, scope) },
            csrfToken,
            abort.signal,
          );
        if (!valid()) return;
        const next = presentPreparationReport(data, projectId, enterpriseId);
        setCurrent(next);
        if (reportId !== next.report.reportId) {
          setState(initialState(next.report));
          reportId = next.report.reportId;
        }
        setNotice('');
      } catch (error) {
        if (!valid()) return;
        const failure = failureFromUnknown(error, 'DEPENDENCY_UNAVAILABLE');
        if (failure.httpStatus === 401 || failure.httpStatus === 403) {
          setCurrent(null);
          setState(null);
          setNotice('当前会话或权限已失效，请重新登录后读取原项目。');
          if (failure.httpStatus === 401) latest.current.onSessionFailure();
          return;
        }
        let message =
          '暂未取得已接纳的分析报告。页面会继续查询原请求；服务异常时请检查环境 B 的运行日志，不要重复上传。';
        let terminal = false;
        try {
          const scope = { enterpriseId, projectId };
          const intake = record(
            await readExactQuery(
              'integration.get_customer_zip_intake',
              scope,
              {
                by: 'PREPARATION_REQUEST',
                preparationRequestRef: objectRef(
                  'zhiju.project.preparation_request',
                  requestId,
                  scope,
                ),
                originalPreparationKey: 'project.request_project_preparation:1.0:' + requestId,
              },
              csrfToken,
              abort.signal,
            ),
          );
          if (!valid()) return;
          const execution = asRecord(record(intake.analysis).execution);
          const phase = execution?.state;
          const messages: Record<string, string> = {
            PENDING: '分析请求已排队，等待服务器处理。',
            PREPARING: '服务器正在准备本轮来源与分析任务。',
            RUNNING: '本机 OMP 正在分析客户资料与模板。',
            VALIDATING: 'Runner 已返回结果，平台正在校验报告。',
            ACCEPTED: '执行结果已接纳，正在读取项目报告。',
            FAILED: '本次分析未通过。请检查环境 B 的运行日志，保留原请求，不要重复上传。',
            UNKNOWN: '原调用结果待核验。平台不会再次调用 Runner；请保留原请求并检查运行日志。',
            EXPIRED: '本次分析已超过执行有效期。迟到结果不会成为当前报告；请检查原请求。',
          };
          if (typeof phase === 'string' && messages[phase]) {
            message = messages[phase] ?? message;
            terminal = ['FAILED', 'UNKNOWN', 'EXPIRED'].includes(phase);
          }
        } catch (error) {
          const failure = failureFromUnknown(error, 'DEPENDENCY_UNAVAILABLE');
          if (failure.httpStatus === 401 || failure.httpStatus === 403) {
            if (!valid()) return;
            setCurrent(null);
            setState(null);
            setNotice('当前会话或权限已失效，请重新登录后读取原项目。');
            if (failure.httpStatus === 401) latest.current.onSessionFailure();
            return;
          }
        }
        if (!valid()) return;
        setNotice(message);
        if (!terminal)
          timer = setTimeout(() => {
            void read();
          }, 5000);
      }
    };
    void read();
    return () => {
      abort.abort();
      if (timer) clearTimeout(timer);
    };
  }, [
    projectId,
    enterpriseId,
    requestId,
    csrfToken,
    sessionGeneration,
    principalId,
    generation,
    guardRef,
    revision,
  ]);
  const back = preparationHref(requestId, { enterpriseId, projectId });
  if (!current || !state)
    return (
      <section className="panel">
        <p className="eyebrow">客户资料分析</p>
        <h1 tabIndex={-1}>等待分析报告</h1>
        <p role="status">{notice}</p>
        <p>
          上传资料已交给服务器处理。只有来源对应、格式校验和平台接纳都通过，报告才会出现在这里。
        </p>
        <button
          onClick={() => {
            setRevision((n) => n + 1);
          }}
        >
          重新读取
        </button>{' '}
        <Link to={back}>查看资料提交回执</Link>
      </section>
    );
  return (
    <AnalysisPage
      report={current.report}
      state={state}
      update={(change) => {
        setState((old) => (old ? change(old) : old));
      }}
      historical={false}
      readOnlyActions
      navigationContext={{ enterprise: enterpriseId, project: projectId, analysis: '1' }}
      records={<Link to={back}>查看本次资料提交回执</Link>}
      updateNotice={
        !current.usable ? (
          <p role="status">
            本报告保留供查看；原资料快照的执行有效期已结束或当前绑定已失效，不能据此继续启动任务。
          </p>
        ) : undefined
      }
    />
  );
}

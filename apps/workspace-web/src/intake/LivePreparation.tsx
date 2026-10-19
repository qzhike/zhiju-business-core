import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import type { TrustedProps } from '../workbench/TrustedWorkbench.js';
import { readExactQuery, failureFromUnknown } from '../trusted/client.js';
import { isUuidV7, uuidV7 } from '../trusted/identity.js';
import { asRecord, type JsonRecord } from '../trusted/values.js';
import { LivePreparationReport } from '../analysis/LiveReport.js';
import { IntakePage, NewProjectPage } from './Pages.js';
import type { CreationIntent, Customer, IntakeReceipt, Submission } from './model.js';
import {
  bytesSha256,
  objectRef,
  postPreparationCommand,
  preparationCommand,
  preparationHref,
  uploadPreparationZip,
} from './live-client.js';

type Props = Omit<TrustedProps, 'selectedKey' | 'onSelect'>;
const record = (value: unknown): JsonRecord => {
  const result = asRecord(value);
  if (!result) throw new Error('UI_CLIENT_STATE_INVALID');
  return result;
};
function useLifetime(props: Props, scopeKey: string) {
  const abort = useMemo(
    () => ({ current: new AbortController() }),
    [props.sessionGeneration, props.principalId, scopeKey],
  );
  useEffect(() => {
    // Strict Effects may retire the initial controller before the live setup.
    // A changed scope/session always owns a different lifetime object.
    if (abort.current.signal.aborted) abort.current = new AbortController();
    return () => {
      abort.current.abort();
    };
  }, [abort]);
  const current = useCallback(
    () =>
      !abort.current.signal.aborted &&
      props.guardRef.current.generation === props.generation &&
      props.guardRef.current.principalId === props.principalId,
    [abort, props.generation, props.principalId, props.guardRef],
  );
  return { abort, current };
}

function statusFailure(props: Props, error: unknown): string {
  const failure = failureFromUnknown(error, 'DEPENDENCY_UNAVAILABLE');
  if (failure.httpStatus === 401) props.onSessionFailure();
  return '暂时无法核验原请求。请保持原请求链接；当前错误不能证明尚未提交。';
}

/** The approved reusable form receives only current, owning entry choices. */
export function LiveNewProject(props: Props) {
  const navigate = useNavigate();
  const lifetime = useLifetime(props, '/projects/new');
  const [entry, setEntry] = useState<JsonRecord | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let stopped = false;
    const currentRead = () => !stopped && lifetime.current();
    const load = async () => {
      let cursor: string | undefined;
      const seen = new Set<string>();
      const items: Customer[] = [];
      let binding: string | undefined;
      do {
        const data = record(
          await readExactQuery(
            'project.find_preparation_enterprises',
            {},
            { searchText: '', page: { limit: 50, ...(cursor ? { cursor } : {}) } },
            props.csrfToken,
            lifetime.abort.current.signal,
          ),
        );
        if (!currentRead()) return;
        const nextBinding = JSON.stringify(data.entryBinding);
        if (binding !== undefined && binding !== nextBinding)
          throw new Error('UI_CLIENT_STATE_INVALID');
        binding = nextBinding;
        if (!Array.isArray(data.items)) throw new Error('UI_CLIENT_STATE_INVALID');
        for (const raw of data.items) {
          const item = record(raw);
          const ref = record(item.enterpriseRef);
          if (
            ref.objectType !== 'zhiju.project.enterprise' ||
            !isUuidV7(String(ref.objectId)) ||
            typeof item.displayName !== 'string' ||
            typeof item.displayCode !== 'string'
          )
            throw new Error('UI_CLIENT_STATE_INVALID');
          items.push({ id: String(ref.objectId), name: item.displayName, code: item.displayCode });
        }
        cursor = typeof data.nextCursor === 'string' ? data.nextCursor : undefined;
        if (cursor) {
          if (seen.has(cursor) || seen.size >= 200) throw new Error('UI_CLIENT_STATE_INVALID');
          seen.add(cursor);
        }
        if (!cursor) {
          setCustomers(items);
          setEntry(data);
        }
      } while (cursor);
    };
    void load().catch((failure: unknown) => {
      if (currentRead()) setError(statusFailure(props, failure));
    });
    return () => {
      stopped = true;
    };
  }, [props.csrfToken, lifetime.current, lifetime.abort, props]);

  const create =
    entry === null
      ? undefined
      : async (intent: CreationIntent) => {
          const binding = record(entry.entryBinding);
          const requestId = uuidV7();
          const scope = {
            enterpriseId: intent.customer.kind === 'NEW' ? uuidV7() : intent.customer.customer.id,
            projectId: uuidV7(),
          };
          if (intent.customer.kind === 'NEW' && entry.newCustomerAllowed !== true)
            throw new Error('UI_CLIENT_STATE_INVALID');
          const payload = {
            customer:
              intent.customer.kind === 'NEW'
                ? { mode: 'NEW', displayName: intent.customer.name }
                : {
                    mode: 'EXISTING',
                    enterpriseRef: objectRef('zhiju.project.enterprise', scope.enterpriseId, {
                      enterpriseId: scope.enterpriseId,
                    }),
                  },
            projectTitle: intent.title,
            preparationPresetRef: binding.preparationPresetRef,
            preparationPresetHash: binding.preparationPresetHash,
          };
          const command = await preparationCommand(
            'project.request_project_preparation',
            objectRef('zhiju.project.preparation_request', requestId, scope),
            payload,
          );
          if (!lifetime.current()) throw new Error('UI_CLIENT_STATE_INVALID');
          // Preserve safe recovery identifiers in the URL before the first write.
          // The component then unmounts; the owner query is the recovery authority.
          const href = preparationHref(requestId, scope);
          window.history.replaceState(null, '', href);
          try {
            await postPreparationCommand(command, props.csrfToken, lifetime.abort.current.signal);
          } finally {
            if (lifetime.current()) void navigate(href, { replace: true });
          }
          return {
            recoveryHref: href,
            intent,
            project: {
              id: scope.projectId,
              title: intent.title,
              customer:
                intent.customer.kind === 'EXISTING'
                  ? intent.customer.customer
                  : { id: scope.enterpriseId, name: intent.customer.name, code: '' },
            },
          };
        };
  return (
    <NewProjectPage
      customers={customers}
      newCustomerAllowed={entry?.newCustomerAllowed === true}
      {...(create ? { create } : {})}
      {...(entry === null ? { unavailable: error || '正在核验准备入口与当前客户选择权限…' } : {})}
    />
  );
}

function parseRequest(value: unknown, requestId: string, scope: JsonRecord): JsonRecord {
  const data = record(value);
  const ref = record(data.requestRef);
  const original = record(data.originalCommand);
  const target = record(original.targetRef);
  if (
    ref.objectId !== requestId ||
    target.objectId !== requestId ||
    ref.objectType !== 'zhiju.project.preparation_request' ||
    record(original.scopeRef).enterpriseId !== scope.enterpriseId ||
    record(original.scopeRef).projectId !== scope.projectId ||
    data.originalKey !== `project.request_project_preparation:1.0:${requestId}`
  )
    throw new Error('UI_CLIENT_STATE_INVALID');
  return data;
}
function intakeView(value: unknown, requestId: string, scope: JsonRecord): JsonRecord {
  const data = record(value);
  const ref = record(data.intakeRef);
  const original = record(data.originalCommand);
  const payload = record(original.payload);
  if (
    !isUuidV7(String(ref.objectId)) ||
    ref.objectType !== 'zhiju.integration.customer_zip_intake' ||
    record(payload.preparationRequestRef).objectId !== requestId ||
    record(original.scopeRef).enterpriseId !== scope.enterpriseId ||
    record(original.scopeRef).projectId !== scope.projectId ||
    payload.analysisIntent !== 'ANALYZE' ||
    (data.submittedNote ?? undefined) !== (payload.submittedNote ?? undefined)
  )
    throw new Error('UI_CLIENT_STATE_INVALID');
  return data;
}

export function LivePreparationRequest(props: Props) {
  const { requestId = '' } = useParams();
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  const enterpriseId = search.get('enterprise') ?? '';
  const projectId = search.get('project') ?? '';
  const attemptedIntakeId = search.get('intake');
  const scopeKey = `${location.pathname}${location.search}`;
  const lifetime = useLifetime(props, scopeKey);
  const [request, setRequest] = useState<JsonRecord | null>(null);
  const [intake, setIntake] = useState<JsonRecord | null>(null);
  const [notice, setNotice] = useState('正在读取原准备请求…');
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);
  const lock = useRef(false);
  const lastCommand = useRef<JsonRecord | null>(null);
  const failedRead = (error: unknown) => {
    const failure = failureFromUnknown(error, 'DEPENDENCY_UNAVAILABLE');
    if (failure.httpStatus === 401 || failure.httpStatus === 403) {
      setRequest(null);
      setIntake(null);
    }
    setNotice(statusFailure(props, error));
  };
  const scope = { enterpriseId, projectId };
  const valid = [requestId, enterpriseId, projectId].every(isUuidV7);
  const refresh = () => {
    setRevision((value) => value + 1);
  };
  useEffect(() => {
    let stopped = false;
    const currentRead = () => !stopped && lifetime.current();
    setRequest(null);
    setIntake(null);
    if (!valid) {
      setNotice('准备请求链接无效。');
      return;
    }
    const read = async () => {
      const requestRef = objectRef('zhiju.project.preparation_request', requestId, {
        enterpriseId,
        projectId,
      });
      const [requestRead, intakeRead] = await Promise.allSettled([
        readExactQuery(
          'project.get_project_preparation_request',
          { enterpriseId, projectId },
          { requestRef, originalKey: `project.request_project_preparation:1.0:${requestId}` },
          props.csrfToken,
          lifetime.abort.current.signal,
        ),
        readExactQuery(
          'integration.get_customer_zip_intake',
          { enterpriseId, projectId },
          {
            by: 'PREPARATION_REQUEST',
            preparationRequestRef: requestRef,
            originalPreparationKey: `project.request_project_preparation:1.0:${requestId}`,
          },
          props.csrfToken,
          lifetime.abort.current.signal,
        ),
      ]);
      if (!currentRead()) return;
      setNotice('');
      if (requestRead.status === 'fulfilled')
        setRequest(parseRequest(requestRead.value, requestId, { enterpriseId, projectId }));
      else setNotice(statusFailure(props, requestRead.reason));
      if (intakeRead.status === 'fulfilled')
        setIntake(intakeView(intakeRead.value, requestId, { enterpriseId, projectId }));
      else {
        const failure = failureFromUnknown(intakeRead.reason, 'DEPENDENCY_UNAVAILABLE');
        if (failure.httpStatus !== 404) setNotice(statusFailure(props, intakeRead.reason));
        else if (lastCommand.current !== null || attemptedIntakeId !== null)
          setNotice('尚未查到原 intake，提交结果仍待核验；请勿更换请求或重复提交。');
      }
    };
    void read().catch((error: unknown) => {
      if (currentRead()) failedRead(error);
    });
    return () => {
      stopped = true;
    };
  }, [
    valid,
    requestId,
    enterpriseId,
    projectId,
    props.csrfToken,
    lifetime.current,
    lifetime.abort,
    revision,
    props,
  ]);

  const original = request ? record(request.originalCommand) : null;
  const payload = original ? record(original.payload) : null;
  const customer = payload ? record(payload.customer) : null;
  const usable =
    request !== null &&
    record(request.access).status === 'USABLE' &&
    Array.isArray(request.permittedActions) &&
    request.permittedActions.includes('SUBMIT_ZIP');
  const currentPayload = intake ? record(record(intake.originalCommand).payload) : null;
  const custody = intake ? record(intake.custody) : null;
  const analysis = intake ? record(intake.analysis) : null;
  const receipts = new Map<string, IntakeReceipt[]>();
  if (intake && currentPayload) {
    const failed = custody?.status === 'FAILED';
    const stage = failed
      ? 'PREPARATION_FAILED'
      : custody?.status === 'READY' || custody?.status === 'PARTIAL'
        ? 'WAITING'
        : custody?.status === 'RECEIVING'
          ? 'RECEIVING'
          : custody?.status === 'UNKNOWN'
            ? 'UNKNOWN'
            : 'PREPARING';
    const limitations = Array.isArray(custody?.reasonCodes)
      ? custody.reasonCodes.filter((item): item is string => typeof item === 'string')
      : [];
    receipts.set(projectId, [
      {
        input: {
          id: String(record(intake.intakeRef).objectId),
          projectId,
          zip: { name: String(currentPayload.originalName) },
          note: typeof intake.submittedNote === 'string' ? intake.submittedNote : '',
        },
        stage,
        failures: limitations,
        retryAllowed: false,
      },
    ]);
  }
  const submit =
    usable && intake === null && lastCommand.current === null && attemptedIntakeId === null
      ? async (input: Submission) => {
          if (lock.current || !input.zip.file) return;
          lock.current = true;
          setPending(true);
          try {
            const file = input.zip.file;
            if (file.size < 1 || file.size > 104_857_600) throw new Error('UI_ZIP_LIMIT');
            const zipHash = await bytesSha256(await file.arrayBuffer());
            const command = await preparationCommand(
              'integration.request_customer_zip_intake',
              objectRef('zhiju.integration.customer_zip_intake', uuidV7(), scope),
              {
                projectRef: objectRef('zhiju.project.project', projectId, scope),
                preparationRequestRef: request.requestRef,
                originalPreparationKey: request.originalKey,
                preparationPresetRef: request.preparationPresetRef,
                preparationPresetHash: request.preparationPresetHash,
                originalName: file.name,
                declaredByteLength: file.size,
                zipBytesSha256: zipHash,
                intakePolicyRef: request.intakePolicyRef,
                intakePolicyHash: request.intakePolicyHash,
                ...(input.note.length ? { submittedNote: input.note } : {}),
                analysisIntent: 'ANALYZE',
              },
            );
            if (!lifetime.current()) return;
            lastCommand.current = command;
            const recovery = new URLSearchParams(location.search);
            recovery.set('intake', String(record(command.targetRef).objectId));
            window.history.replaceState(null, '', `${location.pathname}?${recovery.toString()}`);
            const data = await postPreparationCommand(
              command,
              props.csrfToken,
              lifetime.abort.current.signal,
            );
            if (!lifetime.current()) return;
            await uploadPreparationZip(
              file,
              record(data.upload),
              props.csrfToken,
              lifetime.abort.current.signal,
            );
          } catch (error) {
            if (lifetime.current()) failedRead(error);
          } finally {
            if (lifetime.current()) {
              setPending(false);
              refresh();
            }
          }
        }
      : undefined;
  const restartAllowed =
    intake !== null &&
    Array.isArray(intake.allowedActions) &&
    (intake.allowedActions.includes('RESTART') || record(intake.uploadState).state === 'ISSUED');
  async function restart(file: File) {
    if ((lock.current && pending) || !intake || !currentPayload || !restartAllowed) return;
    lock.current = true;
    setPending(true);
    try {
      const actual = await bytesSha256(await file.arrayBuffer());
      if (
        file.size !== currentPayload.declaredByteLength ||
        actual.digest !== record(currentPayload.zipBytesSha256).digest
      )
        throw new Error('UI_ZIP_BYTES_MISMATCH');
      const uploadState = record(intake.uploadState);
      const command =
        asRecord(intake.restartCommand) ??
        (uploadState.state === 'ISSUED'
          ? record(intake.originalCommand)
          : await preparationCommand(
              'integration.restart_customer_zip_upload',
              record(intake.intakeRef),
              {
                intakeRef: intake.intakeRef,
                originalKey: intake.originalKey,
                originalPayloadHash: intake.payloadHash,
                expectedUploadGeneration: uploadState.generation,
              },
              Number(intake.aggregateVersion),
            ));
      const result = await postPreparationCommand(
        command,
        props.csrfToken,
        lifetime.abort.current.signal,
      );
      if (lifetime.current())
        await uploadPreparationZip(
          file,
          record(result.upload),
          props.csrfToken,
          lifetime.abort.current.signal,
        );
    } catch (error) {
      if (lifetime.current()) failedRead(error);
    } finally {
      if (lifetime.current()) {
        setPending(false);
        refresh();
      }
    }
  }
  if (!request || !payload || !customer)
    return (
      <section className="panel">
        <h1 tabIndex={-1}>核验原准备请求</h1>
        <p role="status">{notice}</p>
        {intake && currentPayload && (
          <section aria-label="已授权资料回执">
            <h2>原资料托管状态</h2>
            <p>
              {String(currentPayload.originalName)} · {String(custody?.status)}
            </p>
            {typeof intake.submittedNote === 'string' && <pre>{intake.submittedNote}</pre>}
            <p>分析交接：{String(analysis?.status)}</p>
            <p>准备请求当前不可核验；已授权读取的原资料保留，不执行后续写入。</p>
          </section>
        )}
        <button onClick={refresh}>读取原请求状态</button>
      </section>
    );
  const project = {
    id: projectId,
    title: String(payload.projectTitle),
    customer: {
      id: enterpriseId,
      name: customer.mode === 'NEW' ? String(customer.displayName) : '已选客户',
      code: enterpriseId,
    },
  };
  if (search.get('analysis') === '1')
    return (
      <LivePreparationReport
        {...props}
        enterpriseId={enterpriseId}
        projectId={projectId}
        requestId={requestId}
      />
    );
  return (
    <IntakePage
      selectedProjectId={projectId}
      firstIntakeImmutable
      submissionPending={pending}
      projects={[project]}
      receipts={receipts}
      {...(submit
        ? {
            submit: (input) => {
              void submit(input);
            },
          }
        : {})}
      {...(!usable && intake === null
        ? { unavailable: '原请求尚未取得完整项目权限或其绑定已失效；请核验原步骤。' }
        : {})}
      controls={
        <>
          {notice && <p role="status">{notice}</p>}
          <section className="panel">
            <h2>原请求与接纳回执</h2>
            <p>
              请求 {requestId} · {String(request.disposition)} · 权限{' '}
              {String(record(request.access).status)}
            </p>
            <ol>
              {Object.entries(record(request.steps)).map(([step, value]) => (
                <li key={step}>
                  {step} · {String(record(value).status)}
                </li>
              ))}
            </ol>
            {analysis?.status === 'WAITING_CAPABILITY' && (
              <p role="status">资料已接收，分析能力暂不可用。</p>
            )}
            {analysis?.status === 'UNKNOWN' && (
              <p role="status">资料接纳结果已保留，分析交接状态待核验。</p>
            )}
            {analysis?.status === 'ACCEPTED' && (
              <div>
                <p role="status">分析请求已接收，报告通过校验并接纳后可查看。</p>
                <Link
                  className="button primary"
                  to={preparationHref(requestId, { enterpriseId, projectId }) + '&analysis=1'}
                >
                  查看分析报告
                </Link>
              </div>
            )}
            {request.permittedActions instanceof Array &&
              request.permittedActions.includes('CONTINUE_ORIGINAL') && (
                <button
                  disabled={pending}
                  onClick={() => {
                    if (pending || !original) return;
                    setPending(true);
                    void postPreparationCommand(
                      original,
                      props.csrfToken,
                      lifetime.abort.current.signal,
                    )
                      .catch((error: unknown) => {
                        if (lifetime.current()) failedRead(error);
                      })
                      .finally(() => {
                        if (lifetime.current()) {
                          setPending(false);
                          refresh();
                        }
                      });
                  }}
                >
                  继续原准备请求
                </button>
              )}
            {Array.isArray(custody?.entries) && (
              <ul aria-label="资料接纳明细">
                {custody.entries.map((raw, index) => {
                  const item = record(raw);
                  return (
                    <li key={index}>
                      {typeof item.originalName === 'string' ? item.originalName : '资料项'} ·{' '}
                      {String(item.status)}
                      {Array.isArray(item.reasonCodes) ? ` · ${item.reasonCodes.join('、')}` : ''}
                    </li>
                  );
                })}
              </ul>
            )}
            {restartAllowed && (
              <label>
                {record(intake.uploadState).state === 'ISSUED'
                  ? '继续原上传（必须为原文件，票据不续期）'
                  : '重新上传这份 ZIP（仅一次、必须为原文件）'}
                <input
                  type="file"
                  accept=".zip,application/zip"
                  disabled={pending}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void restart(file);
                  }}
                />
              </label>
            )}
            {!restartAllowed &&
              intake &&
              record(intake.uploadState).restartsUsed === 1 &&
              ['CLOSED_NO_OBJECT', 'UNKNOWN'].includes(
                String(record(intake.uploadState).state),
              ) && <p>重传额度已用尽或状态不确定，请联系受权运维核对原 intake。</p>}
            <button disabled={pending} onClick={refresh}>
              读取原请求与 intake 状态
            </button>
          </section>
        </>
      }
    />
  );
}

import { Link } from 'react-router';
import { buttonVariants } from '../components/ui/button.js';
import { useFixtureProject } from './project-session.js';
import { useU1 } from './u1.js';
import { u1FormatRules } from './u1-data.js';
import { Label } from '../components/ui/label.js';
import { NativeSelect } from '../components/ui/native-select.js';
import { MockControls } from './control-slot.js';
// DEVELOPMENT_INTAKE_ADAPTER_ONLY: never imported by the production entry.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useParams } from 'react-router';
import { IntakePage, NewProjectPage } from '../intake/Pages.js';
import { FixtureU1Intake } from './u1.js';
import type {
  CreationIntent,
  Customer,
  IntakeProject,
  IntakeReceipt,
  IntakeStage,
  Submission,
} from '../intake/model.js';
const customers: readonly [Customer, Customer, Customer] = [
  { id: 'WB-ENTERPRISE-01', name: '青禾制造', code: 'QH-01' },
  { id: 'WB-ENTERPRISE-03', name: '青禾制造', code: 'QH-02' },
  { id: 'WB-ENTERPRISE-02', name: '远山科技', code: 'YS-2026' },
];
const initialProjects: readonly IntakeProject[] = [
  { id: 'DEMO-PROJECT-01', customer: customers[0], title: '体系文件升级' },
  {
    id: 'DEMO-PROJECT-02',
    customer: customers[2],
    title: '华东与华南多基地质量体系建设及年度审核资料准备项目',
  },
];
interface ProjectProgress {
  status: string;
  detail: string;
  reason: string;
}
interface FixtureState {
  entered: ReadonlyMap<string, string>;
  enterProject: (id: string, inputId: string) => void;
  progress: ReadonlyMap<string, ProjectProgress>;
  updateProgress: (id: string, progress: ProjectProgress) => void;
  projects: readonly IntakeProject[];
  receipts: ReadonlyMap<string, readonly IntakeReceipt[]>;
  create: (intent: CreationIntent) => Promise<{ intent: CreationIntent; project: IntakeProject }>;
  submit: (input: Submission) => void;
  retry: (receipt: IntakeReceipt) => void;
  controls: ReactNode;
}
const Context = createContext<FixtureState | null>(null);
export function FixtureIntakeProvider({ children }: { children: ReactNode }) {
  const [entered, setEntered] = useState<ReadonlyMap<string, string>>(new Map());
  const [progress, setProgress] = useState<ReadonlyMap<string, ProjectProgress>>(new Map());
  const updateProgress = useCallback((id: string, next: ProjectProgress) => {
    setProgress((previous) => {
      const old = previous.get(id);
      if (old?.status === next.status && old.detail === next.detail && old.reason === next.reason)
        return previous;
      return new Map(previous).set(id, next);
    });
  }, []);
  const [projects, setProjects] = useState(initialProjects);
  const [receipts, setReceipts] = useState<ReadonlyMap<string, readonly IntakeReceipt[]>>(
    new Map(),
  );
  const [scenario, setScenario] = useState('ready');
  const [creationMode, setCreationMode] = useState('matching');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const alive = useRef(true);
  const intents = useRef(new Set<string>());
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      timers.current.forEach(clearTimeout);
    };
  }, []);
  const update = (
    input: Submission,
    stage: IntakeStage,
    failures: readonly string[],
    retryAllowed = false,
  ) => {
    if (!alive.current) return;
    setReceipts((current) => {
      const history = [...(current.get(input.projectId) ?? [])];
      const receipt: IntakeReceipt = {
        input,
        stage,
        failures,
        retryAllowed,
        ...(stage === 'READY' ? { reportId: 'DEMO-STARTUP-REPORT-01' } : {}),
      };
      const index = history.findIndex((item) => item.input.id === input.id);
      if (index < 0) history.push(receipt);
      else history[index] = receipt;
      return new Map(current).set(input.projectId, history);
    });
  };
  const run = (input: Submission, previousFailures: readonly string[] = [], retrying = false) => {
    update(input, retrying ? 'WAITING' : 'RECEIVING', previousFailures);
    const fixed = input.zip.fixedScenario && input.projectId === 'DEMO-PROJECT-01';
    const stages: IntakeStage[] =
      scenario === 'unknown'
        ? ['UNKNOWN']
        : scenario === 'preparation-failure'
          ? ['PREPARING', 'PREPARATION_FAILED']
          : !fixed
            ? ['PREPARING', 'WAITING']
            : scenario === 'analysis-failure' || scenario === 'analysis-denied'
              ? ['PREPARING', 'WAITING', 'ANALYZING', 'ANALYSIS_FAILED']
              : ['PREPARING', 'WAITING', 'ANALYZING', 'VALIDATING', 'READY'];
    const attemptStages = retrying ? stages.filter((stage) => stage !== 'PREPARING') : stages;
    attemptStages.forEach((stage, index) => {
      timers.current.push(
        setTimeout(
          () => {
            const failures =
              stage === 'PREPARATION_FAILED'
                ? [...previousFailures, '固定场景：ZIP 准备失败，未启动 Runner。']
                : stage === 'ANALYSIS_FAILED'
                  ? [...previousFailures, '固定场景：Runner 分析失败。']
                  : previousFailures;
            update(
              input,
              stage,
              failures,
              stage === 'ANALYSIS_FAILED' && scenario === 'analysis-failure',
            );
          },
          (index + 1) * 350,
        ),
      );
    });
  };
  const state: FixtureState = {
    entered,
    enterProject: (id, inputId) => {
      const receipt = receipts.get(id)?.at(-1);
      if (receipt?.stage !== 'WAITING' || receipt.input.id !== inputId) return;
      setEntered((previous) => new Map(previous).set(id, inputId));
    },
    progress,
    updateProgress,
    projects,
    receipts,
    create: async (intent) => {
      await new Promise<void>((resolve) => {
        timers.current.push(setTimeout(resolve, 400));
      });
      if (!alive.current || creationMode === 'error')
        throw new Error('DEVELOPMENT_CREATION_UNKNOWN');
      const project: IntakeProject = {
        id: `DEMO-CREATED-${intent.id}`,
        title: intent.title,
        customer:
          intent.customer.kind === 'EXISTING'
            ? intent.customer.customer
            : { id: `DEMO-CUSTOMER-${intent.id}`, name: intent.customer.name, code: 'NEW · 演示' },
      };
      if (creationMode === 'matching') setProjects((current) => [...current, project]);
      return {
        intent: creationMode === 'mismatch' ? { ...intent, id: 'wrong-intent' } : intent,
        project,
      };
    },
    submit: (input) => {
      if (intents.current.has(input.id)) return;
      intents.current.add(input.id);
      run(input);
    },
    retry: (receipt) => {
      if (!receipt.retryAllowed || receipt.stage !== 'ANALYSIS_FAILED') return;
      const input = { ...receipt.input, id: crypto.randomUUID() };
      run(input, receipt.failures, true);
    },
    controls: (
      <MockControls>
        <details className="fixture-options">
          <summary>演示选项</summary>
          <div>
            <p>
              固定合成场景 · 不上传、创建或运行真实客户业务。只有带入固定 ZIP
              且位于青禾示例项目才返回固定报告；其他 ZIP
              仅展示合成等待回执。新项目接收后可显式使用独立示例进入当前工作，示例不是本地 ZIP
              解析结果。刷新清理本轮内存。
            </p>
            <Label>
              分析场景
              <NativeSelect
                value={scenario}
                onChange={(event) => {
                  setScenario(event.target.value);
                }}
              >
                <option value="ready">固定报告就绪</option>
                <option value="preparation-failure">准备失败</option>
                <option value="analysis-failure">分析失败 · 允许重试</option>
                <option value="analysis-denied">分析失败 · 不允许重试</option>
                <option value="unknown">UNKNOWN</option>
              </NativeSelect>
            </Label>
            <Label>
              创建回执
              <NativeSelect
                value={creationMode}
                onChange={(event) => {
                  setCreationMode(event.target.value);
                }}
              >
                <option value="matching">匹配</option>
                <option value="mismatch">不匹配</option>
                <option value="error">不可用</option>
              </NativeSelect>
            </Label>
          </div>
        </details>
      </MockControls>
    ),
  };
  return <Context.Provider value={state}>{children}</Context.Provider>;
}
export function useFixtureIntake() {
  const state = useContext(Context);
  if (!state) throw new Error('DEVELOPMENT_INTAKE_ADAPTER_ONLY');
  return state;
}
export function FixtureNewProject() {
  const state = useFixtureIntake();
  const directory = [
    ...new Map(
      [...customers, ...state.projects.map((project) => project.customer)].map((customer) => [
        customer.id,
        customer,
      ]),
    ).values(),
  ];
  return <NewProjectPage customers={directory} create={state.create} controls={state.controls} />;
}
export function FixtureIntake() {
  const state = useFixtureIntake();
  const params = useParams();
  const identity = useFixtureProject();
  const u1 = useU1();
  const created = state.projects.find(
    (project) => project.id === params.projectId && project.id.startsWith('DEMO-CREATED-'),
  );
  const current = created ? state.receipts.get(created.id)?.at(-1) : undefined;
  if (params.projectId === 'MVP-U1-PROJECT') return <FixtureU1Intake />;
  return (
    <IntakePage
      {...state}
      {...(created
        ? {
            submitLabel: '提交资料',
            sampleZip: { name: '体系文件示例资料.zip', fixedScenario: true },
            directoryNotice: (
              <p className="intake-project-status">
                项目已创建 · {created.customer.name} · {created.title}。
                {current?.stage === 'WAITING' ? '首轮资料已接收。' : '下一步：提交首轮资料。'}
              </p>
            ),
            ...(current?.stage === 'WAITING'
              ? {
                  continuation: (
                    <div className="intake-continuation">
                      <h2>资料已接收，可以继续演练</h2>
                      <p>
                        当前仅记录文件名与说明，没有读取本地
                        ZIP。下一步使用下方合成示例目录进行分析与修订演练，不代表所选 ZIP 的内容。
                      </p>
                      <Link
                        className={buttonVariants({ variant: 'default' })}
                        to={`/projects/${identity.id}/work`}
                        onClick={() => {
                          state.enterProject(created.id, current.input.id);
                        }}
                      >
                        使用示例资料进入当前工作
                      </Link>
                    </div>
                  ),
                  batches: u1.batches.map((batch, index) =>
                    index === 0
                      ? {
                          ...batch,
                          label: '合成示例资料（非本地 ZIP 解析结果）',
                          zipName: '体系文件示例资料.zip',
                        }
                      : batch,
                  ),
                  formatRules: u1FormatRules,
                }
              : {}),
          }
        : {})}
      fixedZip={{ name: '青禾客户资料（固定演示）.zip', fixedScenario: true }}
    />
  );
}

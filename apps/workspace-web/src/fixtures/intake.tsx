// DEVELOPMENT_INTAKE_ADAPTER_ONLY: never imported by the production entry.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
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
interface FixtureState {
  projects: readonly IntakeProject[];
  receipts: ReadonlyMap<string, readonly IntakeReceipt[]>;
  create: (intent: CreationIntent) => Promise<{ intent: CreationIntent; project: IntakeProject }>;
  submit: (input: Submission) => void;
  retry: (receipt: IntakeReceipt) => void;
  controls: ReactNode;
}
const Context = createContext<FixtureState | null>(null);
export function FixtureIntakeProvider({ children }: { children: ReactNode }) {
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
        : !fixed
          ? ['PREPARING', 'WAITING']
          : scenario === 'preparation-failure'
            ? ['PREPARING', 'PREPARATION_FAILED']
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
      <details className="fixture-options">
        <summary>演示选项</summary>
        <div>
          <p>
            固定合成场景 · 不上传、创建或运行真实客户业务。只有带入固定 ZIP
            且位于青禾示例项目才返回固定报告；其他 ZIP/新项目只展示合成等待回执。刷新清理本轮内存。
          </p>
          <label>
            分析场景
            <select
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
            </select>
          </label>
          <label>
            创建回执
            <select
              value={creationMode}
              onChange={(event) => {
                setCreationMode(event.target.value);
              }}
            >
              <option value="matching">匹配</option>
              <option value="mismatch">不匹配</option>
              <option value="error">不可用</option>
            </select>
          </label>
        </div>
      </details>
    ),
  };
  return <Context.Provider value={state}>{children}</Context.Provider>;
}
function useFixture() {
  const state = useContext(Context);
  if (!state) throw new Error('DEVELOPMENT_INTAKE_ADAPTER_ONLY');
  return state;
}
export function FixtureNewProject() {
  const state = useFixture();
  return <NewProjectPage customers={customers} create={state.create} controls={state.controls} />;
}
export function FixtureIntake() {
  const state = useFixture();
  const params = useParams();
  if (params.projectId === 'MVP-U1-PROJECT') return <FixtureU1Intake />;
  return (
    <IntakePage
      {...state}
      fixedZip={{ name: '青禾客户资料（固定演示）.zip', fixedScenario: true }}
    />
  );
}

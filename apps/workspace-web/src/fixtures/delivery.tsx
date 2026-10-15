// Isolated synthetic events and bytes. Never a production release/export adapter.
import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { DeliveryPage, type DeliveryPageProps } from '../delivery/Page.js';
import {
  selectionKey,
  type DeliveryActions,
  type DeliveryData,
  type DeliveryFile,
  type DeliveryIntent,
  type DeliveryPackage,
  type DeliveryReceipt,
  type DownloadFact,
  type Selection,
} from '../delivery/model.js';
const marker = 'DELIVERY_DEVELOPMENT_ADAPTER_ONLY';
const projectId = 'DEMO-PROJECT-01';
const stamp = '2026-10-15 10:00（Asia/Shanghai）';
const file = (
  id: string,
  title: string,
  chapter: string,
  round: string,
  eligible = true,
): DeliveryFile => ({
  id,
  title,
  code: `QH-${id}`,
  chapter,
  chapterTitle: chapter === '4.2' ? '文件要求' : '改进',
  revisionId: `${id}-REV-01`,
  version: '第 1 版',
  provenance: { round, reportId: `REPORT-${round}`, reportVersion: 1 },
  qualification: {
    key: `${id}-QUAL-01`,
    eligible,
    reason: eligible
      ? '固定合成核验：本版本适用发布条件满足'
      : '内部已批准，待发布授权；批准本身不授予交付资格',
  },
});
const initial: DeliveryData = {
  projectId,
  projectTitle: '青禾制造 · 合成项目',
  contextKey: 'DEMO-PLAN-01',
  recipient: '青禾制造 · 质量管理体系项目接收范围（合成）',
  observedAt: stamp,
  completeness: 'COMPLETE',
  files: [
    file('MANUAL', '质量手册', '4.2', '第 2 轮'),
    file('CORR', '纠正措施程序', '8.5', '第 1 轮'),
    file('PREV', '预防措施程序', '8.5', 'Human 手工编制', false),
  ],
  packages: [],
};
interface Adapter {
  data: DeliveryData;
  setData: (change: (data: DeliveryData) => DeliveryData) => void;
  intents: Map<string, DeliveryIntent>;
  receipt: DeliveryReceipt | null;
  setReceipt: (receipt: DeliveryReceipt | null) => void;
  calls: number;
  setCalls: (change: (calls: number) => number) => void;
}
const Context = createContext<Adapter | null>(null);
export function FixtureDeliveryProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState(initial);
  const [intents] = useState(() => new Map<string, DeliveryIntent>());
  const [receipt, setReceipt] = useState<DeliveryReceipt | null>(null);
  const [calls, setCalls] = useState(0);
  return (
    <Context.Provider value={{ data, setData, intents, receipt, setReceipt, calls, setCalls }}>
      {children}
    </Context.Provider>
  );
}
export function FixtureDelivery() {
  const adapter = useContext(Context);
  if (!adapter) throw new Error(marker);
  const { data, setData, intents, receipt, setReceipt, calls, setCalls } = adapter;
  const [phase, setPhase] = useState<NonNullable<DeliveryPageProps['phase']>>('AVAILABLE');
  const [outcome, setOutcome] = useState<DeliveryReceipt['state'] | 'HOLD' | 'MISMATCH'>(
    'PACKAGE_READY',
  );
  const [readOutcome, setReadOutcome] = useState<DeliveryReceipt['state']>('PACKAGE_READY');
  const [downloadOutcome, setDownloadOutcome] = useState('REQUESTED');
  const pending = useRef<((value: DeliveryReceipt) => void) | null>(null);
  const current = useRef(data);
  current.current = data;
  const checks = useRef(new Map<string, string>());
  const makePackage = (intent: DeliveryIntent): DeliveryPackage => ({
    id: `DEMO-PACKAGE-${intent.id}`,
    label: '合成项目交付批次',
    createdAt: stamp,
    selection: structuredClone(intent.selection),
    availability: 'AVAILABLE',
    reason: '',
    synthetic: true,
    downloads: [],
  });
  const result = (intent: DeliveryIntent, state: DeliveryReceipt['state']): DeliveryReceipt => {
    if (state !== 'PACKAGE_READY')
      return {
        intent,
        state,
        reason:
          state === 'REJECTED'
            ? '合成服务拒绝：发布资格需重新核对'
            : state === 'FAILED'
              ? '合成归档生成失败，可查看原意图'
              : '',
      };
    const pkg =
      current.current.packages.find((item) => item.id === `DEMO-PACKAGE-${intent.id}`) ??
      makePackage(intent);
    setData((prior) => ({
      ...prior,
      packages: prior.packages.some((item) => item.id === pkg.id)
        ? prior.packages
        : [...prior.packages, pkg],
    }));
    return { intent, state, package: pkg };
  };
  const actions: DeliveryActions = {
    check: async (selection) => {
      await Promise.resolve();
      const token = crypto.randomUUID();
      checks.current.set(token, selectionKey(selection));
      const hasManual = selection.files.some((item) => item.id === 'MANUAL');
      const hasCorr = selection.files.some((item) => item.id === 'CORR');
      return {
        selection,
        token,
        requirements: [
          {
            title: '固定合成配套规则',
            detail: '质量手册必须与纠正措施程序在同一批提供；此判断由开发适配器供应',
          },
        ],
        blockers: hasManual && !hasCorr ? ['缺少本批配套：纠正措施程序；请返回调整选择'] : [],
      };
    },
    confirm: (intent) => {
      if (checks.current.get(intent.checkToken) !== selectionKey(intent.selection))
        return Promise.resolve({ intent, state: 'REJECTED' });
      intents.set(intent.id, structuredClone(intent));
      setCalls((prior) => prior + 1);
      if (outcome === 'HOLD')
        return new Promise((resolve) => {
          pending.current = resolve;
        });
      if (outcome === 'MISMATCH')
        return Promise.resolve({
          intent: { ...intent, id: 'WRONG-INTENT' },
          state: 'PACKAGE_READY',
          package: makePackage(intent),
        });
      return Promise.resolve(result(intent, outcome));
    },
    read: async (intent) => {
      await Promise.resolve();
      const original = intents.get(intent.id);
      if (
        original?.checkToken !== intent.checkToken ||
        selectionKey(original.selection) !== selectionKey(intent.selection)
      )
        throw new Error(marker);
      return result(original, readOutcome);
    },
    download: async (pkg) => {
      await Promise.resolve();
      if (downloadOutcome === 'THROW') throw new Error(marker);
      if (downloadOutcome === 'REQUESTED') {
        const bytes = syntheticZip(pkg.selection);
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `${pkg.id}-SYNTHETIC.zip`;
        link.click();
        URL.revokeObjectURL(url);
      }
      const fact: DownloadFact = {
        id: crypto.randomUUID(),
        packageId: pkg.id,
        at: stamp,
        state:
          downloadOutcome === 'FAILED'
            ? 'FAILED'
            : downloadOutcome === 'RESPONSE_SENT'
              ? 'RESPONSE_SENT'
              : downloadOutcome === 'RESPONSE_STARTED'
                ? 'RESPONSE_STARTED'
                : downloadOutcome === 'UNKNOWN'
                  ? 'UNKNOWN'
                  : 'REQUESTED',
      };
      setData((prior) => ({
        ...prior,
        packages: prior.packages.map((item) =>
          item.id === pkg.id && !item.downloads.some((saved) => saved.id === fact.id)
            ? { ...item, downloads: [...item.downloads, fact] }
            : item,
        ),
      }));
      return fact;
    },
  };
  const availability = (value: DeliveryPackage['availability']) => {
    setData((prior) => ({
      ...prior,
      packages: prior.packages.map((pkg) => ({
        ...pkg,
        availability: value,
        reason:
          value === 'AVAILABLE'
            ? ''
            : value === 'EXPIRED'
              ? '请在当前权限下重新请求同一包'
              : value === 'FAILED'
                ? '交付包校验失败，当前无法下载'
                : '当前无法下载，未取得有效许可',
      })),
    }));
  };
  return (
    <DeliveryPage
      data={data}
      phase={phase}
      actions={actions}
      recovery={{ receipt, update: setReceipt }}
      reload={() => {
        setPhase('AVAILABLE');
        setData((prior) => ({ ...prior, completeness: 'COMPLETE' }));
      }}
      controls={
        <details className="delivery-controls">
          <summary>开发交付场景 · 全部为合成数据</summary>
          <p>{marker} · 仅内存，不接 Core/Runner/生产受控导出。</p>
          <p>确认调用数：{calls}</p>
          <div>
            <label>
              确认回执
              <select
                value={outcome}
                onChange={(event) => {
                  setOutcome(event.target.value as typeof outcome);
                }}
              >
                {[
                  'PACKAGE_READY',
                  'HOLD',
                  'UNKNOWN',
                  'REJECTED',
                  'FAILED',
                  'CONFIRMED',
                  'GENERATING',
                  'MISMATCH',
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              原意图查询结果
              <select
                value={readOutcome}
                onChange={(event) => {
                  setReadOutcome(event.target.value as typeof readOutcome);
                }}
              >
                {['PACKAGE_READY', 'UNKNOWN', 'CONFIRMED', 'GENERATING', 'FAILED', 'REJECTED'].map(
                  (value) => (
                    <option key={value}>{value}</option>
                  ),
                )}
              </select>
            </label>
            <label>
              下载观察
              <select
                value={downloadOutcome}
                onChange={(event) => {
                  setDownloadOutcome(event.target.value);
                }}
              >
                {[
                  'REQUESTED',
                  'UNKNOWN',
                  'FAILED',
                  'THROW',
                  'RESPONSE_STARTED',
                  'RESPONSE_SENT',
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              交付读取场景
              <select
                value={phase}
                onChange={(event) => {
                  setPhase(event.target.value as typeof phase);
                }}
              >
                {['AVAILABLE', 'LOADING', 'ERROR', 'EXPIRED', 'UNAVAILABLE'].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <button
              onClick={() => {
                const intent = [...intents.values()].at(-1);
                if (intent && pending.current) {
                  pending.current({ intent, state: 'UNKNOWN' });
                  pending.current = null;
                }
              }}
            >
              返回待核实回执
            </button>
            <button
              onClick={() => {
                setData((prior) => ({
                  ...prior,
                  files: prior.files.map((item) =>
                    item.id !== 'MANUAL'
                      ? item
                      : {
                          ...item,
                          revisionId: 'MANUAL-REV-02',
                          version: '第 2 版',
                          qualification: { ...item.qualification, key: 'MANUAL-QUAL-02' },
                        },
                  ),
                }));
              }}
            >
              模拟手册新版本
            </button>
            <button
              onClick={() => {
                setData((prior) => ({
                  ...prior,
                  files: prior.files.map((item) =>
                    item.id !== 'CORR'
                      ? item
                      : {
                          ...item,
                          qualification: {
                            key: 'REVOKED',
                            eligible: false,
                            reason: '配套核验已失效，需重新核对',
                          },
                        },
                  ),
                }));
              }}
            >
              模拟程序资格失效
            </button>
            <button
              onClick={() => {
                setData((prior) => ({
                  ...prior,
                  files: prior.files.filter((item) => item.id !== 'MANUAL'),
                }));
              }}
            >
              移除手册观察
            </button>
            <button
              onClick={() => {
                setData((prior) => ({ ...prior, completeness: 'PARTIAL' }));
              }}
            >
              模拟部分读取
            </button>
            <button
              onClick={() => {
                setData((prior) => ({ ...prior, completeness: 'STALE' }));
              }}
            >
              模拟陈旧读取
            </button>
            <button
              onClick={() => {
                setData((prior) => ({ ...prior, files: [] }));
              }}
            >
              模拟空清单
            </button>
            <button
              onClick={() => {
                setData((prior) => ({
                  ...prior,
                  files: [
                    ...initial.files,
                    ...Array.from({ length: 197 }, (_, index) =>
                      file(`LONG-${index}`, `合成文件 ${index}`, '8.5', '第 3 轮'),
                    ),
                  ],
                }));
              }}
            >
              带入 200 份文件
            </button>
            <button
              onClick={() => {
                availability('EXPIRED');
              }}
            >
              模拟包许可过期
            </button>
            <button
              onClick={() => {
                availability('UNAVAILABLE');
              }}
            >
              模拟包不可下载
            </button>
            <button
              onClick={() => {
                availability('FAILED');
              }}
            >
              模拟包校验失败
            </button>
            <button
              onClick={() => {
                availability('AVAILABLE');
              }}
            >
              恢复同一包可下载
            </button>
          </div>
        </details>
      }
    />
  );
}
// Minimal uncompressed ZIP for synthetic UI download QA; never used by production.
function syntheticZip(selection: Selection) {
  const encoder = new TextEncoder();
  const entries = [
    {
      name: 'SYNTHETIC-MANIFEST.md',
      text: `# SYNTHETIC DEVELOPMENT SAMPLE\n\nNot a controlled export.\n\n${selection.files.map((item) => `${item.title}: ${item.revisionId} / ${item.provenance.reportId}`).join('\n')}`,
    },
    ...selection.files.map((item) => ({
      name: `${item.id}.md`,
      text: `# ${item.title}\n\nSYNTHETIC DEVELOPMENT SAMPLE ONLY\n\nRevision: ${item.revisionId}\nReport: ${item.provenance.reportId}\n\nNo customer content or production export.\n`,
    })),
  ];
  const chunks: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  const header = (size: number) => new DataView(new ArrayBuffer(size));
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const content = encoder.encode(entry.text);
    let crc = 0xffffffff;
    for (const byte of content) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = header(30);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, content.length, true);
    local.setUint32(22, content.length, true);
    local.setUint16(26, name.length, true);
    const central = header(46);
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, content.length, true);
    central.setUint32(24, content.length, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    chunks.push(new Uint8Array(local.buffer), name, content);
    directory.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.length + content.length;
  }
  const directorySize = directory.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = header(22);
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  const output = new Uint8Array(offset + directorySize + 22);
  let position = 0;
  for (const chunk of [...chunks, ...directory, new Uint8Array(end.buffer)]) {
    output.set(chunk, position);
    position += chunk.length;
  }
  return output;
}

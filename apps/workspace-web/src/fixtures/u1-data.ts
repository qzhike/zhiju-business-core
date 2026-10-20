// Public-safe U1 rehearsal data. Source IDs are anonymous; statements are
// derived presentation facts from the local read-only customer DOCX and official
// templates, with no customer identity, excerpts, comments or screenshots.
import type { AnalysisReport } from '../analysis/model.js';
import type { InputBatch, InputFormatRule } from '../intake/model.js';
import type { PlanView } from '../plan/model.js';

export const u1Project = {
  id: 'MVP-U1-PROJECT',
  enterpriseId: 'U1-ENTERPRISE',
  customerLabel: '匿名客户 C01–C07',
  title: '变更控制体系文件升级',
  code: 'U1-REHEARSAL',
} as const;

export const u1FormatRules: readonly InputFormatRule[] = [
  {
    format: 'DOCX',
    disposition: 'SUPPORTED',
    note: '读取正文、标题结构；批注、修订和版式另行核验。',
  },
  { format: 'Markdown', disposition: 'SUPPORTED', note: '按文本读取；本轮客户样本未包含该格式。' },
  { format: 'XLSX', disposition: 'SUPPORTED', note: '读取工作簿内容；本轮客户样本未包含该格式。' },
  { format: 'XLS', disposition: 'CONVERT', note: '旧 XLS 需员工先转换为 XLSX 再上传。' },
  { format: 'PDF', disposition: 'UNSUPPORTED', note: '暂不支持；不会静默转成其他格式。' },
  { format: '宏', disposition: 'UNSUPPORTED', note: '不执行宏。' },
];

const firstEntries: InputBatch['entries'] = [
  {
    id: 'C01',
    path: '质量手册/质量手册 DOCX',
    format: 'DOCX',
    bytes: 174448,
    state: 'LIMITED',
    note: '正文与目录可提取；组织图、流程图、批注和版式未核验。',
  },
  {
    id: 'C02',
    path: '程序文件/变更控制程序 DOCX',
    format: 'DOCX',
    bytes: 40378,
    state: 'RECEIVED',
    note: '正文可提取；批注与修订未核验。',
  },
  {
    id: 'C03',
    path: '记录表单/变更申请单 DOCX',
    format: 'DOCX',
    bytes: 34075,
    state: 'RECEIVED',
    note: '表格正文可提取；版面未核验。',
  },
  {
    id: 'C04',
    path: '记录表单/变更影响评估表 DOCX',
    format: 'DOCX',
    bytes: 36089,
    state: 'RECEIVED',
    note: '表格正文可提取；版面未核验。',
  },
  {
    id: 'C05',
    path: '记录表单/变更实施方案确认记录 DOCX',
    format: 'DOCX',
    bytes: 35984,
    state: 'RECEIVED',
    note: '表格正文可提取；版面未核验。',
  },
  {
    id: 'C06',
    path: '记录表单/变更评审记录 DOCX',
    format: 'DOCX',
    bytes: 35455,
    state: 'RECEIVED',
    note: '表格正文可提取；版面未核验。',
  },
  {
    id: 'C07',
    path: '记录表单/变更关闭记录 DOCX',
    format: 'DOCX',
    bytes: 35314,
    state: 'RECEIVED',
    note: '表格正文可提取；版面未核验。',
  },
];

export const u1InitialBatch: InputBatch = {
  id: 'U1-BATCH-01',
  label: '首轮资料',
  zipName: '客户现有体系文件（匿名 C01–C07）.zip',
  submittedAt: '2026-10-20 09:10',
  state: 'LIMITED',
  entries: firstEntries,
  answers: [],
  limitations: [
    '包结构与正文可提取，不等于语义、批注/修订或版式已完整读取。',
    '本轮 7 份均为 DOCX；Markdown/XLSX 只有展示状态覆盖，未用真实客户样本验证。',
  ],
  nextAction: '核对目录与读取限制，然后查看分析并记录客户答复或补充说明。',
};

export const u1SupplementBatch: InputBatch = {
  id: 'U1-BATCH-02',
  label: '补充批次',
  zipName: '客户答复（无新增文件）',
  submittedAt: '2026-10-20 09:40',
  state: 'RECEIVED',
  entries: [],
  answers: [
    '同意按四层文件结构升级，并接受质量手册中文件与记录控制编号迁移；C04/C05/C07 继续作为内部表单保留。',
    '外来文件管理规定按正式模板新增；变更实施记录与通知单需要补充。',
  ],
  limitations: ['补充批次只有文字答复，没有新增客户文件；不能据此宣称资料已补全。'],
  nextAction: '查看据此形成的第 2 版分析，再核对修改范围。',
};

export const u1SimulatedProblemEntries: InputBatch['entries'] = [
  {
    id: 'X-PDF',
    path: '合成演示/外部标准扫描件.pdf',
    format: 'PDF',
    bytes: 2048,
    state: 'UNSUPPORTED',
    note: '合成演示条目：PDF 暂不支持，不会静默丢失或转换。',
  },
  {
    id: 'X-XLS',
    path: '合成演示/旧版记录清单.xls',
    format: 'XLS',
    bytes: 1024,
    state: 'FAILED',
    note: '合成演示条目：旧 XLS 需员工先转换为 XLSX；本次未接收内容。',
  },
];

export const u1ReportOne: AnalysisReport = {
  projectId: u1Project.id,
  reportId: 'U1-REPORT-01',
  version: 1,
  title: '匿名客户变更控制体系分析（U1 合成演练）',
  summary:
    '客户已有质量手册、变更控制程序和五份关联表单；正式模板的四层文件结构、三层分流与记录编号存在适用缺口，另有两项表单映射待确认。',
  limitations: [
    '仅依据 C01–C07 的 DOCX 正文提取结果；批注、修订、图形和版式未核验。',
    'T01–T06 是正式模板的只读快照；模板条款不是客户事实，适用性逐项说明。',
    '本报告是页面演练的合成展示，不是 Runner 执行结果、业务审核或服务器接纳。',
  ],
  narrative: `## 读取与判断边界

本演练读取了 C01–C07 的 DOCX 正文，并与 T01–T06 正式模板逐项对照。C01 的组织图和流程图没有可靠提取，页面不据此推断客户组织关系。

## 主要判断

- 客户已有变更申请、影响评估、评审、实施确认和关闭记录，不能按“模板缺什么就新建什么”处理。
- 正式模板的四层文件结构、实质性/非实质性三层分流、风险触发判断和记录编号需要适配客户现有制度。
- 外来文件管理规定在客户手册中只有原则性要求，没有独立制度；这项适用缺口需要新增文件，而不是向客户索取不存在的事实。
- C04/C05/C07 在正式模板中没有同名记录，保留为内部表单还是由新记录替代，需要客户确认。

所有建议均待业务审核；本轮不生成候选。`,
  understanding: [
    {
      id: 'U-C01-STRUCT',
      category: 'SOURCE_FACT',
      statement:
        'C01 质量手册以文件、记录和受托生产要求组织“文件要求”，文件与记录控制使用旧编号 4.2.4、4.2.5，并声明三个文件层次。',
      sourceIds: ['C01'],
      templateIds: [],
    },
    {
      id: 'U-C02-FLOW',
      category: 'SOURCE_FACT',
      statement:
        'C02 变更控制程序覆盖变更类型、I/II/III 类分级、申请、评估、评审、批准、实施、效果确认和关闭，并引用五份客户表单。',
      sourceIds: ['C02', 'C03', 'C04', 'C05', 'C06', 'C07'],
      templateIds: [],
    },
    {
      id: 'U-COVERAGE',
      category: 'EXISTING_COVERAGE',
      statement:
        '客户已有变更申请、影响评估、实施方案确认、评审和关闭记录；这些文件承载了申请、评审、实施与关闭的既有做法，应先保留再评估差异。',
      sourceIds: ['C02', 'C03', 'C04', 'C05', 'C06', 'C07'],
      templateIds: ['T02', 'T04', 'T05'],
    },
    {
      id: 'U-GAP-MANUAL',
      category: 'APPLICABLE_GAP',
      statement:
        'T01 采用四层文件结构，并用 4.2.4 变更控制、4.3.5 文件控制、4.3.6 记录控制；C01 仍是三层次和旧编号，且没有独立变更控制章节。',
      sourceIds: ['C01'],
      templateIds: ['T01'],
    },
    {
      id: 'U-GAP-PROCEDURE',
      category: 'APPLICABLE_GAP',
      statement:
        'T02 引入实质性/非实质性三层分流、风险触发判断、变更通知与 QR-PD-4.2.4 系列记录编号；C02 仍以 I/II/III 类分级为主，未说明这些分流和通知要求。',
      sourceIds: ['C02'],
      templateIds: ['T02'],
    },
    {
      id: 'U-GAP-EXTERNAL',
      category: 'APPLICABLE_GAP',
      statement:
        'T03 要求独立的外来文件识别、登记、适用性评审和更新处置；C01 只有外来文件控制原则，没有独立管理制度。',
      sourceIds: ['C01'],
      templateIds: ['T03'],
    },
    {
      id: 'U-NOT-APPLICABLE',
      category: 'NOT_APPLICABLE',
      statement:
        'T02 明确 BG-03 变更验证/确认报告、BG-04 变更批准单已作废，验证确认统一走 PD-4.2.5、批准意见并入评审记录；不能把这两份旧记录当作适用缺口。',
      sourceIds: [],
      templateIds: ['T02'],
    },
    {
      id: 'U-INSUFFICIENT-FORMS',
      category: 'INSUFFICIENT',
      statement:
        'C04 变更影响评估表、C05 变更实施方案确认记录和 C07 变更关闭记录在正式模板中没有同名记录；现有资料不足以判定应保留、合并还是替代。',
      sourceIds: ['C04', 'C05', 'C07'],
      templateIds: ['T02', 'T06'],
    },
    {
      id: 'U-CONFLICT-MANUAL',
      category: 'CONFLICT',
      statement:
        'C01 的三层文件结构与 T01 的四层文件结构并存；直接套用模板会改变客户文件层级和编号，属于需要确认的制度变化。',
      sourceIds: ['C01'],
      templateIds: ['T01'],
    },
    {
      id: 'U-CONFLICT-GRADE',
      category: 'CONFLICT',
      statement:
        'C02 的 I/II/III 类分级与 T02 的实质性/非实质性分流使用不同口径；需要保留客户审批职责，同时补充模板要求的分流判断。',
      sourceIds: ['C02'],
      templateIds: ['T02'],
    },
    {
      id: 'U-READ-LIMIT',
      category: 'READ_LIMIT',
      statement:
        'C01–C07 只完成正文提取；图形、批注、修订、页眉页脚和版式没有核验，页面不能把这些未读部分当成已确认事实。',
      sourceIds: ['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07'],
      templateIds: [],
      limitation: '需要人工核对原件版式；本轮不声称完整读取。',
    },
  ],
  templates: [
    {
      templateId: 'T01',
      title: '质量手册',
      disposition: 'APPLICABLE',
      explanation:
        '四层结构、变更控制位置和文件/记录控制编号适用；需要客户确认编号迁移，不能把模板条款当成客户现状。',
      sourceIds: ['C01'],
    },
    {
      templateId: 'T02',
      title: '变更控制程序',
      disposition: 'PARTIALLY_APPLICABLE',
      explanation:
        '三层分流、风险触发和记录编号适用；客户 I/II/III 类分级与审批职责应保留并按差异改写。',
      sourceIds: ['C02'],
    },
    {
      templateId: 'T03',
      title: '外来文件管理规定',
      disposition: 'APPLICABLE',
      explanation: '客户缺少独立制度，手册只有原则要求；建议新增，而不是向客户索取不存在的文件。',
      sourceIds: ['C01'],
    },
    {
      templateId: 'T04',
      title: '变更申请单',
      disposition: 'APPLICABLE',
      explanation: '客户 C03 已有申请单；需要补充实质性/非实质性初步判定栏。',
      sourceIds: ['C03'],
    },
    {
      templateId: 'T05',
      title: '变更评审记录',
      disposition: 'APPLICABLE',
      explanation: '客户 C06 已有评审记录；需要补充风险触发判断和批准意见区。',
      sourceIds: ['C06'],
    },
    {
      templateId: 'T06',
      title: '变更实施记录',
      disposition: 'APPLICABLE',
      explanation:
        '客户 C05 只有实施方案确认，没有独立实施记录；建议新增 T06，但 C05 的去留待确认。',
      sourceIds: ['C05'],
    },
  ],
  attentionItems: [
    {
      id: 'U1-Q1',
      title: '确认四层文件结构与编号迁移',
      kind: 'FACT_QUESTION',
      audience: 'CUSTOMER',
      reason:
        'C01 仍按三层次及 4.2.4/4.2.5 组织文件与记录控制；T01 采用四层结构并使用 4.2.4 变更控制、4.3.5 文件控制、4.3.6 记录控制。',
      question: '客户是否确认升级为四层结构，并接受质量手册相关编号调整？',
      affectedPlannedFileIds: ['F-MANUAL'],
      protectedFactIds: [],
      evidenceIds: ['E-C01-STRUCT', 'E-T01-STRUCT'],
      customerRequest: {
        key: 'REQ-U1-STRUCT',
        title: '四层文件结构与编号迁移',
        text: '请确认是否接受四层文件结构，以及质量手册中文件/记录控制编号的迁移；如保留旧编号，请说明映射关系。',
      },
    },
    {
      id: 'U1-Q2',
      title: '确认 C04/C05/C07 的保留方式',
      kind: 'FACT_QUESTION',
      audience: 'CUSTOMER',
      reason:
        'T02 将详细风险评价分流至 QR-PD-7.1-04，并新增变更实施记录；客户现有影响评估、实施方案确认和关闭记录在模板中没有同名记录。',
      question: '是否保留这三份表单作为客户内部记录，并按模板补充实施记录、通知单和台账？',
      affectedPlannedFileIds: ['F-PROCEDURE'],
      protectedFactIds: [],
      evidenceIds: ['E-C04-FORM', 'E-C07-FORM', 'E-T02-RECORDS'],
      customerRequest: {
        key: 'REQ-U1-FORMS',
        title: '保留内部表单的确认',
        text: '请确认 C04、C05、C07 是否继续作为内部表单使用，以及是否同意补充变更实施记录、通知单和台账。',
      },
    },
    {
      id: 'U1-CONFLICT',
      title: '变更分级口径需要顾问判断',
      kind: 'PROTECTION_CONFLICT',
      audience: 'CONSULTANT',
      reason:
        'C02 使用 I/II/III 类分级和既有审批权限；T02 采用实质性/非实质性三层分流。两者不能直接互相覆盖。',
      question: '哪些现有分级术语和审批职责保留，哪些需要按模板补充而不改变客户责任？',
      affectedPlannedFileIds: ['F-PROCEDURE'],
      protectedFactIds: [],
      evidenceIds: ['E-C02-FLOW', 'E-T02-FLOW'],
      customerRequest: null,
    },
    {
      id: 'U1-READ',
      title: '原件图形与版式未核验',
      kind: 'UNREADABLE_MATERIAL',
      audience: 'CUSTOMER',
      reason: 'DOCX 正文可提取，但组织图、流程图、批注和修订没有可靠读取。',
      question: '是否补充可读的组织关系说明，或接受本轮仅基于正文的演练？',
      affectedPlannedFileIds: ['F-MANUAL'],
      protectedFactIds: [],
      evidenceIds: ['E-C01-STRUCT'],
      customerRequest: {
        key: 'REQ-U1-READ',
        title: '原件读取限制说明',
        text: '本轮只读取了正文；如组织图或流程图会影响判断，请补充可读版本或文字说明。',
      },
    },
  ],
  evidence: [
    {
      id: 'E-C01-STRUCT',
      sourceId: 'C01',
      representation: 'EXTRACTED',
      locator: { kind: 'SECTION', value: '目录与文件要求章节' },
      note: 'C01 目录和正文显示三层次、4.2.4 文件控制、4.2.5 记录控制；图形与版式未核验。',
    },
    {
      id: 'E-C02-FLOW',
      sourceId: 'C02',
      representation: 'EXTRACTED',
      locator: { kind: 'SECTION', value: '变更类型、分级与流程章节' },
      note: 'C02 正文按 I/II/III 类分级描述申请、评估、评审、批准、实施和关闭。',
    },
    {
      id: 'E-C03-FORM',
      sourceId: 'C03',
      representation: 'EXTRACTED',
      locator: { kind: 'WHOLE_DOCUMENT', value: '变更申请单表格' },
      note: 'C03 字段包含变更事项、原因、范围、影响注册情况等；版面未核验。',
    },
    {
      id: 'E-C04-FORM',
      sourceId: 'C04',
      representation: 'EXTRACTED',
      locator: { kind: 'WHOLE_DOCUMENT', value: '变更影响评估表' },
      note: 'C04 以勾选项形成影响评估和 I/II/III 类结论；未含模板的实质性/非实质性分流栏。',
    },
    {
      id: 'E-C07-FORM',
      sourceId: 'C07',
      representation: 'EXTRACTED',
      locator: { kind: 'WHOLE_DOCUMENT', value: '变更关闭记录' },
      note: 'C07 记录实施完成、效果确认和关闭结论；模板没有同名关闭记录。',
    },
    {
      id: 'E-T01-STRUCT',
      sourceId: 'T01',
      representation: 'ORIGINAL',
      locator: { kind: 'SECTION', value: '4.2.4、4.3.5、4.3.6' },
      note: 'T01 使用四层文件结构，并把变更控制、文件控制、记录控制分别放在 4.2.4、4.3.5、4.3.6。',
    },
    {
      id: 'E-T02-FLOW',
      sourceId: 'T02',
      representation: 'ORIGINAL',
      locator: { kind: 'SECTION', value: '5.4 实质性/非实质性变更判定与分流' },
      note: 'T02 使用注册证四要素、风险分析和程序执行三层分流，并保留重大/一般/微小分级。',
    },
    {
      id: 'E-T02-RECORDS',
      sourceId: 'T02',
      representation: 'ORIGINAL',
      locator: { kind: 'SECTION', value: '7 相关记录与 8 文件修订历史' },
      note: 'T02 列出 QR-PD-4.2.4-01/02/05/06/07，并说明 BG-03、BG-04 已作废。',
    },
    {
      id: 'E-T03-RULE',
      sourceId: 'T03',
      representation: 'ORIGINAL',
      locator: { kind: 'SECTION', value: '5.5 更新跟踪' },
      note: 'T03 规定外来文件检索、更新触发和变更控制凭证编号回填。',
    },
  ],
  plannedFiles: [
    {
      id: 'F-MANUAL',
      title: '质量手册',
      customerCode: null,
      origin: 'CUSTOMER_REVISION',
    },
    {
      id: 'F-PROCEDURE',
      title: '变更控制程序',
      customerCode: null,
      origin: 'CUSTOMER_REVISION',
    },
    {
      id: 'F-EXTERNAL-RULE',
      title: '外来文件管理规定',
      customerCode: null,
      origin: 'TEMPLATE_DERIVED',
    },
    {
      id: 'F-FORM-APPLY',
      title: '变更申请单',
      customerCode: null,
      origin: 'CUSTOMER_REVISION',
    },
    {
      id: 'F-FORM-REVIEW',
      title: '变更评审记录',
      customerCode: null,
      origin: 'CUSTOMER_REVISION',
    },
    {
      id: 'F-FORM-IMPLEMENT',
      title: '变更实施记录',
      customerCode: null,
      origin: 'TEMPLATE_DERIVED',
    },
  ],
  changes: [
    {
      id: 'M-MANUAL',
      title: '升级质量手册的文件与变更控制结构',
      description:
        '采用四层文件结构，补充 4.2.4 变更控制，并把文件/记录控制迁移到 4.3.5/4.3.6；保留客户现有质量方针和目标。',
      targetPlannedFileIds: ['F-MANUAL'],
      evidenceIds: ['E-C01-STRUCT', 'E-T01-STRUCT'],
    },
    {
      id: 'M-PROCEDURE',
      title: '补充实质性/非实质性分流与风险触发',
      description:
        '保留客户 I/II/III 类分级和既有审批职责，补充注册证四要素、风险分析和程序执行三层分流、变更通知与记录编号。',
      targetPlannedFileIds: ['F-PROCEDURE'],
      evidenceIds: ['E-C02-FLOW', 'E-T02-FLOW', 'E-T02-RECORDS'],
    },
    {
      id: 'C-EXTERNAL-RULE',
      title: '新增外来文件管理规定',
      description:
        '按 T03 建立外来文件清单、适用性评审、更新跟踪和作废处置；不把法规原文纳入内部受控编号。',
      targetPlannedFileIds: ['F-EXTERNAL-RULE'],
      evidenceIds: ['E-C01-STRUCT', 'E-T03-RULE'],
    },
    {
      id: 'M-FORM-APPLY',
      title: '补充变更申请单的初步判定栏',
      description: '在 C03 现有字段上增加实质性/非实质性初步判定，不删除客户已有申请信息。',
      targetPlannedFileIds: ['F-FORM-APPLY'],
      evidenceIds: ['E-C03-FORM', 'E-T02-FLOW'],
    },
    {
      id: 'M-FORM-REVIEW',
      title: '补充评审记录的风险触发与批准意见',
      description: '在 C06 现有评审字段上增加风险触发判断、关联风险记录编号和分级批准意见。',
      targetPlannedFileIds: ['F-FORM-REVIEW'],
      evidenceIds: ['E-C04-FORM', 'E-T02-FLOW', 'E-T02-RECORDS'],
    },
    {
      id: 'C-FORM-IMPLEMENT',
      title: '新增变更实施记录',
      description:
        '按 T06 新增实施内容、文件更新、培训与效果确认记录；C05 实施方案确认记录的去留另待确认。',
      targetPlannedFileIds: ['F-FORM-IMPLEMENT'],
      evidenceIds: ['E-C07-FORM', 'E-T02-RECORDS'],
    },
  ],
  checks: [
    {
      id: 'CHECK-READ',
      title: '输入读取范围',
      result: 'LIMITED',
      authority: 'UI_REHEARSAL',
      limitations: ['DOCX 正文可提取；图形、批注、修订和版式未核验。'],
    },
    {
      id: 'CHECK-TEMPLATE',
      title: '正式模板适用性',
      result: 'REVIEWED_AS_CANDIDATE',
      authority: 'UI_REHEARSAL',
      limitations: ['模板条款不是客户事实；适用性仍需业务审核。'],
    },
    {
      id: 'CHECK-RUN',
      title: 'Runner 分析与候选生成',
      result: 'NOT_RUN',
      authority: 'UI_REHEARSAL',
      limitations: ['本页不调用 Runner，不生成候选。'],
    },
  ],
  resolutionProposals: [],
};

export const u1ReportTwo: AnalysisReport = {
  ...u1ReportOne,
  reportId: 'U1-REPORT-02',
  version: 2,
  title: '收到客户答复后的变更控制分析（U1 合成演练）',
  summary:
    '客户确认四层结构、编号迁移和内部表单保留；据此补充外来文件制度、实施记录和通知单。读取限制仍在，候选尚未生成。',
  limitations: [
    '第 2 版依据补充批次的文字答复，不是新增客户文件。',
    'DOCX 图形、批注、修订和版式仍未核验。',
    '本报告仍是页面演练的合成展示，不是 Runner 执行或业务批准。',
  ],
  narrative: `## 本轮变化

补充批次确认了四层结构、质量手册编号迁移和 C04/C05/C07 的内部保留。计划据此新增外来文件管理规定、变更实施记录和变更通知单。

## 仍未确认

C01 的图形、批注、修订和版式仍未读取；本轮不据此断言组织关系或审批职责已经确认。`,
  understanding: [
    ...(u1ReportOne.understanding ?? []).filter(
      (item) =>
        item.category !== 'CONFLICT' &&
        item.category !== 'INSUFFICIENT' &&
        item.category !== 'READ_LIMIT',
    ),
    {
      id: 'U-CONFIRMED-STRUCT',
      category: 'SOURCE_FACT',
      statement:
        '补充批次 A1 确认采用四层文件结构并接受质量手册编号迁移；这是客户答复，不是模板推断。',
      sourceIds: ['A1'],
      templateIds: ['T01'],
    },
    {
      id: 'U-CONFIRMED-FORMS',
      category: 'NOT_APPLICABLE',
      statement:
        'A1 确认 C04/C05/C07 继续作为内部表单保留；它们不作为本轮生成范围，也不被模板同名记录替代。',
      sourceIds: ['A1', 'C04', 'C05', 'C07'],
      templateIds: ['T02'],
    },
    {
      id: 'U-GAP-IMPLEMENT',
      category: 'APPLICABLE_GAP',
      statement:
        'A1 同意补充变更实施记录、通知单和外来文件制度；这些是对客户现有覆盖的补充，不是客户缺失事实。',
      sourceIds: ['A1'],
      templateIds: ['T02', 'T03', 'T06'],
    },
    {
      id: 'U-READ-LIMIT',
      category: 'READ_LIMIT',
      statement:
        'C01–C07 只完成正文提取；图形、批注、修订、页眉页脚和版式没有核验，页面不能把这些未读部分当成已确认事实。',
      sourceIds: ['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07'],
      templateIds: [],
      limitation: '需要人工核对原件版式；本轮不声称完整读取。',
    },
  ],
  attentionItems: [
    {
      id: 'U1-READ',
      title: '原件图形与版式未核验',
      kind: 'UNREADABLE_MATERIAL',
      audience: 'CUSTOMER',
      reason: 'DOCX 正文可提取，但组织图、流程图、批注和修订没有可靠读取。',
      question: '是否补充可读的组织关系说明，或接受本轮仅基于正文的演练？',
      affectedPlannedFileIds: ['F-MANUAL'],
      protectedFactIds: [],
      evidenceIds: ['E-C01-STRUCT'],
      customerRequest: {
        key: 'REQ-U1-READ',
        title: '原件读取限制说明',
        text: '本轮只读取了正文；如组织图或流程图会影响判断，请补充可读版本或文字说明。',
      },
    },
    {
      id: 'U1-Q3',
      title: '记录编号与台账映射待核对',
      kind: 'FACT_QUESTION',
      audience: 'CONSULTANT',
      reason:
        'A1 同意补充实施记录、通知单和外来文件制度，但没有提供变更台账与通知单编号；编号映射需要业务核对。',
      question: '新增记录采用模板编号还是客户既有编号体系？',
      affectedPlannedFileIds: ['F-PROCEDURE', 'F-FORM-IMPLEMENT'],
      protectedFactIds: [],
      evidenceIds: ['E-ANSWER', 'E-T02-RECORDS'],
      customerRequest: null,
    },
  ],
  evidence: [
    ...u1ReportOne.evidence,
    {
      id: 'E-ANSWER',
      sourceId: 'A1',
      representation: 'EXTRACTED',
      locator: { kind: 'ANSWER', value: '补充批次客户答复' },
      note: '客户答复确认四层结构与编号迁移、内部表单保留，并要求补充实施记录、通知单和外来文件制度。',
    },
  ],
  resolutionProposals: [
    {
      id: 'R-Q1',
      attentionItemIds: ['U1-Q1'],
      explanation: 'A1 已确认四层结构与编号迁移；建议不再把该事项列为待澄清，仍待业务审核。',
      evidenceIds: ['E-ANSWER', 'E-T01-STRUCT'],
    },
    {
      id: 'R-Q2',
      attentionItemIds: ['U1-Q2'],
      explanation: 'A1 已确认 C04/C05/C07 保留为内部表单；建议作为保留项，不进入本轮生成。',
      evidenceIds: ['E-ANSWER', 'E-C04-FORM', 'E-C07-FORM'],
    },
  ],
  changes: [
    ...u1ReportOne.changes.filter((change) => change.id !== 'M-FORM-IMPLEMENT'),
    {
      id: 'C-FORM-IMPLEMENT',
      title: '新增变更实施记录',
      description:
        '按 T06 新增实施内容、文件更新、培训与效果确认记录；C05 继续作为内部实施方案确认记录。',
      targetPlannedFileIds: ['F-FORM-IMPLEMENT'],
      evidenceIds: ['E-ANSWER', 'E-T02-RECORDS'],
    },
  ],
};

export const u1PlanOne: PlanView = {
  planId: 'U1-PLAN-01',
  version: 1,
  projectId: u1Project.id,
  reportId: u1ReportTwo.reportId,
  reportVersion: u1ReportTwo.version,
  state: 'DRAFT',
  inputBasis: [
    {
      batchId: u1InitialBatch.id,
      label: u1InitialBatch.label,
      sourceIds: u1InitialBatch.entries.map((entry) => entry.id),
    },
    {
      batchId: u1SupplementBatch.id,
      label: u1SupplementBatch.label,
      sourceIds: ['A1'],
    },
  ],
  templateBasis: [
    'T01 质量手册',
    'T02 变更控制程序',
    'T03 外来文件管理规定',
    'T04 变更申请单',
    'T05 变更评审记录',
    'T06 变更实施记录',
  ],
  currentSituation:
    '客户已有质量手册、变更控制程序和五份关联表单，但手册仍是三层次与旧编号，程序仍以 I/II/III 类分级为主，且没有独立外来文件制度。',
  problem:
    '正式模板要求四层文件结构、实质性/非实质性三层分流、风险触发判断、变更通知和 QR 记录编号；现有制度与表单没有完整承载这些要求。',
  proposal:
    '修订质量手册、变更控制程序、变更申请单和评审记录；新增外来文件管理规定和变更实施记录；C04/C05/C07 作为客户内部表单保留，不进入本轮生成。',
  impact:
    '影响文件层级、手册编号、程序分流口径、表单字段和记录编号；不据此声称产品、注册或审批权限发生变化，相关影响仍需业务审核。',
  files: [
    {
      id: 'F-MANUAL',
      title: '质量手册',
      level: 'MANUAL',
      action: 'REVISE',
      current: '三层次文件结构；文件控制 4.2.4、记录控制 4.2.5；没有独立变更控制章节。',
      proposal: '采用四层结构，补充 4.2.4 变更控制，文件控制迁移到 4.3.5、记录控制迁移到 4.3.6。',
      impact: '手册内部编号和引用关系变化；质量方针、目标与客户现有职责不变。',
      inputSourceIds: ['C01', 'A1'],
      templateSourceIds: ['T01'],
    },
    {
      id: 'F-PROCEDURE',
      title: '变更控制程序',
      level: 'PROCEDURE',
      action: 'REVISE',
      current: '以 I/II/III 类分级组织变更流程，引用 C03–C07 五份表单。',
      proposal:
        '保留客户分级与审批职责，补充实质性/非实质性三层分流、风险触发判断、变更通知和 QR 记录编号。',
      impact: '影响变更评审、批准、通知和记录归档；不改变客户既有岗位授权。',
      inputSourceIds: ['C02', 'A1'],
      templateSourceIds: ['T02', 'T03'],
    },
    {
      id: 'F-EXTERNAL-RULE',
      title: '外来文件管理规定',
      level: 'RULE',
      action: 'CREATE',
      current: '手册只有外来文件识别与控制原则，没有独立管理制度。',
      proposal: '按 T03 建立外来文件清单、适用性评审、更新跟踪、作废与分发要求。',
      impact: '新增一份管理制度；法规原文不纳入内部受控编号。',
      inputSourceIds: ['C01', 'A1'],
      templateSourceIds: ['T03'],
    },
    {
      id: 'F-FORM-APPLY',
      title: '变更申请单',
      level: 'RECORD',
      action: 'REVISE',
      current: '已有变更事项、原因、范围、注册影响和申请意见字段。',
      proposal: '增加实质性/非实质性初步判定栏，保留客户现有申请信息。',
      impact: '申请环节增加一个判定字段；不改变提交与审批路径。',
      inputSourceIds: ['C03'],
      templateSourceIds: ['T04', 'T02'],
    },
    {
      id: 'F-FORM-REVIEW',
      title: '变更评审记录',
      level: 'RECORD',
      action: 'REVISE',
      current: '已有评审项目、结论、决议与会签字段。',
      proposal: '增加风险触发判断、关联风险记录编号和分级批准意见区。',
      impact: '评审与批准在同一记录中闭环；不新增审批层级。',
      inputSourceIds: ['C06'],
      templateSourceIds: ['T05', 'T02'],
    },
    {
      id: 'F-FORM-IMPLEMENT',
      title: '变更实施记录',
      level: 'RECORD',
      action: 'CREATE',
      current: 'C05 是实施方案确认记录，没有独立实施、文件更新、培训和效果确认记录。',
      proposal: '按 T06 新增变更实施记录，与申请单、评审记录通过变更编号关联。',
      impact: '新增一份记录表单；C05 继续作为内部实施方案确认记录。',
      inputSourceIds: ['C05', 'A1'],
      templateSourceIds: ['T06', 'T02'],
    },
  ],
  retained: [
    {
      id: 'C04',
      title: '变更影响评估表',
      reason:
        '客户内部影响评估记录；模板把详细风险评价分流至 QR-PD-7.1-04，但没有同名记录，本轮不生成也不删除。',
    },
    {
      id: 'C05',
      title: '变更实施方案确认记录',
      reason: '客户内部实施方案确认记录；与新增的变更实施记录并存，是否合并留待业务决定。',
    },
    {
      id: 'C07',
      title: '变更关闭记录',
      reason: '客户内部关闭记录；T02 要求记录归档但没有同名关闭表单，本轮保留。',
    },
  ],
};

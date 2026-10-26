// Public-safe U2 rehearsal content. It is an anonymized presentation derived
// from source structure (C01–C07, T01–T06), never a customer original, excerpt,
// registered hash or Runner output. Customer identities, paths and bytes stay
// in the local-only manifest.
import type { MarkdownReviewData } from '../MarkdownReviewPage.js';
import type { Change, Document, ReviewContent, Unit } from '../trusted/markdown.js';

interface TableSpec {
  caption: string;
  headers: readonly string[];
  rows: readonly (readonly string[])[];
}

interface SectionSpec {
  title: string;
  paragraphs?: readonly string[];
  table?: TableSpec;
}

export interface U2FileMeta {
  fileId: string;
  title: string;
  level: 'MANUAL' | 'PROCEDURE' | 'RULE' | 'RECORD';
  action: 'REVISE' | 'CREATE';
  currentLabel: string;
  baselineLabel: string;
  sourceIds: readonly string[];
  templateIds: readonly string[];
  retained: readonly string[];
  limitations: readonly string[];
}

export const u2FileMetas: Record<string, U2FileMeta> = {
  'F-MANUAL': {
    fileId: 'F-MANUAL',
    title: '质量手册',
    level: 'MANUAL',
    action: 'REVISE',
    currentLabel: '客户现行质量手册正文（匿名结构摘要）',
    baselineLabel: '客户现行手册摘要',
    sourceIds: ['C01', 'A1'],
    templateIds: ['T01'],
    retained: ['客户质量方针与质量目标', '现行岗位与职责安排', '原有签批栏与生效日期控制'],
    limitations: [
      'C01 组织图、流程图、批注和修订未核验；本候选不据此推断组织关系。',
      '编号迁移结论来自 A1 客户答复；模板条款不是客户事实。',
    ],
  },
  'F-PROCEDURE': {
    fileId: 'F-PROCEDURE',
    title: '变更控制程序',
    level: 'PROCEDURE',
    action: 'REVISE',
    currentLabel: '客户现行变更控制程序（匿名结构摘要）',
    baselineLabel: '客户现行程序摘要',
    sourceIds: ['C02', 'A1'],
    templateIds: ['T02', 'T03'],
    retained: [
      '客户 I/II/III 类分级术语',
      '客户现行审批职责与签批栏',
      'C03–C07 现有表单引用',
      'C04/C05/C07 内部表单保留',
    ],
    limitations: [
      'C02 批注、修订和流程图未核验。',
      'I/II/III 类与实质性/非实质性的映射仍需业务核对，候选不替客户决定。',
    ],
  },
  'F-EXTERNAL-RULE': {
    fileId: 'F-EXTERNAL-RULE',
    title: '外来文件管理规定',
    level: 'RULE',
    action: 'CREATE',
    currentLabel: '无客户原版本：按 T03 正式模板新增',
    baselineLabel: '无客户原版本',
    sourceIds: ['C01', 'A1'],
    templateIds: ['T03'],
    retained: ['客户手册中的外来文件控制原则', '外部文件原发布机关效力'],
    limitations: [
      '客户没有独立的外来文件管理制度；本候选是模板驱动的新增文件，不伪造客户原版本。',
      '职责部门与记录编号仍需业务核对。',
    ],
  },
  'F-FORM-APPLY': {
    fileId: 'F-FORM-APPLY',
    title: '变更申请单',
    level: 'RECORD',
    action: 'REVISE',
    currentLabel: '客户现行变更申请单字段（匿名摘要）',
    baselineLabel: '客户现行表单字段',
    sourceIds: ['C03'],
    templateIds: ['T04', 'T02'],
    retained: ['客户现有变更事项、原因与影响字段', '原有编号与签批位置'],
    limitations: ['C03 表格正文可提取；版面与勾选项未核验。'],
  },
  'F-FORM-REVIEW': {
    fileId: 'F-FORM-REVIEW',
    title: '变更评审记录',
    level: 'RECORD',
    action: 'REVISE',
    currentLabel: '客户现行变更评审记录字段（匿名摘要）',
    baselineLabel: '客户现行表单字段',
    sourceIds: ['C06'],
    templateIds: ['T05', 'T02'],
    retained: ['现有评审项目与会签安排', '客户审批层级'],
    limitations: ['C06 表格正文可提取；会签栏与版面未核验。'],
  },
  'F-FORM-IMPLEMENT': {
    fileId: 'F-FORM-IMPLEMENT',
    title: '变更实施记录',
    level: 'RECORD',
    action: 'CREATE',
    currentLabel: '无独立客户原版本：C05 仅确认实施方案',
    baselineLabel: '无客户原版本',
    sourceIds: ['C05', 'A1'],
    templateIds: ['T06', 'T02'],
    retained: ['C05 继续作为内部实施方案确认记录'],
    limitations: ['新增记录编号与归档路径待业务核对；不合并或删除 C05。'],
  },
  'F-FORM-NOTICE': {
    fileId: 'F-FORM-NOTICE',
    title: '变更通知单',
    level: 'RECORD',
    action: 'CREATE',
    currentLabel: '无客户原版本：客户未提供独立变更通知单',
    baselineLabel: '无客户原版本',
    sourceIds: ['C02', 'A1'],
    templateIds: ['T02'],
    retained: ['客户现有通知渠道与责任安排'],
    limitations: ['客户未确认通知责任部门；候选不预填真实责任决定。'],
  },
};

const currentSections: Record<string, readonly SectionSpec[]> = {
  'F-MANUAL': [
    {
      title: '1 适用范围与质量方针',
      paragraphs: [
        '客户现行手册以质量方针、质量目标和适用范围开篇。本轮保留原有方针与目标，不依据模板改写客户战略表述。',
      ],
    },
    {
      title: '2 文件要求',
      paragraphs: [
        '现行手册按三个文件层次组织；文件控制使用 4.2.4，记录控制使用 4.2.5。',
        '正文可提取，但组织图、流程图和版式未核验。',
      ],
    },
    {
      title: '3 变更管理位置',
      paragraphs: ['现行手册没有独立变更控制章节，变更要求主要落在程序文件中。'],
    },
    {
      title: '4 读取限制',
      paragraphs: ['图形、批注和修订未读取；本摘要不把这些未读部分当作已确认事实。'],
    },
  ],
  'F-PROCEDURE': [
    {
      title: '1 目的与范围',
      paragraphs: ['现行程序覆盖人员、设备、物料、产品、环境和体系文件等变更。'],
    },
    {
      title: '2 变更分级',
      paragraphs: [
        '现行程序按 I 类实质性、II 类非实质性和 III 类一般变更分级。',
        '分级结论由现有岗位按客户审批安排作出。',
      ],
    },
    {
      title: '3 流程与记录',
      paragraphs: [
        '流程包括申请、影响评估、评审、批准、实施、效果确认和关闭，并引用五份现有表单。',
        '表单编号沿用客户现有体系；本轮不直接替换。',
      ],
    },
  ],
  'F-FORM-APPLY': [
    {
      title: '变更申请信息',
      paragraphs: ['现行申请单记录变更事项、原因、范围和注册影响。'],
      table: {
        caption: '客户现行申请单字段（匿名摘要）',
        headers: ['字段', '现有内容', '本轮处理'],
        rows: [
          ['变更事项', '变更前与变更后描述', '保留'],
          ['变更原因', '申请依据与原因', '保留'],
          ['注册影响', '是否涉及注册事项', '保留并补充初步判定'],
          ['申请意见', '申请部门意见', '保留原有签批'],
        ],
      },
    },
  ],
  'F-FORM-REVIEW': [
    {
      title: '评审记录信息',
      paragraphs: ['现行评审记录包含评审项目、结论、决议和会签。'],
      table: {
        caption: '客户现行评审记录字段（匿名摘要）',
        headers: ['字段', '现有内容', '本轮处理'],
        rows: [
          ['评审项目', '按变更内容列项', '保留'],
          ['评审结论', '同意、有条件同意或不同意', '保留'],
          ['决议', '实施要求与责任', '保留'],
          ['会签', '现有岗位会签', '保留，不新增审批层级'],
        ],
      },
    },
  ],
};

interface CandidateSeed {
  fileId: string;
  versionId: string;
  versionLabel: string;
  sections: readonly SectionSpec[];
}

const candidateSeeds: Record<string, Record<string, CandidateSeed>> = {
  'F-MANUAL': {
    V1: {
      fileId: 'F-MANUAL',
      versionId: 'V1',
      versionLabel: '第 1 版候选',
      sections: [
        {
          title: '1 四层文件结构',
          paragraphs: [
            '质量手册、程序文件、管理制度和记录表单分别表达文件层级；层级是组织方式，不是串行审批关卡。',
            '本轮保留客户质量方针、质量目标、现有岗位和职责安排，不用模板示例替换客户决定。',
          ],
        },
        {
          title: '2 4.2.4 变更控制',
          paragraphs: [
            '手册新增变更控制原则，要求变更经过申请、影响评估、评审、批准、实施和效果确认。',
            '变更分级沿用客户 I/II/III 类术语；实质性/非实质性判定在程序文件中展开。',
          ],
        },
        {
          title: '3 4.3.5 文件控制与 4.3.6 记录控制',
          paragraphs: [
            '文件控制由原 4.2.4 迁移到 4.3.5，记录控制由原 4.2.5 迁移到 4.3.6；迁移以客户 A1 答复为依据。',
            '编号迁移只改变手册内部位置，不改变客户现有文件审批职责。',
          ],
        },
        {
          title: '4 读取限制与待核对',
          paragraphs: [
            '组织图、流程图、批注和修订未核验；如影响职责判断，需要客户补充可读说明。',
            '记录编号映射仍待业务核对，候选不把模板编号当成客户既有编号。',
          ],
        },
      ],
    },
    V2: {
      fileId: 'F-MANUAL',
      versionId: 'V2',
      versionLabel: '第 2 版候选',
      sections: [
        {
          title: '1 四层文件结构',
          paragraphs: [
            '质量手册、程序文件、管理制度和记录表单分别表达文件层级；层级是组织方式，不是串行审批关卡。',
            '本轮保留客户质量方针、质量目标、现有岗位和职责安排；模板示例不替代客户决定。',
            '文件层级的引用关系在手册内保持一致；新增文件只在已确认计划范围内出现。',
          ],
        },
        {
          title: '2 4.2.4 变更控制',
          paragraphs: [
            '手册新增变更控制原则，要求变更经过申请、影响评估、评审、批准、实施和效果确认。',
            '分流结论必须记录判定依据；客户 I/II/III 类术语仍待业务确认后保留，模板术语不直接覆盖。',
          ],
        },
        {
          title: '3 4.3.5 文件控制与 4.3.6 记录控制',
          paragraphs: [
            '文件控制由原 4.2.4 迁移到 4.3.5，记录控制由原 4.2.5 迁移到 4.3.6；迁移以客户 A1 答复为依据。',
          ],
          table: {
            caption: '手册编号迁移对照（候选）',
            headers: ['原位置', '新位置', '说明'],
            rows: [
              ['4.2.4 文件控制', '4.3.5 文件控制', '编号迁移，审批职责不变'],
              ['4.2.5 记录控制', '4.3.6 记录控制', '编号迁移，归档职责不变'],
              ['无独立变更章节', '4.2.4 变更控制', '新增原则，不替代程序文件'],
            ],
          },
        },
        {
          title: '4 读取限制与待核对',
          paragraphs: [
            '组织图、流程图、批注和修订未核验；如影响职责判断，需要客户补充可读说明。',
            '记录编号映射仍待业务核对，候选不把模板编号当成客户既有编号。',
          ],
        },
      ],
    },
    V3: {
      fileId: 'F-MANUAL',
      versionId: 'V3',
      versionLabel: '第 3 版候选（返工）',
      sections: [
        {
          title: '1 四层文件结构与编号一致性',
          paragraphs: [
            '返工稿保留四层文件结构与既有质量方针；本轮只处理手册变更控制章节与下游引用的一致性。',
            '下游程序、管理制度和记录表单按各自层级重新引用本版手册；不新增审批层级。',
          ],
        },
        {
          title: '2 4.2.4 变更控制与下游依据',
          paragraphs: [
            '手册明确变更控制章节是程序与记录表单的上游依据；手册版本变化后，下游须标记待复核并重新确认。',
            '客户 I/II/III 类术语继续保留；分流结论、判定人和日期由程序与记录表单承载。',
          ],
        },
        {
          title: '3 文件与记录控制迁移',
          paragraphs: [
            '文件控制保持 4.3.5、记录控制保持 4.3.6；编号迁移沿用客户 A1 答复。',
            '本稿不改变客户岗位授权，不把模板示例写成客户事实。',
          ],
          table: {
            caption: '返工稿下游影响（候选）',
            headers: ['下游文件', '处理', '理由'],
            rows: [
              ['变更控制程序', '修改', '同步手册依据与变更控制引用'],
              ['外来文件管理规定', '保留', '职责与范围未受手册返工影响'],
              ['记录表单', '复核', '按程序与手册新依据核对字段和编号'],
            ],
          },
        },
        {
          title: '4 读取限制与待核对',
          paragraphs: [
            '组织图、流程图、批注和修订仍未核验；记录编号映射继续待业务核对。',
            '本稿是环境 A 返工演练候选，不是 Runner 输出或客户确认。',
          ],
        },
      ],
    },
  },
  'F-PROCEDURE': {
    V1: {
      fileId: 'F-PROCEDURE',
      versionId: 'V1',
      versionLabel: '第 1 版候选',
      sections: [
        {
          title: '1 目的、范围与分流',
          paragraphs: [
            '程序适用于产品相关变更；纯文件格式、人员岗位和法规更新分别走文件控制或人力资源程序。',
            '客户 I/II/III 类分级保留，作为审批路径和风险沟通的现行术语。',
          ],
        },
        {
          title: '2 实质性/非实质性判定',
          paragraphs: [
            '在现有分级前补充三层分流：是否涉及注册证四要素、是否需要风险分析、是否仅涉及程序执行。',
            '分流结论、依据和判定人写入申请与评审记录；不由模板自动得出客户结论。',
          ],
        },
        {
          title: '3 变更流程',
          paragraphs: [
            '申请、影响评估、评审、批准、实施、效果确认和关闭沿用客户现有职责与签批安排。',
            '评审记录保留风险触发判断、关联风险记录编号和分级批准意见。',
          ],
        },
        {
          title: '4 变更通知',
          paragraphs: [
            '内部、外部和受托生产相关通知按客户现有渠道执行；通知责任部门待业务核对。',
            '通知单是新增候选记录，不声称客户已有同名表单。',
          ],
        },
        {
          title: '5 记录与编号',
          paragraphs: [
            'C03、C06、C05 等现有表单继续使用；C04/C05/C07 作为内部表单保留。',
            '新增记录暂用模板 QR-PD-4.2.4 系列占位，最终编号映射待业务核对。',
          ],
        },
      ],
    },
    V2: {
      fileId: 'F-PROCEDURE',
      versionId: 'V2',
      versionLabel: '第 2 版候选',
      sections: [
        {
          title: '1 目的、范围与分流',
          paragraphs: [
            '程序适用于产品相关变更；纯文件格式、人员岗位和法规更新分别走文件控制或人力资源程序。',
            '客户 I/II/III 类分级保留，作为审批路径和风险沟通的现行术语。',
          ],
        },
        {
          title: '2 实质性/非实质性判定',
          paragraphs: [
            '在现有分级前补充三层分流：是否涉及注册证四要素、是否需要风险分析、是否仅涉及程序执行。',
            '分流结论必须记录判定依据、判定人和日期；不得以模板术语替代客户 I/II/III 类。',
            '无法判断时保持待确认，不以默认结论推进变更。',
          ],
        },
        {
          title: '3 变更流程',
          paragraphs: [
            '申请、影响评估、评审、批准、实施、效果确认和关闭沿用客户现有职责与签批安排。',
            '评审记录保留风险触发判断、关联风险记录编号和分级批准意见；不新增审批层级。',
          ],
        },
        {
          title: '4 变更通知',
          paragraphs: [
            '内部、外部和受托生产相关通知按客户现有渠道执行；通知责任部门仍待业务核对。',
            '未确认责任部门时保留空白并标注待核对，不预填真实责任决定。',
          ],
        },
        {
          title: '5 记录与编号',
          paragraphs: [
            'C03、C06、C05 等现有表单继续使用；C04/C05/C07 作为内部表单保留。',
            '新增记录暂用模板 QR-PD-4.2.4 系列占位；编号映射待业务核对，候选不声称已确定。',
          ],
          table: {
            caption: '第二阶段记录关系（候选）',
            headers: ['记录', '来源', '当前处理'],
            rows: [
              ['变更申请单', 'C03', '保留并增加初步判定栏'],
              ['变更评审记录', 'C06', '保留并增加风险触发栏'],
              ['变更实施记录', 'T06 新增', '编号占位待核对'],
              ['变更通知单', 'T02 新增', '责任部门待核对'],
            ],
          },
        },
      ],
    },
    V3: {
      fileId: 'F-PROCEDURE',
      versionId: 'V3',
      versionLabel: '第 3 版候选（返工）',
      sections: [
        {
          title: '1 返工依据与新手册版本',
          paragraphs: [
            '本稿以返工后的质量手册第 3 版为依据，重新核对变更控制章节、分流判定和下游记录引用。',
            '客户 I/II/III 类分级与现有审批职责保持不变；不因手册返工新增审批关卡。',
          ],
        },
        {
          title: '2 变更控制与分流判定',
          paragraphs: [
            '变更申请、影响评估、评审、批准、实施、效果确认和关闭继续沿用客户职责。',
            '分流结论必须记录判定依据、判定人和日期；无法判断时保持待确认，不以默认结论推进。',
          ],
        },
        {
          title: '3 下游记录与编号',
          paragraphs: [
            '四份记录表单按新手册与程序依据复核；变更申请单、评审记录和实施记录需要修改引用。',
            '外来文件管理规定不随本次手册返工修改，继续采用已确认版本并保留理由。',
          ],
          table: {
            caption: '返工后记录复核清单（候选）',
            headers: ['记录', '处理', '理由'],
            rows: [
              ['变更申请单', '修改', '同步新的分流判定与手册版本引用'],
              ['变更评审记录', '修改', '同步风险触发与手册依据'],
              ['变更实施记录', '修改', '同步实施记录编号引用'],
              ['变更通知单', '保留', '通知字段与本次手册返工无直接依赖'],
            ],
          },
        },
        {
          title: '4 读取限制与待核对',
          paragraphs: [
            '流程图、批注和版式仍未核验；记录编号映射继续待业务核对。',
            '本稿是环境 A 返工演练候选，不声称客户已确认或 Runner 已执行。',
          ],
        },
      ],
    },
  },
  'F-EXTERNAL-RULE': {
    V1: {
      fileId: 'F-EXTERNAL-RULE',
      versionId: 'V1',
      versionLabel: '第 1 版候选',
      sections: [
        {
          title: '1 目的与范围',
          paragraphs: [
            '规范法律法规、标准、监管文件、供应商和客户技术资料等外来文件的识别、登记、评审、分发、更新和作废。',
            '外来文件原发布机关效力不变，不纳入内部受控文件编号体系。',
          ],
        },
        {
          title: '2 职责',
          paragraphs: [
            '质量部负责清单维护和适用性评审组织；使用部门负责提出需求和确认适用范围。',
            '职责按 T03 模板说明，具体岗位由客户业务核对后确定。',
          ],
        },
        {
          title: '3 识别、登记与适用性评审',
          paragraphs: [
            '登记来源、版本、发布日期、适用产品和获取渠道；评审结论记录适用、不适用或待确认。',
            '适用性评审保留评审人、日期和依据；不把法规原文复制成内部受控文件。',
          ],
        },
        {
          title: '4 更新跟踪与作废',
          paragraphs: [
            '按发布机关渠道跟踪更新；发现更新后评估影响并触发文件或变更控制。',
            '作废或替换保留原文件标识和历史记录，不静默删除。',
          ],
        },
        {
          title: '5 相关记录',
          table: {
            caption: '外来文件记录（候选）',
            headers: ['记录', '用途', '编号状态'],
            rows: [
              ['外来文件清单', '登记与适用性结论', 'QR-GL-4.3.4.01-01 占位'],
              ['查新与更新处置记录', '更新跟踪与通知', 'QR-GL-4.3.4.01-02 占位'],
            ],
          },
        },
      ],
    },
    V2: {
      fileId: 'F-EXTERNAL-RULE',
      versionId: 'V2',
      versionLabel: '第 2 版候选',
      sections: [
        {
          title: '1 目的与范围',
          paragraphs: [
            '规范法律法规、标准、监管文件、供应商和客户技术资料等外来文件的识别、登记、评审、分发、更新和作废。',
            '外来文件原发布机关效力不变，不纳入内部受控文件编号体系。',
          ],
        },
        {
          title: '2 职责',
          paragraphs: [
            '质量部负责清单维护和适用性评审组织；使用部门负责提出需求和确认适用范围。',
            '职责按 T03 模板说明，具体岗位由客户业务核对后确定；候选不预填客户组织关系。',
          ],
        },
        {
          title: '3 识别、登记与适用性评审',
          paragraphs: [
            '登记来源、版本、发布日期、适用产品、客户或供应商来源和获取渠道；评审结论记录适用、不适用或待确认。',
            '适用性评审保留评审人、日期和依据；不把法规原文复制成内部受控文件。',
            '评审结论变化时形成新记录，不覆盖历史结论。',
          ],
        },
        {
          title: '4 更新跟踪与作废',
          paragraphs: [
            '按发布机关渠道跟踪更新；发现更新后评估影响并触发文件或变更控制。',
            '作废或替换保留原文件标识和历史记录，不静默删除。',
            '更新通知的责任部门和编号回填仍待业务核对。',
          ],
        },
        {
          title: '5 相关记录',
          table: {
            caption: '外来文件记录（候选）',
            headers: ['记录', '用途', '编号状态', '保留方式'],
            rows: [
              ['外来文件清单', '登记与适用性结论', 'QR-GL-4.3.4.01-01 占位', '保留历史版本'],
              ['查新与更新处置记录', '更新跟踪与通知', 'QR-GL-4.3.4.01-02 占位', '按年度归档'],
              ['变更控制凭证', '引用 PD-4.2.4 申请单', '关联编号待核对', '不复制法规原文'],
            ],
          },
        },
      ],
    },
    V3: {
      fileId: 'F-EXTERNAL-RULE',
      versionId: 'V3',
      versionLabel: '第 3 版候选',
      sections: [
        {
          title: '1 目的与范围',
          paragraphs: [
            '规范外来文件的识别、登记、评审、分发、更新和作废；外来文件原发布机关效力不变。',
            '本稿按返工后的质量手册核对文件层级引用，不改变外来文件本身效力。',
          ],
        },
        {
          title: '2 职责与依据',
          paragraphs: [
            '质量部负责清单维护和适用性评审组织；使用部门负责提出需求和确认适用范围。',
            '职责仍按客户现行安排填写；候选不预填客户组织关系。',
          ],
        },
        {
          title: '3 识别、登记与适用性评审',
          paragraphs: [
            '登记来源、版本、发布日期、适用产品、客户或供应商来源和获取渠道。',
            '评审结论记录适用、不适用或待确认，并保留评审人、日期和依据。',
            '评审结论变化时形成新记录，不覆盖历史结论。',
          ],
        },
        {
          title: '4 更新跟踪与作废',
          paragraphs: [
            '按发布机关渠道跟踪更新；发现更新后评估影响并触发文件或变更控制。',
            '作废或替换保留原文件标识和历史记录，不静默删除。',
            '更新通知的责任部门和编号回填仍待业务核对。',
          ],
        },
        {
          title: '5 相关记录',
          table: {
            caption: '外来文件记录（返工候选）',
            headers: ['记录', '用途', '编号状态', '保留方式'],
            rows: [
              ['外来文件清单', '登记与适用性结论', 'QR-GL-4.3.4.01-01 占位', '保留历史版本'],
              ['查新与更新处置记录', '更新跟踪与通知', 'QR-GL-4.3.4.01-02 占位', '按年度归档'],
              ['变更控制凭证', '引用 PD-4.2.4 申请单', '关联编号待核对', '不复制法规原文'],
            ],
          },
        },
      ],
    },
  },
  'F-FORM-APPLY': {
    V1: {
      fileId: 'F-FORM-APPLY',
      versionId: 'V1',
      versionLabel: '第 1 版候选',
      sections: [
        {
          title: '变更申请与初步判定',
          paragraphs: ['在客户现有申请字段之后增加初步分流判定，不删除原有申请信息。'],
          table: {
            caption: '变更申请单（候选）',
            headers: ['字段', '内容', '填写要求'],
            rows: [
              ['变更编号', '按客户现行编号规则', '不预填'],
              ['变更事项', '变更前状态与变更后状态', '保留现有字段'],
              ['变更原因', '原因、依据与影响范围', '保留现有字段'],
              ['初步判定', '实质性 / 非实质性 / 待确认', '记录判定依据'],
              ['客户分级参考', 'I / II / III 类', '保留客户术语'],
              ['申请意见', '申请部门意见与日期', '原有签批'],
            ],
          },
        },
      ],
    },
    V2: {
      fileId: 'F-FORM-APPLY',
      versionId: 'V2',
      versionLabel: '第 2 版候选',
      sections: [
        {
          title: '变更申请与初步判定',
          paragraphs: [
            '在客户现有申请字段之后增加初步分流判定，不删除原有申请信息。',
            '判定人与日期必须填写；无法判断时选择“待确认”，不能默认进入实质性变更。',
          ],
          table: {
            caption: '变更申请单（候选）',
            headers: ['字段', '内容', '填写要求', '备注'],
            rows: [
              ['变更编号', '按客户现行编号规则', '不预填', '编号映射待核对'],
              ['变更事项', '变更前状态与变更后状态', '保留现有字段', ''],
              ['变更原因', '原因、依据与影响范围', '保留现有字段', ''],
              ['初步判定', '实质性 / 非实质性 / 待确认', '记录判定依据', '不得默认结论'],
              ['判定人与日期', '实际判定人', '签名与日期', '不预填审批人'],
              ['客户分级参考', 'I / II / III 类', '保留客户术语', '与初步判定并列'],
              ['申请意见', '申请部门意见与日期', '原有签批', '不新增审批层级'],
            ],
          },
        },
      ],
    },
    V3: {
      fileId: 'F-FORM-APPLY',
      versionId: 'V3',
      versionLabel: '第 3 版候选（后续改稿）',
      sections: [
        {
          title: '变更申请信息与返工后手册依据',
          paragraphs: [
            '本稿按返工后的质量手册与变更控制程序核对申请单字段；客户现有申请信息与签批位置保留。',
            '新增的手册版本引用与分流判定栏只补充必要依据，不改变申请与审批路径。',
          ],
          table: {
            caption: '变更申请单后续改稿（候选）',
            headers: ['字段', '现有内容', '本轮处理', '备注'],
            rows: [
              ['变更事项', '变更前与变更后描述', '保留', ''],
              ['变更原因', '申请依据与原因', '保留', ''],
              ['注册影响', '是否涉及注册事项', '保留并补充初步判定', '待业务核对'],
              ['手册依据', '本次适用的质量手册版本', '新增引用', '第 3 版返工稿'],
              ['分流判定', '实质性 / 非实质性 / 待确认', '增加初步判定栏', '不替代评审结论'],
              ['申请意见', '申请部门意见', '保留原有签批', ''],
            ],
          },
        },
      ],
    },
  },
  'F-FORM-REVIEW': {
    V1: {
      fileId: 'F-FORM-REVIEW',
      versionId: 'V1',
      versionLabel: '第 1 版候选',
      sections: [
        {
          title: '评审、风险触发与批准意见',
          paragraphs: ['在客户现有评审记录中增加风险触发判断和批准意见区。'],
          table: {
            caption: '变更评审记录（候选）',
            headers: ['字段', '内容', '填写要求'],
            rows: [
              ['变更编号', '关联申请单', '必填'],
              ['评审项目', '按变更内容列项', '保留现有字段'],
              ['风险触发', '是 / 否 / 待确认', '记录判断依据'],
              ['风险记录编号', '关联风险管理记录', '如适用'],
              ['评审结论', '同意 / 有条件同意 / 不同意', '保留现有字段'],
              ['批准意见', '分级批准意见', '并入本记录'],
              ['会签', '客户现有岗位', '不新增层级'],
            ],
          },
        },
      ],
    },
    V2: {
      fileId: 'F-FORM-REVIEW',
      versionId: 'V2',
      versionLabel: '第 2 版候选',
      sections: [
        {
          title: '评审、风险触发与批准意见',
          paragraphs: [
            '在客户现有评审记录中增加风险触发判断和批准意见区。',
            '批准意见并入本记录；不新增审批层级，也不把模板岗位写入客户职责。',
          ],
          table: {
            caption: '变更评审记录（候选）',
            headers: ['字段', '内容', '填写要求', '备注'],
            rows: [
              ['变更编号', '关联申请单', '必填', '编号映射待核对'],
              ['评审项目', '按变更内容列项', '保留现有字段', ''],
              ['风险触发', '是 / 否 / 待确认', '记录判断依据', '待确认不视为通过'],
              ['风险记录编号', '关联风险管理记录', '如适用', '不预填'],
              ['评审结论', '同意 / 有条件同意 / 不同意', '保留现有字段', ''],
              ['批准意见', '分级批准意见', '并入本记录', '不新增层级'],
              ['会签', '客户现有岗位', '不新增层级', '按客户现行安排'],
            ],
          },
        },
      ],
    },
    V3: {
      fileId: 'F-FORM-REVIEW',
      versionId: 'V3',
      versionLabel: '第 3 版候选',
      sections: [
        {
          title: '评审、风险触发与批准意见',
          paragraphs: [
            '本稿按返工后的控制程序核对评审字段与批准意见区。',
            '客户现有评审项目、会签安排和审批层级保留；不新增审批层级。',
          ],
          table: {
            caption: '变更评审记录（返工候选）',
            headers: ['字段', '内容', '填写要求', '备注'],
            rows: [
              ['变更编号', '关联申请单', '必填', '编号映射待核对'],
              ['评审项目', '按变更内容列项', '保留现有字段', ''],
              ['风险触发', '是 / 否 / 待确认', '记录判断依据', '待确认不视为通过'],
              ['风险记录编号', '关联风险管理记录', '如适用', '不预填'],
              ['评审结论', '同意 / 有条件同意 / 不同意', '保留现有字段', ''],
              ['批准意见', '分级批准意见', '并入本记录', '不新增层级'],
              ['会签', '客户现有岗位', '不新增层级', '按客户现行安排'],
            ],
          },
        },
      ],
    },
  },
  'F-FORM-IMPLEMENT': {
    V1: {
      fileId: 'F-FORM-IMPLEMENT',
      versionId: 'V1',
      versionLabel: '第 1 版候选',
      sections: [
        {
          title: '变更实施记录',
          paragraphs: ['按 T06 新增实施记录，与申请单、评审记录通过变更编号关联。'],
          table: {
            caption: '变更实施记录（候选）',
            headers: ['字段', '内容', '填写要求'],
            rows: [
              ['变更编号', '关联申请单与评审记录', '必填'],
              ['实施内容', '实际实施步骤', '按实际填写'],
              ['文件更新', '受影响文件与版本', '逐项列明'],
              ['培训', '培训对象、内容与日期', '如适用'],
              ['效果确认', '确认方法与结论', '未完成保持待确认'],
              ['完成日期', '实际完成日期', '不预填'],
            ],
          },
        },
      ],
    },
    V2: {
      fileId: 'F-FORM-IMPLEMENT',
      versionId: 'V2',
      versionLabel: '第 2 版候选',
      sections: [
        {
          title: '变更实施记录',
          paragraphs: [
            '按 T06 新增实施记录，与申请单、评审记录通过变更编号关联。',
            'C05 实施方案确认记录继续独立保留，本记录不替代它。',
          ],
          table: {
            caption: '变更实施记录（候选）',
            headers: ['字段', '内容', '填写要求', '备注'],
            rows: [
              ['变更编号', '关联申请单与评审记录', '必填', '编号映射待核对'],
              ['实施内容', '实际实施步骤', '按实际填写', ''],
              ['文件更新', '受影响文件与版本', '逐项列明', '保留旧版本标识'],
              ['培训', '培训对象、内容与日期', '如适用', '未实施不勾选'],
              ['效果确认', '确认方法与结论', '未完成保持待确认', '不以计划代替结论'],
              ['完成日期', '实际完成日期', '不预填', ''],
            ],
          },
        },
      ],
    },
    V3: {
      fileId: 'F-FORM-IMPLEMENT',
      versionId: 'V3',
      versionLabel: '第 3 版候选',
      sections: [
        {
          title: '变更实施记录',
          paragraphs: [
            '本稿按返工后的手册与控制程序核对实施记录的关联编号。',
            'C05 实施方案确认记录继续独立保留；本记录不替代它。',
          ],
          table: {
            caption: '变更实施记录（返工候选）',
            headers: ['字段', '内容', '填写要求', '备注'],
            rows: [
              ['变更编号', '关联申请单与评审记录', '必填', '编号映射待核对'],
              ['实施内容', '实际实施步骤', '按实际填写', ''],
              ['文件更新', '受影响文件与版本', '逐项列明', '保留旧版本标识'],
              ['培训', '培训对象、内容与日期', '如适用', '未实施不勾选'],
              ['效果确认', '确认方法与结论', '未完成保持待确认', '不以计划代替结论'],
              ['完成日期', '实际完成日期', '不预填', ''],
            ],
          },
        },
      ],
    },
  },
  'F-FORM-NOTICE': {
    V1: {
      fileId: 'F-FORM-NOTICE',
      versionId: 'V1',
      versionLabel: '第 1 版候选',
      sections: [
        {
          title: '变更通知单',
          paragraphs: ['按 T02 新增通知记录，覆盖内部、外部和受托生产通知。'],
          table: {
            caption: '变更通知单（候选）',
            headers: ['字段', '内容', '填写要求'],
            rows: [
              ['变更编号', '关联申请单', '必填'],
              ['通知对象', '内部部门 / 外部相关方', '按实际填写'],
              ['通知内容', '变更事项与生效安排', '不扩大客户决定'],
              ['通知方式', '现有渠道', '按实际填写'],
              ['通知时间', '实际发出时间', '不预填'],
              ['接收确认', '接收人与日期', '保留记录'],
            ],
          },
        },
      ],
    },
    V2: {
      fileId: 'F-FORM-NOTICE',
      versionId: 'V2',
      versionLabel: '第 2 版候选',
      sections: [
        {
          title: '变更通知单',
          paragraphs: [
            '按 T02 新增通知记录，覆盖内部、外部和受托生产通知。',
            '通知责任部门按客户现行安排填写；未确认前保留空白并标注待核对。',
          ],
          table: {
            caption: '变更通知单（候选）',
            headers: ['字段', '内容', '填写要求', '备注'],
            rows: [
              ['变更编号', '关联申请单', '必填', ''],
              ['通知对象', '内部部门 / 外部相关方', '按实际填写', '不预填客户身份'],
              ['通知内容', '变更事项与生效安排', '不扩大客户决定', ''],
              ['通知方式', '现有渠道', '按实际填写', ''],
              ['通知时间', '实际发出时间', '不预填', ''],
              ['接收确认', '接收人与日期', '保留记录', ''],
              ['责任部门', '客户现行安排', '待核对', '不预填真实决定'],
            ],
          },
        },
      ],
    },
    V3: {
      fileId: 'F-FORM-NOTICE',
      versionId: 'V3',
      versionLabel: '第 3 版候选',
      sections: [
        {
          title: '变更通知单',
          paragraphs: [
            '本稿按返工后的控制程序核对通知对象、通知内容与接收确认。',
            '通知责任部门按客户现行安排填写；未确认前保留空白并标注待核对。',
          ],
          table: {
            caption: '变更通知单（返工候选）',
            headers: ['字段', '内容', '填写要求', '备注'],
            rows: [
              ['变更编号', '关联申请单', '必填', ''],
              ['通知对象', '内部部门 / 外部相关方', '按实际填写', '不预填客户身份'],
              ['通知内容', '变更事项与生效安排', '不扩大客户决定', ''],
              ['通知方式', '现有渠道', '按实际填写', ''],
              ['通知时间', '实际发出时间', '不预填', ''],
              ['接收确认', '接收人与日期', '保留记录', ''],
              ['责任部门', '客户现行安排', '待核对', '不预填真实决定'],
            ],
          },
        },
      ],
    },
  },
};

export function u2VersionLabel(versionId: string): string {
  if (versionId === 'V3') return '第 3 版候选';
  return versionId === 'V2' ? '第 2 版候选' : '第 1 版候选';
}

const revisionIds: Record<string, Record<string, string>> = {
  'F-MANUAL': { V1: 'MANUAL01', V2: 'MANUAL02', V3: 'MANUAL03' },
  'F-PROCEDURE': { V1: 'PROCED01', V2: 'PROCED02', V3: 'PROCED03' },
  'F-EXTERNAL-RULE': { V1: 'EXTRULE1', V2: 'EXTRULE2', V3: 'EXTRULE3' },
  'F-FORM-APPLY': { V1: 'FORMAPP1', V2: 'FORMAPP2', V3: 'FORMAPP3' },
  'F-FORM-REVIEW': { V1: 'FORMREV1', V2: 'FORMREV2', V3: 'FORMREV3' },
  'F-FORM-IMPLEMENT': { V1: 'FORMIMP1', V2: 'FORMIMP2', V3: 'FORMIMP3' },
  'F-FORM-NOTICE': { V1: 'FORMNOT1', V2: 'FORMNOT2', V3: 'FORMNOT3' },
};

function digest(value: string): string {
  let state = 2166136261;
  let output = '';
  for (let index = 0; index < 32; index++) {
    state = ((state ^ value.charCodeAt(index % value.length)) * 16777619) >>> 0;
    output += state.toString(16).padStart(8, '0');
  }
  return output;
}

function hash(value: string) {
  return {
    algorithm: 'SHA-256' as const,
    digest: digest(value),
    canonicalizationVersion: '1' as const,
  };
}

function block(
  unitId: string,
  unitType: Unit['unitType'],
  text: string | undefined,
  ordinal: number,
  parentUnitId: string,
  childUnitIds: string[],
  markdown: Unit['semanticMetadata']['markdown'],
): Unit {
  return {
    unitId,
    unitType,
    ordinal,
    parentUnitId,
    childUnitIds,
    ...(text !== undefined ? { text } : {}),
    semanticMetadata: { markdown },
  };
}

function buildDocument(
  revisionId: string,
  title: string,
  sections: readonly SectionSpec[],
): Document {
  const units: Unit[] = [];
  sections.forEach((section, sectionIndex) => {
    const sectionId = `${revisionId}-s${sectionIndex + 1}`;
    const children: string[] = [];
    section.paragraphs?.forEach((text, paragraphIndex) => {
      const unitId = `${sectionId}-p${paragraphIndex + 1}`;
      units.push(
        block(unitId, 'PARAGRAPH', text, paragraphIndex, sectionId, [], { blockKind: 'PARAGRAPH' }),
      );
      children.push(unitId);
    });
    if (section.table) {
      const tableId = `${sectionId}-table`;
      const rowIds: string[] = [];
      const rows = [section.table.headers, ...section.table.rows];
      rows.forEach((cells, rowIndex) => {
        const rowId = `${tableId}-r${rowIndex + 1}`;
        const cellIds = cells.map((text, cellIndex) => {
          const cellId = `${rowId}-c${cellIndex + 1}`;
          units.push(
            block(cellId, 'TABLE_CELL', text, cellIndex, rowId, [], { blockKind: 'PARAGRAPH' }),
          );
          return cellId;
        });
        units.push(block(rowId, 'TABLE_ROW', undefined, rowIndex, tableId, cellIds, {}));
        rowIds.push(rowId);
      });
      units.push(
        block(
          tableId,
          'TABLE',
          section.table.caption,
          (section.paragraphs?.length ?? 0) + 1,
          sectionId,
          rowIds,
          {
            blockKind: 'TABLE',
            columns: section.table.headers.map((_, index) => ({
              columnId: `c${index + 1}`,
              alignment: 'LEFT',
            })),
          },
        ),
      );
      children.push(tableId);
    }
    units.push({
      unitId: sectionId,
      unitType: 'SECTION',
      ordinal: sectionIndex,
      childUnitIds: children,
      text: section.title,
      semanticMetadata: { markdown: { headingLevel: 1 } },
    });
  });
  return { documentId: `${revisionId}-document`, title, units };
}

function revision(revisionId: string): ReviewContent['revisionRef'] {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'artifact.artifact_revision',
    objectId: revisionId,
    scope: { enterpriseId: 'U1-ENTERPRISE', projectId: 'MVP-U1-PROJECT' },
    contentHash: hash(revisionId),
  };
}

function content(
  revisionId: string,
  title: string,
  sections: readonly SectionSpec[],
): ReviewContent {
  const ref = revision(revisionId);
  return {
    revisionRef: ref,
    canonicalContentHash: ref.contentHash,
    document: buildDocument(revisionId, title, sections),
    authoritativeIdentityMap: {
      artifactRef: {
        kind: 'OBJECT',
        objectType: 'artifact.artifact',
        objectId: `${revisionId}-artifact`,
        scope: ref.scope,
      },
    },
    currentUsability: 'USABLE',
  };
}

function sectionSections(seed: CandidateSeed, before: boolean): readonly SectionSpec[] {
  if (!before) return seed.sections;
  if (seed.versionId === 'V1') return currentSections[seed.fileId] ?? [];
  return candidateSeeds[seed.fileId]?.V1?.sections ?? [];
}

function tableSignature(table: TableSpec): string {
  return [table.caption, ...table.headers, ...table.rows.map((row) => row.join('|'))].join('|');
}

function changesFor(
  before: ReviewContent,
  after: ReviewContent,
  beforeSections: readonly SectionSpec[],
  afterSections: readonly SectionSpec[],
  revisionId: string,
): { changes: Change[]; groups: { unitId: string; title: string; changeCount: number }[] } {
  const beforeUnits = new Map(before.document.units.map((unit) => [unit.unitId, unit]));
  const afterUnits = new Map(after.document.units.map((unit) => [unit.unitId, unit]));
  const beforeId = before.revisionRef.objectId;
  const afterId = after.revisionRef.objectId;
  const changes: Change[] = [];
  const groups: { unitId: string; title: string; changeCount: number }[] = [];
  const count = Math.max(beforeSections.length, afterSections.length);
  for (let sectionIndex = 0; sectionIndex < count; sectionIndex++) {
    const beforeSection = beforeSections[sectionIndex];
    const afterSection = afterSections[sectionIndex];
    const sectionId = `${afterId}-s${sectionIndex + 1}`;
    const beforeSectionId = `${beforeId}-s${sectionIndex + 1}`;
    let sectionChanges = 0;
    const push = (change: Omit<Change, 'changeId' | 'chapterUnitIds' | 'contextUnitIds'>) => {
      changes.push({
        changeId: hash(`${revisionId}:${sectionIndex}:${changes.length}`),
        ...change,
        chapterUnitIds: [sectionId],
        contextUnitIds: [sectionId],
      });
      sectionChanges += 1;
    };
    if (!beforeSection && afterSection) {
      const afterUnit = afterUnits.get(sectionId);
      if (afterUnit) push({ unitId: afterUnit.unitId, kind: 'ADDED', afterValue: afterUnit });
    } else if (beforeSection && !afterSection) {
      const beforeUnit = beforeUnits.get(beforeSectionId);
      if (beforeUnit) push({ unitId: beforeUnit.unitId, kind: 'REMOVED', beforeValue: beforeUnit });
    } else if (beforeSection && afterSection) {
      if (beforeSection.title !== afterSection.title) {
        const beforeUnit = beforeUnits.get(beforeSectionId);
        const afterUnit = afterUnits.get(sectionId);
        if (beforeUnit && afterUnit)
          push({
            unitId: afterUnit.unitId,
            kind: 'CHANGED',
            beforeValue: beforeUnit,
            afterValue: afterUnit,
          });
      }
      const paragraphs = Math.max(
        beforeSection.paragraphs?.length ?? 0,
        afterSection.paragraphs?.length ?? 0,
      );
      for (let paragraphIndex = 0; paragraphIndex < paragraphs; paragraphIndex++) {
        const beforeText = beforeSection.paragraphs?.[paragraphIndex];
        const afterText = afterSection.paragraphs?.[paragraphIndex];
        if (beforeText === afterText) continue;
        const beforeUnit = beforeUnits.get(`${beforeSectionId}-p${paragraphIndex + 1}`);
        const afterUnit = afterUnits.get(`${sectionId}-p${paragraphIndex + 1}`);
        if (!beforeUnit && afterUnit)
          push({ unitId: afterUnit.unitId, kind: 'ADDED', afterValue: afterUnit });
        else if (beforeUnit && !afterUnit)
          push({ unitId: beforeUnit.unitId, kind: 'REMOVED', beforeValue: beforeUnit });
        else if (beforeUnit && afterUnit)
          push({
            unitId: afterUnit.unitId,
            kind: 'CHANGED',
            beforeValue: beforeUnit,
            afterValue: afterUnit,
          });
      }
      if (beforeSection.table?.caption !== afterSection.table?.caption) {
        const beforeUnit = beforeUnits.get(`${beforeSectionId}-table`);
        const afterUnit = afterUnits.get(`${sectionId}-table`);
        if (!beforeUnit && afterUnit)
          push({ unitId: afterUnit.unitId, kind: 'ADDED', afterValue: afterUnit });
        else if (beforeUnit && !afterUnit)
          push({ unitId: beforeUnit.unitId, kind: 'REMOVED', beforeValue: beforeUnit });
        else if (beforeUnit && afterUnit)
          push({
            unitId: afterUnit.unitId,
            kind: 'CHANGED',
            beforeValue: beforeUnit,
            afterValue: afterUnit,
          });
      } else if (
        beforeSection.table &&
        afterSection.table &&
        tableSignature(beforeSection.table) !== tableSignature(afterSection.table)
      ) {
        const beforeUnit = beforeUnits.get(`${beforeSectionId}-table`);
        const afterUnit = afterUnits.get(`${sectionId}-table`);
        if (beforeUnit && afterUnit)
          push({
            unitId: afterUnit.unitId,
            kind: 'CHANGED',
            beforeValue: beforeUnit,
            afterValue: afterUnit,
          });
      }
    }
    if (sectionChanges > 0)
      groups.push({
        unitId: sectionId,
        title: afterSection?.title ?? beforeSection?.title ?? `第 ${sectionIndex + 1} 节`,
        changeCount: sectionChanges,
      });
  }
  return { changes, groups };
}

const emptySections: readonly SectionSpec[] = [];

/** Exact public-safe candidate for one planned file and version. */
export function u2Candidate(fileId: string, versionId: string): MarkdownReviewData | undefined {
  const meta = u2FileMetas[fileId];
  const seed = candidateSeeds[fileId]?.[versionId];
  if (!meta || !seed) return undefined;
  const beforeSections = sectionSections(seed, true);
  const afterSections = seed.sections;
  const afterId = revisionIds[fileId]?.[versionId] ?? `${fileId}-${versionId}`;
  const before = content(
    `${afterId}B`,
    `${meta.title} · 比较基线`,
    beforeSections.length > 0 ? beforeSections : emptySections,
  );
  const after = content(afterId, `${meta.title} · ${seed.versionLabel}`, afterSections);
  const { changes, groups } = changesFor(before, after, beforeSections, afterSections, fileId);
  const empty = beforeSections.length === 0;
  return {
    content: after,
    ...(empty ? {} : { before }),
    changes: {
      exactInputs: {
        toRevisionRef: after.revisionRef,
        ...(empty ? {} : { fromRevisionRef: before.revisionRef }),
        baselineKind: empty ? 'EMPTY_INITIAL' : 'REVISION',
      },
      diffHash: hash(`${fileId}:${versionId}:diff`),
      totalChanges: changes.length,
      changedUnitCount: changes.length,
      filteredChanges: changes.length,
      chapterGroups: groups,
      entries: changes,
    },
  };
}

export function u2VersionsFor(fileId: string): readonly string[] {
  return Object.keys(candidateSeeds[fileId] ?? {});
}

export function u2Summary(
  fileId: string,
): { summary: string; retained: readonly string[]; note: string } | undefined {
  const meta = u2FileMetas[fileId];
  if (!meta) return undefined;
  return {
    summary:
      meta.action === 'CREATE'
        ? `本候选是按 ${meta.templateIds.join('、')} 形成的新增文件；没有客户原版本，不伪造原件。`
        : `本候选在 ${meta.sourceIds.join('、')} 的现有结构上形成；保留客户现行职责与术语，差异逐处列出。`,
    retained: meta.retained,
    note: `${meta.limitations.join(' ')} 来源与模板均为只读快照；候选不是 Runner 输出。`,
  };
}

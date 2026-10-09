import definition from './company-startup-definition.json' with { type: 'json' };

// Frozen company business definitions from Delta #257, not customer assertions.
export const COMPANY_STARTUP_DEFINITION = definition;
export const COMPANY_REQUIREMENT_LOCATORS: Readonly<Record<string, readonly [string, string][]>> = {
  'zhiju.requirement.qms.scope': [['S1', '1.2/4.3.3']],
  'zhiju.requirement.qms.design_development': [
    ['S1', '7.3'],
    ['S4', '1-2'],
  ],
  'zhiju.requirement.qms.product_cleanliness': [
    ['S1', '1.3/7.5.2'],
    ['S5', '5.2'],
  ],
  'zhiju.requirement.qms.sterile_device': [['S1', '7.5.5']],
  'zhiju.requirement.qms.sterilization_validation': [['S1', '7.5.7']],
  'zhiju.requirement.qms.implant_traceability': [['S1', '7.5.9.2']],
  'zhiju.requirement.qms.contamination_control': [
    ['S1', '1.3'],
    ['S9', '2/5.3'],
  ],
  'zhiju.requirement.qms.process_validation': [
    ['S1', '7.5.6'],
    ['S5', '3.3/5.6'],
  ],
  'zhiju.requirement.qms.qms_software': [
    ['S1', '4.1.6'],
    ['S6', '2/5.2'],
  ],
  'zhiju.requirement.qms.product_software': [
    ['S4', '5'],
    ['S7', '2/5.1'],
  ],
  'zhiju.requirement.qms.external_processes': [
    ['S1', '4.2.3'],
    ['S4', '5.12'],
    ['S8', '2'],
  ],
  'zhiju.requirement.qms.sample_retention': [['S1', '1.3#6']],
};
export const COMPANY_STARTUP_MANDATORY = {
  mandatoryFactTypes: ['zhiju.fact.quality_policy'],
  requiredProductFields: [
    'productType',
    'displayName',
    'intendedUse',
    'productScope.productFamily',
    'variants',
    'markets',
    'sourceRefs',
  ].sort(),
  minimumProductVersions: 1,
  protectionEvidenceRequirements: [
    'quality_objectives',
    'organization_responsibilities',
    'operational_processes',
    'product_processes',
  ].sort(),
  mandatoryRequirementCodes: definition.requirements.map((r) => r.code).sort(),
  mandatoryChoiceKeys: [
    'zhiju.choice.qms.document_base',
    'zhiju.choice.qms.protection_strategy',
  ].sort(),
  mandatoryDecisionTypes: [
    'zhiju.decision.qms.supported_scope',
    'zhiju.decision.qms.protection_evidence',
    'zhiju.decision.qms.startup_conflicts',
  ].sort(),
  allowedStartupOutcomes: {
    'zhiju.decision.qms.supported_scope': ['zhiju.outcome.within_supported_scope'],
    'zhiju.decision.qms.protection_evidence': ['zhiju.outcome.sufficient'],
    'zhiju.decision.qms.startup_conflicts': [
      'zhiju.outcome.file_only_conflicts',
      'zhiju.outcome.no_startup_conflict',
    ],
  },
  supportSet: ['PRODUCT', 'QMS', 'TEXT'],
};
export interface CompanyVocabularyDefinition {
  domain: string;
  code: string;
  label: string;
  meaning: string;
  field: string;
  sources: readonly [string, string][];
}
const vocabularyEntries: CompanyVocabularyDefinition[] = [
  {
    domain: 'fact_type',
    code: 'zhiju.fact.quality_policy',
    label: '质量方针',
    meaning: '完整客户质量方针原文；TEXT、高风险、Human-only',
    field: 'EnterpriseFact.factType',
    sources: [['S1', '0.3/5.3']],
  },
  {
    domain: 'product_type',
    code: 'zhiju.product.active_device',
    label: '有源医疗器械硬件产品',
    meaning: '有源、非无菌、非植入医疗器械硬件，可包含软件组件，不包含独立软件',
    field: 'Product.productType',
    sources: [
      ['S1', '1.2'],
      ['S7', '2'],
    ],
  },
  {
    domain: 'market',
    code: 'zhiju.market.cn_mainland',
    label: '中国大陆市场',
    meaning: '本项目明确纳入中国大陆市场，不推断注册类别或客户适用性',
    field: 'Product.markets',
    sources: [['S1', '1.2']],
  },
  {
    domain: 'risk_level',
    code: 'zhiju.risk.high',
    label: '高风险',
    meaning: '质量方针确认须由具权限 Human 明确作出',
    field: 'EnterpriseFact.riskLevel',
    sources: [['S1', '0.3/5.3']],
  },
  ...definition.requirements.map((r): CompanyVocabularyDefinition => ({
    domain: 'requirement',
    code: r.code,
    label: r.text.split('；')[0] ?? r.text,
    meaning: r.conditions,
    field: 'QMSConfiguration.applicabilityDecisions.requirementRef',
    sources: COMPANY_REQUIREMENT_LOCATORS[r.code] ?? [],
  })),
  {
    domain: 'choice',
    code: 'zhiju.choice.qms.document_base',
    label: '文件底稿',
    meaning: '沿用经确认的客户受控底稿与身份，缺件派生另按文件授权',
    field: 'QMSConfiguration.managementChoices.choiceKey',
    sources: [['S1', '0.3']],
  },
  {
    domain: 'choice',
    code: 'zhiju.choice.qms.protection_strategy',
    label: '保护策略',
    meaning: '保持客户方针、目标、人员职责及既有过程；不批准保护例外或修改',
    field: 'QMSConfiguration.managementChoices.choiceKey',
    sources: [['S1', '0.3']],
  },
  {
    domain: 'choice_option',
    code: 'zhiju.option.customer_controlled_base',
    label: '客户受控底稿',
    meaning: 'zhiju.choice.qms.document_base 的唯一首版选项',
    field: 'QMSConfiguration.managementChoices.selectedOption',
    sources: [['S1', '0.3']],
  },
  {
    domain: 'choice_option',
    code: 'zhiju.option.preserve_customer_arrangements',
    label: '保持客户安排',
    meaning: 'zhiju.choice.qms.protection_strategy 的唯一首版选项',
    field: 'QMSConfiguration.managementChoices.selectedOption',
    sources: [['S1', '0.3']],
  },
  ...[
    ['supported_scope', '受支持范围', '核对全部产品、市场、标准目标和十二项适用性'],
    ['protection_evidence', '保护依据', '核对四类保护依据的完整原文及关系'],
    ['startup_conflicts', '启动冲突', '区分启动必需冲突与精确整文件修改冲突'],
  ].map(([key, label, meaning]): CompanyVocabularyDefinition => ({
    domain: 'decision',
    code: `zhiju.decision.qms.${key}`,
    label: label ?? '',
    meaning: meaning ?? '',
    field: 'QMSConfiguration.professionalDecisions.decisionType',
    sources: [['S1', '0.3']],
  })),
  ...[
    ['within_supported_scope', '范围内', 'supported_scope 允许继续检查启动'],
    ['outside_supported_scope', '范围外', 'supported_scope 阻启动'],
    ['undetermined', '未确定', 'supported_scope 阻启动'],
    ['sufficient', '依据足够', 'protection_evidence 允许继续检查启动'],
    ['insufficient', '依据不足', 'protection_evidence 阻启动'],
    ['conflicting', '依据冲突', 'protection_evidence 阻启动'],
    ['no_startup_conflict', '无启动冲突', 'startup_conflicts 允许继续检查启动'],
    [
      'file_only_conflicts',
      '仅文件冲突',
      'startup_conflicts 允许继续检查启动；受影响整文件保持 blocker',
    ],
    ['startup_conflict', '启动冲突', 'startup_conflicts 阻启动'],
  ].map(([key, label, meaning]): CompanyVocabularyDefinition => ({
    domain: 'decision_outcome',
    code: `zhiju.outcome.${key}`,
    label: label ?? '',
    meaning: meaning ?? '',
    field: 'QMSConfiguration.professionalDecisions.outcome',
    sources: [['S1', '0.3']],
  })),
];
export const COMPANY_STARTUP_VOCABULARY: readonly CompanyVocabularyDefinition[] =
  vocabularyEntries.sort((a, b) =>
    `${a.domain}:${a.code}`.localeCompare(`${b.domain}:${b.code}`, 'en'),
  );

# 匿名启动核对报告

设计样例；以下业务内容由同一结构化样例生成。

```json
{
  "schemaVersion": "0.2.0",
  "stage": "ANALYSIS",
  "context": {
    "analysisRequestKey": "ANALYSIS-DEMO-01",
    "inputManifestSha256": "44ca1278c092fc53a95ddee66851da363d099ad99a95bfa8f946568c2412199e",
    "previousReportSha256": null,
    "sourceReportIds": []
  },
  "title": "匿名启动核对报告",
  "analysisCompleteness": "PARTIAL",
  "summary": "先补现行组织图；纠正与预防程序可独立处理；启动候选仍须顾问确认。",
  "limitations": [
    "现行组织图未提供；软件使用情况未知。"
  ],
  "readCoverage": [
    {
      "sourceId": "C-STARTUP",
      "readState": "READ",
      "scopeDescription": "已读取本匿名 Markdown 样例全文。",
      "limitations": []
    },
    {
      "sourceId": "T-UPGRADE",
      "readState": "READ",
      "scopeDescription": "已读取本匿名 Markdown 样例全文。",
      "limitations": []
    }
  ],
  "evidence": [
    {
      "id": "E-POLICY",
      "sourceId": "C-STARTUP",
      "representation": "ORIGINAL",
      "locator": {
        "kind": "SECTION",
        "value": "质量方针"
      },
      "quote": "在确认的产品范围内，持续满足客户要求，并改进质量管理体系的有效性。",
      "note": "原文完整保留。",
      "extractedText": null
    },
    {
      "id": "E-PRODUCT",
      "sourceId": "C-STARTUP",
      "representation": "ORIGINAL",
      "locator": {
        "kind": "SECTION",
        "value": "产品范围"
      },
      "quote": "产品族：示例产品族；型号：甲一、甲二；市场代码：demo.market_cn。",
      "note": "产品完整结构来自本节，不从模板推断。",
      "extractedText": null
    },
    {
      "id": "E-MANAGEMENT",
      "sourceId": "C-STARTUP",
      "representation": "ORIGINAL",
      "locator": {
        "kind": "SECTION",
        "value": "现行管理安排"
      },
      "quote": "纠正措施与预防措施使用两份独立程序，分别保持现行审批流程。",
      "note": "保留两份程序与审批流程。",
      "extractedText": null
    },
    {
      "id": "E-ORG",
      "sourceId": "C-STARTUP",
      "representation": "ORIGINAL",
      "locator": {
        "kind": "SECTION",
        "value": "现行管理安排"
      },
      "quote": "组织关系详见独立组织图；该组织图未包含在本次资料中。",
      "note": "只证明引用的组织图未提供，不能证明企业没有组织关系。",
      "extractedText": null
    },
    {
      "id": "E-TEMPLATE",
      "sourceId": "T-UPGRADE",
      "representation": "ORIGINAL",
      "locator": {
        "kind": "SECTION",
        "value": "职责与组织"
      },
      "quote": "升级稿应明确现行职责与组织关系。模板示例岗位不得作为客户事实。",
      "note": "只作为要求依据，不作为企业事实。",
      "extractedText": null
    }
  ],
  "protectedFacts": [
    {
      "id": "P-ORG",
      "title": "保护企业实际职责",
      "category": "RESPONSIBILITY",
      "statement": "实际岗位职责以企业现行安排为准，不采用模板中的示例岗位。",
      "sourceState": "UNCONFIRMED",
      "evidenceIds": [
        "E-ORG"
      ],
      "legacyLabels": []
    }
  ],
  "attentionItems": [
    {
      "id": "U-ORG",
      "title": "补充现行组织图",
      "kind": "MISSING_MATERIAL",
      "audience": "CUSTOMER",
      "reason": "客户正文引用了未提供的独立组织图。",
      "question": "请补充依据或说明现行安排。",
      "effect": "BEFORE_AFFECTED_GENERATION",
      "affectedPlannedFileIds": [
        "F-MANUAL"
      ],
      "relatedChangeIds": [],
      "protectedFactIds": [],
      "evidenceIds": [
        "E-ORG"
      ],
      "material": {
        "expectedMaterial": "现行组织图",
        "searchedSourceIds": [
          "C-STARTUP"
        ],
        "providedSourceIds": [],
        "searchScopeNote": "只判断本次来源集合。"
      },
      "customerRequest": {
        "key": "REQ-ORG",
        "title": "现行组织图",
        "text": "请提供现行组织图，如已提供请指出对应文件。"
      },
      "legacyLabels": []
    },
    {
      "id": "U-ROLE",
      "title": "模板职责需要企业依据",
      "kind": "PROTECTION_CONFLICT",
      "audience": "CONSULTANT",
      "reason": "不能用模板示例替代客户实际职责。",
      "question": "请补充依据或说明现行安排。",
      "effect": "BEFORE_AFFECTED_GENERATION",
      "affectedPlannedFileIds": [
        "F-ROLE"
      ],
      "relatedChangeIds": [],
      "protectedFactIds": [
        "P-ORG"
      ],
      "evidenceIds": [
        "E-ORG",
        "E-TEMPLATE"
      ],
      "material": null,
      "customerRequest": null,
      "legacyLabels": []
    },
    {
      "id": "U-SOFTWARE",
      "title": "软件使用情况待确认",
      "kind": "FACT_QUESTION",
      "audience": "CUSTOMER",
      "reason": "资料尚未说明软件使用情况。",
      "question": "请补充依据或说明现行安排。",
      "effect": "BEFORE_AFFECTED_GENERATION",
      "affectedPlannedFileIds": [],
      "relatedChangeIds": [],
      "protectedFactIds": [],
      "evidenceIds": [
        "E-TEMPLATE"
      ],
      "material": null,
      "customerRequest": null,
      "legacyLabels": []
    }
  ],
  "resolutionProposals": [],
  "plannedFiles": [
    {
      "id": "F-CORR",
      "title": "纠正措施程序",
      "customerCode": "QP22",
      "category": "PROCEDURE",
      "origin": "CUSTOMER_REVISION",
      "customerSourceIds": [
        "C-STARTUP"
      ],
      "templateSourceIds": [
        "T-UPGRADE"
      ],
      "proposedOutputPath": "正文/纠正措施程序.md",
      "attentionItemIds": []
    },
    {
      "id": "F-PREV",
      "title": "预防措施程序",
      "customerCode": "QP23",
      "category": "PROCEDURE",
      "origin": "CUSTOMER_REVISION",
      "customerSourceIds": [
        "C-STARTUP"
      ],
      "templateSourceIds": [
        "T-UPGRADE"
      ],
      "proposedOutputPath": "正文/预防措施程序.md",
      "attentionItemIds": []
    },
    {
      "id": "F-MANUAL",
      "title": "质量手册",
      "customerCode": null,
      "category": "MANUAL",
      "origin": "CUSTOMER_REVISION",
      "customerSourceIds": [
        "C-STARTUP"
      ],
      "templateSourceIds": [
        "T-UPGRADE"
      ],
      "proposedOutputPath": "正文/质量手册.md",
      "attentionItemIds": [
        "U-ORG"
      ]
    },
    {
      "id": "F-ROLE",
      "title": "岗位职责制度",
      "customerCode": null,
      "category": "POLICY",
      "origin": "TEMPLATE_DERIVED",
      "customerSourceIds": [
        "C-STARTUP"
      ],
      "templateSourceIds": [
        "T-UPGRADE"
      ],
      "proposedOutputPath": "正文/岗位职责制度.md",
      "attentionItemIds": [
        "U-ROLE"
      ]
    }
  ],
  "templateCoverage": [
    {
      "templateSourceId": "T-UPGRADE",
      "disposition": "ADAPT_EXISTING",
      "customerSourceIds": [
        "C-STARTUP"
      ],
      "plannedFileIds": [
        "F-CORR",
        "F-PREV",
        "F-MANUAL",
        "F-ROLE"
      ],
      "explanation": "按功能对应，不能按模板数量等同交付数量。",
      "evidenceIds": [
        "E-MANAGEMENT",
        "E-TEMPLATE"
      ],
      "attentionItemIds": [
        "U-ORG",
        "U-ROLE"
      ]
    }
  ],
  "changes": [
    {
      "id": "CH-F-CORR",
      "title": "纠正措施程序适配",
      "action": "REVISE",
      "description": "按锁定规则适配，并保留企业现状。",
      "reason": "演示计划。",
      "targetPlannedFileIds": [
        "F-CORR"
      ],
      "evidenceIds": [
        "E-MANAGEMENT",
        "E-TEMPLATE"
      ],
      "protectedFactIds": [],
      "protectedImpact": "NONE_DECLARED",
      "attentionItemIds": [],
      "dependsOnChangeIds": [],
      "legacyLabels": []
    },
    {
      "id": "CH-F-PREV",
      "title": "预防措施程序适配",
      "action": "REVISE",
      "description": "按锁定规则适配，并保留企业现状。",
      "reason": "演示计划。",
      "targetPlannedFileIds": [
        "F-PREV"
      ],
      "evidenceIds": [
        "E-MANAGEMENT",
        "E-TEMPLATE"
      ],
      "protectedFactIds": [],
      "protectedImpact": "NONE_DECLARED",
      "attentionItemIds": [],
      "dependsOnChangeIds": [],
      "legacyLabels": []
    },
    {
      "id": "CH-F-MANUAL",
      "title": "质量手册适配",
      "action": "REVISE",
      "description": "按锁定规则适配，并保留企业现状。",
      "reason": "演示计划。",
      "targetPlannedFileIds": [
        "F-MANUAL"
      ],
      "evidenceIds": [
        "E-MANAGEMENT",
        "E-TEMPLATE"
      ],
      "protectedFactIds": [],
      "protectedImpact": "NONE_DECLARED",
      "attentionItemIds": [
        "U-ORG"
      ],
      "dependsOnChangeIds": [],
      "legacyLabels": []
    },
    {
      "id": "CH-F-ROLE",
      "title": "岗位职责制度适配",
      "action": "REVISE",
      "description": "按锁定规则适配，并保留企业现状。",
      "reason": "演示计划。",
      "targetPlannedFileIds": [
        "F-ROLE"
      ],
      "evidenceIds": [
        "E-MANAGEMENT",
        "E-TEMPLATE"
      ],
      "protectedFactIds": [
        "P-ORG"
      ],
      "protectedImpact": "POTENTIAL",
      "attentionItemIds": [
        "U-ROLE"
      ],
      "dependsOnChangeIds": [],
      "legacyLabels": []
    }
  ],
  "checks": [],
  "startupCandidates": [
    {
      "candidateId": "SC-POLICY",
      "kind": "ENTERPRISE_FACT",
      "title": "质量方针",
      "valueState": "EVIDENCED",
      "value": {
        "factType": "demo.quality_policy",
        "value": {
          "format": "TEXT",
          "text": "在确认的产品范围内，持续满足客户要求，并改进质量管理体系的有效性。"
        },
        "riskLevel": "demo.risk_high"
      },
      "evidenceIds": [
        "E-POLICY"
      ],
      "reason": "按客户依据保留现状，等待顾问确认。",
      "relatedAttentionItemIds": [],
      "missingFields": [],
      "conflictingFields": [],
      "alternatives": []
    },
    {
      "candidateId": "SC-PRODUCT",
      "kind": "PRODUCT",
      "title": "系列甲产品范围",
      "valueState": "EVIDENCED",
      "value": {
        "productType": "demo.device",
        "displayName": "系列甲",
        "intendedUse": "示例用途，限合同样例。",
        "productScope": {
          "productFamily": "示例产品族",
          "variants": [
            "甲一",
            "甲二"
          ],
          "markets": [
            "demo.market_cn"
          ]
        }
      },
      "evidenceIds": [
        "E-PRODUCT"
      ],
      "reason": "按客户依据保留现状，等待顾问确认。",
      "relatedAttentionItemIds": [],
      "missingFields": [],
      "conflictingFields": [],
      "alternatives": []
    },
    {
      "candidateId": "SC-MANAGEMENT",
      "kind": "QMS_MANAGEMENT_CHOICE",
      "title": "保留两份独立程序",
      "valueState": "EVIDENCED",
      "value": {
        "choiceKey": "demo.capa_organization",
        "selectedOption": "纠正措施与预防措施使用两份独立程序，分别保持现行审批流程。",
        "rationale": "按现行客户文件保持分立。"
      },
      "evidenceIds": [
        "E-MANAGEMENT"
      ],
      "reason": "按客户依据保留现状，等待顾问确认。",
      "relatedAttentionItemIds": [],
      "missingFields": [],
      "conflictingFields": [],
      "alternatives": []
    },
    {
      "candidateId": "SC-APPLICABILITY",
      "kind": "QMS_APPLICABILITY",
      "title": "职责条款适用性建议",
      "valueState": "EVIDENCED",
      "value": {
        "requirementSourceId": "T-UPGRADE",
        "requirementLocator": "职责与组织",
        "outcome": "APPLICABLE",
        "rationale": "客户有现行体系，需要补齐企业依据。"
      },
      "evidenceIds": [
        "E-ORG",
        "E-TEMPLATE"
      ],
      "reason": "按客户依据保留现状，等待顾问确认。",
      "relatedAttentionItemIds": [],
      "missingFields": [],
      "conflictingFields": [],
      "alternatives": []
    },
    {
      "candidateId": "SC-SOFTWARE",
      "kind": "QMS_APPLICABILITY",
      "title": "软件适用性待补充",
      "valueState": "UNKNOWN",
      "value": {
        "requirementSourceId": "T-UPGRADE",
        "requirementLocator": "软件适用性",
        "rationale": "缺软件事实，不能判断不适用。"
      },
      "evidenceIds": [
        "E-TEMPLATE"
      ],
      "reason": "按客户依据保留现状，等待顾问确认。",
      "relatedAttentionItemIds": [
        "U-SOFTWARE"
      ],
      "missingFields": [
        "outcome"
      ],
      "conflictingFields": [],
      "alternatives": []
    },
    {
      "candidateId": "SC-PROFESSIONAL",
      "kind": "QMS_PROFESSIONAL_DECISION",
      "title": "保持现行流程的判断建议",
      "valueState": "EVIDENCED",
      "value": {
        "decisionType": "demo.preserve_process",
        "outcome": "保持现行流程",
        "rationale": "按客户依据保留两份程序及各自审批流程。"
      },
      "evidenceIds": [
        "E-MANAGEMENT"
      ],
      "reason": "按客户依据保留现状，等待顾问确认。",
      "relatedAttentionItemIds": [],
      "missingFields": [],
      "conflictingFields": [],
      "alternatives": []
    }
  ]
}
```

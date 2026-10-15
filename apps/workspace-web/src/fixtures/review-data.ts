// Synthetic content for the development review workspace (#286). No customer
// document, no Runner output and no registered hash is used or claimed here.
import type { MarkdownReviewData } from '../MarkdownReviewPage.js';
import type { Change, Document, ReviewContent, Unit } from '../trusted/markdown.js';

const scope = { enterpriseId: 'DEMO-ENTERPRISE-01', projectId: 'DEMO-PROJECT-01' };

/** Approved 36-change/9-chapter synthetic scenario (multiple-changes prototype). */
export const chapterChanges: readonly (readonly [
  string,
  readonly (readonly [string, string, string])[],
])[] = [
  [
    '1 目的与适用范围',
    [
      ['目的表述', '本程序用于预防措施管理。', '本程序用于预防措施管理，文件与记录分别维护。'],
      ['适用范围', '适用于预防措施。', '适用于预防措施的识别、评估、实施与效果验证。'],
      [
        '与纠正措施的区别',
        '按相关程序执行。',
        '预防措施与纠正措施分别执行，关联事项保留交叉引用。',
      ],
      ['术语说明', '潜在问题按本程序处理。', '“潜在问题”指尚未发生、但已有识别依据的问题。'],
    ],
  ],
  [
    '2 企业现有职责',
    [
      [
        '职责来源说明',
        '职责按企业现行安排执行。',
        '职责按企业现行安排执行；本次整理不采用模板中的示例岗位替换。',
      ],
      ['部门名称核对', '使用现行部门名称。', '使用客户文件中的现行部门名称，引用处保持一致。'],
      ['汇报关系说明', '汇报关系保持不变。', '汇报关系保持不变；仅补充现有组织文件的引用位置。'],
      ['签批角色保留', '按原有角色签批。', '按原有角色签批，空白签字栏不得预填。'],
    ],
  ],
  [
    '3 信息来源',
    [
      ['客户反馈来源', '收集反馈信息。', '收集已有客户反馈信息，并保留来源文件与记录编号。'],
      ['内部记录引用', '查阅内部记录。', '查阅内部已有记录；缺失记录列入待补资料。'],
      ['历史数据时间范围', '使用历史数据。', '使用客户提供的历史数据，并注明数据所属时间范围。'],
      ['资料缺失说明', '资料不足时补充。', '资料不足时记录缺口，不以模板示例替代客户事实。'],
    ],
  ],
  [
    '4 潜在问题识别',
    [
      ['识别依据', '依据资料识别问题。', '依据已提供资料识别潜在问题，关联到具体来源位置。'],
      ['问题描述字段', '填写问题描述。', '填写问题描述、来源与影响范围；无依据内容保持待确认。'],
      [
        '产品流程边界',
        '遵循产品流程。',
        '遵循企业现有产品流程，本次整理不改变产品相关工艺与规定。',
      ],
      ['关联文件说明', '查看相关文件。', '查看相关文件并保留引用；存在关联不等于授权修改。'],
    ],
  ],
  [
    '5 评估与确定措施',
    [
      ['评估记录引用', '记录评估过程。', '在现有评估记录中保留问题、依据与结论的对应关系。'],
      ['措施描述格式', '列明措施。', '按现有记录格式列明措施，缺失字段标注待补。'],
      [
        '责任安排引用',
        '按现有安排确定责任。',
        '按现有安排确定责任，并引用现行职责文件；不新增岗位。',
      ],
      ['计划时间填写', '确定计划时间。', '计划时间由实际安排填写；模板日期不作为客户计划。'],
    ],
  ],
  [
    '6 实施与跟踪',
    [
      ['实施记录来源', '保留实施记录。', '保留企业已有实施记录，并注明本程序对应位置。'],
      ['进展说明字段', '记录实施进展。', '记录已有实施进展；未知状态标注待确认，不推定已完成。'],
      ['配套文件编号', '注明相关编号。', '注明配套文件原有编号；编号更新时保留原编号对应关系。'],
      ['异常情况记录', '记录异常情况。', '记录异常情况与现有处置依据，缺少依据时提出补充请求。'],
    ],
  ],
  [
    '7 效果验证',
    [
      ['验证记录关联', '保存验证记录。', '保存已有验证记录，并关联到相应预防措施。'],
      ['验证结果表述', '记录验证结果。', '按真实记录表述验证结果；文档升级不等于措施已有效。'],
      ['待验证情况', '必要时继续验证。', '尚未验证的事项保持待验证，不从模板复制通过结论。'],
      ['签字与日期空白', '填写签字日期。', '签字与日期由实际执行人员填写；现有空白继续保留。'],
    ],
  ],
  [
    '8 相关文件与记录',
    [
      ['记录编号显示', '使用预防措施记录。', '使用企业现有预防措施记录，并显示其原编号。'],
      ['程序引用名称', '参照纠正措施程序。', '参照企业现有纠正措施程序，保留准确的名称与版本。'],
      ['归档路径说明', '按规定归档。', '按企业现行规定归档，注明原有文件类别。'],
      ['客户资料追溯', '保存资料。', '保存客户提供的资料原件与来源信息，便于核对。'],
    ],
  ],
  [
    '9 修订与文件控制',
    [
      ['修订记录说明', '记录文件修订。', '记录本次文本整理的位置，便于顾问逐处核对。'],
      ['版本标识格式', '更新版本号。', '版本标识统一显示；正式生效仍依企业现行文件控制程序。'],
      ['历史版本保留', '保存旧版本。', '保留旧版本及对应改稿，不直接覆盖已批准文件。'],
      ['交付说明', '整理后提供文件。', '整理稿需检查与批准，下载本身不表示已生效或客户已收到。'],
    ],
  ],
];

/** Deterministic synthetic digest; never a registered content hash. */
export function digestFor(value: string): string {
  let state = 2166136261;
  let output = '';
  for (let index = 0; index < 32; index++) {
    state = ((state ^ value.charCodeAt(index % value.length)) * 16777619) >>> 0;
    output += state.toString(16).padStart(8, '0');
  }
  return output;
}

function unit(input: {
  unitId: string;
  unitType: Unit['unitType'];
  text?: string;
  headingLevel?: number;
  parentUnitId?: string;
  children?: Unit[];
  ordinal: number;
}): Unit {
  return {
    unitId: input.unitId,
    unitType: input.unitType,
    ordinal: input.ordinal,
    childUnitIds: (input.children ?? []).map((child) => child.unitId),
    ...(input.text !== undefined ? { text: input.text } : {}),
    ...(input.parentUnitId !== undefined ? { parentUnitId: input.parentUnitId } : {}),
    semanticMetadata: {
      markdown:
        input.headingLevel !== undefined
          ? { headingLevel: input.headingLevel }
          : { blockKind: 'PARAGRAPH' },
    },
  };
}

/** Twelve-column table with an empty cell and a zero value, kept losslessly. */
function wideTable(input: { revisionId: string; parentUnitId: string; units: Unit[] }): Unit {
  const headers = [
    '项目',
    '要求',
    '依据',
    '责任',
    '频次',
    '记录',
    '阈值',
    '状态',
    '备注',
    '来源',
    '复核',
    '末列',
  ];
  const values = [
    '0',
    '',
    '保留',
    '3',
    '每年',
    'QR-1',
    '0',
    '待确认',
    '',
    '现行',
    '10',
    '最后一列完整',
  ];
  const tableId = `${input.revisionId}-table`;
  const row = (rowId: string, texts: readonly string[]) => {
    const cells = texts.map((text, index) =>
      unit({
        unitId: `${rowId}-cell-${index + 1}`,
        unitType: 'TABLE_CELL',
        text,
        ordinal: index,
        parentUnitId: rowId,
      }),
    );
    input.units.push(...cells);
    return unit({
      unitId: rowId,
      unitType: 'TABLE_ROW',
      ordinal: rowId.endsWith('header') ? 0 : 1,
      parentUnitId: tableId,
      children: cells,
    });
  };
  const headerRow = row(`${tableId}-header`, headers);
  const bodyRow = row(`${tableId}-body`, values);
  const table = unit({
    unitId: tableId,
    unitType: 'TABLE',
    ordinal: 0,
    parentUnitId: input.parentUnitId,
    children: [headerRow, bodyRow],
  });
  input.units.push(headerRow, bodyRow, table);
  return table;
}

function changeKindOf(chapterIndex: number, rowIndex: number): Change['kind'] {
  if (chapterIndex === 0 && rowIndex === 3) return 'ADDED';
  if (chapterIndex === 7 && rowIndex === 3) return 'REMOVED';
  if (chapterIndex === 8 && rowIndex === 2) return 'MOVED';
  return 'CHANGED';
}

interface SideInput {
  revisionId: string;
  side: 'before' | 'after';
  appendedNote?: string;
}

function sideUnits(input: SideInput): { units: Unit[] } {
  const units: Unit[] = [];
  const row = (input2: {
    rowId: string;
    title: string;
    text: string;
    ordinal: number;
    parentUnitId: string;
  }): Unit => {
    const text = unit({
      unitId: `${input2.rowId}-text`,
      unitType: 'PARAGRAPH',
      text: input2.text,
      ordinal: 0,
      parentUnitId: input2.rowId,
    });
    const section = unit({
      unitId: input2.rowId,
      unitType: 'SECTION',
      text: input2.title,
      headingLevel: 2,
      ordinal: input2.ordinal,
      parentUnitId: input2.parentUnitId,
      children: [text],
    });
    units.push(text, section);
    return section;
  };
  chapterChanges.forEach(([chapter, changes], chapterIndex) => {
    const sectionId = `${input.revisionId}-${input.side}-chapter-${chapterIndex + 1}`;
    const children: Unit[] = [];
    changes.forEach(([title, before, after], rowIndex) => {
      const kind = changeKindOf(chapterIndex, rowIndex);
      if (kind === 'ADDED' && input.side === 'before') return;
      if (kind === 'REMOVED' && input.side === 'after') return;
      children.push(
        row({
          rowId: `${input.revisionId}-${input.side}-row-${chapterIndex + 1}-${rowIndex + 1}`,
          title,
          text: input.side === 'before' ? before : after,
          ordinal: rowIndex,
          parentUnitId: sectionId,
        }),
      );
    });
    if (chapterIndex === 6 && input.side === 'after')
      children.push(wideTable({ revisionId: input.revisionId, parentUnitId: sectionId, units }));
    if (chapterIndex === 8 && input.side === 'after' && input.appendedNote)
      children.push(
        row({
          rowId: `${input.revisionId}-after-appended`,
          title: '本轮补充核对说明',
          text: input.appendedNote,
          ordinal: 4,
          parentUnitId: sectionId,
        }),
      );
    units.push(
      unit({
        unitId: sectionId,
        unitType: 'SECTION',
        text: chapter,
        headingLevel: 1,
        ordinal: chapterIndex,
        children,
      }),
    );
  });
  return { units };
}

export function reviewContent(input: SideInput & { title?: string }): ReviewContent {
  const built = sideUnits(input);
  const digest = digestFor(input.revisionId);
  const hash = { algorithm: 'SHA-256' as const, digest, canonicalizationVersion: '1' as const };
  return {
    revisionRef: {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'artifact.artifact_revision',
      objectId: input.revisionId,
      scope,
      contentHash: hash,
    },
    canonicalContentHash: hash,
    document: {
      documentId: `${input.revisionId}-${input.side}`,
      title: input.title ?? '预防措施程序（合成）',
      units: built.units,
    },
    authoritativeIdentityMap: {
      artifactRef: {
        kind: 'OBJECT',
        objectType: 'artifact.artifact',
        objectId: 'DEMO-WS-ARTIFACT',
        scope,
      },
    },
    currentUsability: 'USABLE',
  };
}

/** Builds the 36-change workspace candidate or its returned successor. */
export function workspaceCandidate(input: {
  revisionId: string;
  appendedNote?: string;
  before?: ReviewContent;
  /** A returned candidate carries only the newly appended change. */
  onlyAppended?: boolean;
}): MarkdownReviewData {
  const content = reviewContent({
    revisionId: input.revisionId,
    side: 'after',
    ...(input.appendedNote ? { appendedNote: input.appendedNote } : {}),
  });
  const before =
    input.before ?? reviewContent({ revisionId: `${input.revisionId}-BASE`, side: 'before' });
  const beforeRows = [...before.document.units];
  const changes: Change[] = [];
  if (!input.onlyAppended)
    chapterChanges.forEach(([, chapterRows], chapterIndex) => {
      const chapterId = requiredValue(
        content.document.units.find((entry) => entry.unitId.endsWith(`chapter-${chapterIndex + 1}`))
          ?.unitId,
      );
      chapterRows.forEach(([, , afterText], rowIndex) => {
        const kind = changeKindOf(chapterIndex, rowIndex);
        if (!afterText) return;
        const afterUnit = content.document.units.find((entry) =>
          entry.unitId.endsWith(`after-row-${chapterIndex + 1}-${rowIndex + 1}`),
        );
        const beforeUnit =
          kind === 'ADDED'
            ? undefined
            : beforeRows.find((entry) =>
                new RegExp(`-(?:before|after)-row-${chapterIndex + 1}-${rowIndex + 1}$`, 'u').test(
                  entry.unitId,
                ),
              );
        const afterValue =
          kind === 'REMOVED'
            ? undefined
            : kind === 'MOVED'
              ? afterUnit && { ...afterUnit, unitId: `${input.revisionId}-after-unresolved` }
              : afterUnit;
        const beforeValue = kind === 'ADDED' ? undefined : beforeUnit;
        if (!afterValue && !beforeValue) return;
        changes.push({
          changeId: {
            algorithm: 'SHA-256',
            digest: digestFor(`${input.revisionId}:${chapterIndex}:${rowIndex}`),
            canonicalizationVersion: '1',
          },
          unitId: afterValue?.unitId ?? requiredValue(beforeValue).unitId,
          kind,
          ...(beforeValue ? { beforeValue } : {}),
          ...(afterValue ? { afterValue } : {}),
          chapterUnitIds: [chapterId],
          contextUnitIds: [chapterId],
        });
      });
    });
  if (input.appendedNote) {
    const appended = requiredValue(
      content.document.units.find((entry) => entry.unitId.endsWith('after-appended')),
    );
    changes.push({
      changeId: {
        algorithm: 'SHA-256',
        digest: digestFor(`${input.revisionId}:appended`),
        canonicalizationVersion: '1',
      },
      unitId: appended.unitId,
      kind: 'ADDED',
      afterValue: appended,
      chapterUnitIds: [
        requiredValue(
          content.document.units.find((entry) => entry.unitId.endsWith('chapter-9'))?.unitId,
        ),
      ],
      contextUnitIds: [
        requiredValue(
          content.document.units.find((entry) => entry.unitId.endsWith('chapter-9'))?.unitId,
        ),
      ],
    });
  }
  return {
    content,
    before,
    changes: {
      exactInputs: {
        toRevisionRef: content.revisionRef,
        fromRevisionRef: before.revisionRef,
        baselineKind: 'REVISION',
      },
      diffHash: {
        algorithm: 'SHA-256',
        digest: digestFor(`diff:${input.revisionId}`),
        canonicalizationVersion: '1',
      },
      totalChanges: changes.length,
      changedUnitCount: changes.length,
      filteredChanges: changes.length,
      chapterGroups: chapterChanges.map(([chapter], chapterIndex) => {
        const chapterId = requiredValue(
          content.document.units.find((entry) =>
            entry.unitId.endsWith(`chapter-${chapterIndex + 1}`),
          )?.unitId,
        );
        return {
          unitId: chapterId,
          title: chapter,
          changeCount: changes.filter((entry) => entry.chapterUnitIds.includes(chapterId)).length,
        };
      }),
      entries: changes,
    },
  };
}

/** Second review-ready candidate in the synthetic directory. */
export function manualCandidate(revisionId: string): MarkdownReviewData {
  const content = reviewContent({ revisionId, side: 'after', title: '质量手册（合成）' });
  const sectionId = `${revisionId}-section`;
  const paragraph = unit({
    unitId: `${revisionId}-note`,
    unitType: 'PARAGRAPH',
    text:
      '合成候选：质量手册整理稿，仅用于开发示例，不来自客户文件或 Runner。' +
      '参见 [外部链接](https://example.invalid/) 与 <a href="javascript:alert(1)">原始说明</a>；' +
      '两者都按文本显示，不生成链接或可执行内容。',
    ordinal: 0,
    parentUnitId: sectionId,
  });
  const section = unit({
    unitId: sectionId,
    unitType: 'SECTION',
    text: '1 质量方针与适用范围',
    headingLevel: 1,
    ordinal: 0,
    children: [paragraph],
  });
  const document: Document = { ...content.document, units: [paragraph, section] };
  return {
    content: { ...content, document },
    changes: {
      exactInputs: { toRevisionRef: content.revisionRef, baselineKind: 'EMPTY_INITIAL' },
      diffHash: {
        algorithm: 'SHA-256',
        digest: digestFor(`diff:${revisionId}`),
        canonicalizationVersion: '1',
      },
      totalChanges: 1,
      changedUnitCount: 1,
      filteredChanges: 1,
      chapterGroups: [
        { unitId: section.unitId, title: section.text ?? '1 质量方针与适用范围', changeCount: 1 },
      ],
      entries: [
        {
          changeId: {
            algorithm: 'SHA-256',
            digest: digestFor(`${revisionId}:change`),
            canonicalizationVersion: '1',
          },
          unitId: paragraph.unitId,
          kind: 'ADDED',
          afterValue: paragraph,
          chapterUnitIds: [section.unitId],
          contextUnitIds: [section.unitId],
        },
      ],
    },
  };
}

function requiredValue<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('Missing review fixture binding');
  return value;
}

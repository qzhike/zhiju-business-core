import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { readExactQuery } from '../trusted/client.js';
import { asRecord } from '../trusted/values.js';
import { isUuidV7 } from '../trusted/identity.js';
import { preparationHref } from '../intake/live-client.js';
import { usePageChain } from '../trusted/hooks.js';
import type { LiveGuard, ReadBoundary } from '../trusted/guard.js';
import {
  DIRECTORY_OPERATION,
  DIRECTORY_SCOPE_KEY,
  OPERATION_VERSION,
  PROJECT_BOARD_OPERATION,
  TASK_BOARD_OPERATION,
  buildDirectoryQueryInput,
  buildProjectBoardQueryInput,
  buildTaskBoardQueryInput,
  parseDirectoryPage,
  parseProjectBoardPage,
  parseTaskBoardPage,
  type DirectoryCard,
  type DirectoryQueryArgs,
  type BoardRow,
} from '../trusted/protocol.js';
import { Workbench } from './Workbench.js';
import { boardCards, chainNotice, directoryProject } from './trusted-adapter.js';
import type { PageChain } from '../trusted/hooks.js';

export interface TrustedProps {
  sessionGeneration: string;
  principalId: string;
  csrfToken: string;
  generation: number;
  guardRef: { readonly current: LiveGuard };
  readBoundary: ReadBoundary;
  onSessionFailure: () => void;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}
const cardKey = (card: DirectoryCard) => card.key;
const rowKey = (row: BoardRow) => row.key;

export function TrustedWorkbench(props: TrustedProps) {
  const directory = usePageChain<DirectoryCard>({
    ...props,
    operation: DIRECTORY_OPERATION,
    version: OPERATION_VERSION,
    scopeKey: DIRECTORY_SCOPE_KEY,
    enabled: true,
    buildBody: buildDirectoryQueryInput,
    parsePage: parseDirectoryPage,
    keyOf: cardKey,
  });
  return <SelectedWorkbench key={props.selectedKey ?? 'all'} {...props} directory={directory} />;
}

function SelectedWorkbench({
  directory,
  ...props
}: TrustedProps & { directory: PageChain<DirectoryCard> }) {
  const readable = directory.state.dataState === 'READY';
  const selected = readable
    ? directory.state.items.find((card) => card.key === props.selectedKey)
    : undefined;
  const shared = {
    ...props,
    version: OPERATION_VERSION,
    scopeKey: selected?.key ?? DIRECTORY_SCOPE_KEY,
    enabled: selected !== undefined,
    keyOf: rowKey,
  };
  const buildDelivery = useMemo(
    () => (args: DirectoryQueryArgs) => {
      if (!selected) throw new Error('UI_CLIENT_STATE_INVALID');
      return buildProjectBoardQueryInput({ ...args, card: selected });
    },
    [selected],
  );
  const buildTasks = useMemo(
    () => (args: DirectoryQueryArgs) => {
      if (!selected) throw new Error('UI_CLIENT_STATE_INVALID');
      return buildTaskBoardQueryInput({ ...args, card: selected });
    },
    [selected],
  );
  const delivery = usePageChain<BoardRow>({
    ...shared,
    operation: PROJECT_BOARD_OPERATION,
    buildBody: buildDelivery,
    parsePage: parseProjectBoardPage,
  });
  const tasks = usePageChain<BoardRow>({
    ...shared,
    enabled: selected !== undefined && selected.status !== 'PREPARING',
    operation: TASK_BOARD_OPERATION,
    buildBody: buildTasks,
    parsePage: parseTaskBoardPage,
  });
  const projects = readable
    ? directory.state.items.map((card) => {
        const project = directoryProject(card);
        if (card.key === selected?.key) {
          project.progress = `交付项${delivery.state.dataState === 'READY' || delivery.state.dataState === 'EMPTY' ? `已读取 ${delivery.state.items.length} 条` : '未读取'} · 任务${tasks.state.dataState === 'READY' || tasks.state.dataState === 'EMPTY' ? `已读取 ${tasks.state.items.length} 条` : '未读取'}`;
        }
        return project;
      })
    : [];
  return (
    <Workbench
      controls={
        selected?.status === 'PREPARING' ? (
          <PreparationRecovery
            key={`${props.sessionGeneration}:${selected.key}`}
            {...props}
            card={selected}
          />
        ) : undefined
      }
      projects={projects}
      selectedKey={props.selectedKey}
      onSelect={props.onSelect}
      directory={chainNotice('directory', '授权项目', directory, true)}
      sources={
        selected
          ? [
              chainNotice('delivery', '交付项看板（EP）', delivery),
              ...(selected.status === 'PREPARING'
                ? []
                : [chainNotice('tasks', '任务看板（TE）', tasks)]),
            ]
          : []
      }
      cards={
        selected
          ? [
              ...boardCards(selected, delivery, 'delivery-item'),
              ...boardCards(selected, tasks, 'task'),
            ]
          : []
      }
      coverage={
        selected
          ? '仅所选项目的已读取工作 · 交付项与任务分别计数。报告与候选读取尚不可用，卡片数量不是文件数或项目完成度。'
          : '选择一个项目查看当前授权的工作。尚无跨项目工作汇总，未合计全部项目的待办或完成数量。'
      }
    />
  );
}

/** Optional owning board metadata is read under the same live Human session. */
function PreparationRecovery(props: TrustedProps & { card: DirectoryCard }) {
  const [href, setHref] = useState<string | null>(null);
  const { card, csrfToken, generation, principalId, guardRef, onSessionFailure } = props;
  useEffect(() => {
    const abort = new AbortController();
    setHref(null);
    const read = async () => {
      const result = asRecord(
        await readExactQuery(
          PROJECT_BOARD_OPERATION,
          { enterpriseId: card.enterpriseId, projectId: card.projectId },
          { projectRef: card.projectRef, statuses: [], itemTypes: [], page: { pageSize: 1 } },
          csrfToken,
          abort.signal,
        ),
      );
      if (
        abort.signal.aborted ||
        guardRef.current.generation !== generation ||
        guardRef.current.principalId !== principalId
      )
        return;
      const entry = asRecord(result?.preparationEntry);
      const ref = asRecord(entry?.preparationRequestRef);
      const scope = asRecord(ref?.scope);
      if (
        ref?.objectType === 'zhiju.project.preparation_request' &&
        isUuidV7(String(ref.objectId)) &&
        scope?.enterpriseId === card.enterpriseId &&
        scope.projectId === card.projectId &&
        entry?.originalPreparationKey ===
          `project.request_project_preparation:1.0:${String(ref.objectId)}`
      )
        setHref(
          preparationHref(String(ref.objectId), {
            enterpriseId: card.enterpriseId,
            projectId: card.projectId,
          }),
        );
    };
    void read().catch(() => {
      /* Missing recovery permission never creates a replacement request. */
    });
    return () => {
      abort.abort();
    };
  }, [card, csrfToken, generation, principalId, guardRef, onSessionFailure]);
  return href ? <Link to={href}>查看原准备请求与资料接纳状态</Link> : null;
}

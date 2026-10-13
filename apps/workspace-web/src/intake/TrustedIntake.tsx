import { usePageChain } from '../trusted/hooks.js';
import {
  DIRECTORY_OPERATION,
  DIRECTORY_SCOPE_KEY,
  OPERATION_VERSION,
  buildDirectoryQueryInput,
  parseDirectoryPage,
  type DirectoryCard,
} from '../trusted/protocol.js';
import type { TrustedProps } from '../workbench/TrustedWorkbench.js';
import { chainNotice } from '../workbench/trusted-adapter.js';
import { IntakePage } from './Pages.js';
const keyOf = (card: DirectoryCard) => card.key;
const receipts = new Map();
export function TrustedIntake(props: Omit<TrustedProps, 'selectedKey' | 'onSelect'>) {
  const directory = usePageChain<DirectoryCard>({
    ...props,
    operation: DIRECTORY_OPERATION,
    version: OPERATION_VERSION,
    scopeKey: DIRECTORY_SCOPE_KEY,
    enabled: true,
    buildBody: buildDirectoryQueryInput,
    parsePage: parseDirectoryPage,
    keyOf,
  });
  const notice = chainNotice('directory', '授权项目', directory, true);
  return (
    <IntakePage
      projects={
        directory.state.dataState === 'READY'
          ? directory.state.items.map((card) => ({
              id: card.projectId,
              title: card.title,
              customer: {
                id: card.enterpriseId,
                name: card.enterpriseDisplayName,
                code: card.displayCode,
              },
            }))
          : []
      }
      receipts={receipts}
      unavailable="ZIP 接收与分析公开操作尚未注册，当前不能上传或开始分析。"
      directoryNotice={
        <div role="status">
          <p>
            {notice.title} · {notice.detail}
          </p>
          {notice.warning && <p>{notice.warning}</p>}
          {notice.action && <button onClick={notice.action.run}>{notice.action.label}</button>}
        </div>
      }
    />
  );
}

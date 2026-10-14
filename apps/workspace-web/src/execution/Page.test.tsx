import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router';
import { WorkbenchNavigation } from '../workbench/navigation.js';
import { ExecutionNavigation, ExecutionPage, type ExecutionPageProps } from './Page.js';
import type { ExecutionRound } from './model.js';
const round: ExecutionRound = {
  projectId: 'project',
  requestId: 'request',
  label: '第 1 轮',
  reportId: 'report',
  reportVersion: 1,
  confirmedFileIds: ['file'],
  files: [
    {
      id: 'file',
      title: '程序',
      code: 'CX-01',
      state: 'FAILED',
      update: '处理失败',
      updatedAt: 'time',
      failure: '源读取失败',
      failures: ['原运行失败'],
      retryAllowed: true,
    },
  ],
  summary: '摘要',
  logs: ['日志'],
};
function markup(props: ExecutionPageProps) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/projects/project/executions/request']}>
      <WorkbenchNavigation>
        <ExecutionNavigation>
          <Routes>
            <Route
              path="/projects/:projectId/executions/:requestId"
              element={<ExecutionPage {...props} />}
            />
          </Routes>
        </ExecutionNavigation>
      </WorkbenchNavigation>
    </MemoryRouter>,
  );
}
describe('execution page boundaries', () => {
  it('never offers retry without an adapter even when the file permission is supplied', () => {
    const html = markup({ rounds: [round] });
    expect(html).toContain('失败原因：源读取失败');
    expect(html).toContain('重试能力尚未接入');
    expect(html).not.toContain('重新处理本文件');
  });
  it('removes all supplied file information when access expires', () => {
    const html = markup({ rounds: [round], phase: 'EXPIRED' });
    expect(html).toContain('访问已失效');
    expect(html).not.toContain('CX-01');
    expect(html).not.toContain('源读取失败');
  });
  it('does not substitute fixture inputs when production capability is unavailable', () => {
    const html = markup({ rounds: [], phase: 'UNAVAILABLE', reason: '尚未接入已授权进度读取' });
    expect(html).toContain('尚未接入');
    expect(html).not.toContain('DEMO-');
    expect(html).not.toContain('重新处理本文件');
  });
});

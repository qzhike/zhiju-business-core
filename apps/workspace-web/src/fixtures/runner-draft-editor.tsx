import { useRef } from 'react';
import { Button } from '../components/ui/button.js';
import { Label } from '../components/ui/label.js';
import { Textarea } from '../components/ui/textarea.js';
import {
  runnerDraftKey,
  type RunnerDraft,
  type RunnerDraftAction,
  type RunnerFlowProject,
} from './runner-flow-model.js';
import { useRunnerFlow } from './runner-flow-session.js';
import type { RunnerReadingPackage } from './runner-package.js';

export function RunnerDraftEditor({
  project,
  round,
  draft,
  id,
  label,
  readOnly,
}: {
  project: RunnerFlowProject;
  round: RunnerReadingPackage;
  draft: RunnerDraft;
  id: string;
  label: string;
  readOnly: boolean;
}) {
  const flow = useRunnerFlow();
  const editor = useRef<HTMLTextAreaElement>(null);
  const saved = project.drafts[runnerDraftKey(round, draft)];
  const value = saved?.text ?? '';
  const confirmed = saved?.confirmed === true;
  const act = (action: Exclude<RunnerDraftAction, 'write'>) => {
    flow.draftAction(project.id, round.manifestSha256, draft, action);
    requestAnimationFrame(() => editor.current?.focus({ preventScroll: true }));
  };
  return (
    <>
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        ref={editor}
        value={value}
        readOnly={readOnly || confirmed}
        aria-describedby={`${id}-status`}
        onChange={(event) => {
          flow.draft(project.id, round.manifestSha256, { ...draft, text: event.target.value });
        }}
      />
      {!readOnly && (
        <div
          className="runner-draft-actions"
          role="group"
          aria-label={draft.kind === 'ISSUE' ? '答复操作' : '意见操作'}
        >
          <Button
            disabled={!value.trim() || confirmed}
            onClick={() => {
              act('confirm');
            }}
          >
            提交
          </Button>
          <Button
            variant="outline"
            disabled={!confirmed}
            onClick={() => {
              act('modify');
            }}
          >
            修改
          </Button>
          <Button
            variant="ghost"
            disabled={!value.length}
            onClick={() => {
              act('clear');
            }}
          >
            清除
          </Button>
        </div>
      )}
      <p id={`${id}-status`} className="muted" role="status">
        {readOnly
          ? `历史内容${confirmed ? '（本次会话已确认）' : ''}，只读保留；尚未发送给 Runner。`
          : confirmed
            ? '本次会话已确认，尚未发送给 Runner。点击“修改”可继续编辑。'
            : '编辑内容保留在本次会话；“提交”仅确认此条内容，尚未发送给 Runner。'}
      </p>
    </>
  );
}

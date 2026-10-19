/* eslint-disable @typescript-eslint/require-await -- Controlled callbacks implement the asynchronous process port. */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runOmpProcess, verifyOmpStartup } from './omp-rpc-process.js';
const expected = {
  provider: 'test-provider',
  model: 'test-model',
  thinking: 'max' as const,
  instructionText: '公司固定指令：先读客户文件。',
};
const state = () => ({
  model: { provider: expected.provider, id: expected.model },
  thinkingLevel: 'max',
  messageCount: 0,
  isStreaming: false,
  hasPendingAsyncWork: false,
  autoCompactionEnabled: false,
  sessionId: 'isolated-test-session',
  systemPrompt: [expected.instructionText],
  dumpTools: ['read', 'grep', 'glob', 'write'].map((name) => ({ name })),
});
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
describe('OMP startup proof', () => {
  it('accepts the actual bounded tool surface and company instructions', () => {
    expect(verifyOmpStartup(state(), expected).sessionId).toBe('isolated-test-session');
  });
  it.each([
    { model: { provider: 'other', id: expected.model } },
    { thinkingLevel: 'high' },
    { messageCount: 1 },
    { isStreaming: true },
    { hasPendingAsyncWork: true },
    { autoCompactionEnabled: true },
    { systemPrompt: ['different instructions'] },
    { dumpTools: [...state().dumpTools, { name: 'bash' }] },
    { dumpTools: [{ name: 'read' }] },
  ])('rejects startup drift before a prompt: %j', (patch) => {
    expect(() => verifyOmpStartup({ ...state(), ...patch }, expected)).toThrow(
      'INTEGRATION_OMP_STARTUP_MISMATCH',
    );
  });
});
async function fixture(mode: string) {
  const root = await mkdtemp(join(tmpdir(), 'zhiju-omp-process-'));
  directories.push(root);
  const executable = join(root, 'fake-omp');
  await writeFile(
    executable,
    `#!${process.execPath}
` +
      String.raw`
const fs = require('node:fs');
const readline = require('node:readline');
const state = ${JSON.stringify(state())};
const mode = ${JSON.stringify(mode)};
const emit = value => process.stdout.write(JSON.stringify(value)+'\n');
readline.createInterface({input:process.stdin}).on('line', line => {
 const command = JSON.parse(line);
 if (command.type === 'get_state') {
   if (mode === 'wrong-tools') state.dumpTools.push({name:'bash'});
   const bytes=Buffer.from(JSON.stringify({type:'response',id:'startup',success:true,data:state})+'\n');
   // Split in the middle of a multibyte company-rule character.
   const split=bytes.indexOf(Buffer.from('公司'))+1;
   process.stdout.write(bytes.subarray(0,split));
   setTimeout(()=>process.stdout.write(bytes.subarray(split)),5);
 }
 if (command.type === 'prompt') {
   fs.writeFileSync(${JSON.stringify(join(root, 'prompt-observed'))},'one');
   emit({type:'response',id:'analysis',success:true});
   emit({type:'message_update',thinking:'PRIVATE_THINKING',content:'PRIVATE_CUSTOMER_TEXT'});
   emit({type:'tool_execution_start',toolCallId:'tool-1',toolName:'read',args:{path:'PRIVATE_CUSTOMER_PATH'},result:'PRIVATE_CUSTOMER_TEXT'});
   if (mode === 'exit-without-result') return process.exit(0);
   emit({type:'prompt_result',id:'analysis',status:mode==='provider-error'?'error':'completed',sessionSettled:mode!=='delayed-settle'});
   if(mode==='delayed-settle') setTimeout(()=>emit({type:'session_settled'}),20);
 }
});
`,
    { mode: 0o700 },
  );
  return root;
}
describe('one real process boundary with a test-only RPC peer', () => {
  it.each(['completed', 'delayed-settle', 'provider-error'])(
    'keeps invocation and outcome distinct: %s',
    async (mode) => {
      const root = await fixture(mode);
      let claims = 0,
        closures = 0;
      const result = await runOmpProcess({
        ...expected,
        executable: join(root, 'fake-omp'),
        cwd: root,
        overlayPath: join(root, 'overlay'),
        instructionPath: join(root, 'rules'),
        environment: { PATH: process.env.PATH },
        prompt: 'synthetic',
        eventFile: join(root, 'events'),
        deadline: Date.now() + 10000,
        beforePrompt: async () => {
          claims++;
        },
        processClosed: async () => {
          closures++;
        },
      });
      expect(claims).toBe(1);
      expect(closures).toBe(1);
      expect(result.promptStatus).toBe(mode === 'provider-error' ? 'error' : 'completed');
      expect(result.providerCancellationAcknowledged).toBe(false);
      expect(result.processStopped).toBe(true);
      expect(await readFile(join(root, 'prompt-observed'), 'utf8')).toBe('one');
      const journal = await readFile(join(root, 'events'), 'utf8');
      expect(journal).not.toContain('PRIVATE_');
      expect(journal).not.toContain(expected.instructionText);
      expect(journal).toContain('tool_execution_start');
      expect(journal).toContain('prompt_result');
    },
  );
  it('never sends a prompt after a startup mismatch', async () => {
    const root = await fixture('wrong-tools');
    let claims = 0;
    await expect(
      runOmpProcess({
        ...expected,
        executable: join(root, 'fake-omp'),
        cwd: root,
        overlayPath: 'overlay',
        instructionPath: 'rules',
        environment: { PATH: process.env.PATH },
        prompt: 'synthetic',
        eventFile: join(root, 'events'),
        deadline: Date.now() + 10000,
        beforePrompt: async () => {
          claims++;
        },
      }),
    ).rejects.toThrow('INTEGRATION_OMP_STARTUP_MISMATCH');
    expect(claims).toBe(0);
    await expect(readFile(join(root, 'prompt-observed'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('does not turn a zero process exit into a completed analysis', async () => {
    const root = await fixture('exit-without-result');
    await expect(
      runOmpProcess({
        ...expected,
        executable: join(root, 'fake-omp'),
        cwd: root,
        overlayPath: 'overlay',
        instructionPath: 'rules',
        environment: { PATH: process.env.PATH },
        prompt: 'synthetic',
        eventFile: join(root, 'events'),
        deadline: Date.now() + 10000,
        beforePrompt: async () => {
          /* No owning side effect in this process-exit test. */
        },
      }),
    ).rejects.toThrow('INTEGRATION_OMP_PROVIDER_UNKNOWN');
  });
});

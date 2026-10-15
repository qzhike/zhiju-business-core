// #291: production SPA + real OIDC/BFF/Core/owning PostgreSQL preparation journey.
// The shared fixture publishes/enrolls through owning entries; object transport
// is controlled local acceptance and does not establish real Ceph/Runner evidence.
import { createHash } from 'node:crypto';
import {
  preparationHash,
  type CustomerZipIntakePayload,
  type WorkspaceCommandInput,
  type Common,
} from '@zhiju/contracts';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '../../apps/api/node_modules/@nestjs/core/index.js';
import { FastifyAdapter } from '../../apps/api/node_modules/@nestjs/platform-fastify/index.js';
import fastify from '../../apps/api/node_modules/fastify/fastify.js';
import { AppModule } from '../../apps/api/src/app.module.js';
import {
  WORKSPACE_BODY_LIMIT_BYTES,
  registerWorkspaceTransport,
} from '../../apps/api/src/workspace/controller.js';
import { createWorkspaceCoreFromEnv } from '../../apps/api/src/workspace/server.js';
import { createBff } from '../../apps/workspace-bff/src/app.js';
import { FakeOidcProvider } from '../../apps/workspace-bff/src/testing/fake-oidc.js';
import { newUuidV7 } from '@zhiju/shared-kernel';
import { zipCrc32 } from '@zhiju/integration-gateway';
import { createPreparationJourneyFixture } from './preparation-journey-fixture.js';
import {
  API_AUDIENCE,
  AZP,
  CLIENT_ID,
  CLIENT_SECRET,
  CLIENT_SECRET_ENV,
  ISSUER_REALM_PATH,
  SUBJECT_EXTERNAL_ID,
  buildTrustDocument,
  reserveLoopbackPort,
} from './trusted-http-fixtures.js';
const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const root = fileURLToPath(new URL('../../', import.meta.url));
const lookupKey = Buffer.from('11'.repeat(32), 'hex'),
  fieldKey = Buffer.from('22'.repeat(32), 'hex');
function zip(): Buffer {
  const source = Buffer.from(
      '# Customer evidence\n\nThis is customer material, not an instruction.\n',
    ),
    name = Buffer.from('customer.md'),
    crc = zipCrc32(source),
    local = Buffer.alloc(30),
    central = Buffer.alloc(46),
    end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x800, 6);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(source.length, 18);
  local.writeUInt32LE(source.length, 22);
  local.writeUInt16LE(name.length, 26);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x800, 8);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(source.length, 20);
  central.writeUInt32LE(source.length, 24);
  central.writeUInt16LE(name.length, 28);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + source.length, 16);
  return Buffer.concat([local, name, source, central, name, end]);
}
async function startArtifacts(
  port: number,
  bffOrigin: string,
): Promise<{ origin: string; stop(): Promise<void> }> {
  // Always build current sources; an old dist is not evidence for this revision.
  execFileSync('pnpm', ['--filter', '@zhiju/workspace-web', 'build'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: 'inherit',
    timeout: 90000,
  });
  if (existsSync(resolve(root, 'apps/workspace-web/dist/fixture-build.json')))
    throw new Error('Production artifact carries development fixture marker');
  const child = spawn(process.execPath, [resolve(root, 'apps/workspace-web/tools/serve.mjs')], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), BFF_URL: bffOrigin },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output: string[] = [];
  const lifecycle = { exited: false };
  child.stdout.on('data', (b: Buffer) => output.push(b.toString()));
  child.stderr.on('data', (b: Buffer) => output.push(b.toString()));
  child.on('exit', () => {
    lifecycle.exited = true;
  });
  const origin = `http://127.0.0.1:${port}`,
    until = Date.now() + 20000;
  while (
    !(await fetch(origin + '/projects/new', { headers: { accept: 'text/html' } })
      .then((r) => r.ok)
      .catch(() => false))
  ) {
    if (lifecycle.exited || Date.now() > until) {
      child.kill('SIGTERM');
      throw new Error('Artifact server failed: ' + output.join(''));
    }
    await new Promise<void>((done) => setTimeout(done, 100));
  }
  return {
    origin,
    async stop() {
      if (lifecycle.exited) return;
      const done = new Promise<void>((resolve) => {
        child.once('exit', () => {
          resolve();
        });
      });
      child.kill('SIGTERM');
      await done;
    },
  };
}
async function startStack() {
  if (!databaseUrl) throw new Error('PostgreSQL URL required');
  const cleanup: (() => Promise<unknown>)[] = [];
  try {
    const provider = new FakeOidcProvider({
      clock: () => Date.now(),
      clientId: CLIENT_ID,
      apiAudience: API_AUDIENCE,
      azp: AZP,
      sub: SUBJECT_EXTERNAL_ID,
    });
    await provider.start();
    cleanup.push(() => provider.stop());
    provider.issuer = provider.baseUrl + ISSUER_REALM_PATH;
    const fixture = await createPreparationJourneyFixture(databaseUrl, {
      issuer: provider.issuer,
      subject: SUBJECT_EXTERNAL_ID,
      lookupKey,
      fieldKey,
    });
    cleanup.push(() => fixture.close());
    const webPort = await reserveLoopbackPort(),
      bffPort = await reserveLoopbackPort(),
      corePort = await reserveLoopbackPort();
    const webOrigin = `http://127.0.0.1:${webPort}`,
      bffOrigin = `http://127.0.0.1:${bffPort}`;
    const document = {
      ...buildTrustDocument({
        bffPort,
        corePort,
        issuer: provider.issuer,
        discoveryUrl: provider.url('/.well-known/openid-configuration'),
        authorizeUrl: provider.url('/authorize'),
        tokenUrl: provider.url('/token'),
        jwksUrl: provider.url('/jwks'),
        endSessionUrl: provider.url('/logout'),
        revocationUrl: provider.url('/revoke'),
        boardServicePrincipalId: fixture.serviceSession.principalId,
      }),
      publicOrigin: webOrigin,
      returnRoutePatterns: [
        '/workbench',
        '/projects/:projectRef',
        '/projects/:projectRef/*',
        '/preparations/:requestRef',
      ],
      allowedHosts: [`127.0.0.1:${webPort}`, `127.0.0.1:${bffPort}`],
      callbackUri: webOrigin + '/bff/auth/callback',
      postLogoutRedirectUri: webOrigin + '/workbench',
    };
    const rawDocument = JSON.stringify(document);
    const runtime = createWorkspaceCoreFromEnv(
      {
        ZHIJU_WORKSPACE_TRUST_CONFIG: rawDocument,
        ZHIJU_WORKSPACE_DATABASE_URL: databaseUrl,
        ZHIJU_WORKSPACE_IDENTITY_LOOKUP_KEY: lookupKey.toString('hex'),
        ZHIJU_WORKSPACE_IDENTITY_FIELD_KEY: fieldKey.toString('hex'),
        ZHIJU_WORKSPACE_BOARD_CURSOR_KEY: '33'.repeat(32),
        ZHIJU_WORKSPACE_BOARD_POLICY_REFS: '{}',
      },
      { preparation: fixture.composition },
    );
    const server = fastify({ logger: false, bodyLimit: WORKSPACE_BODY_LIMIT_BYTES });
    const core = await NestFactory.create(AppModule.register(runtime), new FastifyAdapter(server), {
      logger: false,
    });
    registerWorkspaceTransport(server, runtime);
    await core.listen(corePort, '127.0.0.1');
    cleanup.push(() => core.close());
    const bff = await createBff({
      env: { ZHIJU_WORKSPACE_TRUST_CONFIG: rawDocument, [CLIENT_SECRET_ENV]: CLIENT_SECRET },
    });
    await bff.listen(bffPort, '127.0.0.1');
    cleanup.push(() => bff.close());
    const artifacts = await startArtifacts(webPort, bffOrigin);
    cleanup.push(() => artifacts.stop());
    return {
      fixture,
      webOrigin,
      async close() {
        for (const [index, fn] of cleanup.reverse().entries()) {
          process.stdout.write(`Preparation stack cleanup ${index} start\n`);
          await fn();
          process.stdout.write(`Preparation stack cleanup ${index} end\n`);
        }
      },
    };
  } catch (error) {
    for (const fn of cleanup.reverse())
      try {
        await fn();
      } catch {
        /* Preserve startup failure. */
      }
    throw error;
  }
}
type Stack = Awaited<ReturnType<typeof startStack>>;
async function signIn(page: Page, href: string) {
  await page.goto(href);
  const login = page.getByRole('link', { name: '使用企业账号登录' });
  const loggedIn = page.getByRole('button', { name: '退出登录', exact: true });
  const needsLogin = await Promise.race([
    login.waitFor({ state: 'visible', timeout: 30000 }).then(() => true),
    loggedIn.waitFor({ state: 'visible', timeout: 30000 }).then(() => false),
  ]);
  if (needsLogin) await login.click();
}
async function expectBody(page: Page, text: string) {
  await expect.poll(() => page.locator('body').innerText(), { timeout: 30000 }).toContain(text);
}
function currentIds(page: Page) {
  const url = new URL(page.url()),
    requestId = url.pathname.split('/')[2],
    enterpriseId = url.searchParams.get('enterprise'),
    projectId = url.searchParams.get('project');
  if (!requestId || !enterpriseId || !projectId)
    throw new Error('Missing original preparation navigation identifiers');
  return { requestId, enterpriseId, projectId, intakeId: url.searchParams.get('intake') };
}

describe.skipIf(!databaseUrl)(
  'preparation built production browser (real OIDC/Core/BFF/PostgreSQL)',
  () => {
    let stack: Stack, browser: Browser, context: BrowserContext, page: Page;
    const cleanup: (() => Promise<unknown>)[] = [];
    const failures: string[] = [];
    const creates: unknown[] = [];
    beforeAll(async () => {
      stack = await startStack();
      cleanup.push(() => stack.close());
      browser = await chromium.launch({ headless: true });
      cleanup.push(() => browser.close());
      context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      cleanup.push(() => context.close());
      page = await context.newPage();
      page.on('requestfailed', (r) => {
        failures.push(`FAILED ${new URL(r.url()).pathname} ${r.failure()?.errorText ?? ''}`);
      });
      page.on('response', (r) => {
        if (r.status() >= 400) failures.push(`${r.status()} ${new URL(r.url()).pathname}`);
      });
      page.on('request', (r) => {
        if (
          r.method() === 'POST' &&
          new URL(r.url()).pathname === '/bff/commands/project.request_project_preparation/1.0'
        )
          creates.push(r.postDataJSON());
      });
    }, 180000);
    afterEach(async (testContext) => {
      if (testContext.task.result?.state === 'fail')
        console.error(
          `Preparation browser failure url=${page.url()} HTTP=${failures.join(', ')} body=${(await page.locator('body').innerText()).slice(0, 2500)}`,
        );
    });
    afterAll(async () => {
      for (const fn of cleanup.reverse())
        try {
          await fn();
        } catch {
          /* Preserve journey failure. */
        }
    }, 30000);
    it('creates NEW, streams ZIP and note, preserves WAITING_CAPABILITY and original IDs after refresh and actual relogin', async () => {
      const note = 'Browser #291 original customer note; never a system instruction.';
      await signIn(page, stack.webOrigin + '/projects/new');
      await page
        .getByRole('heading', { name: '新建项目', exact: true })
        .waitFor({ timeout: 30000 });
      const newCustomer = page.getByRole('button', { name: '新建客户', exact: true });
      await expect.poll(() => newCustomer.isEnabled(), { timeout: 30000 }).toBe(true);
      await newCustomer.click();
      await page
        .getByLabel('客户企业名称', { exact: true })
        .fill('Browser controlled NEW customer');
      await page.getByLabel('项目名称', { exact: true }).fill('Browser NEW preparation');
      await page.getByRole('button', { name: '创建项目并继续', exact: true }).click();
      try {
        await page
          .getByRole('heading', { name: '准备首轮客户资料', exact: true })
          .waitFor({ timeout: 30000 });
      } catch (error) {
        throw new Error(
          `NEW creation failed; ${failures.join(', ')}; ${(await page.locator('body').innerText()).slice(0, 1500)}`,
          { cause: error },
        );
      }
      expect(new URL(page.url()).pathname).toMatch(/^\/preparations\/[0-9a-f-]+$/);
      const created = currentIds(page);
      expect(created.enterpriseId).toBeTruthy();
      expect(created.projectId).toBeTruthy();
      expect(creates).toHaveLength(1);
      await page.getByLabel('选择 ZIP 文件', { exact: true }).setInputFiles({
        name: 'browser-customer.zip',
        mimeType: 'application/zip',
        buffer: zip(),
      });
      await page.locator('textarea').fill(note);
      await page.getByRole('button', { name: '提交并分析', exact: true }).click();
      try {
        await expectBody(page, '资料已接收，分析能力暂不可用。');
      } catch (error) {
        throw new Error(
          `ZIP journey failed; ${failures.join(', ')}; ${(await page.locator('body').innerText()).slice(0, 2000)}`,
          { cause: error },
        );
      }
      const submitted = currentIds(page);
      expect(submitted.requestId).toBe(created.requestId);
      expect(submitted.enterpriseId).toBe(created.enterpriseId);
      expect(submitted.projectId).toBe(created.projectId);
      expect(submitted.intakeId).toBeTruthy();
      const href = page.url();
      expect(await page.locator('textarea').inputValue()).toBe(note);
      expect(await page.locator('textarea').isDisabled()).toBe(true);
      await page.reload();
      await expectBody(page, '资料已接收，分析能力暂不可用。');
      expect(currentIds(page)).toEqual(submitted);
      expect(await page.locator('textarea').inputValue()).toBe(note);
      await page.getByRole('button', { name: '退出登录', exact: true }).click();
      await page.getByRole('link', { name: '使用企业账号登录' }).waitFor({ timeout: 30000 });
      await signIn(page, href);
      await expectBody(page, '资料已接收，分析能力暂不可用。');
      expect(currentIds(page)).toEqual(submitted);
      expect(await page.locator('textarea').inputValue()).toBe(note);
      expect(creates).toHaveLength(1);
      const html = await page.content();
      expect(html).not.toContain(SUBJECT_EXTERNAL_ID);
      expect(html).not.toContain(CLIENT_SECRET);
      expect(html).not.toContain('DEMO-PROJECT-01');
      await page.screenshot({
        path: join(root, 'test-results/preparation-new-recovered.png'),
        fullPage: true,
      });
    }, 120000);
    it('creates EXISTING through current enterprise candidates and rejects cross-scope reads without exposing the original note', async () => {
      const priorCreates = creates.length;
      await signIn(page, stack.webOrigin + '/projects/new');
      await page.getByRole('heading', { name: '新建项目', exact: true }).waitFor();
      const choices = page.getByRole('combobox', { name: '客户企业名称', exact: true });
      await choices.fill('');
      const option = page.getByRole('option').first();
      await option.waitFor({ timeout: 30000 });
      await option.click();
      await page.getByLabel('项目名称', { exact: true }).fill('Browser EXISTING preparation');
      await page.getByRole('button', { name: '创建项目并继续', exact: true }).click();
      await page
        .getByRole('heading', { name: '准备首轮客户资料', exact: true })
        .waitFor({ timeout: 30000 });
      const ids = currentIds(page);
      expect(ids.enterpriseId).toBe(stack.fixture.existingEnterpriseRef.objectId);
      expect(creates).toHaveLength(priorCreates + 1);
      const denied = await page.evaluate(
        async ({ enterpriseId, requestId, projectId }) => {
          const session = (await (await fetch('/bff/session', { cache: 'no-store' })).json()) as {
            csrfToken: string;
          };
          const scope = { enterpriseId, projectId };
          const response = await fetch('/bff/queries/project.get_project_preparation_request/1.0', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken },
            body: JSON.stringify({
              queryId: requestId,
              type: 'project.get_project_preparation_request',
              version: '1.0',
              scopeRef: scope,
              consistencyRequirement: 'AUTHORITATIVE',
              correlationId: requestId,
              requestedAt: new Date().toISOString(),
              payload: {
                requestRef: {
                  kind: 'OBJECT',
                  objectType: 'zhiju.project.preparation_request',
                  objectId: requestId,
                  scope,
                },
                originalKey: `project.request_project_preparation:1.0:${requestId}`,
              },
            }),
          });
          return { status: response.status, body: await response.text() };
        },
        { enterpriseId: ids.enterpriseId, requestId: ids.requestId, projectId: newUuidV7() },
      );
      expect([403, 404]).toContain(denied.status);
      expect(denied.body).not.toContain('Browser #291 original customer note');
      expect(denied.body).not.toContain('Browser EXISTING preparation');
      await page.goto(
        `${stack.webOrigin}/preparations/${ids.requestId}?enterprise=${ids.enterpriseId}&project=${newUuidV7()}`,
      );
      await expectBody(page, '暂时无法核验原请求');
      expect(await page.locator('textarea').count()).toBe(0);
      expect(await page.locator('body').innerText()).not.toContain('Browser EXISTING preparation');
    }, 60000);
    it('restarts an actually truncated upload through the permitted file picker and preserves the original intake', async () => {
      await signIn(page, stack.webOrigin + '/projects/new');
      const command = await stack.fixture.preparationCommand({
        mode: 'NEW',
        displayName: 'Browser restart customer',
      });
      const csrfToken = await page.evaluate(
        async () =>
          ((await (await fetch('/bff/session')).json()) as { csrfToken: string }).csrfToken,
      );
      async function post(value: WorkspaceCommandInput<unknown>) {
        return page.evaluate(
          async ({ value, csrfToken }) => {
            const response = await fetch(`/bff/commands/${value.type}/1.0`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
              body: JSON.stringify(value),
            });
            return {
              status: response.status,
              body: (await response.json()) as { data: Record<string, unknown> },
            };
          },
          { value, csrfToken },
        );
      }
      const created = await post(command);
      expect(created.status).toBe(200);
      const binding = created.body.data;
      const bytes = zip();
      const intakeRef: Common.ObjectRef = {
        kind: 'OBJECT',
        objectType: 'zhiju.integration.customer_zip_intake',
        objectId: newUuidV7(),
        scope: command.scopeRef,
      };
      const payload: CustomerZipIntakePayload = {
        projectRef: {
          kind: 'OBJECT',
          objectType: 'zhiju.project.project',
          objectId: command.scopeRef.projectId,
          scope: command.scopeRef,
        },
        preparationRequestRef: command.targetRef,
        originalPreparationKey: command.idempotencyKey,
        preparationPresetRef:
          binding.preparationPresetRef as CustomerZipIntakePayload['preparationPresetRef'],
        preparationPresetHash: binding.preparationPresetHash as Common.ContentHash,
        intakePolicyRef: binding.intakePolicyRef as CustomerZipIntakePayload['intakePolicyRef'],
        intakePolicyHash: binding.intakePolicyHash as Common.ContentHash,
        originalName: 'restart-original.zip',
        declaredByteLength: bytes.length,
        zipBytesSha256: {
          algorithm: 'SHA-256',
          canonicalizationVersion: '1',
          digest: createHash('sha256').update(bytes).digest('hex'),
        },
        submittedNote: 'Original interrupted browser upload note',
        analysisIntent: 'ANALYZE',
      };
      const intake: WorkspaceCommandInput<CustomerZipIntakePayload> = {
        commandId: newUuidV7(),
        type: 'integration.request_customer_zip_intake',
        version: '1.0',
        scopeRef: command.scopeRef,
        targetRef: intakeRef,
        idempotencyKey: `integration.request_customer_zip_intake:1.0:${intakeRef.objectId}`,
        correlationId: newUuidV7(),
        requestedAt: new Date().toISOString(),
        payload,
        integrity: { canonicalizationVersion: '1', payloadHash: preparationHash(payload) },
      };
      const issued = await post(intake);
      expect(issued.status).toBe(200);
      const upload = issued.body.data.upload as { path: string; token: string };
      const cookies = await page.context().cookies(stack.webOrigin);
      async function* truncated() {
        yield await Promise.resolve(bytes.subarray(0, 20));
      }
      const interrupted = await fetch(stack.webOrigin + upload.path.replace(/^\/api\//, '/bff/'), {
        method: 'PUT',
        headers: {
          cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '),
          origin: stack.webOrigin,
          'content-type': 'application/zip',
          'x-csrf-token': csrfToken,
          'x-intake-upload-token': upload.token,
        },
        body: truncated(),
        duplex: 'half',
      });
      await interrupted.text();
      expect(interrupted.status).toBeGreaterThanOrEqual(400);
      const closed = await stack.fixture.run((session) =>
        stack.fixture.composition.integration.get(session, {
          scopeRef: command.scopeRef,
          payload: { by: 'INTAKE', intakeRef },
          correlationId: intake.correlationId,
        }),
      );
      expect(closed.uploadState).toMatchObject({ generation: 1, state: 'CLOSED_NO_OBJECT' });
      expect(closed.allowedActions).toContain('RESTART');
      const href = `${stack.webOrigin}/preparations/${command.targetRef.objectId}?enterprise=${command.scopeRef.enterpriseId}&project=${command.scopeRef.projectId}&intake=${intakeRef.objectId}`;
      await page.goto(href);
      const picker = page.getByLabel('重新上传这份 ZIP（仅一次、必须为原文件）', { exact: true });
      await picker.waitFor({ timeout: 30000 });
      await picker.setInputFiles({
        name: 'restart-original.zip',
        mimeType: 'application/zip',
        buffer: bytes,
      });
      await expectBody(page, '资料已接收，分析能力暂不可用。');
      expect(currentIds(page).intakeId).toBe(intakeRef.objectId);
      expect(await page.locator('textarea').inputValue()).toBe(payload.submittedNote);
      const readback = await stack.fixture.run((session) =>
        stack.fixture.composition.integration.get(session, {
          scopeRef: command.scopeRef,
          payload: { by: 'INTAKE', intakeRef },
          correlationId: intake.correlationId,
        }),
      );
      expect(readback.uploadState).toMatchObject({ generation: 2, restartsUsed: 1 });
      expect(readback.originalCommand).toEqual(intake);
    }, 120000);
  },
);

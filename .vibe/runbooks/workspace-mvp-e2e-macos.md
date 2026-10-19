# Workspace MVP：macOS 本机 E2E 测试环境配置

适用范围：仅本机 macOS。环境 A 用于人工检查页面；环境 B 的目标是让人类用户在浏览器中操作真实 Web/BFF/Core，连接 Docker 中保留数据的 PostgreSQL，并由平台调用本机专用 Agent Runner。本文记录已存在的启动方法、已确认的环境目标与尚待实现的接入条件，不把配置设计当作已经可执行的部署入口。

核对日期：2026-10-18。本轮修改基于 `e890b8c8d4a43792372ee4f154daf9f636cd9922`，位于独立工作树的 `codex/env-b-runner-analysis`；包含常驻基础之上的首次分析链路，尚未提交。环境 A 未重启或重建。升级到其他修订时，重新核对脚本、配置加载器与接入条件；版本与参数以该修订的代码为准。

## 1. 两种人工测试环境与自动化检查

| 环境 | 用户怎样操作 | 数据与 Runner | 当前边界 |
| --- | --- | --- | --- |
| A：页面交互环境 | 人工打开正式 React 组件，检查工作台、资料提交、分析、进度、审阅和交付的样例交互 | 隔离开发样例；不依赖 Docker，不调用真实 Runner | 用户已确认可以启动；样例操作不产生业务事实 |
| B：本机真实手动联调环境 | 人工登录、提交 ZIP、等待本机 Runner 返回报告，再检查已接入的后续流程 | Docker PostgreSQL 保留测试数据；真实文件托管；调用本机专用 Runner | 常驻服务、真实登录、准备项目、ZIP 托管、本机 OMP 与报告读取已实现；真实调用验证与用户人工验收分开记录 |

原先称为“环境 B”的受控自动化集成测试移到第 9 节，作为工程回归工具。它会创建并清理临时服务，不能作为 B 的启动命令，也不能代替用户的人工验收。

完整 MVP E2E 是环境 B 逐步达到的验收目标，不再另列一个环境 C。B 可以先交付“真实登录 → 提交 ZIP → 本机 Runner 分析 → 页面查看报告”的最小可用链；生成、反馈、批准及批次交付只有实际接入并人工走通后才计入通过范围。

## 2. 本机前置准备

### 2.1 代码与工具

使用独立工作区，避免在有其他开发改动的目录运行会清理、重建制品的验证目标。以下命令均从所选工作区的仓库根目录执行；不需要改动 main、重置其他分支或删除现有文件。

```shell
vibe repo --json
git status --short
node --version
pnpm --version
```

| 依赖 | 本文基线 | 执行来源 |
| --- | --- | --- |
| Node.js | `24.19.0` | [.nvmrc](../../.nvmrc)、[package.json](../../package.json) |
| pnpm | `11.19.0` | `package.json` 的 `packageManager` / `engines` |
| 项目依赖 | 完全遵循 lockfile | [pnpm-lock.yaml](../../pnpm-lock.yaml)；不要顺手升级依赖 |
| Playwright | `1.64.0` 对应的 Chromium | `package.json`；浏览器由当前依赖安装 |
| Vibe | 本机已安装且可读取本仓库配置 | [project.yaml](../project.yaml)；验证统一使用其命名目标 |
| Docker Engine | 环境 B 和第 9 节自动化检查必需；使用本机当前可用的 Docker context | [Docker 连接处理](../../tools/persistence/docker.mjs) |

依赖版本不匹配时，先用本机已有的版本管理方式切到上述版本。本文不要求安装另一套全局 Node/pnpm，也不指定更换现有 Docker 产品。

```shell
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

安装 Chromium 是自动化测试的准备步骤；人工查看 A 可以用本机 Chrome 或 Edge。受控 Chromium 的通过记录不自动覆盖实际 Chrome/Edge 版本及 Windows 平台。

### 2.2 Docker 与镜像

仅运行 A 可以跳过本节。运行 B 前启动本机已有的 Docker Engine，并核对当前 context：

```shell
docker context show
docker version --format '{{.Server.Version}}'
vibe verify environment --json
```

`environment` 是只读检查：核对 Docker 可连接及 PostgreSQL/Flyway 的 tag 与 digest 绑定，不拉镜像、不创建容器、不读取注册表凭据。未缓存镜像可以只是 warning，前提是固定绑定核对通过；真正运行 `full` 时才按现有 gate 的拉取/缓存规则处理。

- PostgreSQL `18.6`、Flyway `11.20.3` 的完整 `tag@digest` 以 [baseline.mjs](../../tools/persistence/baseline.mjs) 为唯一来源，不在操作命令中另抄一套 digest。
- 第 9 节受控 Keycloak 使用 `keycloak/keycloak:26.7.0` 的固定 digest，来源为 [controlled-keycloak.ts](../../tests/persistence/controlled-keycloak.ts)。环境 B 由独立启动器初始化常驻测试 realm/client/用户，不使用每次测试生成的临时账号。PostgreSQL/Flyway 的预检通过不代表身份服务已就绪。
- 首次安装需要访问依赖源、Playwright 浏览器下载源和上述镜像仓库。第 9 节自动化检查使用脱敏夹具，不需要模型订阅或 Provider API Key；环境 B 的真实 Runner 需要其专用执行配置中的模型通道，凭据留在本机受控配置中，不写入本文或 Git。
- macOS 上显式设置的 `DOCKER_HOST` 优先；未设置时，工具在加载 Testcontainers 前读取当前 Docker context 的 endpoint。不要强制写死 OrbStack / Docker Desktop 的 socket，也不要为绕过失败切换全局平台或镜像版本。
- 同一容器环境中复用成功的预检。更换 context、重建运行时，或出现容器/镜像仓库错误后再检查。

## 3. 环境 A：打开可交互的本机页面

### 3.1 端口与进程

| 组件 | 本节地址 | 用途 |
| --- | --- | --- |
| Web 静态服务 | `http://127.0.0.1:3100` | 提供明确标记的开发构建；转发同源 `/bff/*` |
| BFF 外壳 | `http://127.0.0.1:3101` | 健康检查和固定的未登录/未配置响应 |
| Core / PostgreSQL / OIDC / Runner | 不启动 | 此环境只检查页面和样例交互 |

本节使用构建后的 React 应用。历史 `8766` 高保真原型不是本次工程页面的验收入口。

### 3.2 终端一：启动 BFF 外壳

```shell
pnpm --filter @zhiju/workspace-bff build
env -u ZHIJU_WORKSPACE_TRUST_CONFIG NODE_ENV=development PORT=3101 pnpm --filter @zhiju/workspace-bff start
```

仅对这个进程移除 `ZHIJU_WORKSPACE_TRUST_CONFIG`，防止继承其他环境的真实登录配置；不修改 shell 启动文件或全局设置。外壳不会伪造身份，也不会提供业务写入能力。

### 3.3 终端二：构建并启动页面

```shell
pnpm --filter @zhiju/workspace-web build:fixture
env NODE_ENV=development PORT=3100 BFF_URL=http://127.0.0.1:3101 pnpm --filter @zhiju/workspace-web start
```

打开 [工作台](http://127.0.0.1:3100/workbench)。页面应显示匿名开发样例的身份/数据说明，而不是一个真实登录用户。

可在第三个终端检查代理与外壳：

```shell
curl --fail --silent --show-error http://127.0.0.1:3100/bff/health
curl --fail --silent --show-error http://127.0.0.1:3100/bff/bootstrap
```

`bootstrap` 应返回 `accessState: REAUTH_REQUIRED`、`businessActionsEnabled: false`。这与开发页面可交互不矛盾：页面样例使用隔离适配器，BFF 没有因此开启真实业务。

### 3.4 页面检查入口

| 场景 | 入口 / 操作 |
| --- | --- |
| 多项目工作台 | `/workbench` |
| 客户选择与新建项目 | `/projects/new` |
| 首轮 ZIP 提交 | `/initial-analysis`，或从项目卡片进入资料提交 |
| 分析报告与启动核对 | 从工作台的现有示例报告进入，保持页面提供的精确 report ID |
| 逐文件执行进度 | `/projects/DEMO-PROJECT-01/executions/WB-ROUND-01` |
| 36 处变化、9 个章节、201 份文件目录 | `/review-workspace` |
| 跨轮次交付与包历史 | `/projects/DEMO-PROJECT-01/delivery` |

通过页面自带的明确开发控制注入样例事件。任意本地 ZIP 选择不会真的读取、上传或分析文件；新建的演示项目也不会自动获得其他项目的报告。需要查看固定报告时，使用对应示例项目及“带入演示”入口。

开发适配器的内存状态通常随刷新重置；个别选择/请求使用独立的 tab-local 样例存储。都不构成服务器个人草稿或跨设备恢复。具体范围见 [Web README](../../apps/workspace-web/README.md)。

### 3.5 停止与切换

在两个服务终端分别使用 `Ctrl+C`。如需改端口，Web 的 `PORT`、BFF 的 `PORT` 和 Web 的 `BFF_URL` 一并对应调整；无需占用或停止其他会话的服务。

`build:fixture` 与正式 build 共用 `apps/workspace-web/dist`。停止手动服务后再运行 `code` / `full`，不要在同一个工作区同时构建开发与正式制品。恢复正式制品可执行：

```shell
pnpm --filter @zhiju/workspace-web build
```

只把 `NODE_ENV` 改为 production 不会把旧开发制品变成正式制品；静态服务器会拒绝以 production 模式提供带 `fixture-build.json` 的目录。

## 4. 环境 B：人类用户操作的真实本机联调

### 4.1 已确认目标与组件

用户于 2026-10-17 确认：由本人在浏览器手动测试，数据库运行在本机 Docker 中，平台调用本机专门配置的 Agent Runner。Runner 项目暂沿用 `/Users/galendai/repo/qzhike/zhiju-doc-artifacts`，目录须由配置文件指定，后续可以调整。

预期链路为：浏览器 → 同源 Web/BFF → Core → Docker PostgreSQL 与文件托管 → 本机 Runner → 校验/接纳 → 页面显示真实报告。Core 负责调度和业务事实；文档的业务分析交给 Runner。

| 组件 | 环境 B 的目标 | 与现有实现的关系 |
| --- | --- | --- |
| 浏览器与 Web | Chrome/Edge 人工操作；使用排除 fixture 的正式构建 | 复用现有 React 页面和可信入口；缺失服务的动作保持不可用 |
| BFF / Core | 在 macOS 持续运行；真实登录、授权和业务请求 | 复用可信配置和 HTTP 接入；由独立启动器组合，业务能力按实际配置提供 |
| PostgreSQL | Docker 专用实例/数据库与持久化卷；停止服务后保留项目、任务和结果引用 | 复用固定版本、迁移和角色规则；不使用自动化 gate 的临时库 |
| 登录服务 | 专用测试 realm/client/用户，支持本人反复登录 | 固定 Keycloak 镜像，专用 realm/client/用户；通过 owning 命令建立身份映射 |
| 原始 ZIP、模板与输出 | 由现有文件托管接口保存并保留；数据库保存精确引用 | B 使用已批准的本机持久化文件适配；不要求额外部署 S3，文件目录与数据库都须保留 |
| Agent Runner | 在 macOS 调用用户专门设置的 Runner；输入/输出绑定本次任务 | 项目路径可配置；安装固定 OMP profile，经受控 RPC、原 Attempt 记录及独立接纳返回报告 |

在 A 继续运行时，B 使用独立工作区、构建制品、端口和数据目录；不能在 A 的工作区运行 clean/full 或覆盖其 fixture 制品。第 3 节端口是 A 的默认值，不能直接复用来启动第二套服务。

本轮 B 只提供 loopback 本机入口，尚未适配经 Tailscale 的完整登录。后续远程接入须同时配置 Web HTTPS origin、登录回调、可信代理和远程设备可达的身份服务地址，不能只转发 3200 端口。启动器不修改现有 Tailscale 设置。

### 4.2 Runner 路径由配置文件指定

启动器显式读取 `config/workspace-e2e.local.json`（可用 `--config /absolute/path.json` 覆盖）；该文件与 `.local/workspace-env-b/` 已排除 Git。无秘密样例为 [workspace-e2e.example.json](../../config/workspace-e2e.example.json)。首次用 `env:b:init --runner-project ...` 生成真实实例配置，不直接运行含占位值的样例。

配置闭集包含 `version`、`instanceId`、`dataDir`、`ports`、`runner`。默认端口分别为 Web 3200、BFF 3201、Core 3202、Keycloak 3280、PostgreSQL 55432、私有进程控制 3290。拒绝 3100/3101、重复端口、未知字段、非绝对路径及 Runner/数据目录重叠。私有数据写入前按真实路径检查：自定义 `dataDir` 若位于 Git 工作区中，须先将整个目录加入该工作区的忽略规则，且目录内不能有已跟踪文件；否则拒绝写入。仓库外私有目录不受 Git 忽略规则限制，仍执行权限和路径检查。

- `runner.projectRoot` 是操作者指定的 OMP 项目目录，启动前检查真实路径及可读的 `AGENTS.md`；业务请求和 ZIP 不可覆盖。当前选择 `/Users/galendai/repo/qzhike/zhiju-doc-artifacts`，产品代码不硬编码该目录。
- 用户已确认平时直接运行 OMP 并读取目录内 `AGENTS.md`。`runner.profileFile` 可指定专用绝对路径；其中 `executionRoot` 必须等于本实例的 `dataDir/runner-attempts`，不得跨实例共享；为 null 时，初始化会在 dataDir 生成 `omp-profile.json`，用实际空会话确定明确模型并固定二进制、工具及依赖 Hash。初始化不发送模型 prompt，不导入历史报告。
- 已安装 profile 中的 OMP 版本、provider/model/thinking 是本轮唯一运行选择；每次调用核验真实空会话，配置漂移拒绝执行。原本机默认值不作为当前版本承诺；macOS profile 不代表 Ubuntu 生产执行锁。首次安装在私有 venv 中准备固定 `jsonschema==4.26.0`。
- 以后修改 Runner 项目路径只影响新的启动配置，不迁移历史数据、不重绑已提交任务；每轮输入/输出与实际执行配置均绑定原 Attempt，不通过改目录替换原调用依据。
- 初始实例的端口和数据目录是资源归属的一部分，不能修改后复用原容器；检测到漂移会拒绝启动/停止。调整这些字段须先停止原实例，再建立独立实例或显式迁移，不能通过改标签或清卷绕过。

### 4.3 第一个可用的手动测试闭环

用户于 2026-10-19 选择暂不补齐 B 的 `projection_app` 角色。当前先从资料提交回执中的“查看分析报告”链接进入，保存原准备请求／报告 URL，刷新或重新登录后继续访问该链接。目录可列出项目，但通过项目看板找回报告的入口尚不可用；不因此重传 ZIP 或补写数据库权限。详见 [角色补齐的暂缓决定](../decisions/template-driven-preparation.md#7-环境-b-项目看板角色补齐2026-10-19用户选择暂缓)。

1. 启动环境 B，以专用测试用户登录；可以看到本人有权限的企业与项目。
2. 在网页创建准备项目并上传一个脱敏 ZIP；平台保存真实字节、来源清单和原请求记录。
3. 平台经已接入的分析流程，把本次任务的物化输入和模板交给配置指定的本机 Runner；本人不需要另开 CLI 手工执行任务或搬运报告。
4. 页面显示实际等待/运行/失败情况。Runner 返回 JSON/Markdown 后，由平台核对协议、引用与来源并接纳；只有接纳成功才更新分析总览。
5. 刷新页面或重新登录后，仍能找到同一项目、提交记录和已接纳报告；业务服务重启后重新登录可恢复已有数据，不因此重复调用 Runner。
6. 至少走一次缺资料、Runner 不可用或报告不合格的路径：页面显示原因和已有事实，不把托管成功或进程退出当作分析成功。

这一闭环通过后，仍在同一环境逐步接通范围确认、Markdown 生成、逐文件反馈/批准和项目交付。第一轮联调成功不提前宣称整条 MVP 已通过。

### 4.4 启停和数据保留要求

在**环境 B 的独立工作树**内执行，勿在正在提供 A 页面样例的工作区构建或清理：

```bash
pnpm build
pnpm env:b:init --runner-project /Users/galendai/repo/qzhike/zhiju-doc-artifacts
pnpm env:b:start
pnpm env:b:status
```

浏览器入口为 `http://127.0.0.1:3200/workbench`。初始化输出私有 `login.txt` 路径，其中仅含本机测试入口、用户名和密码；不把该文件或 `secrets.json` 贴入 Issue/PR。生成的文件位于 `dataDir`，目录 0700、秘密文件 0600。业务数据库与 Keycloak 数据库都在本实例的 PostgreSQL 持久卷内；核心应用使用非 superuser、非 BYPASSRLS 的数据库角色。

`init` 启动数据库/登录服务，运行现有迁移，通过 IdentityPolicy 命令初始化一个 Human、一个 board service 及真实 Keycloak 用户映射。重复运行保留账号和密钥；它不创建假客户/项目/分析报告，也不虚构公司规则发布。`start` 预检正式制品，复用初始化结果并启动后台 Web/BFF/Core，退出终端后继续运行；电脑重启后需再次执行 `start`，没有安装系统开机服务。

```bash
pnpm env:b:stop
pnpm env:b:start
```

`stop` 通过带私有令牌的本机控制入口停止其实际持有的子进程，并核对标签后停止本实例的 Keycloak/PostgreSQL 容器；不删除容器、卷或任务产物。没有全局停止/清理或 Tailscale 修改。端口占用、资源归属不符或配置漂移时安全拒绝。运行日志位于 `dataDir`，错误对外仅输出固定代码。Runner 目录移走后仍可运行 `status`/`stop`；再次 `start` 前须更新为有效目录。依赖容器停止时状态显示 `DEGRADED`，重复 start 给出明确拒绝；先 stop，再 start 恢复原实例，保留数据。两个容器运行且初始化成功记录匹配实例、配置和身份文件时才显示 `INITIALIZED`；仅容器运行、记录缺失或身份文件不匹配均显示 `PARTIAL`。新一轮初始化开始前撤销旧完成记录，全部步骤成功后才写入新记录；中断后保留账号和数据，重试 init/start 恢复。`status` 同时输出 `initialization: COMPLETE/INCOMPLETE`。

环境 B 的项目目录与项目看板读取，从已安装 preparation 配置取精确 capability code，并向 Core/BFF 下发相同可信配置；不另用与已有成员授权不同的默认 code。已安装配置缺少所需 capability code 时拒绝启动，不重写历史授权。

当前初始化已通过 owning 接口建立真实模板版本、模板分析基准、准备预设及专用准入授权，并使用 B 的本机持久化文件目录；这条分支不以 S3 或三份规范原文发布为前置。已批准的两个 Core 准备角色以 SET TRUE/INHERIT FALSE/ADMIN FALSE 安装；首次 PREPARING 分析的 TE/IG 调度、独立报告接纳及公开读取已实现。初始化结果不等于真实 Provider、完整 MVP 或用户独立人工验收通过。

文件存储首次建立前先保存带本实例和预分配 storeId 的私有初始化意图。若已建好完整存储标记、尚未保存外部绑定时中断，重试仅校验并恢复该精确身份；不会创建第二个存储。无原意图的旧目录、缺标记、身份或目录元数据不符均拒绝自动恢复。若返回 `ENV_B_FILE_STORE_INITIALIZATION_INCOMPLETE`，先保留目录及意图供核对；仅在确认从未写入业务对象后，由操作员将该未完成目录和意图一起隔离，再显式重跑初始化，不手填现有存储身份或删除已有对象。

若初始化被强行结束后留下 `operation.lock`，先读取该文件的实例和 PID，确认原进程已结束且没有另一项 B 操作后，只移除该实例的锁再重试。启动器不自动抢占锁，不根据陈旧 PID 杀进程。

## 5. 当前实际配置项

下面用于理解接入和排查。环境 A 只需其启动命令中的变量；环境 B 的常驻启动器须显式提供并校验相应配置，第 9 节自动化夹具则自行生成临时值。它不是一份可以直接复制到 `.env` 就获得完整业务的模板。

### 5.1 页面与测试进程

| 变量 | 读取者 | 用法与约束 |
| --- | --- | --- |
| `PORT` | Web、BFF、Core 的独立进程 | 原默认分别为 `3100`、`3101`、`3000`；B 启动器分别传入 `3200`、`3201`、`3202` |
| `BFF_URL` | Web 静态服务 | 固定 BFF upstream，默认 `http://127.0.0.1:3101`；不能包含用户名/密码 |
| `NODE_ENV` | 构建脚本、Web 静态服务 | 开发制品必须显式 development；正式构建必须排除 fixture |
| `WORKSPACE_TEST_URL` | 页面 Playwright 配置 | 由 `tools/workspace/check.mjs` 注入当轮 Web 地址；不是业务服务地址配置 |
| `DOCKER_HOST` | Docker / Testcontainers | 显式值优先，否则 macOS 从当前 context 推导；不写死本机 socket |
| `ZJU_PERSISTENCE_DATABASE_URL` | persistence 测试 | gate 为临时数据库注入；不要填入开发/生产共享库 |

Core 的 [main.ts](../../apps/api/src/main.ts) 读取并验证 `PORT`，缺省保持 `3000`；始终监听 `127.0.0.1`。非法端口使启动失败，不静默使用另一端口。受控测试仍可直接构造应用并选临时端口。

### 5.2 Core / BFF 的可信配置

| 配置 | 所属进程 | 真实约束 |
| --- | --- | --- |
| `ZHIJU_WORKSPACE_TRUST_CONFIG` | Core、BFF | 完整 JSON **字符串**，不是文件路径；两端使用完全相同的原始字节，其 SHA-256 才一致 |
| `clientAuthSecretRef` 指定的环境变量 | BFF | JSON 内为 `env:变量名`；该变量提供 client secret，本文件不提供固定秘密 |
| `ZHIJU_WORKSPACE_DATABASE_URL` | Core | 必需的默认数据库连接；B 指向 Docker 中的专用持久化库，自动化检查使用 gate 的临时库 |
| `ZHIJU_WORKSPACE_IDENTITY_DATABASE_URL` | Core | IP 连接覆盖；缺省依次回退 `ZHIJU_WORKSPACE_DISCOVERY_DATABASE_URL`、默认连接 |
| `ZHIJU_WORKSPACE_DISCOVERY_DATABASE_URL` | Core | 当前是 IP 连接的兼容回退，不是另一条绕过 IP 授权的通道 |
| `ZHIJU_WORKSPACE_ENTERPRISE_DATABASE_URL` | Core | EP 连接覆盖，缺省使用默认连接 |
| `ZHIJU_WORKSPACE_TASK_EXECUTION_DATABASE_URL` | Core | TE 连接覆盖，缺省使用默认连接 |
| `ZHIJU_WORKSPACE_IDENTITY_LOOKUP_KEY` | Core | 身份检索密钥，加载器支持 hex/base64；必须满足当前长度/加密要求 |
| `ZHIJU_WORKSPACE_IDENTITY_FIELD_KEY` | Core | 身份字段 AES-256-GCM 密钥；使用受控的 32 字节密钥，不能随启动变更而让已有字段无法解密 |
| `ZHIJU_WORKSPACE_BOARD_CURSOR_KEY` | Core | 游标签名密钥；由受控配置持有，不下发浏览器 |
| `ZHIJU_WORKSPACE_BOARD_POLICY_REFS` | Core | JSON 对象，将 Project ID 映射到实际存在的精确 VersionedRef；`{}` 不能提供一个可用项目所需的 policy |

来源为 [Core composition](../../apps/api/src/workspace/server.ts)、[Core trust loader](../../apps/api/src/workspace/trust-config.ts) 和 [BFF trust loader](../../apps/workspace-bff/src/trust-config.ts)。BFF 缺少/不能接受配置时保持未配置状态；Core 缺少必要值时拒绝启动。后台入口没有自动加载 `.env` 的逻辑，文件落盘不等于变量已注入进程。

可信 JSON 的字段组必须完整，不能只填写 issuer、clientId：

| 字段组 | 要核对的内容 |
| --- | --- |
| 版本与访问地址 | `trustConfigVersion`、`publicOrigin`、`allowedHosts`、`trustedProxyPeers`；区分浏览器看到的 Web 地址与内部 BFF 地址 |
| OIDC | `issuer`、`providerCode`、`discoveryUrl`、`clientId`、`clientAuthSecretRef`、`apiAudience`、`allowedAzp`、`oidcEndpointAllowlist` |
| 回调与返回 | `callbackUri`、`postLogoutRedirectUri`、`returnRoutePatterns`；callback 指向同源 `/bff/auth/callback` |
| Core 通道 | `apiBaseUrl`、`apiGatewayPeers`；Core 当前使用 `/api` 基址，不带结尾斜杠 |
| 算法与限制 | ID/access token 算法、token age、clock skew、JWKS TTL、HTTP timeout、session/transaction/upload 数量上限；遵循当前封闭 loader，不放宽验证 |
| 授权主体与能力 | 六项必需的 `capabilityCodes` 映射及 `boardService.principalId`；来自实际 owning setup，不能用随机 UUID 代替主体/授权 |

受控生成示例见 [buildTrustDocument](../../tests/persistence/trusted-http-fixtures.ts)，实际构建后 Web 地址及 Keycloak 端点覆盖见 [Keycloak 场景](../../tests/persistence/workspace-controlled-keycloak.test.ts)。这些测试值只属于当轮夹具，不是供常驻环境直接复用的身份配置。

本机地址统一使用测试实际选择的 `127.0.0.1` 与端口，不随意混用 localhost。loader 允许明确的 loopback HTTP；Cookie、Host、Origin、CSRF 等限制仍保留，不通过关闭安全检查“修好登录”。IP 数据库连接还必须具备当前 self-discovery reader 的正确角色关系；目录读取失败不能解释为没有项目。

### 5.3 单文件读取/下载不是单靠环境变量启用

#279 的真实 Markdown 链需要 `createWorkspaceCoreFromEnv(env, { markdown })` 显式注入 owning 服务、存储、渲染版本、票据密钥与 operation-capability 映射。受控 built-browser 夹具提供这些依赖。

当前普通 `apps/api/src/main.ts` 调用未传入上述 `markdown` composition。单独运行 `pnpm --filter @zhiju/api start`，即使填写可信登录环境变量，也不能据此保证 #279 的读取/下载可用。没有 `ENABLE_MARKDOWN_REVIEW` 或 `RUNNER_URL` 这样的已实现总开关；本文件不发明它们。

### 5.4 真实准备项目与 ZIP 托管的现有配置

本次基线已包含 [准备入口部署组合](../../apps/api/src/workspace/preparation-environment.ts)，由 `createWorkspaceCoreFromEnv` 接入。它负责现有准备项目/ZIP 功能的装配，不自动发布公司规则、授予权限或调用 Runner。

| 配置 | 读取者与用途 |
| --- | --- |
| `ZHIJU_WORKSPACE_INTEGRATION_DATABASE_URL` | Core 的 IG 数据库连接；缺省回退默认 workspace 连接 |
| `ZHIJU_PREPARATION_CONFIG` | Core 读取的完整 JSON 字符串；含管理员/服务主体、精确预设发布与引用、能力映射、ZIP policy、S3 或获准本机存储定位和公司来源绑定 |
| `ZHIJU_PREPARATION_CURSOR_KEY` | 准备入口游标密钥，按加载器要求编码/校验 |
| `ZHIJU_PREPARATION_TICKET_KEYS` | ZIP 票据密钥集合；必须包含配置中的 active key |
| `ZHIJU_PREPARATION_S3_ACCESS_KEY_ID` / `ZHIJU_PREPARATION_S3_SECRET_ACCESS_KEY` | 本环境文件存储凭据；由进程安全配置提供 |
| `ZHIJU_PREPARATION_S3_SESSION_TOKEN` | 仅在所用存储认证需要时提供 |

这些变量已由代码读取；第 4.2 节的 `runner.projectRoot` 已由启动器读取和校验，`runner.profileFile` 或 dataDir 下自动生成的 profile 用于本机首次分析 dispatch。真实初始主体、公司发布及模板必须存在并匹配引用，不能凭构造 UUID、空对象或随意指向目录替代初始化。

## 6. 环境 B 的接入差异与行动顺序

### 6.1 首次分析的实现与后续边界

| 项目 | 本轮实现 | 验证与使用边界 |
| --- | --- | --- |
| 登录与数据库 | 隔离的 Docker 数据库、身份服务、账号、顾问准入和准备流程角色 | 初始化与原数据保留必须通过；环境 A 独立 |
| 准备项目与 ZIP | 正式准备请求和 DOCX/Markdown ZIP 托管；source@2.0 锁定公司模板、指令和定位 | 首次 PREPARING 分析；旧 source/preset 维持原流程 |
| OMP | 私有 profile、实际 get_state 握手、只读来源包、一次调用与原 Attempt 恢复 | 同一用户的 macOS 可信进程边界；不宣称内核隔离或 Provider 取消已确认 |
| 报告返回 | 固定 collect/finalize/check，独立 TE Acceptance 与 EP 报告 CAS 接纳 | 原 JSON/Markdown、来源及模板 Hash 相符才可读；失败不使用合成报告 |
| 页面 | 原准备请求进入真实分析总览；等待页显示真实执行阶段 | 复制客户索取清单可用；未开放的补料/确认/修改不可提交 |
| 生成、反馈、批准与交付 | 继续保留原已确认设计与相应页面 | 后续 owning 能力需逐段接入，首次分析成功不等于完整 MVP E2E |

首次安装或版本更新时，在 B 工作树中完成构建，然后 stop、init、start。初始化不创建客户项目或自动发送模型请求；用户点击“提交并分析”后才形成该客户资料的执行意图。配置文件不含密钥，认证沿用本机 OMP；不要将私有身份文件和输入输出目录提交 Git。

运行资料位于 `dataDir/runner-attempts/<attempt-id>`，包括只读输入、提取件、原调用标记、生命周期元数据与成功后的 `result/analysis-report.json` 和 `analysis-report.md`。日志不保存隐藏推理、系统提示或完整 transcript。FAILED/UNKNOWN/EXPIRED 保留原请求，不以重新上传或删除调用标记进行盲重试；排查原 Attempt 的实际记录及安全错误码。

原始 Runner 项目的 `AGENTS.md`、固定 v0.2 校验器/Schema 和模板只读使用。升级这些文件或 OMP 二进制后，已有 profile 的 Hash 不再匹配时明确拒绝；保留历史 profile 和数据，为新的显式配置重新安装绑定，不能改旧 Run 的依据。Tailscale 与 Ubuntu 生产接入保持原边界。

### 6.2 按可人工使用的结果推进

1. **先具备常驻基础和真实 ZIP 托管。** 交付隔离的启动配置、Docker 数据与文件保留、测试身份及初始化，用户可登录、建准备项目、上传和恢复记录。此时若没有分析能力，明确停在等待接入，不能算 Runner 联调成功。
2. **贯通一个真实分析任务。** 完成本机 Runner profile/路径读取与必要协议工具，接通调度、返回和接纳；用户按第 4.3 节通过页面操作，亲自看到由本次输入产生的报告。这是 B 首轮可用的验收目标。
3. **在同一环境完成完整 MVP。** 继续接入范围确认、生成、反馈、逐文件批准及交付包，核对精确版本和实际产物；各步实际执行后记录结果，不把自动化通过扩大成人工业务验收。

没有完成第 2 步前，B 状态保持“接入中，真实 Runner 人工闭环 NOT RUN”；完成第 2 步也不能自动把第 3 步标为通过。测试可先使用一个脱敏客户、一套固定模板和少量有代表性的 DOCX/Markdown，随后再扩大资料规模。

## 7. 常见问题与恢复

| 现象 | 核对与处理 |
| --- | --- |
| `3100` / `3101` 被占用 | 使用 `lsof -nP -iTCP:3100 -sTCP:LISTEN` / 对应 3101 查进程；只停止自己启动的终端，或对应修改本节端口，不批量杀进程 |
| 页面开发制品启动被拒绝 | 检查 `fixture-build.json` 与 `NODE_ENV`；开发制品显式 development，正式环境重新 build，不能删除标记冒充正式构建 |
| BFF 503 / `UI_SERVICE_NOT_CONFIGURED` | 环境 A 的业务操作拒绝是预期；B 应核对专用身份/业务配置，不通过伪造 session/actor 解锁 |
| Core `WORKSPACE_STARTUP_REJECTED` | 核对可信 JSON、密钥与连接是否已注入；保留固定错误码，不打印整份环境或秘密 |
| 登录回调、Host 或 Origin 被拒绝 | 核对实际 Web origin、callback、BFF host 和同一份配置字节；不要改成任意 Host/Origin 或关闭 CSRF |
| Docker socket 不可用 | 确认 Engine 已启动、context 正确，显式 `DOCKER_HOST` 没有指向旧地址；重跑只读环境预检 |
| 镜像 `PIN_MISMATCH` / 仓库不可达 | 记录具体镜像与失败类型，遵循固定基线及现有缓存策略；不换 `latest`、不改 digest 让门禁通过 |
| Chromium executable 不存在 | 在当前工作区执行 `pnpm exec playwright install chromium`，不要把系统浏览器冒充测试所需版本 |
| 直接执行测试出现数据库变量缺失或跳过 | 自动化检查按第 9 节由 gate 创建临时库；环境 B 独立配置持久化库，两者不能混用 |
| 报告、进度、草稿或交付显示尚未接入 | 对照第 6 节，这是当前实现范围，不是缺少 Docker 容器或一个隐藏开关 |
| 测试中断后有残留资源 | 先确认资源属于本轮；保留错误与清理结果，只处理本轮资源，不使用全局 `docker system prune` / 全部容器删除 |

## 8. 结果记录与维护

本文件只记录配置方法。一次测试应在相应 Issue/PR 中注明代码完整 SHA、环境 A/B 或自动化检查、执行目标、实际浏览器与 macOS 版本、结果和未覆盖项。环境 B 另记数据库/文件保留范围、Runner profile 与配置版本、真实 Run/报告引用；不得记录秘密。只有页面样例通过时写“页面交互通过”；使用真实 Core/数据库的场景单独写清；完整业务 E2E、实际 Chrome/Edge 矩阵和独立顾问验收各自保留结果。

单纯文档修订使用 `docs` 目标；本轮包含常驻启动、初始化和 Core 端口配置代码，须使用配置的 `full` 目标，并独立验证 A/B 共存、真实登录与重启保留。基础设施验证不能替代第 4.3 节 Runner 人工闭环；未执行层保持 NOT RUN。后续改变启动入口、配置格式或 Runner 接入时同步修订本文件。

## 9. 附录：受控自动化集成检查

本节复用已有工程验证设施，不启动环境 B。临时数据库、账号和服务随测试结束清理；不得指向 B 的持久化数据库或 Runner 工作目录。

### 9.1 选择验证目标

| 本次要验证什么 | 入口 | 包含内容 |
| --- | --- | --- |
| 页面、组件、构建边界与受控浏览器交互 | `vibe verify code --json` | 静态检查、普通测试、Web/BFF 构建、生产隔离与开发场景浏览器测试等 |
| 上述内容，加实际 PostgreSQL / Core / BFF / OIDC 与已有 Markdown 下载链 | `vibe verify full --json` | 先执行 code 范围，再创建临时数据库、迁移、运行 persistence 与受控身份/浏览器测试并清理 |

新容器环境第一次执行 `full` 前先完成第 2.2 节预检。若本轮直接运行 `full`，无需先单独运行一次 `code`；同一修订已有可信完整 CI 时，按项目规则复用，只有具体新疑点才补充定向检查。

```shell
vibe verify full --json
```

`docs` 仅用于本配置文档等严格文档变更，不能作为环境 B 人工联调或完整 E2E 的通过证明。不要把底层 `vitest` / Playwright 命令拼成替代门禁，也不要跳过失败的 suite 后仍报告 full PASS。

### 9.2 自动管理的组件与测试身份

无需手工填写数据库密码、Keycloak 管理员密码或一组测试用户凭据。

| 组件 | 创建与配置来源 | 生命周期 |
| --- | --- | --- |
| PostgreSQL 与 Flyway | [persistence gate](../../tools/persistence/gate.mjs) 和固定镜像基线 | 独立临时数据库；自动迁移与版本检查；结束时删除测试容器 |
| 真实受控 Keycloak | [Keycloak 测试](../../tests/persistence/workspace-controlled-keycloak.test.ts) / [临时 realm 配置](../../tests/persistence/controlled-keycloak.ts) | 测试时生成 realm、client、用户密码及密钥，使用随机 loopback 端口，结束时清理 |
| Core 与 BFF | 同一测试夹具传入匹配的配置、身份与数据库 | 各测试场景独立启动/关闭；不是常驻服务 |
| 构建后 Web | [built-browser 测试](../../tests/persistence/workspace-built-browser.test.ts) | 提供正式制品并代理同源调用；结束时停止 |
| Chromium | 当前 Playwright 安装的版本 | 自动创建/关闭测试上下文 |
| Markdown 内容与登记 | 已审阅的 owning fixture / ART / IG 能力 | 真实封存、渲染登记、读取和下载技术链；内容是脱敏测试资料 |

两种身份测试要分别解释：`workspace-controlled-keycloak.test.ts` 使用真实临时 Keycloak；`workspace-built-browser.test.ts` 的 Markdown 场景使用受控合成 OIDC HTTP。不能把两个独立场景拼成一次已经执行的“真实 Keycloak + Runner + 全部业务”旅程。

端口由测试选择，无需在 macOS 安装常驻 PostgreSQL、手工建立固定 `5432` 数据库，或启动第 3 节的服务。`environment` 不检查 Keycloak 的全部就绪条件；若实际容器启动失败，该测试失败，不应算作已跳过的成功。

### 9.3 如何判断结果

- 检查 Vibe 的最终 `status`、目标与退出码；某个浏览器用例通过不等于整个配置目标通过。
- `full` 的持久化 gate 应完成迁移检查、测试和第二次无待应用迁移检查，并报告测试 PostgreSQL 容器清理。Keycloak、HTTP 服务和浏览器由各夹具清理。
- 页面产物/匿名截图在忽略的 `test-results/`，当前 Playwright 配置为 `trace: off`；不承诺未配置的录像、HAR 或 HTML 报告文件一定存在。
- 记录对应修订、目标、macOS/CPU 架构、浏览器实际版本、Docker context、成功/失败范围及剩余缺口。证据进入对应 GitHub Issue/PR，不在本 runbook 累积每次运行日志。
- 本目标可以证明已有登录、权限隔离、精确内容与下载的受控技术行为；完整客户业务、真实 Runner、跨设备草稿和独立顾问验收仍分别取证。

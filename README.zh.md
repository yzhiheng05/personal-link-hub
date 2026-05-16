# Personal Link Hub

一个基于 Cloudflare Workers 的单用户个人链接收藏墙应用，使用 D1 存储链接、分类和标签数据。

## 当前版本包含

- 单一 Worker 入口，同时提供 API 路由和静态页面
- D1 数据库结构，包含链接、分类、标签和链接-标签关系
- 基于 Cookie 的管理员登录
- 手动创建链接，并可在详情页编辑可选元数据
- 链接列表、详情、编辑、归档和短链路由
- 支持按标题、URL 和备注搜索
- 支持分类和标签筛选
- 重复 URL 提示，并可跳转到已有链接详情
- 对无效输入和重复分类/标签名称提供明确校验与失败提示

## 本地开发

1. 安装依赖：`npm install`
2. 复制 `.dev.vars.example` 为 `.dev.vars`
3. 在 `.dev.vars` 中设置你自己的 `ADMIN_PASSWORD`
4. 创建 D1 数据库：`npx wrangler d1 create link_hub`
5. 应用本地迁移：`npm run db:migrate:local`
6. 启动开发服务：`npm run dev`

## 本地路由

通过 Wrangler assets 提供静态页面时，HTML 页面使用无扩展名路由：

- `/login`
- `/`
- `/new`
- `/link?id=<id>`
- `/taxonomy`

## 必需的密码配置

`ADMIN_PASSWORD` 是必需配置。Worker 会在每次请求时检查这个绑定；如果没有配置，应用会返回 `Missing ADMIN_PASSWORD environment variable.`，登录页和后台都无法正常使用。

- 本地开发从 `.dev.vars` 读取 `ADMIN_PASSWORD`。
- `.dev.vars.example` 只是示例文件；需要复制为 `.dev.vars`，并把值换成你自己的密码。
- Cloudflare 生产环境不会读取 `.dev.vars`，部署前必须把 `ADMIN_PASSWORD` 设置为 Worker Secret。

## 部署到 Cloudflare

生产环境必须同时配置名为 `DB` 的 D1 绑定，以及名为 `ADMIN_PASSWORD` 的 Secret。两者缺一不可。

1. 如果是新拉取的项目，先安装依赖：`npm install`。
2. 登录 Wrangler：`npx wrangler login`。如果在 CI 中部署，则提供具备 Workers 和 D1 管理权限的 `CLOUDFLARE_API_TOKEN`。
3. 如果还没有生产 D1 数据库，创建一个：`npx wrangler d1 create link_hub`。
4. 打开 Cloudflare 控制台，进入 Workers 和 Pages，选择 `personal-link-hub`，确认 D1 数据库绑定：
   - 绑定变量名：`DB`
   - D1 数据库：`link_hub`
5. 应用远程 D1 迁移：`npm run db:migrate:remote`。
6. 设置生产管理员密码 Secret：`npx wrangler secret put ADMIN_PASSWORD`。输入你想在 `/login` 使用的后台密码。
7. 也可以在 Cloudflare 控制台的 Worker 设置、变量和机密中检查 Secret。Secret 名称必须精确为 `ADMIN_PASSWORD`。
8. 发布前先验证打包但不发布：`npx wrangler deploy --dry-run`。
9. 部署到 Cloudflare：`npm run deploy`。
10. 打开部署后的地址，访问 `/login`，使用刚才设置的 `ADMIN_PASSWORD` 登录。
11. 可选：对生产环境运行 smoke 测试：
    - PowerShell：`$env:BASE_URL='https://<your-domain-or-worker-url>'; $env:SMOKE_PASSWORD='<admin-password>'; node scripts/local-smoke.mjs`
    - `SMOKE_PASSWORD` 必须与 Cloudflare 中的 `ADMIN_PASSWORD` Secret 值一致。

## Smoke 测试约定

`scripts/local-smoke.mjs` 支持以下环境变量：

- `BASE_URL`：目标服务地址，默认 `http://127.0.0.1:8787`
- `SMOKE_PASSWORD`：目标环境的登录密码。如果不设置，脚本会使用 `admin123`；只有当你的 `ADMIN_PASSWORD` 也配置为 `admin123` 时才会成功。

同一个脚本可同时用于本地验证和 `workers.dev` 线上回归。

## 说明

- 当前版本在 `links` 中只保留 `visit_count` 和 `last_visited_at`
- 新链接通过手动输入创建，额外元数据可以之后在详情页补充
- URL 校验会阻止明显的 localhost 和私有网络目标，但不会做 DNS 层面的私有 IP 解析
- `wrangler.jsonc` 通过名称声明 D1 绑定，并有意不保存 `database_id`；如果采用控制台管理部署，请在 Cloudflare 控制台中将 `DB` 绑定到 `link_hub`
- 生产密码必须通过 Wrangler Secret 或 Cloudflare 控制台显式提供，不要依赖 `.dev.vars` 进行生产部署

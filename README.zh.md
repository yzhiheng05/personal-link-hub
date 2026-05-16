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
3. 在 `.dev.vars` 中设置 `ADMIN_PASSWORD`
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

## 本地开发凭据

当前本地开发凭据由 `.dev.vars` 控制。当前本地配置中：

- 密码：`admin123`

## 生产部署

当前项目按单一 `workers.dev` 部署目标准备。

1. 使用 `npx wrangler login` 登录 Wrangler，或提供可管理 Workers 和 D1 的 `CLOUDFLARE_API_TOKEN`。
2. 创建或选择名为 `link_hub` 的生产 D1 数据库。
3. 将 D1 数据库绑定到 Worker，绑定名必须是 `DB`。在 Cloudflare 控制台中添加 D1 数据库绑定，变量名称填 `DB`，数据库选择 `link_hub`。
4. 应用远程迁移：`npm run db:migrate:remote`
5. 设置生产 Secret：
   - `npx wrangler secret put ADMIN_PASSWORD`
6. 发布前验证打包：`npx wrangler deploy --dry-run`
7. 部署到 Cloudflare：`npm run deploy`
8. 保存部署后的 `https://<worker>.workers.dev` 地址，并对线上环境运行 smoke 回归：
   - PowerShell：`$env:BASE_URL='https://<worker>.workers.dev'; $env:SMOKE_PASSWORD='<admin-password>'; node scripts/local-smoke.mjs`

## Smoke 测试约定

`scripts/local-smoke.mjs` 支持以下环境变量：

- `BASE_URL`：目标服务地址，默认 `http://127.0.0.1:8787`
- `SMOKE_PASSWORD`：登录密码，默认 `admin123`

同一个脚本可同时用于本地验证和 `workers.dev` 线上回归。

## 说明

- 当前版本在 `links` 中只保留 `visit_count` 和 `last_visited_at`
- 新链接通过手动输入创建，额外元数据可以之后在详情页补充
- URL 校验会阻止明显的 localhost 和私有网络目标，但不会做 DNS 层面的私有 IP 解析
- `wrangler.jsonc` 通过名称声明 D1 绑定，并有意不保存 `database_id`；如果采用控制台管理部署，请在 Cloudflare 控制台中将 `DB` 绑定到 `link_hub`
- 生产密码必须通过 Wrangler Secret 显式提供，不要依赖 `.dev.vars` 进行生产部署

# 微信公众号管理（DSH 插件）

从 DeepSeek Harness（DSH）左侧栏管理微信公众号：素材、草稿、发布与账号状态。所有能力同时注册为 Agent 工具（`wechat_*`），面板与对话共用同一套 Host 服务。

## 功能

- **素材管理**：图片等永久素材上传、列表、分页、删除。
- **草稿箱**：所见即所得富文本编辑、多图文（1–8 篇，可增删排序）、正文内图片上传（`/media/uploadimg`，不占素材库配额）、封面从永久图片素材选择、原文链接 / 显示封面 / 评论开关等完整微信字段；草稿新建、编辑、删除、发布。
- **发布管理**：已发布文章列表与删除（需公众号开通「发布」权限）。
- **账号设置**：在侧边栏凭据保险箱保存 AppID/AppSecret，测试连接、清除凭据。
- **Agent 工具**：14 个 `wechat_*` 工具，供智能体在对话中调用。

## 安装

在 DSH 中通过插件管理器安装本地 Bundle：

1. DSH → 插件 → 安装本地插件（Bundle）。
2. 选择本仓库目录（含 `package.json` / `index.js` / `client.js`）。
3. 安装后左侧栏出现 **微信公众号** 入口，点击打开面板。

或：

```text
install_bundle target=<本目录绝对路径>
```

## 使用前提

1. 需要一个**认证服务号**（订阅号/未认证号无草稿、发布、素材管理接口权限）。
2. 在「设置」页填入 AppID / AppSecret，凭据存入 DSH 侧边栏凭据保险箱；明文不会进入模型上下文。
3. 把 DSH 运行机器的出口 IP 加入公众号「IP 白名单」（`开发 → 基本配置 → IP 白名单`）。
4. 封面图必须是**永久图片素材**的 media_id：先在「素材」页上传图片，再在草稿里选用。
5. 发布接口（`freepublish`）需公众号开通群发/发布能力；未开通时仅「已发布」列表不可用，素材与草稿不受影响。

## 安全约定

- AppID / AppSecret 存 DSH 凭据保险箱，不写入插件配置、不随代码分发。
- 所有写操作（删除、发布、上传）在 UI 中均需二次确认。
- Host HTTP 写接口校验同源 Origin 与 `Content-Type: application/json`，防 CSRF。
- Agent 工具的危险操作要求显式 `confirm: true`。

## 目录结构

```text
index.js            Host 端：微信 API 服务、HTTP 路由、Agent 工具、凭据读取
wechat-api.js       微信公众平台 API 客户端（token 缓存、multipart 上传、错误处理）
client.js           Web 端：侧栏图标 + 主面板 + 素材/草稿/发布/设置四个 Tab
cordis.patch.yml    静态 Bundle 注入声明
locale/zh.json      中文文案
locale/en.json      英文文案
icon.svg            侧栏图标
```

## 已知限制

- 微信 `draft/update` 不能增删文章篇数；多图文整篇保存采用「新建草稿 + 删除旧草稿」，新草稿的 media_id 会变化。
- 正文富文本基于 `document.execCommand`（浏览器已废弃 API，但仍被广泛支持）；粘贴外部样式可能带入额外 HTML，发布前请用「预览」检查。
- 面板改动后需刷新 DSH 界面才能加载新的 client 代码。

## 许可

MIT

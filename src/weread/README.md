# 微信读书 Agent API 使用整理

参考项目已下载到：

- `docs/obsidian-weread-plugin`
- 关键参考文件：`docs/obsidian-weread-plugin/src/api.ts`
- API 文档：`docs/obsidian-weread-plugin/docs/weread-agent-api.md`

## 网关

统一网关：

```text
POST https://i.weread.qq.com/api/agent/gateway
Authorization: Bearer <WEREAD_API_KEY>
Content-Type: application/json
```

请求体规则：

- `api_name` 必填，用来选择实际接口。
- `skill_version` 必填，参考项目当前使用 `1.0.3`。
- 业务参数平铺在 JSON 顶层，不包在 `params` 或 `data` 里。
- `errcode` 非 `0` 时按失败处理。

最小请求：

```json
{
  "api_name": "/store/search",
  "skill_version": "1.0.3",
  "keyword": "三体",
  "scope": 10,
  "count": 20
}
```

## 已接入本项目的公开模块

模块位置：

```text
src/weread/agent.ts
src/weread/Weread.vue
```

注册入口：

```text
src/utils/HttpSources.ts
```

在 SiReader 的“微信读书”页面或“来源管理”里启用 `微信读书 Agent API`，把 API Key 填到密码/API Key 输入框。当前书源配置类型还没有单独的 `apiKey` 字段，所以暂用 `auth.password` 保存。

当前实现先接入搜索：

- API：`/store/search`
- 返回：微信读书书籍元信息、封面、作者、简介、详情页、网页版阅读页
- 下载：不支持，微信读书 Agent API 返回的是平台书籍数据，不是 EPUB/PDF 文件直链

## Agent 可调用接口速查

常用接口：

| 目的 | api_name | 关键参数 |
| --- | --- | --- |
| 搜索书籍 | `/store/search` | `keyword`, `scope`, `count`, `maxIdx` |
| 书架 | `/shelf/sync` | 无 |
| 书籍详情 | `/book/info` | `bookId` |
| 章节目录 | `/book/chapterinfo` | `bookId` |
| 阅读进度 | `/book/getprogress` | `bookId` |
| 笔记本概览 | `/user/notebooks` | 无 |
| 单本划线 | `/book/bookmarklist` | `bookId` |
| 个人想法 | `/review/list/mine` | `bookid`，注意小写 |
| 热门划线 | `/book/bestbookmarks` | `bookId`, `chapterUid` |
| 阅读统计 | `/readdata/detail` | `mode`, `baseTime` |

## 本地验证

无 API Key 时，只验证网关是否可达以及鉴权失败路径：

```powershell
node src/weread/verify-weread-agent.mjs
```

有 API Key 时跑真实搜索：

```powershell
$env:WEREAD_API_KEY='wrk-xxxx'
node src/weread/verify-weread-agent.mjs
```

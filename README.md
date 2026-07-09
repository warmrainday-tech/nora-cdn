# nora-cdn

Cloudflare Worker — 以 GitHub 仓库为存储后端的图床 / CDN 代理 + 配置同步 API。
为绫月乃萝粉丝站服务。

## 架构

```
粉丝站前端 ──▶ Cloudflare Worker (nora-cdn) ──▶ GitHub Contents API
                ↑ CDN 代理层，隐藏 token            ↑ 免费存储
```

- **存储后端**：GitHub 仓库 `warmrainday-tech/nora-cdn`
- **CDN 层**：Cloudflare Worker `nora-cdn`
- **访问地址**：`https://nora-cdn.warmrainday.workers.dev`

## 端点

| Method | Path | 功能 |
|--------|------|------|
| GET | `/` | 健康检查，返回 `{"status":"ok","service":"nora-cdn"}` |
| GET | `/image?path=xxx` | 代理读取仓库中的图片 |
| POST | `/upload` | 上传图片到仓库 `images/uploads/` (multipart/form-data) |
| GET | `/config` | 读取 `js/config.json` |
| POST | `/config` | 更新 `js/config.json` (body: raw JSON) |

## 使用方法

### 读取图片

```
GET https://nora-cdn.warmrainday.workers.dev/image?path=images/avatar.jpg
```

- `path` 参数为仓库内相对路径，如 `images/avatar.jpg`、`images/uploads/xxx.jpg`
- 小文件（<500KB）：Worker 解码 base64 后直接返回图片二进制
- 大文件（>500KB）：Worker 通过 GitHub download_url 中转返回
- 返回头包含 `Content-Type` 和 `Cache-Control: public, max-age=86400`（24小时缓存）
- 路径中包含 `..` 会被拒绝

**前端示例：**

```html
<img src="https://nora-cdn.warmrainday.workers.dev/image?path=images/avatar.jpg" alt="头像">
<img src="https://nora-cdn.warmrainday.workers.dev/image?path=images/uploads/1783566442827_g2rf59.jpg" alt="上传图片">
```

### 上传图片

```
POST https://nora-cdn.warmrainday.workers.dev/upload
Content-Type: multipart/form-data
Body: file=<图片文件>
```

- 仅允许图片类型：JPEG、PNG、GIF、WebP、SVG
- 单文件上限 8MB
- 文件名自动生成：`{时间戳}_{随机6字符}.{原扩展名}`
- 存储路径：`images/uploads/{文件名}`

**返回值：**

```json
{
  "url": "https://nora-cdn.warmrainday.workers.dev/image?path=images%2Fuploads%2F1783566442827_g2rf59.jpg",
  "path": "images/uploads/1783566442827_g2rf59.jpg"
}
```

**前端示例：**

```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);

const resp = await fetch('https://nora-cdn.warmrainday.workers.dev/upload', {
  method: 'POST',
  body: formData
});
const data = await resp.json();
console.log(data.url);  // 图片代理 URL
```

**curl 示例：**

```bash
curl -X POST https://nora-cdn.warmrainday.workers.dev/upload \
  -F "file=@avatar.jpg;type=image/jpeg"
```

### 读取配置

```
GET https://nora-cdn.warmrainday.workers.dev/config
```

返回 `js/config.json` 的内容，如：

```json
{"theme":"dark","updated":"2026-07-09"}
```

### 更新配置

```
POST https://nora-cdn.warmrainday.workers.dev/config
Content-Type: application/json
Body: <JSON 字符串>
```

- Body 必须是合法 JSON
- 自动获取当前文件 SHA 并覆盖更新
- 返回 `{"ok":true}` 或 `{"ok":false,"error":"..."}`

**前端示例：**

```javascript
const resp = await fetch('https://nora-cdn.warmrainday.workers.dev/config', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ theme: 'light' })
});
const data = await resp.json();
console.log(data.ok);  // true
```

## 仓库目录结构

```
nora-cdn/
├── src/
│   └── worker.js          # Worker 主代码
├── images/                 # 图片存储
│   ├── avatar.jpg
│   ├── goods_*.jpg
│   ├── pixiv_hd_*.jpg
│   ├── vid_*.jpg
│   └── uploads/           # 用户上传目录
│       └── *.jpg
├── js/
│   └── config.json        # 站点配置文件
├── wrangler.toml          # Cloudflare Worker 配置
├── .gitignore
└── README.md
```

## 环境变量与密钥

| 名称 | 类型 | 说明 |
|------|------|------|
| `GH_REPO` | plain_text (vars) | GitHub 仓库地址，如 `warmrainday-tech/nora-cdn` |
| `GH_TOKEN` | secret | GitHub Personal Access Token，**通过 Cloudflare Dashboard 或 API 设置，不写入代码** |

## 部署方式

### 方式一：Cloudflare Dashboard

1. 进入 Cloudflare Dashboard → Workers & Pages
2. 创建新 Worker，命名为 `nora-cdn`
3. 粘贴 `src/worker.js` 内容
4. 在 Settings → Variables 中添加：
   - `GH_REPO` = `warmrainday-tech/nora-cdn` (plain text)
   - `GH_TOKEN` = `<你的 GitHub token>` (secret)

### 方式二：Cloudflare API

```bash
# 1. 上传 Worker 脚本
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/workers/scripts/nora-cdn" \
  -H "Authorization: Bearer <CF_TOKEN>" \
  -F "metadata=@metadata.json;type=application/json" \
  -F "worker.js=@src/worker.js;type=application/javascript+module"

# metadata.json 内容:
# {"main_module":"worker.js","bindings":[{"type":"plain_text","name":"GH_REPO","text":"warmrainday-tech/nora-cdn"}],"compatibility_date":"2025-05-18"}

# 2. 设置 GitHub Token secret
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/workers/scripts/nora-cdn/secrets" \
  -H "Authorization: Bearer <CF_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"GH_TOKEN","text":"<你的 GitHub token>","type":"secret_text"}'

# 3. 启用 workers.dev 子域名访问
curl -X POST "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/workers/scripts/nora-cdn/subdomain" \
  -H "Authorization: Bearer <CF_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"enabled":true}'
```

### 方式三：Wrangler CLI

```bash
npm install -g wrangler
wrangler login
wrangler secret put GH_TOKEN    # 粘贴 GitHub token
wrangler deploy
```

## 限制与安全

- 单文件上传上限 8MB
- 支持格式：JPEG、PNG、GIF、WebP、SVG
- 大文件（>500KB）通过 download_url 中转
- 路径穿越防护（`..` 被拦截）
- GitHub Token 通过 Cloudflare Secret 注入，不暴露在代码中
- CORS 允许所有来源（`*`），适合前端直接调用

## 技术细节

### 安全的 Base64 编码

Worker 使用分块循环替代 `String.fromCharCode(...spread)`，避免大文件栈溢出：

```javascript
function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
```

### 大文件处理

GitHub Contents API 对大文件返回 base64 编码内容，Worker 检测文件大小：
- <500KB：直接解码 base64 返回二进制
- >500KB：通过 `download_url` 中转，流式返回

## 相关凭证

- Cloudflare Account ID: `07e5efc49b4104cb780c1d51e5e19604`
- Cloudflare API Token: 存储在本地 `.secrets/cloudflare.md`
- GitHub 仓库: `warmrainday-tech/nora-cdn` (public)
- GitHub Token: 通过 `gh auth token` 获取当前有效 token

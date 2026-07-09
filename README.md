# nora-cdn

Cloudflare Worker — GitHub 仓库图床代理 + 配置同步 API，为绫月乃萝粉丝站服务。

## 端点

| Method | Path | 功能 |
|--------|------|------|
| GET | `/` | 健康检查 |
| GET | `/image?path=xxx` | 代理读取 GitHub 仓库中的图片 |
| POST | `/upload` | 上传图片到 GitHub 仓库 (multipart/form-data, field: `file`) |
| GET | `/config` | 读取 `js/config.json` |
| POST | `/config` | 更新 `js/config.json` (body: raw JSON) |

## 部署

```bash
# 1. 安装 wrangler
npm install -g wrangler

# 2. 登录 Cloudflare
wrangler login

# 3. 设置 GitHub Token (使用 fine-grained token, 仅需 repo:contents 读写权限)
wrangler secret put GH_TOKEN

# 4. 部署
wrangler deploy
```

## 配置

- `GH_REPO` — 在 `wrangler.toml` 的 `[vars]` 中设置
- `GH_TOKEN` — 通过 `wrangler secret put GH_TOKEN` 设置，**不要写入代码或配置文件**

## 限制

- 单文件上限 8MB（GitHub Contents API 实际限制约 100MB）
- 支持格式：JPEG, PNG, GIF, WebP, SVG
- 大文件（>500KB）通过 download_url 中转

# Token Market

大模型 API 中转与 Token 经营平台。一个 API Key 接入 OpenAI / Anthropic / DeepSeek 等多厂商模型，提供调用鉴权、输入/输出 Token 计量、按量与 Token 套餐包计费、额度管控、调用流水与账单对账。

- 兼容 **OpenAI**（`/v1/chat/completions`、`/v1/embeddings`、`/v1/models`）与 **Anthropic**（`/v1/messages`，可直接给 Claude Code 使用）两种协议，同协议直通、跨协议自动转换
- **防超卖**：Redis Lua 原子预扣 + PG 只追加账本，Redis 故障自动降级
- **流式计量**：上游 usage 优先、缺失自动估算，客户端断开按已生成部分结算
- **经营**：渠道多 Key / 优先级 / 权重 / 自动禁用与恢复、版本化定价、套餐包、毛利看板、三类自动对账
- 用户端（模型广场、API Key、钱包、套餐、操练场、日志、账单）与管理端（渠道、模型、计费、用户、订单、兑换码、对账、审计、设置）两个独立前端

架构与方案详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 快速开始

```bash
cp .env.example .env        # 修改 TM_JWT_SECRET / TM_CHANNEL_KEY_SECRET / TM_ROOT_PASSWORD 等
make up                     # 构建并启动（Docker 镜像源异常时：DOCKER_BUILDKIT=0 make up）
```

| 入口 | 地址 |
|---|---|
| 用户端 + API | http://localhost:8080 （API Base URL：`http://localhost:8080/v1`） |
| 管理端 | http://localhost:8081 （默认 root / ChangeMe123!） |

首次启动会自动迁移并初始化：root 管理员、用户分组、供应商、常用模型与参考价格、3 个套餐包、Mock 渠道。在 `.env` 中填写 `SEED_OPENAI_API_KEY` 等可自动创建对应官方渠道，也可以在管理端「渠道管理」中添加。

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer sk-xxx" -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"你好"}],"stream":true}'

# Claude Code
export ANTHROPIC_BASE_URL=http://localhost:8080
export ANTHROPIC_AUTH_TOKEN=sk-xxx
```

## 本地开发

```bash
make dev-infra              # 仅启动 Postgres(15432) + Redis(16379)
cd server && uv sync && cd ..
make migrate seed
make dev-mock               # :18090  Mock 上游（故障注入）
make dev-relay              # :18001
make dev-api                # :18000
make dev-worker
cd web && pnpm install && cd ..
make dev-console            # :5173
make dev-admin              # :5174
```

## 演示与测试

```bash
make bench         # 并发防超卖：naive vs Lua，端到端并发 + 对账
make fault         # 故障注入：客户端断开 / 上游截断 / 无 usage / 500 重试 / 401 自动禁用
make fault-redis   # 追加 Redis 宕机降级与恢复同步
make test          # 后端测试
make lint          # ruff + tsc
```

## 目录

```
server/          FastAPI：api（控制面）/ relay（数据面）/ worker（后台任务）
  app/relay/     鉴权、选渠道、上游适配、SSE 计量、主链路
  app/quota/     Redis Lua 额度引擎、PG 降级
  app/billing/   计价、记账、落库
  app/commerce/  订单、支付网关、兑换码
  app/channels/  渠道服务、测试、健康
  app/jobs/      计量消费、回收、对账、账单、巡检
web/             React + shadcn/ui：src/console（用户端）、src/admin（管理端）、src/shared
mock_upstream/   OpenAI / Anthropic 兼容 Mock，支持故障注入
scripts/         压测与故障演示
docs/            架构文档
```

## 生产部署检查清单

- [ ] 修改 `.env` 中所有密钥：`TM_JWT_SECRET`、`TM_CHANNEL_KEY_SECRET`（32 字节）、`TM_PAYMENT_NOTIFY_SECRET`、`TM_ROOT_PASSWORD`、`POSTGRES_PASSWORD`
- [ ] `TM_ENV=prod`（关闭 API 文档、启用 https 与内网地址校验）
- [ ] 管理端 81 端口仅内网 / VPN 可访问；80 端口前置 HTTPS
- [ ] 按 CPU 设置 `API_WORKERS` / `RELAY_WORKERS`，核对连接池预算
- [ ] Postgres 与 Redis 持久化卷备份
- [ ] 接入真实支付网关（实现 `server/app/commerce/payments/base.py` 中的 `PaymentProvider`）

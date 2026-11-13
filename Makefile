# Token Market 常用命令
PY := server/.venv/bin/python
export PYTHONPATH := server

.PHONY: help up down logs migrate seed dev-infra dev-api dev-relay dev-worker dev-mock dev-console dev-admin test lint bench fault fault-redis build

help:
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n",$$1,$$2}'

up: ## 构建并启动全部服务（docker compose）。镜像源异常时可用 DOCKER_BUILDKIT=0 make up
	docker compose up -d --build

down: ## 停止全部服务
	docker compose down

logs: ## 查看服务日志
	docker compose logs -f --tail=100 api relay worker

dev-infra: ## 本地开发：仅启动 Postgres + Redis
	docker compose up -d postgres redis

migrate: ## 执行数据库迁移
	cd server && .venv/bin/alembic upgrade head

seed: ## 初始化数据（root、分组、模型、价格、套餐、渠道）
	cd server && .venv/bin/python -m app.cli seed

dev-api: ## 本地运行控制面 :18000
	cd server && .venv/bin/uvicorn app.main_api:app --port 18000 --reload

dev-relay: ## 本地运行中转 :18001
	cd server && .venv/bin/uvicorn app.main_relay:app --port 18001

dev-worker: ## 本地运行 worker
	cd server && .venv/bin/python -m app.worker

dev-mock: ## 本地运行 Mock 上游 :18090
	cd mock_upstream && ../server/.venv/bin/uvicorn app:app --port 18090

dev-console: ## 前端用户端 :5173
	cd web && pnpm dev:console

dev-admin: ## 前端管理端 :5174
	cd web && pnpm dev:admin

test: ## 后端测试
	cd server && .venv/bin/pytest -q

lint: ## 代码检查
	cd server && .venv/bin/ruff check app && cd ../web && pnpm exec tsc -b

bench: ## 防超卖压测演示
	$(PY) scripts/bench_oversell.py --concurrency 300

fault: ## 故障注入与兜底演示
	$(PY) scripts/fault_demo.py

fault-redis: ## 故障演示（含 Redis 宕机降级）
	$(PY) scripts/fault_demo.py --redis-down

build: ## 构建前端
	cd web && pnpm run build

sweep: ## 接口巡检：调用全部管理端/用户端接口，报告 5xx
	$(PY) scripts/api_sweep.py

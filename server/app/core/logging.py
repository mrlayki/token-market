import logging
import sys


def setup_logging(level: str = "INFO") -> None:
    fmt = "%(asctime)s %(levelname)s [%(name)s] %(message)s"
    logging.basicConfig(level=level, format=fmt, stream=sys.stdout, force=True)
    for noisy in ("httpx", "httpcore", "LiteLLM", "litellm", "LiteLLM Router", "LiteLLM Proxy"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def configure_litellm() -> None:
    """LiteLLM 仅作为协议转换库使用：关闭其全局副作用。"""
    import os

    os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")
    import litellm

    litellm.suppress_debug_info = True
    litellm.drop_params = True  # 跨协议转换时丢弃目标厂商不支持的参数，避免 400
    litellm.turn_off_message_logging = True
    litellm.disable_streaming_logging = True
    litellm.success_callback = []
    litellm.failure_callback = []
    litellm.callbacks = []
    # /v1/messages → OpenAI 兼容渠道时走 chat/completions（DeepSeek/通义等不支持 Responses API）
    litellm.use_chat_completions_url_for_anthropic_messages = True
    if hasattr(litellm, "disable_aiohttp_transport"):
        litellm.disable_aiohttp_transport = True

"""Token 估算：用于预扣估算，以及上游未返回 usage 时的兜底计量（标记 estimated）。"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

import tiktoken


@lru_cache(maxsize=4)
def _enc(name: str):
    return tiktoken.get_encoding(name)


def count_text(text: str) -> int:
    if not text:
        return 0
    try:
        return len(_enc("o200k_base").encode(text, disallowed_special=()))
    except Exception:  # noqa: BLE001
        return len(text) // 2 + 1


def _content_text(content: Any) -> tuple[str, int]:
    """返回 (文本, 额外 token)，图片等多模态按固定开销估算。"""
    if content is None:
        return "", 0
    if isinstance(content, str):
        return content, 0
    extra = 0
    parts: list[str] = []
    if isinstance(content, list):
        for p in content:
            if not isinstance(p, dict):
                continue
            t = p.get("type")
            if t in ("text", "input_text"):
                parts.append(p.get("text", ""))
            elif t in ("image_url", "image", "input_image"):
                extra += 1000
            elif t == "tool_result":
                txt, ex = _content_text(p.get("content"))
                parts.append(txt)
                extra += ex
            elif t == "tool_use":
                parts.append(str(p.get("input", "")))
            elif t == "document":
                extra += 2000
    return "\n".join(parts), extra


def count_openai_messages(body: dict) -> int:
    total = 3
    for m in body.get("messages") or []:
        total += 4
        txt, extra = _content_text(m.get("content"))
        total += count_text(txt) + extra
        if m.get("tool_calls"):
            total += count_text(str(m["tool_calls"]))
    if body.get("tools"):
        total += count_text(str(body["tools"]))
    return total


def count_anthropic_messages(body: dict) -> int:
    total = 3
    system = body.get("system")
    if system:
        txt, extra = _content_text(system)
        total += count_text(txt) + extra
    for m in body.get("messages") or []:
        total += 4
        txt, extra = _content_text(m.get("content"))
        total += count_text(txt) + extra
    if body.get("tools"):
        total += count_text(str(body["tools"]))
    return total


def count_embedding_input(body: dict) -> int:
    inp = body.get("input")
    if isinstance(inp, str):
        return count_text(inp)
    if isinstance(inp, list):
        return sum(count_text(x) if isinstance(x, str) else len(x) for x in inp)
    return 0

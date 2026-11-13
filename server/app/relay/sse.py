"""增量 SSE 解析：按空行切分事件，保留原始帧以便原样转发。"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class SSEEvent:
    event: str | None
    data: str
    raw: bytes


class SSEParser:
    def __init__(self) -> None:
        self._buf = b""

    def feed(self, chunk: bytes) -> list[SSEEvent]:
        self._buf += chunk.replace(b"\r\n", b"\n")
        out: list[SSEEvent] = []
        while True:
            idx = self._buf.find(b"\n\n")
            if idx < 0:
                break
            frame, self._buf = self._buf[:idx], self._buf[idx + 2:]
            ev = self._parse(frame)
            if ev:
                out.append(ev)
        return out

    def flush(self) -> list[SSEEvent]:
        if self._buf.strip():
            ev = self._parse(self._buf)
            self._buf = b""
            return [ev] if ev else []
        return []

    @staticmethod
    def _parse(frame: bytes) -> SSEEvent | None:
        event = None
        data_lines: list[str] = []
        for line in frame.decode("utf-8", errors="replace").split("\n"):
            if not line or line.startswith(":"):
                continue
            field, _, value = line.partition(":")
            value = value[1:] if value.startswith(" ") else value
            if field == "event":
                event = value
            elif field == "data":
                data_lines.append(value)
        if event is None and not data_lines:
            return None
        return SSEEvent(event=event, data="\n".join(data_lines), raw=frame + b"\n\n")


def encode(data: str, event: str | None = None) -> bytes:
    head = f"event: {event}\n" if event else ""
    return f"{head}data: {data}\n\n".encode()

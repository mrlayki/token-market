from fastapi import Request
from fastapi.responses import JSONResponse


class AppError(Exception):
    """控制面业务异常，统一响应 {"code", "message"}。"""

    def __init__(self, message: str, *, status: int = 400, code: str = "bad_request"):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


class NotFound(AppError):
    def __init__(self, message: str = "资源不存在"):
        super().__init__(message, status=404, code="not_found")


class Forbidden(AppError):
    def __init__(self, message: str = "无权限"):
        super().__init__(message, status=403, code="forbidden")


class Unauthorized(AppError):
    def __init__(self, message: str = "未登录或登录已过期"):
        super().__init__(message, status=401, code="unauthorized")


class Conflict(AppError):
    def __init__(self, message: str):
        super().__init__(message, status=409, code="conflict")


async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    return JSONResponse({"code": exc.code, "message": exc.message}, status_code=exc.status)


class RelayError(Exception):
    """数据面（/v1/*）异常，按 OpenAI 错误格式返回。"""

    def __init__(self, message: str, *, status: int = 400, type_: str = "invalid_request_error",
                 code: str | None = None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.type = type_
        self.code = code

    def to_openai(self) -> dict:
        return {"error": {"message": self.message, "type": self.type, "code": self.code, "param": None}}

    def to_anthropic(self) -> dict:
        return {"type": "error", "error": {"type": self.type, "message": self.message}}


class InsufficientQuota(RelayError):
    def __init__(self, message: str = "额度不足，请充值或购买套餐包"):
        super().__init__(message, status=402, type_="insufficient_quota", code="insufficient_quota")

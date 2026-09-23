/** 统一的 API 错误：携带 HTTP 状态码与机器可读的 code。 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static notFound(message = '资源不存在'): ApiError {
    return new ApiError(404, 'NOT_FOUND', message);
  }

  static validation(message: string, details?: unknown): ApiError {
    return new ApiError(400, 'VALIDATION_ERROR', message, details);
  }

  static invalidState(message: string): ApiError {
    return new ApiError(409, 'INVALID_STATE', message);
  }
}

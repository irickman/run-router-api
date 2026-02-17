export type ErrorCode =
  | 'MISSING_FIELD'
  | 'NOT_FOUND'
  | 'BAD_REQUEST'
  | 'UPSTREAM_ERROR'
  | 'INTERNAL_ERROR';

export class HttpError extends Error {
  public readonly status: number;
  public readonly code: ErrorCode;

  constructor(status: number, code: ErrorCode, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function errorResponse(status: number, code: ErrorCode, error: string) {
  return { status, body: { error, code } };
}

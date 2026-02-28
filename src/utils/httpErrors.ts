export type ErrorCode =
  | 'MISSING_FIELD'
  | 'NOT_FOUND'
  | 'BAD_REQUEST'
  | 'UPSTREAM_ERROR'
  | 'ROUTE_CONSTRAINT'
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

export type ConstraintReason = 'LANDMARK_TOO_FAR' | 'NO_ROUTE_FOUND' | 'DISTANCE_UNREACHABLE';

export class RouteConstraintError extends HttpError {
  public readonly reason: ConstraintReason;
  public readonly explanation: string;
  public readonly suggestedDistanceMiles?: number;

  constructor(opts: {
    reason: ConstraintReason;
    explanation: string;
    suggestedDistanceMiles?: number;
  }) {
    super(422, 'ROUTE_CONSTRAINT', opts.explanation);
    this.reason = opts.reason;
    this.explanation = opts.explanation;
    this.suggestedDistanceMiles = opts.suggestedDistanceMiles;
  }
}

export function errorResponse(status: number, code: ErrorCode, error: string) {
  return { status, body: { error, code } };
}

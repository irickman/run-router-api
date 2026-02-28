import type { ApiError } from '../api';

interface ErrorDisplayProps {
  error: ApiError;
  onRetry: () => void;
}

function getErrorMessage(error: ApiError): string {
  if (error.code === 'ROUTE_CONSTRAINT' && error.explanation) return error.explanation;
  const msg = error.error?.toLowerCase() ?? '';
  const code = error.code?.toUpperCase() ?? '';
  if (code === 'MISSING_FIELD' || msg.includes('query')) return 'Invalid query. Please describe your route clearly.';
  if (code === 'NOT_FOUND' || msg.includes('not found')) return 'Route not found.';
  if (msg.includes('network') || msg.includes('fetch')) return 'Network error. Check your connection and try again.';
  if (code === 'UPSTREAM_ERROR') return 'Service temporarily unavailable. Please try again.';
  return error.error || 'Something went wrong. Please try again.';
}

export function ErrorDisplay({ error, onRetry }: ErrorDisplayProps) {
  const isConstraint = error.code === 'ROUTE_CONSTRAINT';

  return (
    <div className={`rounded-lg border p-4 ${
      isConstraint ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50'
    }`}>
      <p className={`mb-3 ${isConstraint ? 'text-amber-800' : 'text-red-800'}`}>
        {getErrorMessage(error)}
      </p>
      {error.suggestedDistanceMiles && (
        <p className="text-sm text-amber-700 mb-3">
          Suggested minimum: ~{error.suggestedDistanceMiles} miles
        </p>
      )}
      <button
        type="button"
        onClick={onRetry}
        className={`px-4 py-2 text-white rounded-lg font-medium ${
          isConstraint ? 'bg-amber-600 hover:bg-amber-700' : 'bg-red-600 hover:bg-red-700'
        }`}
      >
        {isConstraint ? 'Try Again' : 'Retry'}
      </button>
    </div>
  );
}

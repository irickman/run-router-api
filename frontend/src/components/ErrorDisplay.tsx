import type { ApiError } from '../api';

interface ErrorDisplayProps {
  error: ApiError;
  onRetry: () => void;
}

function getErrorMessage(error: ApiError): string {
  const msg = error.error?.toLowerCase() ?? '';
  const code = error.code?.toUpperCase() ?? '';
  if (code === 'MISSING_FIELD' || msg.includes('query')) return 'Invalid query. Please describe your route clearly.';
  if (code === 'NOT_FOUND' || msg.includes('not found')) return 'Route not found.';
  if (msg.includes('network') || msg.includes('fetch')) return 'Network error. Check your connection and try again.';
  if (code === 'UPSTREAM_ERROR') return 'Service temporarily unavailable. Please try again.';
  return error.error || 'Something went wrong. Please try again.';
}

export function ErrorDisplay({ error, onRetry }: ErrorDisplayProps) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4">
      <p className="text-red-800 mb-3">{getErrorMessage(error)}</p>
      <button
        type="button"
        onClick={onRetry}
        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
      >
        Retry
      </button>
    </div>
  );
}

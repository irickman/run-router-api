import { View, Text, TouchableOpacity } from 'react-native';
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
    <View className="rounded-xl p-4" style={{ backgroundColor: isConstraint ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)', borderWidth: 1, borderColor: isConstraint ? 'rgba(245,158,11,0.3)' : 'rgba(239,68,68,0.3)' }}>
      <Text style={{ color: isConstraint ? '#fbbf24' : '#fca5a5', marginBottom: 8 }}>
        {getErrorMessage(error)}
      </Text>
      {error.suggestedDistanceMiles ? (
        <Text style={{ color: '#fbbf24', fontSize: 12, marginBottom: 8 }}>
          Suggested minimum: ~{error.suggestedDistanceMiles} miles
        </Text>
      ) : null}
      <TouchableOpacity
        onPress={onRetry}
        className="px-4 py-2 rounded-lg items-center"
        style={{ backgroundColor: isConstraint ? 'rgba(245,158,11,0.25)' : 'rgba(239,68,68,0.25)' }}
      >
        <Text style={{ color: '#fff', fontWeight: '600' }}>{isConstraint ? 'Try Again' : 'Retry'}</Text>
      </TouchableOpacity>
    </View>
  );
}

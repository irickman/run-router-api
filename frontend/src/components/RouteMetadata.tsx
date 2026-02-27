import { useState } from 'react';
import type { RouteParameters } from '../types';

interface RouteMetadataProps {
  name: string;
  parameters: RouteParameters;
}

function getConfidenceLabel(overall: number): 'High' | 'Medium' | 'Low' {
  if (overall >= 0.8) return 'High';
  if (overall >= 0.5) return 'Medium';
  return 'Low';
}

export function RouteMetadata({ name, parameters }: RouteMetadataProps) {
  const [expanded, setExpanded] = useState(false);
  const assumptions = parameters.confidence?.assumptions ?? [];

  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm text-gray-500">Route name</div>
        <div className="font-medium">{name}</div>
      </div>
      <div>
        <div className="text-sm text-gray-500">Confidence</div>
        <div className="font-medium">{getConfidenceLabel(parameters.confidence?.overall ?? 0)}</div>
      </div>
      {assumptions.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-sm text-blue-600 hover:underline flex items-center gap-1"
          >
            {expanded ? 'Hide' : 'Show'} AI assumptions
            <span className="text-xs">{expanded ? '▲' : '▼'}</span>
          </button>
          {expanded && (
            <ul className="mt-1 text-sm text-gray-600 list-disc list-inside space-y-1">
              {assumptions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

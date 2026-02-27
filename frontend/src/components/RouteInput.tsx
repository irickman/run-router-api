import { useState, useEffect, useRef } from 'react';

const PLACEHOLDERS = [
  '10k loop from Green Lake with minimal elevation gain',
  'Half marathon through Discovery Park and along the water',
  'Easy 5 mile run around Capitol Hill',
  'Trail run starting from Seward Park, hilly terrain preferred',
];

const MAX_CHARS = 500;

interface RouteInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  loading?: boolean;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}

export function RouteInput({
  value,
  onChange,
  onSubmit,
  disabled,
  loading,
  inputRef,
}: RouteInputProps) {
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const localRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = inputRef ?? localRef;

  useEffect(() => {
    const id = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % PLACEHOLDERS.length);
    }, 4000);
    return () => clearInterval(id);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim()) onSubmit();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <textarea
        ref={textareaRef as React.RefObject<HTMLTextAreaElement>}
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, MAX_CHARS))}
        onKeyDown={handleKeyDown}
        placeholder={PLACEHOLDERS[placeholderIdx]}
        rows={3}
        minLength={1}
        maxLength={MAX_CHARS}
        disabled={disabled}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
        aria-label="Describe your route"
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">
          {value.length}/{MAX_CHARS}
        </span>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!value.trim() || loading || disabled}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {loading ? (
            <>
              <svg
                className="animate-spin h-4 w-4"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Generating...
            </>
          ) : (
            'Generate Route'
          )}
        </button>
      </div>
    </div>
  );
}

import { useState } from 'react';

interface SidebarProps {
  /** Desktop: always shown. Mobile: top overlay when hasInput. */
  inputContent: React.ReactNode;
  /** Desktop: shown when hasRoute. Mobile: bottom sheet when hasRoute. */
  statsContent: React.ReactNode;
  hasRoute: boolean;
}

export function Sidebar({ inputContent, statsContent, hasRoute }: SidebarProps) {
  const [cardExpanded, setCardExpanded] = useState(true);
  const [sheetExpanded, setSheetExpanded] = useState(true);

  return (
    <>
      {/* Desktop: left sidebar 400px */}
      <aside className="hidden lg:flex lg:w-[400px] lg:flex-shrink-0 lg:flex-col lg:border-r lg:border-gray-200 lg:bg-white lg:overflow-y-auto">
        <div className="p-6">{hasRoute ? statsContent : inputContent}</div>
      </aside>

      {/* Mobile: top overlay card - input when no route */}
      {!hasRoute && (
        <div className="lg:hidden fixed top-0 left-0 right-0 z-40 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="bg-white rounded-xl shadow-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setCardExpanded(!cardExpanded)}
              className="w-full px-4 py-3 flex items-center justify-between text-left font-medium"
            >
              <span>Describe your route</span>
              <span className="text-gray-400">{cardExpanded ? '▲' : '▼'}</span>
            </button>
            {cardExpanded && (
              <div className="px-4 pb-4 pt-0 border-t border-gray-100">
                {inputContent}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mobile: bottom sheet for stats when route exists */}
      {hasRoute && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 pb-[env(safe-area-inset-bottom)]">
          <button
            type="button"
            onClick={() => setSheetExpanded(!sheetExpanded)}
            className="w-full px-4 py-3 bg-white border-t border-gray-200 rounded-t-xl shadow-lg flex items-center justify-between font-medium"
          >
            <span>{sheetExpanded ? 'Hide' : 'Show'} stats</span>
            <span className="text-gray-400">{sheetExpanded ? '▼' : '▲'}</span>
          </button>
          {sheetExpanded && (
            <div className="bg-white border-t border-gray-200 max-h-[50vh] overflow-y-auto p-4">
              {statsContent}
            </div>
          )}
        </div>
      )}
    </>
  );
}

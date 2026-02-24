import React from 'react';
import { FiChevronLeft, FiChevronRight, FiMessageSquare } from 'react-icons/fi';

type Props = {
  streamingEvents: any[];
  showStreamingPanel: boolean;
  agentThinkingOpen: boolean;
  setAgentThinkingOpen: (open: boolean) => void;
  streamingPanelRef: React.RefObject<HTMLDivElement>;
  expandedClass?: string; // e.g. 'w-80' or 'w-72'
  collapsedClass?: string; // e.g. 'w-12' or 'w-10'
  containerHeightClass?: string; // e.g. 'h-[calc(100vh-240px)]'
};

const AgentThinking: React.FC<Props> = ({
  streamingEvents,
  showStreamingPanel,
  agentThinkingOpen,
  setAgentThinkingOpen,
  streamingPanelRef,
  expandedClass = 'w-80',
  collapsedClass = 'w-12',
  containerHeightClass = 'h-[calc(100vh-240px)]',
}) => {
  if (!showStreamingPanel && (!streamingEvents || streamingEvents.length === 0)) return null;

  return (
    <div className={`transition-all duration-300 flex-shrink-0 ${agentThinkingOpen ? expandedClass : collapsedClass}`}>
      <div className={`flex flex-col bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden sticky top-4 ${agentThinkingOpen ? containerHeightClass : ''}`}>
        <button
          onClick={() => setAgentThinkingOpen(!agentThinkingOpen)}
          className={`border-b border-gray-200 bg-white flex items-center flex-shrink-0 hover:bg-gray-50 transition-colors w-full ${agentThinkingOpen ? 'px-4 py-3 gap-3 text-left' : 'p-3 justify-center flex-col gap-1'}`}
          title={agentThinkingOpen ? 'Collapse panel' : 'Expand Agent Thinking'}
        >
          {agentThinkingOpen ? (
            <>
              <FiChevronRight className="w-4 h-4 text-indigo-600 flex-shrink-0" />
              <FiMessageSquare className="w-4 h-4 text-indigo-600 flex-shrink-0" />
              <h2 className="text-lg font-bold text-gray-900 mb-2 tracking-tight">Agent Thinking</h2>
            </>
          ) : (
            <>
              <FiMessageSquare className="w-5 h-5 text-indigo-600" />
              <FiChevronLeft className="w-4 h-4 text-indigo-600" />
            </>
          )}
        </button>

        {agentThinkingOpen && (
          <div ref={streamingPanelRef} className="flex-1 overflow-y-auto p-4 bg-white">
            {streamingEvents.length === 0 ? (
              <div className="text-gray-400 text-sm">Waiting for agent output...</div>
            ) : (
              <div className="space-y-4">
                {streamingEvents.map((event, idx) => {
                  const content = event.content || event.message || '';
                  const eventType = event.type || `Event ${idx + 1}`;
                  const cleanContent = typeof content === 'string'
                    ? content
                        .replace(/^[^\w\s]*\s*/g, '')
                        .replace(/^STEP\s*\d+:\s*/i, '')
                        .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]/gu, '')
                        .trim()
                    : String(content);

                  if (!cleanContent) return null;

                  return (
                    <div key={idx} className="border-l-2 border-indigo-400 pl-4">
                      <div className="text-xs text-gray-500 mb-1 font-medium capitalize">{eventType}</div>
                      <p className="text-sm text-gray-800 leading-relaxed">{cleanContent}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {showStreamingPanel && agentThinkingOpen && (
          <div className="px-4 py-2 border-t border-gray-200 bg-gray-50 flex items-center gap-2 text-xs text-gray-600 flex-shrink-0">
            <div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            Processing...
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentThinking;

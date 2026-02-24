import React, { useState, useEffect, useRef, useMemo } from 'react';
import { FiChevronDown, FiChevronRight, FiChevronUp } from 'react-icons/fi';

type EventItem = {
  type: string;
  content: string;
} | string;

type Props = {
  aggregatedThinking: EventItem[];
  defaultOpen?: boolean;
  containerClass?: string;
  isStreaming?: boolean;
};

const AgentThinkingAccordion: React.FC<Props> = ({ aggregatedThinking, defaultOpen, containerClass, isStreaming = false }) => {
  const [open, setOpen] = useState<boolean>(defaultOpen ?? true);
  const [expandedGroupIndex, setExpandedGroupIndex] = useState<number | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const containerClassName = containerClass ?? 'max-w-full mx-auto px-6 pb-6';


  const getEventContent = (item: EventItem): string => {
    if (typeof item === 'string') return item;
    return item.content || '';
  };


  const getEventType = (item: EventItem): string => {
    if (typeof item === 'string') return 'Agent Thinking';
    return item.type ? item.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Agent Thinking';
  };


  const groupedThinking = useMemo(() => {
    const groups: EventItem[][] = [];
    let currentGroup: EventItem[] = [];
    for (let i = 0; i < aggregatedThinking.length; i++) {
      const item = aggregatedThinking[i];
      if (currentGroup.length === 0) {
        currentGroup.push(item);
        continue;
      }
      const currentType = getEventType(currentGroup[0]);
      const itemType = getEventType(item);
      if (itemType === currentType) {
        currentGroup.push(item);
      } else {
        groups.push(currentGroup);
        currentGroup = [item];
      }
    }
    if (currentGroup.length > 0) groups.push(currentGroup);
    return groups;
  }, [aggregatedThinking]);

  
  useEffect(() => {
    if (groupedThinking.length > 0) {
      setExpandedGroupIndex(groupedThinking.length - 1);
    }
  }, [groupedThinking.length]);

  
  useEffect(() => {
    if (contentRef.current && open) {
      try {
        contentRef.current.scrollTo({ top: contentRef.current.scrollHeight, behavior: 'smooth' });
      } catch (e) {
        
        contentRef.current.scrollTop = contentRef.current.scrollHeight;
      }
    }
  }, [aggregatedThinking, open]);

  const toggleGroupAccordion = (groupIdx: number) => {
    setExpandedGroupIndex(expandedGroupIndex === groupIdx ? null : groupIdx);
  };

  return (
    <div className={`${containerClassName} ${isStreaming && aggregatedThinking.length > 0 ? 'animate-pulse' : ''}`}>
      {/* Main Agent Thinking Header */}
      <div className="flex items-center justify-between py-2">
        <button
          onClick={() => setOpen((s) => !s)}
          className="flex items-center gap-3 text-left hover:text-gray-700 transition-colors"
        >
          <span className="text-gray-500">{open ? <FiChevronDown /> : <FiChevronRight />}</span>
          <span className="text-lg font-bold text-gray-900 tracking-tight">Agent Thinking</span>
        </button>
      </div>

      {open && (
        <div
          ref={contentRef}
          className="pl-4 text-md text-gray-800 max-h-48 overflow-y-auto"
          style={{ scrollBehavior: 'smooth' }}
        >
          {aggregatedThinking.length === 0 ? (
            <div className="text-gray-400">Waiting for agent output...</div>
          ) : (
            <div className="leading-relaxed rounded-lg border border-gray-600 px-4 py-4">
              {groupedThinking.map((group, groupIdx) => {
                // Get the type from the first event in the group
                const groupTitle = getEventType(group[0]);
                return (
                  <div key={groupIdx}>
                    {/* Inner Accordion Header */}
                      <button
                        onClick={() => toggleGroupAccordion(groupIdx)}
                        className="sticky top-0 bg-white z-10 w-full flex items-center gap-2 pb-2 hover:text-gray-700 transition-colors text-left px-2"
                      >
                      <span className="font-semibold text-md text-gray-800">
                        {groupTitle}
                      </span>
                      <span className="text-gray-600 flex-shrink-0">
                        {expandedGroupIndex === groupIdx ? (
                          <FiChevronDown size={18} />
                        ) : (
                          <FiChevronRight size={18} />
                        )}
                      </span>
                    </button>

                    {/* Inner Accordion Content */}
                    {expandedGroupIndex === groupIdx && (
                      <div className="py-1 ml-5 text-sm text-gray-800 leading-relaxed">
                        {group.map((item, itemIdx) => (
                          <span key={itemIdx}>
                            {getEventContent(item)}
                            {itemIdx < group.length - 1 && ' '}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AgentThinkingAccordion;

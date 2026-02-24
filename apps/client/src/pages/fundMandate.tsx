import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { API } from '../utils/constants';
import { FiSend, FiFile, FiTrash, FiChevronDown, FiChevronUp, FiX, FiChevronRight as FiArrowRight, FiPlus } from 'react-icons/fi';
import { FormControl, InputLabel, Select, MenuItem, Skeleton } from "@mui/material";
import toast from 'react-hot-toast';
import LogoAnimated from '../assets/logo-animated.svg';
import Header from '../components/Header';
import AgentThinking from '../components/AgentThinking';
import AgentThinkingAccordion from '../components/AgentThinkingAccordion';
import mockCapabilities from '../data/mock.json';

const FundMandate: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [fundName, setFundName] = useState('');
  const [fundSize, setFundSize] = useState('');
  // New inputs for redesigned Fund Mandate details
  const [legalName, setLegalName] = useState('');
  const [strategyType, setStrategyType] = useState('buyout');
  const [vintageYear, setVintageYear] = useState('');
  const [primaryAnalyst, setPrimaryAnalyst] = useState('');
  const [targetCount, setTargetCount] = useState('');
  const [processingDate, setProcessingDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [parsedResult, setParsedResult] = useState<any | null>(null);
  const [mandateId, setMandateId] = useState<number | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ file?: string; description?: string }>({});
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    sourcing: true,
    screening: true,
    risk: false,
  });
  // State for edited parameters
  const [editedSourcingParams, setEditedSourcingParams] = useState<Record<string, string>>({});
  const [editedScreeningParams, setEditedScreeningParams] = useState<Record<string, string>>({});
  const [editedRiskParams, setEditedRiskParams] = useState<Record<string, string>>({});
  // New: per-subprocess edited parameters keyed by subprocess name
  const [editedParamsBySubprocess, setEditedParamsBySubprocess] = useState<Record<string, Record<string, string>>>({});

  const [addParamModalOpen, setAddParamModalOpen] = useState(false);
  const [addParamSection, setAddParamSection] = useState<'sourcing' | 'screening' | 'risk' | null>(null);
  const [addParamSubprocessName, setAddParamSubprocessName] = useState('');
  const [newParamName, setNewParamName] = useState('');
  const [newParamValue, setNewParamValue] = useState('');

  // Streaming state
  const [streamingEvents, setStreamingEvents] = useState<any[]>([]);
  const [showStreamingPanel, setShowStreamingPanel] = useState(false);
  const [showAccordion, setShowAccordion] = useState(false);
  const [agentThinkingOpen, setAgentThinkingOpen] = useState(true);
  const [wsConnId, setWsConnId] = useState<string | null>(null);

  // Capabilities modal state
  const [showCapabilitiesModal, setShowCapabilitiesModal] = useState(false);
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [capabilitiesResult, setCapabilitiesResult] = useState<any>(null);
  const [pendingSubmitData, setPendingSubmitData] = useState<{ file: File; description: string } | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [subprocesses, setSubprocesses] = useState<any[]>([]);
  const [capabilityParams, setCapabilityParams] = useState<Record<string, any>>({});

  const extractedParamsRef = useRef<HTMLDivElement>(null);
  const streamingPanelRef = useRef<HTMLDivElement>(null);
  const accordionRef = useRef<HTMLDivElement>(null);
  const lastProcessedStreamingCount = useRef(0);
  const [aggregatedThinking, setAggregatedThinking] = useState<any[]>([]);
  const navigate = useNavigate();

  // Ensure the first mandate parameter (subprocess) expands by default when results are shown
  useEffect(() => {
    if (isSubmitted && subprocesses && subprocesses.length > 0) {
      const firstId = subprocesses[0].id;
      setOpenSections((prev) => ({ ...prev, [firstId]: true }));
      setExpandedItems((prev) => new Set([...Array.from(prev), `subproc-${firstId}`]));
    }
  }, [isSubmitted, subprocesses]);

  // Auto-scroll to accordion when streaming starts
  useEffect(() => {
    if (showAccordion && accordionRef.current && showStreamingPanel) {
      setTimeout(() => {
        accordionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [showAccordion, showStreamingPanel]);

  // Auto-scroll to extracted parameters when streaming finishes
  useEffect(() => {
    if (isSubmitted && !showStreamingPanel && extractedParamsRef.current) {
      setTimeout(() => {
        extractedParamsRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }, 300);
    }
  }, [isSubmitted, showStreamingPanel]);

  // Auto-scroll streaming panel to bottom on new events
  useEffect(() => {
    if (streamingPanelRef.current) {
      streamingPanelRef.current.scrollTop = streamingPanelRef.current.scrollHeight;
    }
  }, [streamingEvents]);

  // Aggregate streaming events into typed items so AgentThinkingAccordion can group by type
  useEffect(() => {
    try {
      const prevCount = lastProcessedStreamingCount.current || 0;
      if (streamingEvents.length === 0) {
        // reset when stream cleared
        setAggregatedThinking([]);
        lastProcessedStreamingCount.current = 0;
        return;
      }

      if (streamingEvents.length > prevCount) {
        const newEvents = streamingEvents.slice(prevCount);
        const newEventData = newEvents.map((event: any) => {
          const content = event.content || event.message || '';
          const eventType = event.type || 'agent_thinking';
          const clean = typeof content === 'string'
            ? content
                .replace(/^[^\w\s]*\s*/g, '')
                .replace(/^STEP\s*\d+:\s*/i, '')
                .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]/gu, '')
                .trim()
            : String(content);
          return clean ? { type: eventType, content: clean } : null;
        }).filter(Boolean);

        if (newEventData.length > 0) {
          setAggregatedThinking((prev) => {
            const current = prev || [];
            return [...current, ...newEventData];
          });
        }
        lastProcessedStreamingCount.current = streamingEvents.length;
      }
    } catch (e) {
      console.error('Error aggregating streaming events', e);
    }
  }, [streamingEvents]);

  // Initialize edited parameters dynamically for all subprocesses when parsed result changes
  useEffect(() => {
    if (isSubmitted && parsedResult) {
      const paramsBySubprocess: Record<string, Record<string, string>> = {};

      const normalizeKeyVariants = (name: string) => {
        const variants = new Set<string>();
        variants.add(name);
        variants.add(name.replace(/\s+/g, '_'));
        variants.add(name.toLowerCase());
        variants.add(name.toLowerCase().replace(/\s+/g, '_'));
        return Array.from(variants);
      };

      subprocesses.forEach((sp: any) => {
        const subName = sp?.name;
        if (!subName) return;
        const variants = normalizeKeyVariants(subName);
        let source: any = null;

        for (const v of variants) {
          if (parsedResult?.criteria?.mandate?.[v]) {
            source = parsedResult.criteria.mandate[v];
            break;
          }
          if (parsedResult?.criteria?.[v]) {
            source = parsedResult.criteria[v];
            break;
          }
          if (parsedResult?.[v]) {
            source = parsedResult[v];
            break;
          }
          // try parameter-suffixed keys
          if (parsedResult?.criteria?.mandate?.[`${v}_parameters`]) {
            source = parsedResult.criteria.mandate[`${v}_parameters`];
            break;
          }
          if (parsedResult?.criteria?.[`${v}_parameters`]) {
            source = parsedResult.criteria[`${v}_parameters`];
            break;
          }
        }

        if (!source) return;

        const params: Record<string, string> = {};
        if (Array.isArray(source)) {
          source.forEach((it: any) => {
            const k = (it.key || it.name || String(it)).toString();
            params[k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())] = String(it.value ?? '');
          });
        } else if (typeof source === 'object') {
          Object.entries(source).forEach(([k, v]) => {
            params[k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())] = String(v ?? '');
          });
        }

        paramsBySubprocess[subName] = params;
      });

      setEditedParamsBySubprocess(paramsBySubprocess);

      // Backwards compatibility: populate legacy buckets with first three subprocesses if available
      const first = subprocesses[0]?.name;
      const second = subprocesses[1]?.name;
      const third = subprocesses[2]?.name;
      setEditedSourcingParams(paramsBySubprocess[first] || {});
      setEditedScreeningParams(paramsBySubprocess[second] || {});
      setEditedRiskParams(paramsBySubprocess[third] || {});
    }
  }, [isSubmitted, parsedResult, subprocesses]);

  const toggleSection = (section: string) => {
    setOpenSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const handleOpenAddParamModal = (section: 'sourcing' | 'screening' | 'risk', subprocessName: string) => {
    setAddParamSection(section);
    setNewParamName('');
    setAddParamSubprocessName(subprocessName);
    setNewParamValue('');
    setAddParamModalOpen(true);
  };

  const handleAddParameter = () => {
    if (!newParamName.trim()) {
      toast.error('Please enter a parameter name');
      return;
    }

    const paramKey = newParamName.trim();
    const paramValue = newParamValue.trim();

    // Persist per-subprocess (preferred)
    if (addParamSubprocessName) {
      setEditedParamsBySubprocess(prev => ({
        ...prev,
        [addParamSubprocessName]: {
          ...(prev[addParamSubprocessName] || {}),
          [paramKey]: paramValue
        }
      }));
    }

    // Backwards-compatible: also update the generic buckets if section provided
    if (addParamSection === 'sourcing') {
      setEditedSourcingParams(prev => ({ ...prev, [paramKey]: paramValue }));
    } else if (addParamSection === 'screening') {
      setEditedScreeningParams(prev => ({ ...prev, [paramKey]: paramValue }));
    } else if (addParamSection === 'risk') {
      setEditedRiskParams(prev => ({ ...prev, [paramKey]: paramValue }));
    }

    toast.success(`Parameter "${paramKey}" added successfully`);
    setAddParamModalOpen(false);
    setNewParamName('');
    setNewParamValue('');
  };

  const handleDeleteParameter = (section: 'sourcing' | 'screening' | 'risk', paramKey: string) => {
    // Remove from per-subprocess edited params if present
    setEditedParamsBySubprocess(prev => {
      const updated = { ...prev };
      Object.keys(updated).forEach((spName) => {
        if (updated[spName] && updated[spName][paramKey] !== undefined) {
          const copy = { ...updated[spName] };
          delete copy[paramKey];
          updated[spName] = copy;
        }
      });
      return updated;
    });

    // Also remove from legacy buckets if applicable
    if (section === 'sourcing') {
      setEditedSourcingParams(prev => {
        const updated = { ...prev };
        delete updated[paramKey];
        return updated;
      });
    } else if (section === 'screening') {
      setEditedScreeningParams(prev => {
        const updated = { ...prev };
        delete updated[paramKey];
        return updated;
      });
    } else if (section === 'risk') {
      setEditedRiskParams(prev => {
        const updated = { ...prev };
        delete updated[paramKey];
        return updated;
      });
    }
    toast.success(`Parameter "${paramKey}" deleted`);
  };

  const validateFile = (file: File) => {
    const allowedTypes = ['application/pdf'];
    const maxSize = 10 * 1024 * 1024; // 10MB

    if (!allowedTypes.includes(file.type)) {
      return 'Only PDF files are allowed';
    }
    if (file.size > maxSize) {
      return 'File size must be less than 10MB';
    }
    return null;
  };

  const handleFileSelect = (file: File) => {
    const error = validateFile(file);
    if (error) {
      setErrors((prev) => ({ ...prev, file: error }));
      return;
    }

    setSelectedFile(file);
    setErrors((prev) => ({ ...prev, file: undefined }));
    setIsSubmitted(false);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files[0]) {
      handleFileSelect(files[0]);
    }
    e.target.value = ''; // Reset input
  };

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDescription(e.target.value);
    setErrors((prev) => ({ ...prev, description: undefined }));
    setIsSubmitted(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    const newErrors: { file?: string; description?: string } = {};

    if (!selectedFile) {
      newErrors.file = 'Please select a PDF file';
    }

    if (!description.trim()) {
      newErrors.description = 'Please provide a description';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // Step 1: Show analyzing spinner for 3 seconds
    setIsAnalyzing(true);
    setPendingSubmitData({ file: selectedFile as File, description: description.trim() });

    // Wait 1.5 seconds for the analyzing spinner
    await new Promise(resolve => setTimeout(resolve, 1500));
    setIsAnalyzing(false);

    // Step 2: Fetch capabilities with GET request
    setCapabilitiesLoading(true);
    setCapabilitiesResult(null);

    try {
      const capabilitiesUrl = API.makeResearchUrl(API.ENDPOINTS.RESEARCH.CAPABILITIES());
      console.log('Fetching capabilities from:', capabilitiesUrl);

      let data: any = null;
      try {
        const response = await fetch(capabilitiesUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || `API error: ${response.status}`);
        }

        data = await response.json();
        console.log('Capabilities result:', data);
      } catch (err) {
        console.warn('Failed to fetch capabilities, falling back to local mock:', err);
        data = (mockCapabilities as any) || null;
        toast('Using local mock capabilities as a fallback');
      }

      setCapabilitiesResult(data);

      // Extract all subprocesses from capabilities data
      const extractedSubprocesses: any[] = [];
      const extractedCapabilityParams: Record<string, any> = {};

      // Handle both single object and array responses
      const capabilities = Array.isArray(data) ? data : [data];

      capabilities.forEach((capability: any) => {
        if (capability.processes && Array.isArray(capability.processes)) {
          capability.processes.forEach((process: any) => {
            if (process.subprocesses && Array.isArray(process.subprocesses)) {
              process.subprocesses.forEach((subprocess: any) => {
                extractedSubprocesses.push({
                  id: subprocess.id,
                  name: subprocess.name,
                  category: subprocess.category
                });

                // Extract data_elements for this subprocess
                const dataElements: string[] = [];
                if (subprocess.data_entities && Array.isArray(subprocess.data_entities)) {
                  subprocess.data_entities.forEach((entity: any) => {
                    if (entity.data_elements && Array.isArray(entity.data_elements)) {
                      entity.data_elements.forEach((element: any) => {
                        dataElements.push(element.data_element_name);
                      });
                    }
                  });
                }

                // Build capability params for this subprocess
                extractedCapabilityParams[subprocess.id] = {
                  subprocess_id: subprocess.id,
                  subprocess_name: subprocess.name,
                  category: subprocess.category,
                  data_elements: dataElements
                };
              });
            }
          });
        }
      });
      setSubprocesses(extractedSubprocesses);
      setCapabilityParams(extractedCapabilityParams);
      console.log('Extracted capability params:', extractedCapabilityParams);

      // Initialize open sections - auto-expand first capability, first process, and first subprocess for better UX
      const initialOpenSections: Record<string, boolean> = {};
      capabilities.forEach((capability: any, capIdx: number) => {
        if (capIdx === 0) {
          initialOpenSections[`cap-${capability.id}`] = true; // Expand first capability
          if (capability.processes && capability.processes.length > 0) {
            const firstProcess = capability.processes[0];
            initialOpenSections[`proc-${firstProcess.id}`] = true; // Expand first process
            if (firstProcess.subprocesses && firstProcess.subprocesses.length > 0) {
              const firstSub = firstProcess.subprocesses[0];
              initialOpenSections[`subproc-${firstSub.id}`] = true; // Expand first subprocess
            }
          }
        }
      });
      setOpenSections(initialOpenSections);
      // Also expand the hierarchical tree in the capabilities modal by default
      const expanded = new Set<string>(Object.keys(initialOpenSections));
      setExpandedItems(expanded);

      setShowCapabilitiesModal(true);
      setCapabilitiesLoading(false);
    } catch (error) {
      console.error('Error fetching capabilities:', error);
      toast.error('Capabilities fetch failed');
      setIsAnalyzing(false);
      setCapabilitiesLoading(false);
    }
  };

  const proceedWithNormalFlow = async (file: File, query: string, capParams: Record<string, any> = {}) => {
    console.log('proceedWithNormalFlow called with capParams:', capParams);
    setShowCapabilitiesModal(false);
    setIsSubmitting(true);
    setIsSubmitted(false);
    setParsedResult(null);
    setApiError(null);
    setStreamingEvents([]);
    setShowStreamingPanel(true);
    setAgentThinkingOpen(true);

    try {
      // Step 1: Upload file to /api/parse-mandate-upload
      const formData = new FormData();
      formData.append('file', file);
      formData.append('query', query);
      formData.append('legal_name', legalName.trim());
      formData.append('strategy_type', strategyType);
      formData.append('vintage_year', vintageYear);
      formData.append('primary_analyst', primaryAnalyst.trim());
      formData.append('processing_date', processingDate);
      formData.append('description', description.trim());

      const uploadResponse = await fetch(API.makeUrl(API.ENDPOINTS.FUND_MANDATE.UPLOAD()), {
        method: 'POST',
        body: formData,
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        throw new Error(errorText || `Upload API error: ${uploadResponse.status}`);
      }

      const uploadData = await uploadResponse.json();
      console.log('Upload response:', uploadData);

      // Extract filename, query, and mandate_id from upload response
      const filename = uploadData.filename || file.name;
      const queryData = uploadData.query || query;
      const newMandateId = uploadData.mandate_id;
      setMandateId(newMandateId);
      const connId = `mandate-${Date.now()}`;

      setWsConnId(connId);

      // Step 2: Connect to WebSocket for parsing with streaming
      const wsUrl = API.wsUrl(API.ENDPOINTS.FUND_MANDATE.WS_PARSE(connId));
      console.log('Connecting to WebSocket:', wsUrl);

      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('WebSocket connected');
        // Send pdf_name, query, and capability_params to server
        // Build ordered payload with string keys and deterministic property order
        const orderedCapabilityParams: Record<string, any> = {};
        try {
          const entries = Object.entries(capParams || {});
          // sort numeric keys ascending (handles keys like 1,2,3)
          entries
            .sort((a: any, b: any) => Number(a[0]) - Number(b[0]))
            .forEach(([k, v]: [string, any]) => {
              // ensure inner object fields are in the exact order required
              const inner = {
                subprocess_id: v?.subprocess_id ?? v?.id ?? null,
                subprocess_name: v?.subprocess_name ?? v?.name ?? null,
                category: v?.category ?? null,
                data_elements: Array.isArray(v?.data_elements) ? v.data_elements : (v?.data_elements || [])
              };
              orderedCapabilityParams[String(k)] = inner;
            });
        } catch (e) {
          console.warn('Failed to build ordered capability params, falling back to raw capParams', e);
        }

        const payload = {
          pdf_name: filename,
          query: queryData,
          capability_params: orderedCapabilityParams,
          mandate_id: newMandateId  // Include mandate_id for linking extracted parameters
        };

        // Log the exact JSON we will send (double-quoted keys/strings)
        const payloadJson = JSON.stringify(payload);
        console.log('Sending WebSocket payload:', payloadJson);
        ws.send(payloadJson);
      };

      ws.onmessage = (event) => {
        try {
          const eventData = JSON.parse(event.data);
          console.log('WebSocket event:', eventData);

          setStreamingEvents((prev) => [...prev, eventData]);

          if (eventData.type === 'analysis_complete' && eventData.criteria) {
            // Extract and set parsed result from criteria
            const result = {
              criteria: eventData.criteria,
              message: eventData.message || '✅ Mandate parsing complete!',
              tokens_used: eventData.tokens_used?.totals?.total_tokens || 0,
            };
            setParsedResult(result);
            setShowStreamingPanel(false);
            setIsSubmitting(false);
            setIsSubmitted(true);
            setSelectedFile(null);
            setDescription('');
            setErrors({});

            toast.success('Mandate processed successfully! Parameters extracted.');
            ws.close();
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setApiError('WebSocket connection error');
        setShowStreamingPanel(false);
      };

      ws.onclose = () => {
        console.log('WebSocket closed');
      };

    } catch (error) {
      console.error('Error submitting fund mandate:', error);
      const message = (error as any)?.message || 'Failed to submit fund mandate. Please try again.';
      setApiError(message);
      setShowStreamingPanel(false);
      setIsSubmitting(false);
      alert(message);
    }
  };

  const getMandatoryThresholds = () => {
    // Prefer exact subprocess name from capabilities (first subprocess)
    if (subprocesses && subprocesses.length > 0 && parsedResult?.criteria?.mandate) {
      const subName = subprocesses[0]?.name;
      if (subName && parsedResult.criteria.mandate[subName]) {
        const data = parsedResult.criteria.mandate[subName];
        if (data && typeof data === 'object') {
          return Object.entries(data).map(([key, value]) => ({
            key: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
            value: value as string
          }));
        }
      }
    }

    // Fallback: Extract from legacy/static keys
    const thresholds = parsedResult?.criteria?.mandate?.sourcing_parameters ?? parsedResult?.criteria?.sourcing_parameters ?? null;
    if (!thresholds) return [];
    return Object.entries(thresholds).map(([key, value]) => ({
      key: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      value: value as string
    }));
  };

  const getPreferredMetrics = () => {
    // Prefer exact subprocess name from capabilities (second subprocess)
    if (subprocesses && subprocesses.length > 1 && parsedResult?.criteria?.mandate) {
      const subName = subprocesses[1]?.name;
      if (subName && parsedResult.criteria.mandate[subName]) {
        const data = parsedResult.criteria.mandate[subName];
        if (data && typeof data === 'object') {
          return Object.entries(data).map(([key, value]) => ({
            key: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
            value: value as string
          }));
        }
      }
    }

    // Fallback: Extract from legacy/static keys
    const metrics = parsedResult?.criteria?.mandate?.screening_parameters ?? parsedResult?.criteria?.screening_parameters ?? null;
    if (!metrics) return [];
    return Object.entries(metrics).map(([key, value]) => ({
      key: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      value: value as string
    }));
  };

  const getRiskFactors = () => {
    // Prefer exact subprocess name from capabilities (third subprocess)
    if (subprocesses && subprocesses.length > 2 && parsedResult?.criteria?.mandate) {
      const subName = subprocesses[2]?.name;
      if (subName && parsedResult.criteria.mandate[subName]) {
        const data = parsedResult.criteria.mandate[subName];
        if (data && typeof data === 'object') {
          return Object.entries(data).map(([key, value]) => ({
            key: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
            value: value as string
          }));
        }
      }
    }

    // Fallback: Extract from legacy/static keys
    const factors = parsedResult?.criteria?.mandate?.risk_parameters ?? parsedResult?.criteria?.risk_parameters ?? null;
    if (!factors) return [];
    return Object.entries(factors).map(([key, value]) => ({
      key: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()), // Convert snake_case to Title Case
      value: value as string
    }));
  };

  const toggleExpand = (key: string) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
    }
    setExpandedItems(newExpanded);
  };

  // Hierarchical tree component
  const HierarchicalTree = ({ data }: { data: any }) => {
    if (!Array.isArray(data) || data.length === 0) {
      return <div className="text-gray-500 text-sm">No capabilities found</div>;
    }

    return (
      <div className="space-y-1">
        {data.map((capability: any) => (
          <div key={capability.id}>
            {/* Capability Level */}
            <button
              onClick={() => toggleExpand(`cap-${capability.id}`)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-100 rounded-lg transition-colors text-left group"
            >
              <div className="flex-shrink-0 w-5">
                {expandedItems.has(`cap-${capability.id}`) ? (
                  <FiChevronDown className="w-4 h-4 text-indigo-600" />
                ) : (
                  <FiArrowRight className="w-4 h-4 text-gray-400" />
                )}
              </div>
              <span className="font-semibold text-gray-900 text-sm">{capability.name}</span>
              {capability.vertical && (
                <span className="text-xs text-gray-500 ml-auto">{capability.vertical}</span>
              )}
            </button>

            {/* Processes */}
            {expandedItems.has(`cap-${capability.id}`) && capability.processes && (
              <div className="ml-4 border-l border-gray-200 pl-2">
                {capability.processes.map((process: any) => (
                  <div key={process.id}>
                    <button
                      onClick={() => toggleExpand(`proc-${process.id}`)}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-100 rounded-lg transition-colors text-left group"
                    >
                      <div className="flex-shrink-0 w-5">
                        {expandedItems.has(`proc-${process.id}`) ? (
                          <FiChevronDown className="w-4 h-4 text-indigo-600" />
                        ) : (
                          <FiArrowRight className="w-4 h-4 text-gray-400" />
                        )}
                      </div>
                      <span className="font-medium text-gray-800 text-sm">{process.name}</span>
                      {process.level && (
                        <span className="text-xs text-gray-500 ml-auto bg-gray-100 px-2 py-0.5 rounded">{process.level}</span>
                      )}
                    </button>

                    {/* Subprocesses */}
                    {expandedItems.has(`proc-${process.id}`) && process.subprocesses && (
                      <div className="ml-4 border-l border-gray-200 pl-2">
                        {process.subprocesses.map((subprocess: any) => (
                          <div key={subprocess.id}>
                            <button
                              onClick={() => toggleExpand(`subproc-${subprocess.id}`)}
                              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-100 rounded-lg transition-colors text-left group"
                            >
                              <div className="flex-shrink-0 w-5">
                                {subprocess.data_entities && subprocess.data_entities.length > 0 ? (
                                  expandedItems.has(`subproc-${subprocess.id}`) ? (
                                    <FiChevronDown className="w-4 h-4 text-indigo-600" />
                                  ) : (
                                    <FiArrowRight className="w-4 h-4 text-gray-400" />
                                  )
                                ) : (
                                  <div className="w-4" />
                                )}
                              </div>
                              <span className="text-gray-700 text-sm">{subprocess.name}</span>
                              {subprocess.category && (
                                <span className="text-xs text-gray-500 ml-auto bg-gray-100 px-2 py-0.5 rounded">{subprocess.category}</span>
                              )}
                            </button>

                            {/* Data Entities */}
                            {expandedItems.has(`subproc-${subprocess.id}`) && subprocess.data_entities && (
                              <div className="ml-4 border-l border-gray-200 pl-2">
                                {subprocess.data_entities.map((dataEntity: any) => (
                                  <div key={dataEntity.data_entity_id}>
                                    <button
                                      onClick={() => toggleExpand(`entity-${dataEntity.data_entity_id}`)}
                                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-100 rounded-lg transition-colors text-left group"
                                    >
                                      <div className="flex-shrink-0 w-5">
                                        {dataEntity.data_elements && dataEntity.data_elements.length > 0 ? (
                                          expandedItems.has(`entity-${dataEntity.data_entity_id}`) ? (
                                            <FiChevronDown className="w-4 h-4 text-indigo-600" />
                                          ) : (
                                            <FiArrowRight className="w-4 h-4 text-gray-400" />
                                          )
                                        ) : (
                                          <div className="w-4" />
                                        )}
                                      </div>
                                      <span className="text-gray-700 text-sm">{dataEntity.data_entity_name}</span>
                                      {dataEntity.data_elements && (
                                        <span className="text-xs text-gray-500 ml-auto bg-gray-100 px-2 py-0.5 rounded">
                                          {dataEntity.data_elements.length} items
                                        </span>
                                      )}
                                    </button>

                                    {/* Data Elements */}
                                    {expandedItems.has(`entity-${dataEntity.data_entity_id}`) && dataEntity.data_elements && (
                                      <div className="ml-4 border-l border-gray-200 pl-2">
                                        {dataEntity.data_elements.map((dataElement: any) => (
                                          <div
                                            key={dataElement.data_element_id}
                                            className="flex items-center gap-2 px-3 py-2 text-left group hover:bg-gray-100 rounded-lg transition-colors"
                                          >
                                            <div className="flex-shrink-0 w-5 flex items-center justify-center">
                                              <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full" />
                                            </div>
                                            <span className="text-gray-600 text-sm">{dataElement.data_element_name}</span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  const canSubmit = !isSubmitting && selectedFile && description.trim() && !errors.file && !errors.description;

  // Analyzing Overlay Component
  const AnalyzingOverlay = () => (
    <>
      {isAnalyzing && (
        <div className="fixed inset-0 flex items-center justify-center z-[999]">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md z-[999] overflow-hidden flex flex-col items-center justify-center p-8">
            <div className="mb-6">
              <img src={LogoAnimated} alt="Loading" className="w-16 h-16" />
            </div>
            <p className="text-gray-700 font-medium text-center">User intent is getting analyzed by Capability Compass</p>
          </div>
        </div>
      )}
    </>
  );

  const AddParameterModal = () => (
    <>
      {addParamModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center z-[999]">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setAddParamModalOpen(false)} />
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md z-[999] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="border-b border-gray-100 px-6 py-4 bg-gray-50 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">
                Add Parameter to {addParamSubprocessName}
              </h2>
              <button
                onClick={() => setAddParamModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <FiX className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Parameter Name
                </label>
                <input
                  type="text"
                  value={newParamName}
                  onChange={(e) => setNewParamName(e.target.value)}
                  placeholder="e.g., Min Fund Size"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Parameter Value
                </label>
                <input
                  type="text"
                  value={newParamValue}
                  onChange={(e) => setNewParamValue(e.target.value)}
                  placeholder="e.g., $100M"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="border-t border-gray-100 px-6 py-4 bg-gray-50 flex items-center gap-3">
              <button
                onClick={() => setAddParamModalOpen(false)}
                className="flex-1 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-100 font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddParameter}
                className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
              >
                Add Parameter
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  // Capabilities Modal
  const CapabilitiesModal = () => (
    <>
      {/* Capabilities Modal */}
      {showCapabilitiesModal && (
        <div className="fixed inset-0 flex items-center justify-center z-[999]">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !capabilitiesLoading && setShowCapabilitiesModal(false)} />
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl z-[999] h-[55vh] overflow-hidden flex flex-col max-h-[80vh]">
            {/* Modal Header */}
            <div className="border-b border-gray-100 px-6 py-3 bg-gray-50 flex items-center gap-3">
              <h2 className="text-lg font-bold text-gray-900">Capabilities Analysis Results</h2>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {capabilitiesLoading ? (
                <div className="flex flex-col items-center justify-center h-40">
                  <div className="animate-spin mb-4">
                    <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full" />
                  </div>
                  <p className="text-gray-600 text-sm">Fetching capabilities...</p>
                </div>
              ) : capabilitiesResult ? (
                <div>
                  {Array.isArray(capabilitiesResult) ? (
                    <HierarchicalTree data={capabilitiesResult} />
                  ) : typeof capabilitiesResult === 'object' ? (
                    <HierarchicalTree data={[capabilitiesResult]} />
                  ) : (
                    <div className="text-gray-500 text-sm">Unable to parse capabilities data</div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center h-32 text-gray-500">
                  <p>No results to display</p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="border-t border-gray-100 px-6 py-3 bg-gray-50 flex items-center gap-3 flex-shrink-0">
              <button
                onClick={() => setShowCapabilitiesModal(false)}
                disabled={capabilitiesLoading}
                className="flex-1 px-3 py-1.5 rounded-md text-gray-600 hover:bg-gray-100 font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (pendingSubmitData) {
                    // User explicitly continued from capabilities modal — show accordion
                    setShowAccordion(true);
                    proceedWithNormalFlow(pendingSubmitData.file, pendingSubmitData.description, capabilityParams);
                  }
                }}
                disabled={capabilitiesLoading}
                className="flex-1 px-4 py-1.5 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  return (
    <div className="flex flex-col min-h-full bg-gray-50">
      
      <AnalyzingOverlay />
      
      <CapabilitiesModal />
      
      <AddParameterModal />
      
      <Header
        title="Mandate Load"
        subtitle="Where Global Intelligence Meets Fund Mandate."
      />

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex gap-6 px-8 py-3">
          {/* Left Side: Form */}
          <div className="flex-1 flex flex-col gap-6">
            {/* Fund Details Container */}
            <div className="p-6 border border-indigo-200 rounded-xl bg-white shadow-sm transition-all duration-300">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-indigo-100 rounded-xl">
                  <FiFile className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Fund Mandate Details</h3>
                  <p className="text-sm text-gray-500">Provide legal and processing details for this mandate</p>
                </div>
              </div>

              <form onSubmit={handleSubmit}>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Legal Name <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={legalName}
                      onChange={(e) => setLegalName(e.target.value)}
                      placeholder="Legal entity name"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      disabled={isSubmitting}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Strategy Type</label>
                    <select
                      value={strategyType}
                      onChange={(e) => setStrategyType(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      disabled={isSubmitting}
                    >
                      <option value="buyout">Buyout</option>
                      <option value="growth">Growth</option>
                      <option value="secondary">Secondary</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Vintage Year <span className="text-red-500">*</span></label>
                    <select
                      value={vintageYear}
                      onChange={(e) => setVintageYear(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 max-h-48 overflow-y-auto"
                      disabled={isSubmitting}
                    >
                      <option value="">Select year</option>
                      {(() => {
                        const currentYear = new Date().getFullYear();
                        const startYear = 1990;
                        const years = [] as number[];
                        for (let y = currentYear; y >= startYear; y--) years.push(y);
                        return years.map((y) => <option key={y} value={String(y)}>{y}</option>);
                      })()}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Primary Analyst <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={primaryAnalyst}
                      onChange={(e) => setPrimaryAnalyst(e.target.value)}
                      placeholder="Analyst name"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      disabled={isSubmitting}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Processing Date</label>
                    <input
                      type="date"
                      value={processingDate}
                      onChange={(e) => setProcessingDate(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      disabled={isSubmitting}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Target Count <span className="text-red-500">*</span></label>
                    <input
                      type="number"
                      value={targetCount}
                      onChange={(e) => setTargetCount(e.target.value)}
                      placeholder="target count of companies"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      disabled={isSubmitting}
                    />
                  </div>

                  <input type="hidden" value={fundName} readOnly />
                  <input type="hidden" value={fundSize} readOnly />
                </div>

                {/* PDF Upload area */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Upload Fund Mandate PDF</label>
                  <div className={`border-2 border-dashed rounded-xl py-4 px-4 text-center transition-colors ${
                    selectedFile
                      ? 'border-indigo-400 bg-indigo-50'
                      : 'border-indigo-300 hover:border-indigo-400 hover:bg-indigo-50'
                  }`}>
                    <input
                      type="file"
                      accept=".pdf"
                      onChange={handleFileInput}
                      className="hidden"
                      id="fund-mandate-upload"
                      disabled={isSubmitting}
                    />
                    <label
                      htmlFor="fund-mandate-upload"
                      className={`cursor-pointer ${isSubmitting ? 'cursor-not-allowed opacity-50' : ''}`}
                    >
                      <p className="text-sm font-medium text-gray-900 mb-1">Click to upload PDF file</p>
                      <p className="text-xs text-gray-500">PDF files only, up to 10MB</p>
                    </label>
                  </div>

                  {errors.file && (
                    <div className="p-2 bg-red-50 border border-red-200 rounded-lg mt-2">
                      <p className="text-red-600 text-sm">{errors.file}</p>
                    </div>
                  )}

                  {selectedFile && !errors.file && (
                    <div className="mt-2 p-2 bg-indigo-50 border border-indigo-200 rounded-lg flex items-center justify-between">
                      <span className="text-indigo-700 text-sm truncate">{selectedFile.name}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedFile(null);
                          setErrors((prev) => ({ ...prev, file: undefined }));
                        }}
                        disabled={isSubmitting}
                        className="text-red-500 hover:text-red-700 ml-4"
                      >
                        <FiTrash className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                <div>
                  <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">Fund Extraction Instruction</label>
                  <textarea
                    id="description"
                    value={description}
                    onChange={handleDescriptionChange}
                    placeholder="Provide a detailed user intent of this fund mandate, including objectives, requirements, and any specific instructions..."
                    className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 min-h-[80px] text-sm bg-white"
                    disabled={isSubmitting}
                    required
                  />

                  {errors.description && (
                    <div className="p-2 bg-red-50 border border-red-200 rounded-lg mt-2">
                      <p className="text-red-600 text-sm">{errors.description}</p>
                    </div>
                  )}

                  {/* Submit Button */}
                  <div className="flex justify-end pt-4">
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={!canSubmit}
                      className={`px-6 py-2 rounded-lg font-semibold transition-all duration-200 flex items-center gap-2 ${canSubmit
                        ? 'bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-lg focus:bg-indigo-700 active:scale-95'
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        }`}
                    >
                      {isSubmitting ? (
                        <>
                          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <FiSend size={18} />
                          Submit
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>

          {/* Right Side: Agent Thinking Container - Collapsible Sidebar */}
              {/* <AgentThinking
                streamingEvents={streamingEvents}
                showStreamingPanel={showStreamingPanel}
                agentThinkingOpen={agentThinkingOpen}
                setAgentThinkingOpen={setAgentThinkingOpen}
                streamingPanelRef={streamingPanelRef}
                expandedClass="w-80"
                collapsedClass="w-12"
                containerHeightClass="h-[calc(100vh-240px)]"
              /> */}
        </div>

        {/* Agent Thinking Accordion - show only after user clicks 'Continue' in capabilities modal */}
        {showAccordion && (
          <div ref={accordionRef} className="px-8">
            <AgentThinkingAccordion aggregatedThinking={aggregatedThinking} defaultOpen={true} isStreaming={showStreamingPanel} />
          </div>
        )}

        {/* Post-Submission Section */}
        {(isSubmitting || isSubmitted) && (
          <div ref={extractedParamsRef} className="px-8 pb-16 animate-in fade-in slide-in-from-top-4 duration-500">
            <div className="max-w-4xl mx-auto space-y-10">
              {/* Introduction Header Area */}
              <div className='flex items-center justify-between'>
              <div className="pl-5">
                  <h2 className="text-lg font-bold text-gray-900 mb-2 tracking-tight">Mandate Parameters</h2>
                  <p className="text-sm text-gray-500 leading-relaxed font-medium">
                  List of parameters extracted and compared against Capability Compass.
                  </p>
              </div>
              {isSubmitted && (
                  <p className="text-sm text-gray-500 leading-relaxed font-medium">
                  Tokens used by Agent: {parsedResult.tokens_used}
                  </p>
                  )}
              </div>

              {apiError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-red-700 text-sm">{apiError}</p>
                </div>
              )}

              {/* Loading Skeleton */}
              {isSubmitting && !isSubmitted && (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="space-y-4">
                      <Skeleton variant="text" width="30%" height={40} />
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {[1, 2, 3].map((j) => (
                          <Skeleton key={j} variant="rectangular" height={80} sx={{ borderRadius: 1 }} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Collapsible Sections */}
              {isSubmitted && (
                <div className="space-y-2">
                  {subprocesses.length > 0 ? (
                    subprocesses.map((subprocess) => {
                      const subprocessParams = editedParamsBySubprocess[subprocess.name] || {};
                      return (
                        <div key={subprocess.id} className="transition-all duration-300">
                          <button
                            onClick={() => toggleSection(subprocess.id)}
                            className="w-full flex items-center gap-4 py-5 text-left border-b border-gray-100 hover:border-indigo-100 group transition-all"
                          >
                            {openSections[subprocess.id] ? <FiChevronUp className="text-indigo-600 flex-shrink-0" /> : <FiChevronDown className="text-gray-300 group-hover:text-gray-400 flex-shrink-0" />}
                            <span className="font-bold text-gray-800 tracking-tight">{subprocess.name}</span>
                            {subprocess.category && (
                              <span className="text-xs text-gray-500 ml-auto bg-gray-100 px-2 py-1 rounded">{subprocess.category}</span>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenAddParamModal('sourcing', subprocess.name);
                              }}
                              className="text-gray-400 hover:text-indigo-600 transition-colors flex-shrink-0"
                              title="Add parameter"
                            >
                              <FiPlus className="w-4 h-4" />
                            </button>
                          </button>
                          {openSections[subprocess.id] && (
                            <div className="py-6 animate-in fade-in slide-in-from-top-1 duration-300">
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                {Object.entries(subprocessParams).map(([key, value]) => (
                                  <div key={key} className="flex flex-col gap-2 p-3 bg-white rounded-lg border border-gray-200 hover:border-indigo-300 transition-colors group">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex items-center gap-2 flex-1 min-w-0">
                                        <span className="w-2 h-2 bg-indigo-400 rounded-full flex-shrink-0" />
                                        <label className="text-sm font-semibold text-gray-800 truncate">{key}</label>
                                      </div>
                                      <button
                                        onClick={() => handleDeleteParameter('sourcing', key)}
                                        className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100"
                                      >
                                        <FiTrash className="w-4 h-4" />
                                      </button>
                                    </div>
                                    <input
                                      type="text"
                                      value={value}
                                      onChange={(e) => setEditedParamsBySubprocess(prev => ({ ...prev, [subprocess.name]: { ...prev[subprocess.name], [key]: e.target.value } }))}
                                      className="text-sm px-2 py-1 border border-gray-200 rounded bg-gray-50 focus:bg-white focus:border-indigo-400 focus:outline-none"
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-gray-500 text-sm">No subprocesses available</div>
                  )}
                </div>
              )}
            </div>

            {/* Continue Button */}
            {isSubmitted && (
              <div className="flex justify-end pt-8">
                <button
                  type="button"
                  onClick={() => {
                    // Build subprocess-based arrays
                    const sourcingArray = Object.entries(editedParamsBySubprocess[subprocesses[0]?.name] || {}).map(([key, value]) => ({ key, value }));
                    const screeningArray = Object.entries(editedParamsBySubprocess[subprocesses[1]?.name] || {}).map(([key, value]) => ({ key, value }));
                    const riskArray = Object.entries(editedParamsBySubprocess[subprocesses[2]?.name] || {}).map(([key, value]) => ({ key, value }));
                    navigate('/sourcing-agent', { 
                      state: { 
                        sourcing: sourcingArray,
                        screening: screeningArray,
                        riskAnalysis: riskArray,
                        parsedResult,
                        mandateId
                      } 
                    });
                  }}
                  className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors"
                >
                  Continue
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default FundMandate;
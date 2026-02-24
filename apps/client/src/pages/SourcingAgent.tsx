
import React, { useState, useRef, useEffect } from 'react';
import AgentThinkingAccordion from '../components/AgentThinkingAccordion';
import { useLocation, Link } from 'react-router-dom';
import { API } from '../utils/constants';
import { Dialog,DialogTitle,DialogContent,DialogActions,Button,Skeleton } from "@mui/material"
import Header from '../components/Header';
import TableMui from '../components/TableMui';
import AgentThinking from '../components/AgentThinking';
import toast from 'react-hot-toast';
import { FiArrowLeft, FiArrowRight, FiChevronDown, FiChevronLeft, FiChevronRight, FiChevronUp, FiMessageSquare, FiEye, FiRefreshCw, FiCheck, FiDownload } from 'react-icons/fi';

const toDisplayArray = (obj: any) => {
  if (!obj) return [];
  if (Array.isArray(obj)) {
    return obj.map((item: any) => {
      if (typeof item === 'string') return { key: item, value: '' };
      if (typeof item === 'object') {
        const entries = Object.entries(item)[0] ?? [];
        return { key: String(entries[0] ?? ''), value: String(entries[1] ?? '') };
      }
      return { key: String(item), value: '' };
    });
  }
  if (typeof obj === 'object') {
    return Object.entries(obj).map(([k, v]) => ({ key: k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()), value: String(v) }));
  }
  return [{ key: String(obj), value: '' }];
};

const formatValue = (value: any): string => {
  if (value === null || value === undefined) return '-';
  return String(value);
};

// Normalize risk score array from various shapes (parameter_analysis or risk_scores)
const getRiskScores = (company: any) => {
  if (!company) return [];
  if (Array.isArray(company.risk_scores) && company.risk_scores.length > 0) return company.risk_scores;
  const pa = company.parameter_analysis || company.parameterAnalysis || {};
  return Object.entries(pa || {}).map(([category, val]: [string, any]) => ({
    category,
    status: val?.status ?? val?.Status ?? val?.status_text ?? '',
    reason: val?.reason ?? val?.Reason ?? val?.reason_text ?? ''
  }));
};

const getOverall = (company: any) => {
  return company?.overall_result || company?.overallResult || company?.overall_status || company?.overallStatus || company?.overall || '';
};

const SourcingAgent: React.FC = () => {
  const location = useLocation();

  const state = (location.state as any) ?? {};
  const parsed = state.parsedResult ?? null;
  const mandateId = state.mandateId ?? null;  // Get mandate_id from navigation state

  // Sourcing parameters - use from state first, then fall back to parsed data
  const sourcingFromState = state.sourcing ?? null;
  const derivedSourcingFromParsed =
    parsed?.criteria?.mandate?.sourcing_parameters ??
    parsed?.criteria?.fund_mandate?.sourcing_parameters ??
    parsed?.criteria?.sourcing_parameters ??
    parsed?.sourcing_parameters ??
    null;
  const sourcingList = sourcingFromState ?? toDisplayArray(derivedSourcingFromParsed);

  // Screening parameters - use from state first, then fall back to parsed data
  const screeningFromState = state.screening ?? null;
  const derivedScreeningFromParsed =
    parsed?.criteria?.mandate?.screening_parameters ??
    parsed?.criteria?.fund_mandate?.screening_parameters ??
    parsed?.criteria?.screening_parameters ??
    parsed?.screening_parameters ??
    null;
  const screeningList = screeningFromState ?? toDisplayArray(derivedScreeningFromParsed);

  // Risk analysis parameters - use from state first, then fall back to parsed data
  const riskAnalysisFromState = state.riskAnalysis ?? null;
  const derivedRiskAnalysisFromParsed =
    parsed?.criteria?.mandate?.risk_parameters ??
    parsed?.criteria?.fund_mandate?.risk_parameters ??
    parsed?.criteria?.risk_parameters ??
    parsed?.risk_parameters ??
    null;
  const riskAnalysisList = riskAnalysisFromState ?? toDisplayArray(derivedRiskAnalysisFromParsed);

  // Step management
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  const [selectedSourcingKeys, setSelectedSourcingKeys] = useState<Record<string, boolean>>({});
  const [selectedScreeningKeys, setSelectedScreeningKeys] = useState<Record<string, boolean>>({});
  const [selectedRiskAnalysisKeys, setSelectedRiskAnalysisKeys] = useState<Record<string, boolean>>({});
  const [selectedCompanies, setSelectedCompanies] = useState<Record<number, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [filterResponse, setFilterResponse] = useState<any>(null);
  const [screeningResponse, setScreeningResponse] = useState<any>(null);
  const [riskAnalysisResponse, setRiskAnalysisResponse] = useState<any>(null);
  const [reportResponse, setReportResponse] = useState<any>(null);
  const [reportFilePath, setReportFilePath] = useState<string | null>(null);
  const [expandedScreeningResults, setExpandedScreeningResults] = useState<Record<number, boolean>>({});
  const [companyDetailOpen, setCompanyDetailOpen] = useState(false);
  const [selectedCompanyDetail, setSelectedCompanyDetail] = useState<any>(null);
  const screeningResultsRef = useRef<HTMLDivElement>(null);
  const riskAnalysisResultsRef = useRef<HTMLDivElement>(null);
  const accordionRef = useRef<HTMLDivElement>(null);
  const sourcingResultsRef = useRef<HTMLDivElement>(null);
  const mainContentRef = useRef<HTMLDivElement>(null);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    sourcing: true,
    screening: true,
    riskAnalysis: true,
  });
  const [agentThinkingOpen, setAgentThinkingOpen] = useState(true);
  const [streamedEventsByStep, setStreamedEventsByStep] = useState<Record<number, any[]>>({ 0: [], 1: [], 2: [], 3: [] });
  const [showStreamingPanel, setShowStreamingPanel] = useState(false);
  const streamingPanelRef = useRef<HTMLDivElement>(null);
  // Which step's accordion is visible: 0=Sourcing,1=Screening,2=Risk,3=Reporting; null = none
  const [showAccordionStep, setShowAccordionStep] = useState<number | null>(null);
  const [aggregatedThinkingByStep, setAggregatedThinkingByStep] = useState<Record<number, any[]>>({ 0: [], 1: [], 2: [], 3: [] });
  const lastProcessedStreamingCountByStep = useRef<Record<number, number>>({ 0: 0, 1: 0, 2: 0, 3: 0 });
  // Derive current step's streaming events
  const streamingEvents = streamedEventsByStep[currentStep] || [];

  const toggleSourcingSelect = (key: string) => {
    setSelectedSourcingKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleScreeningSelect = (key: string) => {
    setSelectedScreeningKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleRiskAnalysisSelect = (key: string) => {
    setSelectedRiskAnalysisKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleCompanySelect = (index: number) => {
    setSelectedCompanies((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const toggleSection = (section: string) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const toggleScreeningResult = (index: number) => {
    setExpandedScreeningResults((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const openCompanyDetail = (company: any) => {
    setSelectedCompanyDetail(company);
    setCompanyDetailOpen(true);
  };

  const closeCompanyDetail = () => {
    setCompanyDetailOpen(false);
    setSelectedCompanyDetail(null);
  };

  // Auto-select all parameters by default
  useEffect(() => {
    if (sourcingList.length > 0) {
      const selectedKeys: Record<string, boolean> = {};
      sourcingList.forEach((item: any) => {
        const val = item?.value ?? '';
        if (val !== null && val !== undefined && String(val).trim() !== '' && String(val) !== '-') {
          selectedKeys[item.key] = true;
        }
      });
      setSelectedSourcingKeys(selectedKeys);
    }
  }, [sourcingList]);

  useEffect(() => {
    if (screeningList.length > 0) {
      const selectedKeys: Record<string, boolean> = {};
      screeningList.forEach((item: any) => {
        const val = item?.value ?? '';
        if (val !== null && val !== undefined && String(val).trim() !== '' && String(val) !== '-') {
          selectedKeys[item.key] = true;
        }
      });
      setSelectedScreeningKeys(selectedKeys);
    }
  }, [screeningList]);

  useEffect(() => {
    if (riskAnalysisList.length > 0) {
      const selectedKeys: Record<string, boolean> = {};
      riskAnalysisList.forEach((item: any) => {
        const val = item?.value ?? '';
        if (val !== null && val !== undefined && String(val).trim() !== '' && String(val) !== '-') {
          selectedKeys[item.key] = true;
        }
      });
      setSelectedRiskAnalysisKeys(selectedKeys);
    }
  }, [riskAnalysisList]);

  useEffect(() => {
    if (riskAnalysisResponse?.investable_companies && riskAnalysisResultsRef.current) {
      riskAnalysisResultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [riskAnalysisResponse]);

  useEffect(() => {
    if (streamingPanelRef.current && streamingEvents.length > 0) {
      streamingPanelRef.current.scrollTop = streamingPanelRef.current.scrollHeight;
    }
  }, [streamingEvents]);

  // NOTE: `showAccordionStep` is set explicitly when user triggers actions
  // (e.g., source, screen, analyze) so we don't auto-show it on any streaming.

  // Auto-scroll to accordion when streaming starts
  useEffect(() => {
    if (showAccordionStep !== null && accordionRef.current && showStreamingPanel) {
      setTimeout(() => {
        accordionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [showAccordionStep, showStreamingPanel]);

  // Aggregate streaming events into paragraphs per step (append to last paragraph)
  useEffect(() => {
    try {
      const step = currentStep;
      const prevCount = lastProcessedStreamingCountByStep.current[step] || 0;
      if (streamingEvents.length === 0) {
        setAggregatedThinkingByStep((prev) => ({ ...prev, [step]: [] }));
        lastProcessedStreamingCountByStep.current[step] = 0;
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
          setAggregatedThinkingByStep((prev) => {
            const currentThinking = prev[step] || [];
            // Push each event as a separate item so accordion can group by type
            return { ...prev, [step]: [...currentThinking, ...newEventData] };
          });
        }
        lastProcessedStreamingCountByStep.current[step] = streamingEvents.length;
      }
    } catch (e) {
      console.error('Error aggregating streaming events in SourcingAgent', e);
    }
  }, [streamingEvents, currentStep]);

  const getSelectedSourcingItems = () => sourcingList.filter((s: any) => selectedSourcingKeys[s.key]);
  const getSelectedScreeningItems = () => screeningList.filter((s: any) => selectedScreeningKeys[s.key]);
  const getSelectedRiskAnalysisItems = () => riskAnalysisList.filter((r: any) => selectedRiskAnalysisKeys[r.key]);
  const getSelectedCompanyList = () => {
    if (!filterResponse?.companies?.qualified) return [];
    return filterResponse.companies.qualified.filter((_: any, index: number) => selectedCompanies[index]);
  };

  const canProceedStep = () => {
    switch (currentStep) {
      case 0:
        return filterResponse && filterResponse.companies && filterResponse.companies.qualified && filterResponse.companies.qualified.length > 0;
      case 1:
        return screeningResponse && screeningResponse.company_details && screeningResponse.company_details.length > 0;
      case 2:
        return riskAnalysisResponse && riskAnalysisResponse.all_companies && riskAnalysisResponse.all_companies.length > 0;
      case 3:
        return true; // Can always proceed from reporting (it's the last step)
      default:
        return false;
    }
  };

  const nextStep = () => {
    if (canProceedStep() && currentStep < 3) {
      // Preserve all streaming events per-step, just hide panel
      setShowStreamingPanel(false);
      setCurrentStep((prev) => prev + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      // Preserve all streaming events per-step, just hide panel
      setShowStreamingPanel(false);
      setCurrentStep((prev) => prev - 1);
    }
  };

  // Scroll main content to top when step changes
  useEffect(() => {
    setTimeout(() => {
      try {
        if (mainContentRef.current) {
          mainContentRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      } catch (e) {
        if (mainContentRef.current) mainContentRef.current.scrollTop = 0;
        else window.scrollTo(0, 0);
      }
    }, 80);
  }, [currentStep]);

  // Scroll to sourcing results when available
  useEffect(() => {
    if (filterResponse?.companies?.qualified && sourcingResultsRef.current) {
      setTimeout(() => {
        try {
          // scroll main container to top then bring sourcing results into view
          if (mainContentRef.current) mainContentRef.current.scrollTo({ top: 0, behavior: 'smooth' });
          sourcingResultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) {
          sourcingResultsRef.current?.scrollIntoView(true);
        }
      }, 120);
    }
  }, [filterResponse]);

  // Scroll to screening results when available
  useEffect(() => {
    if (screeningResponse?.company_details && screeningResponse.company_details.length > 0 && screeningResultsRef.current) {
      setTimeout(() => {
        try {
          if (mainContentRef.current) mainContentRef.current.scrollTo({ top: 0, behavior: 'smooth' });
          screeningResultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) {
          screeningResultsRef.current?.scrollIntoView(true);
        }
      }, 120);
    }
  }, [screeningResponse]);

  // Scroll to risk analysis results when available
  useEffect(() => {
    if (riskAnalysisResponse?.all_companies && riskAnalysisResponse.all_companies.length > 0 && riskAnalysisResultsRef.current) {
      setTimeout(() => {
        try {
          if (mainContentRef.current) mainContentRef.current.scrollTo({ top: 0, behavior: 'smooth' });
          riskAnalysisResultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) {
          riskAnalysisResultsRef.current?.scrollIntoView(true);
        }
      }, 120);
    }
  }, [riskAnalysisResponse]);

  // Scroll to report/accordion when report generated
  useEffect(() => {
    if ((reportResponse || reportFilePath) && accordionRef.current) {
      setTimeout(() => {
        try {
          if (mainContentRef.current) mainContentRef.current.scrollTo({ top: 0, behavior: 'smooth' });
          accordionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) {
          accordionRef.current?.scrollIntoView(true);
        }
      }, 120);
    }
  }, [reportResponse, reportFilePath]);

  const resetScreening = () => {
    setScreeningResponse(null);
    setExpandedScreeningResults({});
    setSelectedCompanies({});
  };

  const resetRiskAnalysis = () => {
    setRiskAnalysisResponse(null);
  };

  const openReportInBrowser = (filePath: string) => {
    if (!filePath) {
      toast.error('File path not available');
      return;
    }

    // If the backend returned a filesystem path, extract filename and open via server endpoint
    try {
      const parts = filePath.split(/\\|\//);
      const filename = parts[parts.length - 1];
      const url = API.makeUrl(`/report/files/${encodeURIComponent(filename)}`);
      window.open(url, '_blank');
    } catch (e) {
      // Fallback: try opening the raw path
      window.open(filePath, '_blank');
    }
  };

  const handleGenerateReport = async () => {
    if (!riskAnalysisResponse?.all_companies || riskAnalysisResponse.all_companies.length === 0) {
      toast.error('No companies to generate report for');
      return;
    }

    setIsSubmitting(true);
    setReportResponse(null);
    setStreamedEventsByStep((prev) => ({ ...prev, 3: [] }));
    setShowStreamingPanel(true);
    setShowAccordionStep(3);

    try {
      const wsUrl = API.wsUrl(API.ENDPOINTS.REPORT.GENERATE());
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('Connected to report generation WebSocket');
        const payload = {
          mandate_id: mandateId
        };
        console.log('Sending report generation payload:', payload);
        ws.send(JSON.stringify(payload));
      };

      ws.onmessage = (event) => {
        try {
          const eventData = JSON.parse(event.data);
          console.log('Report WebSocket event:', eventData);

          // Add event to streaming panel
          setStreamedEventsByStep((prev) => ({
            ...prev,
            3: [...(prev[3] || []), eventData]
          }));

          // Check for report_complete event
          if (eventData.type === 'report_complete') {
            console.log('Report generation complete');
            setReportResponse(eventData);
            setReportFilePath(eventData.file_path || null);
            setCompletedSteps((prev) => new Set([...prev, 3]));
            setIsSubmitting(false);
            toast.success('Report generated Successfully');
            ws.close();
          }
        } catch (error) {
          console.error('Error parsing report WebSocket message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('Report WebSocket error:', error);
        toast.error('Report generation WebSocket error');
        setIsSubmitting(false);
        setShowStreamingPanel(false);
      };

      ws.onclose = () => {
        console.log('Report WebSocket closed');
        setShowStreamingPanel(false);
        setIsSubmitting(false);
      };
    } catch (err) {
      console.error('Error initiating report generation:', err);
      const message = (err as any)?.message || 'Failed to generate report';
      toast.error(message);
      setIsSubmitting(false);
      setShowStreamingPanel(false);
    }
  };

  const handleSourceCompanies = async () => {
    const items = getSelectedSourcingItems();
    if (!items || items.length === 0) {
      toast.error('Please select at least one sourcing threshold to continue');
      return;
    }

    setIsSubmitting(true);
    setFilterResponse(null);
    setStreamedEventsByStep((prev) => ({ ...prev, 0: [] }));
    setShowStreamingPanel(true);
    setShowAccordionStep(0);

    try {
      const selectedParams: Record<string, string> = {};
      items.forEach((item: any) => {
        selectedParams[item.key.toLowerCase().replace(/\s+/g, '_')] = item.value;
      });

      const payload = {
        mandate_id: mandateId,
        additionalProp1: selectedParams
      };

      console.log('Sourcing payload:', payload);

      // Create WebSocket connection
      const connId = `sourcing-${Date.now()}`;
      const wsUrl = API.wsUrl(API.ENDPOINTS.FILTER.FILTER_COMPANIES_WS(connId));
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('Sourcing WebSocket connected');
        ws.send(JSON.stringify(payload));
      };

      ws.onmessage = (event) => {
        const eventData = JSON.parse(event.data);
        console.log('Sourcing event:', eventData);
        setStreamedEventsByStep((prev) => ({ ...prev, 0: [...(prev[0] || []), eventData] }));

        // Handle analysis_complete event
        if (eventData.type === 'analysis_complete' && eventData.result) {
          console.log('Sourcing complete, result:', eventData.result);

          // Transform response to match expected structure (companies.qualified)
          const transformedResponse = {
            companies: {
              qualified: eventData.result.qualified || [],
              tokens: {
                totals: {
                  total_tokens: eventData.tokens_used?.totals?.total_tokens || 0
                }
              }
            }
          };

          setFilterResponse(transformedResponse);
          setCompletedSteps((prev) => new Set([...prev, 0]));
          setShowStreamingPanel(false);
          toast.success(`${eventData.result.qualified?.length || 0} companies sourced successfully`);
          ws.close();
        }
      };

      ws.onerror = (error) => {
        console.error('Sourcing WebSocket error:', error);
        toast.error('WebSocket error during sourcing');
        setShowStreamingPanel(false);
      };

      ws.onclose = () => {
        console.log('Sourcing WebSocket closed');
        setShowStreamingPanel(false);
        setIsSubmitting(false);
      };
    } catch (err) {
      console.error('Error sourcing companies:', err);
      toast.error('Failed to source companies');
      setShowStreamingPanel(false);
      setIsSubmitting(false);
    }
  };

  const handleScreenCompanies = async () => {
    const selectedScreeningItems = getSelectedScreeningItems();
    const selectedCompanyList = getSelectedCompanyList();

    if (!selectedScreeningItems || selectedScreeningItems.length === 0) {
      toast.error('Please select at least one screening parameter');
      return;
    }

    if (!selectedCompanyList || selectedCompanyList.length === 0) {
      toast.error('Please select at least one company to screen');
      return;
    }

    setIsSubmitting(true);
    setScreeningResponse(null);
    setStreamedEventsByStep((prev) => ({ ...prev, 1: [] }));
    setShowStreamingPanel(true);
    setShowAccordionStep(1);

    // Collect agent thinking events during screening
    const agentThinkingSteps: string[] = [];

    try {
      // Build mandate_parameters from selected screening items
      const mandateParameters: Record<string, string> = {};
      selectedScreeningItems.forEach((item: any) => {
        mandateParameters[item.key.toLowerCase().replace(/\s+/g, '_')] = item.value;
      });

      // Extract only company_id from selected companies
      const companyIds = selectedCompanyList.map((company: any) => company.id || company.Company_id);

      const payload = {
        mandate_id: mandateId,
        mandate_parameters: mandateParameters,
        company_id: companyIds
      };

      console.log('Screening payload:', payload);

      // Create WebSocket connection
      const wsUrl = API.wsUrl(API.ENDPOINTS.FILTER.SCREEN_WS());
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('Screening WebSocket connected');
        ws.send(JSON.stringify(payload));
      };

      ws.onmessage = (event) => {
        const eventData = JSON.parse(event.data);
        console.log('Screening event:', eventData);
        setStreamedEventsByStep((prev) => ({ ...prev, 1: [...(prev[1] || []), eventData] }));

        // Collect agent thinking events (step_2 and other thinking-related events)
        if (eventData.type && eventData.content) {
          // Extract thinking content from various step types
          const content = eventData.content || '';
          if (content && typeof content === 'string') {
            // Clean up the content - remove emoji prefixes and step labels
            const cleanContent = content
              .replace(/^[âœ…ðŸ’­ðŸ”§âš™ï¸âœ¨ðŸ“‹â³ðŸ“ŠðŸ¤–]\s*/g, '')
              .replace(/^STEP \d+:\s*/i, '')
              .trim();
            if (cleanContent) {
              agentThinkingSteps.push(cleanContent);
            }
          }
        }

        // Handle final_result event
        if (eventData.type === 'final_result' && eventData.content) {
          console.log('Screening complete, result:', eventData.content);
          // Include agent_thinking in the response
          const responseWithThinking = {
            ...eventData.content,
            agent_thinking: agentThinkingSteps,
            tokens_used: eventData.content.tokens_used?.totals?.total_tokens || 0,
          };
          setScreeningResponse(responseWithThinking);
          // Expand first result by default
          setExpandedScreeningResults({ 0: true });
          setCompletedSteps((prev) => new Set([...prev, 1]));
          setShowStreamingPanel(false);
          toast.success('Companies screened successfully');
          ws.close();
          setTimeout(() => {
            screeningResultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 100);
        }
      };

      ws.onerror = (error) => {
        console.error('Screening WebSocket error:', error);
        toast.error('WebSocket error during screening');
        setShowStreamingPanel(false);
      };

      ws.onclose = () => {
        console.log('Screening WebSocket closed');
        setShowStreamingPanel(false);
        setIsSubmitting(false);
      };
    } catch (err) {
      console.error('Error screening companies:', err);
      toast.error('Failed to screen companies');
      setShowStreamingPanel(false);
      setIsSubmitting(false);
    }
  };

  const handleAnalyzeRisk = async () => {
    const selectedRiskItems = getSelectedRiskAnalysisItems();

    if (!selectedRiskItems || selectedRiskItems.length === 0) {
      toast.error('Please select at least one risk analysis parameter');
      return;
    }

    if (!screeningResponse?.company_details || screeningResponse.company_details.length === 0) {
      toast.error('No companies available for risk analysis');
      return;
    }

    setIsSubmitting(true);
    setRiskAnalysisResponse(null);
    setStreamedEventsByStep((prev) => ({ ...prev, 2: [] }));
    setShowStreamingPanel(true);
    setShowAccordionStep(2);

    try {
      // Build risk_parameters from selected risk analysis items
      const riskParameters: Record<string, string> = {};
      selectedRiskItems.forEach((item: any) => {
        riskParameters[item.key] = item.value;
      });

      // Get companies from screening response
      const companies = screeningResponse.company_details;

      // Ensure Company_id and canonical name fields are present for each company
      const companiesWithId = companies.map((company: any) =>
        company.id || company.Company_id);

      const payload = {
        mandate_id: mandateId,
        companies: companiesWithId,
        risk_parameters: riskParameters
      };

      console.log('Risk analysis payload:', payload);

      // Connect to WebSocket endpoint
      const wsUrl = API.wsUrl(API.ENDPOINTS.RISK.ANALYZE_STREAM());

      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('âœ… WebSocket connected');
        // Send the analysis request
        ws.send(JSON.stringify(payload));
      };

      ws.onmessage = (event) => {
        try {
          const eventData = JSON.parse(event.data);
          console.log('ðŸ“¨ Received event:', eventData);

          // Add event to streaming events
          setStreamedEventsByStep((prev) => ({ ...prev, 2: [...(prev[2] || []), eventData] }));

          // Handle session_complete to capture raw results (preserve original structure)
          if (eventData.type === 'session_complete' && eventData.results) {
            try {
              const rawResults = eventData.results || [];

              const riskTokens = eventData.token_usage?.completion_tokens || 0;

              const summary = {
                total: rawResults.length,
                passed: rawResults.filter((c: any) => String(c.overall_result || c.overall_status || '').toUpperCase() === 'SAFE').length
              };

              const finalResponse = {
                all_companies: rawResults,
                summary,
                tokens_used: riskTokens
              };

              // Preserve original 'parameter_analysis' and 'overall_result' fields so report payload matches backend expectation
              setRiskAnalysisResponse(finalResponse);
              setCompletedSteps((prev) => new Set([...prev, 2]));
              toast.success('Risk analysis completed successfully');
              // Close WebSocket and hide processing indicator after session_complete
              setShowStreamingPanel(false);
              ws.close();
            } catch (e) {
              console.error('Error transforming session_complete results', e);
            }
          }

          // Scroll streaming panel to bottom
          setTimeout(() => {
            if (streamingPanelRef.current) {
              streamingPanelRef.current.scrollTop = streamingPanelRef.current.scrollHeight;
            }
          }, 0);
        } catch (err) {
          console.error('Error parsing event:', err);
        }
      };

      ws.onerror = (error) => {
        console.error(' WebSocket error:', error);
        toast.error('WebSocket connection error');
      };

      ws.onclose = () => {
        console.log(' WebSocket closed');
        setShowStreamingPanel(false);
        setIsSubmitting(false);
      };
    } catch (err) {
      console.error('Error analyzing risk:', err);
      toast.error('Failed to analyze risk');
      setIsSubmitting(false);
    }
  };

  const exportRiskAnalysisToCSV = () => {
    if (!riskAnalysisResponse?.all_companies) {
      toast.error('No data to export');
      return;
    }

    try {
      // Prepare CSV headers
      const headers = ['S.No.', 'Company Name', 'Overall Status', 'Category', 'Status', 'Reason'];

      // Prepare CSV rows
      const rows: string[][] = [];
      let rowNumber = 1;

      riskAnalysisResponse.all_companies.forEach((company: any, companyIndex: number) => {
        getRiskScores(company).forEach((risk: any, riskIndex: number) => {
          rows.push([
            String(rowNumber++),
            company.company_name,
            getOverall(company) ?? '',
            risk.category,
            risk.status ?? '',
            risk.reason ?? ''
          ]);
        });
      });

      // Escape CSV values (handle commas and quotes)
      const escapeCSV = (value: string) => {
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      };

      // Build CSV content
      const csvContent = [
        headers.map(escapeCSV).join(','),
        ...rows.map(row => row.map(escapeCSV).join(','))
      ].join('\n');

      // Create blob and download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);

      const timestamp = new Date().toISOString().slice(0, 10);
      link.setAttribute('href', url);
      link.setAttribute('download', `risk-analysis-${timestamp}.csv`);
      link.style.visibility = 'hidden';

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast.success('Risk analysis data exported to CSV');
    } catch (err) {
      console.error('Error exporting CSV:', err);
      toast.error('Failed to export CSV');
    }
  };

  const stepTitles = ['Sourcing', 'Screening', 'Risk Analysis', 'Reporting'];

  const getClipPath = (index: number, total: number) => {
    // Using percentage-based polygons for better scaling
    // First step: no socket on left
    if (index === 0) {
      return `polygon(calc(100% - 15px) 0, 100% 50%, calc(100% - 15px) 100%, 0% 100%, 0% 50%, 0% 0%)`;
    }
    // Middle and last steps: socket on left, point on right
    return `polygon(calc(100% - 15px) 0, 100% 50%, calc(100% - 15px) 100%, 0% 100%, 15px 50%, 0% 0%)`;
  };

  const isStepCompleted = (index: number) => {
    return completedSteps.has(index);
  };

  // Check if a step can be navigated to
  const canNavigateToStep = (index: number) => {
    if (index === 0) return true; // Step 0 is always accessible
    if (index === 1) {
      // Step 1 requires sourcing parameters and completed sourcing
      return sourcingList.length > 0 && filterResponse?.companies?.qualified;
    }
    if (index === 2) {
      // Step 2 requires screening parameters and completed screening
      return screeningList.length > 0 && screeningResponse?.company_details;
    }
    if (index === 3) {
      // Step 3 requires risk analysis and completed risk analysis
      return riskAnalysisList.length > 0 && riskAnalysisResponse?.all_companies;
    }
    return false;
  };

  const handleResetStep = (index: number) => {
    // Reset step and cascade reset to all subsequent steps
    if (index === 0) {
      // Reset step 0, 1, 2 and report (3)
      setFilterResponse(null);
      setScreeningResponse(null);
      setRiskAnalysisResponse(null);
      setReportResponse(null);
      setReportFilePath(null);
      setIsSubmitting(false);
      setShowStreamingPanel(false);
      setStreamedEventsByStep({ 0: [], 1: [], 2: [], 3: [] });
      setSelectedCompanies({});
      setExpandedScreeningResults({});
      // Remove completed status for steps 0, 1, 2 and 3
      setCompletedSteps((prev) => {
        const updated = new Set(prev);
        updated.delete(0);
        updated.delete(1);
        updated.delete(2);
        updated.delete(3);
        return updated;
      });
    } else if (index === 1) {
      // Reset step 1, 2 and report (3)
      resetScreening();
      setRiskAnalysisResponse(null);
      setReportResponse(null);
      setReportFilePath(null);
      setShowStreamingPanel(false);
      setStreamedEventsByStep((prev) => ({ ...prev, 1: [], 2: [], 3: [] }));
      // Remove completed status for steps 1, 2 and 3
      setCompletedSteps((prev) => {
        const updated = new Set(prev);
        updated.delete(1);
        updated.delete(2);
        updated.delete(3);
        return updated;
      });
    } else if (index === 2) {
      // Reset step 2 and 3
      resetRiskAnalysis();
      setReportResponse(null);
      setReportFilePath(null);
      setShowStreamingPanel(false);
      setStreamedEventsByStep((prev) => ({ ...prev, 2: [], 3: [] }));
      // Remove completed status for steps 2 and 3
      setCompletedSteps((prev) => {
        const updated = new Set(prev);
        updated.delete(2);
        updated.delete(3);
        return updated;
      });
    }
    setCurrentStep(index);
    setShowAccordionStep(null);
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <div className="space-y-4">
           <div className="flex items-center justify-between mb-4">
                  <p className="text-sm text-black-800">
                    <strong>Step 1:</strong> Select the necessary sourcing parameters.
                  </p>
                  <button
                    onClick={() => handleResetStep(0)}
                    title="Reset Sourcing"
                    className="p-1.5 rounded hover:bg-gray-100 transition-colors"
                  >
                    <FiRefreshCw className="w-5 h-5 text-indigo-500" />
                  </button>
                </div>
            {sourcingList && sourcingList.length > 0 ? (
              <>
                <button
                  onClick={() => toggleSection('sourcing')}
                  className="flex items-center gap-3 hover:text-gray-700 transition-colors group"
                >
                  {openSections.sourcing ? (
                    <FiChevronUp className="w-5 h-5 text-gray-600 group-hover:text-gray-800" />
                  ) : (
                    <FiChevronDown className="w-5 h-5 text-gray-600 group-hover:text-gray-800" />
                  )}
                  <h3 className="text-sm font-semibold text-gray-700">Sourcing Parameters</h3>
                </button>
                {openSections.sourcing && (
                  <div className="grid grid-cols-3 gap-6 pb-4">
                    {sourcingList.map((threshold: any) => {
                      const selected = !!selectedSourcingKeys[threshold.key];
                      return (
                        <label
                          key={threshold.key}
                          className="flex items-start gap-3 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleSourcingSelect(threshold.key)}
                            className="w-4 h-4 mt-1 text-indigo-600 rounded"
                          />
                          <div className="flex-1">
                            <span className="text-sm font-medium text-gray-800">{threshold.key}</span>
                            <div className="text-xs text-gray-600 mt-1">{threshold.value}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}

                {/* Agent Thinking Accordion - placed between parameter selection and results */}
                {(showAccordionStep === 0 || (aggregatedThinkingByStep[0].length > 0 && showAccordionStep === null)) && (
                  <div ref={accordionRef}>
                    <AgentThinkingAccordion aggregatedThinking={aggregatedThinkingByStep[0]} defaultOpen={true} containerClass="max-w-full px-0 pb-6" isStreaming={showStreamingPanel} />
                  </div>
                )}

                {isSubmitting && !filterResponse ? (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-4">Sourced Companies</h3>
                    <TableMui
                      columns={[
                        { key: 'number', label: 'S.No.', width: '48px' },
                        { key: 'company', label: 'Company', minWidth: '150px' },
                        { key: 'attr1', label: 'Country', textAlign: 'center' },
                        { key: 'attr2', label: 'Sector', textAlign: 'center' },
                        { key: 'attr3', label: 'industry', textAlign: 'center' },
                        { key: 'view', label: 'View', textAlign: 'center', width: '60px' },
                      ]}
                      loading={true}
                      skeletonCount={5}
                      maxHeight="400px"
                    />
                  </div>
                ) : null}

                {filterResponse?.companies?.qualified ? (
                  <div ref={sourcingResultsRef}>
                  <div className='flex items-center justify-between'>
                  <div className='flex gap-4'>
                    <h3 className="text-md font-bold text-gray-700 mb-4">Sourced Companies</h3>
                    <p className="text-sm text-gray-600 mt-1">
                      {filterResponse.companies.qualified.length} companies qualified based on sourcing criteria
                    </p>
                  </div>
                    <p className="text-sm text-gray-600 mt-1">
                      tokens used by Agent: {filterResponse.companies.tokens?.totals?.total_tokens || 0}
                    </p>
                  </div>
                    {(() => {
                      const filteredKeys = Object.keys(filterResponse.companies.qualified[0] || {})
                        .filter((col) => {
                          const normalized = String(col).replace(/\s+/g, '').toLowerCase();
                          return normalized !== 'company' && normalized !== 'id' && normalized !== 'companyid' && normalized !== 'company_id';
                        })
                        .slice(0, 4);
                      const dynamicColumns = filteredKeys.map((col) => ({ key: col, label: col, textAlign: 'center' as const }));
                      const tableColumns = [
                        { key: 'number', label: 'S.No.', width: '48px' },
                        { key: 'company', label: 'Company', minWidth: '150px' },
                        ...dynamicColumns,
                        { key: 'view', label: 'View', textAlign: 'center' as const, width: '60px' },
                      ];
                      const tableRows = filterResponse.companies.qualified.map((row: any, index: number) => {
                        const rowObj: any = {
                          number: index + 1,
                          company: row['Company '] || row['Company'],
                        };
                        // Add only the filtered columns
                        filteredKeys.forEach((key) => {
                          rowObj[key] = row[key] || '-';
                        });
                        rowObj.view = (
                          <button
                            onClick={() => openCompanyDetail(row)}
                            className="text-indigo-600 hover:text-indigo-800 transition-colors"
                          >
                            <FiEye className="w-5 h-5" />
                          </button>
                        );
                        return rowObj;
                      });
                      return <TableMui columns={tableColumns} rows={tableRows} maxHeight="400px" />;
                    })()}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <p className="text-sm text-gray-600">No sourcing parameters available. Please upload a document and extract parameters.</p>
                <Link
                  to="/fund-mandate"
                  className="inline-flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
                >
                  <span>Go to Fund Mandate</span>
                  <FiArrowRight className="w-4 h-4" />
                </Link>
              </div>
            )}
          </div>
        );

      case 1:
        return (
          <div className="space-y-4">
              {filterResponse?.companies?.qualified ? (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-sm text-black-800">
                      <strong>Step 2:</strong> Select screening parameters and companies to screen. Click "Screen Companies" to apply the selected criteria.
                    </p>
                    <button
                      onClick={() => handleResetStep(1)}
                      title="Reset Screening"
                      className="p-1.5 rounded hover:bg-gray-100 transition-colors"
                    >
                      <FiRefreshCw className="w-5 h-5 text-indigo-500" />
                    </button>
                  </div>

                {screeningList && screeningList.length > 0 && (
                  <>
                    <button
                      onClick={() => toggleSection('screening')}
                      className="flex items-center gap-3 hover:text-gray-700 transition-colors group"
                    >
                      {openSections.screening ? (
                        <FiChevronUp className="w-5 h-5 text-gray-600 group-hover:text-gray-800" />
                      ) : (
                        <FiChevronDown className="w-5 h-5 text-gray-600 group-hover:text-gray-800" />
                      )}
                      <h3 className="text-sm font-semibold text-gray-700">Screening Parameters</h3>
                    </button>
                    {openSections.screening && (
                      <div className="grid grid-cols-3 gap-6 mt-4 pb-4">
                        {screeningList.map((param: any) => {
                          const selected = !!selectedScreeningKeys[param.key];
                          return (
                            <label
                              key={param.key}
                              className="flex items-start gap-3 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() => toggleScreeningSelect(param.key)}
                                className="w-4 h-4 mt-1 text-indigo-600 rounded"
                              />
                              <div className="flex-1">
                                <span className="text-sm font-medium text-gray-800">{param.key}</span>
                                <div className="text-xs text-gray-600 mt-1">{param.value}</div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}

                <div className="mb-8">
                  <h3 className="text-sm font-semibold text-gray-700 mb-4">Select Companies to Screen</h3>
                  {(() => {
                    const filteredKeys = Object.keys(filterResponse.companies.qualified[0] || {})
                      .filter((col) => {
                        const normalized = String(col).replace(/\s+/g, '').toLowerCase();
                        return normalized !== 'company' && normalized !== 'id' && normalized !== 'companyid' && normalized !== 'company_id';
                      })
                      .slice(0, 5);
                    const dynamicColumns = filteredKeys.map((col) => ({ key: col, label: col, textAlign: 'center' as const }));
                    const tableColumns = [
                      { key: 'company', label: 'Company', minWidth: '150px' },
                      ...dynamicColumns,
                      { key: 'view', label: 'View', textAlign: 'center' as const, width: '60px' },
                    ];
                    const tableRows = filterResponse.companies.qualified.map((row: any, index: number) => {
                      const rowObj: any = {
                        number: index,
                        company: row['Company '] || row['Company'],
                      };
                      // Add only the filtered columns
                      filteredKeys.forEach((key) => {
                        rowObj[key] = row[key] || '-';
                      });
                      rowObj.view = (
                        <button
                          onClick={() => openCompanyDetail(row)}
                          className="text-indigo-600 hover:text-indigo-800 transition-colors"
                        >
                          <FiEye className="w-5 h-5" />
                        </button>
                      );
                      return rowObj;
                    });
                    return (
                      <TableMui
                        columns={tableColumns}
                        rows={tableRows}
                        showCheckbox={true}
                        selectedRows={selectedCompanies}
                        onCheckboxChange={toggleCompanySelect}
                        onSelectAll={(checked) => {
                          if (checked) {
                            const newSelected: Record<number, boolean> = {};
                            filterResponse.companies.qualified.forEach((_: any, idx: number) => {
                              newSelected[idx] = true;
                            });
                            setSelectedCompanies(newSelected);
                          } else {
                            setSelectedCompanies({});
                          }
                        }}
                        maxHeight="400px"
                      />
                    );
                  })()}
                </div>

                {/* Agent Thinking Accordion - placed between parameter selection and results */}
                {(showAccordionStep === 1 || (aggregatedThinkingByStep[1].length > 0 && showAccordionStep === null)) && (
                  <div ref={accordionRef}>
                    <AgentThinkingAccordion aggregatedThinking={aggregatedThinkingByStep[1]} defaultOpen={true} containerClass="max-w-full px-0 pb-6" isStreaming={showStreamingPanel} />
                  </div>
                )}

                {isSubmitting && !screeningResponse ? (
                  <div className="mt-12">
                    <h3 className="text-base font-bold text-black">List of companies passed the criteria</h3>
                    <p className="text-sm text-black mb-4">Loading screening results...</p>
                    <div className="space-y-2 max-h-[400px] overflow-y-auto">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="p-2 bg-gray-50 rounded">
                          <Skeleton width="40%" height="24px" />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {screeningResponse && screeningResponse.company_details && screeningResponse.company_details.length === 0 ? (
                  <div className="mt-12 p-6">
                    <h3 className="text-base font-bold text-gray-500 mb-2">No Companies Passed Screening</h3>
                    <p className="text-sm text-gray-700 mb-4">
                      The selected screening criteria resulted in zero companies. Please adjust your parameters or company selection and try again.
                    </p>
                    <button
                      onClick={() => handleResetStep(1)}
                      className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg"
                    >
                      Try Screening Again
                    </button>
                  </div>
                ) : null}

                {screeningResponse?.company_details && screeningResponse.company_details.length > 0 ? (
                  <div className="mt-12" ref={screeningResultsRef}>
                    <div className='flex items-center justify-between'>
                    <div>
                    <h3 className="text-base font-bold text-black">List of companies passed the criteria</h3>
                     <p className="text-sm text-gray-600">
                         {screeningResponse.company_details.length} companies passed screening criteria
                     </p>
                    </div>
                      <p>tokens used by Agent: {screeningResponse.tokens_used}</p>
                  </div>
                    <div className="space-y-1 max-h-[400px] overflow-y-auto">
                      {screeningResponse.company_details.map((row: any, index: number) => {
                        const companyName = row['Company '] || row['Company'] || row['company'] || 'Unknown Company';
                        const companyStatus = row['Status'] || row['status'] || '';
                        const reason = row['Reason'] || row['reason'] || row['Screening Reason'] || row['screening_reason'] || '';
                        const isExpanded = !!expandedScreeningResults[index];
                        return (
                          <div key={index}>
                            <button
                              onClick={() => toggleScreeningResult(index)}
                              className="w-full flex items-center gap-2 py-2 px-1 text-left hover:bg-gray-50 transition-colors"
                            >
                              {isExpanded ? (
                                <FiChevronUp className="w-4 h-4 text-gray-600" />
                              ) : (
                                <FiChevronDown className="w-4 h-4 text-gray-600" />
                              )}
                              <span className="text-black font-bold text-md">{companyName}</span>
                              <span className={`ml-4 inline-block px-3 py-1 rounded-xl text-xs font-semibold whitespace-nowrap border-2 ${
                                companyStatus.toUpperCase() === 'PASS'
                                  ? 'border-green-500 text-green-700 bg-white'
                                  : companyStatus.toUpperCase() === 'CONDITIONAL'
                                  ? 'border-yellow-500 text-yellow-700 bg-white'
                                  : 'border-red-500 text-red-500 bg-white'
                              }`}>
                                {companyStatus}
                              </span>
                            </button>
                            {isExpanded && reason && (
                              <div className="pl-8 pb-2 text-md">
                                <span className="text-gray-900 font-semibold">Reason:</span> <span className="text-black">{formatValue(reason)}</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 space-y-4">
                  <p className="text-sm text-gray-600">Please complete Step 1 (Sourcing) first to access screening parameters.</p>
                  <button
                    onClick={() => setCurrentStep(0)}
                    className="inline-flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
                  >
                    <span>Go back to Step 1</span>
                    <FiArrowLeft className="w-4 h-4" />
                  </button>
                </div>
              )}
          </div>
        );

      case 2:
        return (
          <div className="space-y-4">
            {screeningResponse?.company_details && screeningResponse.company_details.length > 0 ? (
              <>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm text-black-800">
                    <strong>Step 3:</strong> Select required risk analysis parameters to identify potential risk of screened companies.
                  </p>
                  <button
                    onClick={() => handleResetStep(2)}
                    title="Reset Risk Analysis"
                    className="p-1.5 rounded hover:bg-gray-100 transition-colors"
                  >
                    <FiRefreshCw className="w-5 h-5 text-indigo-500" />
                  </button>
                </div>
                {riskAnalysisList && riskAnalysisList.length > 0 ? (
                  <>
                    <button
                      onClick={() => toggleSection('riskAnalysis')}
                      className="flex items-center gap-3 hover:text-gray-700 transition-colors group"
                    >
                      {openSections.riskAnalysis ? (
                        <FiChevronUp className="w-5 h-5 text-gray-600 group-hover:text-gray-800" />
                      ) : (
                        <FiChevronDown className="w-5 h-5 text-gray-600 group-hover:text-gray-800" />
                      )}
                      <h3 className="text-sm font-semibold text-gray-700">Risk Analysis Parameters</h3>
                    </button>
                    {openSections.riskAnalysis && (
                      <div className="grid grid-cols-3 gap-6 mt-4 pb-4">
                        {riskAnalysisList.map((param: any) => {
                          const selected = !!selectedRiskAnalysisKeys[param.key];
                          return (
                            <label
                              key={param.key}
                              className="flex items-start gap-3 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() => toggleRiskAnalysisSelect(param.key)}
                                className="w-4 h-4 mt-1 text-indigo-600 rounded"
                              />
                              <div className="flex-1">
                                <span className="text-sm font-medium text-gray-800">{param.key}</span>
                                <div className="text-xs text-gray-600 mt-1">{param.value}</div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}

                    {/* Agent Thinking Accordion - placed between parameter selection and results */}
                    {(showAccordionStep === 2 || (aggregatedThinkingByStep[2].length > 0 && showAccordionStep === null)) && (
                      <div ref={accordionRef}>
                        <AgentThinkingAccordion aggregatedThinking={aggregatedThinkingByStep[2]} defaultOpen={true} containerClass="max-w-full px-0 pb-6" isStreaming={showStreamingPanel} />
                      </div>
                    )}

                    {isSubmitting && !riskAnalysisResponse ? (
                      <div ref={riskAnalysisResultsRef} className="mt-6">
                        <div className="mb-4">
                          <h3 className="text-lg font-bold text-gray-900">Risk Analysis Results</h3>
                          <p className="text-sm text-gray-600">Loading risk analysis...</p>
                        </div>
                        <TableMui
                          columns={[
                            { key: 'number', label: 'S.No.', width: '48px' },
                            { key: 'company', label: 'Company Name', minWidth: '150px' },
                            { key: 'overall', label: 'Overall Status', minWidth: '120px', textAlign: 'center' },
                            { key: 'category', label: 'Category', minWidth: '180px' },
                            { key: 'status', label: 'Status', minWidth: '80px', textAlign: 'center' },
                            { key: 'reason', label: 'Reason', minWidth: '150px' },
                          ]}
                          loading={true}
                          skeletonCount={6}
                          maxHeight="400px"
                        />
                      </div>
                    ) : null}

                    {riskAnalysisResponse && riskAnalysisResponse.all_companies && riskAnalysisResponse.all_companies.length === 0 ? (
                      <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-lg p-6">
                        <h3 className="text-base font-bold text-yellow-900 mb-2">No Companies in Risk Analysis</h3>
                        <p className="text-sm text-yellow-800 mb-4">
                          The risk analysis returned no companies. Please adjust your risk parameters or select different companies from screening and try again.
                        </p>
                        <button
                          onClick={resetRiskAnalysis}
                          className="px-4 py-2 bg-yellow-600 text-white text-sm font-medium rounded-lg hover:bg-yellow-700 transition-colors"
                        >
                          Try Again
                        </button>
                      </div>
                    ) : null}

                    {riskAnalysisResponse?.all_companies && riskAnalysisResponse.all_companies.length > 0 ? (
                      <div ref={riskAnalysisResultsRef} className="mt-6">
  <div className="mb-4 flex items-center justify-between">
    <div>
      <h3 className="text-lg font-bold text-gray-900">Risk Analysis Results</h3>
      <div className='flex items-center justify-between gap-6'>
      <p className="text-sm text-gray-600">
        {riskAnalysisResponse.summary?.passed ?? 0} out of {riskAnalysisResponse.summary?.total ?? 0} companies passed risk criteria
      </p>
      <p className='text-sm text-gray-600'>Tokens used by Agent: {riskAnalysisResponse.tokens_used}</p>
      </div>
    </div>
                          <button
                            onClick={exportRiskAnalysisToCSV}
                            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                          >
                            Export as CSV
                          </button>
                        </div>
                        {(() => {
                          const tableRows = riskAnalysisResponse.all_companies.flatMap((company: any, companyIdx: number) =>
                            (getRiskScores(company).map((risk: any, riskIdx: number) => ({
                              number: riskIdx === 0 ? companyIdx + 1 : '',
                              company: riskIdx === 0 ? company.company_name : '',
                              overall: riskIdx === 0 ? (
                                <span className={`inline-block px-3 py-1 rounded-xl text-xs font-semibold whitespace-nowrap border-2 ${
                                  String(getOverall(company)).toUpperCase() === 'SAFE' ? 'border-green-500 text-green-700 bg-white' :
                                  String(getOverall(company)).toUpperCase() === 'WARN' || String(getOverall(company)).toUpperCase() === 'WARNING' ? 'border-yellow-500 text-yellow-700 bg-white' :
                                  String(getOverall(company)).toUpperCase() === 'UNSAFE' || String(getOverall(company)).toUpperCase() === 'RISK' ? 'border-red-500 text-red-700 bg-white' : 'border-gray-500 text-gray-700 bg-white'
                                }`}>
                                  {getOverall(company) || '-'}
                                </span>
                              ) : '',
                              category: risk.category,
                              status: (
                                <span className={`inline-block px-3 py-1 rounded-xl text-xs font-semibold whitespace-nowrap border-2 ${
                                  String(risk.status).toUpperCase() === 'SAFE' ? 'border-green-500 text-green-700 bg-white' :
                                  String(risk.status).toUpperCase() === 'WARN' || String(risk.status).toUpperCase() === 'WARNING' ? 'border-yellow-500 text-yellow-700 bg-white' :
                                  String(risk.status).toUpperCase() === 'UNSAFE' || String(risk.status).toUpperCase() === 'RISK' ? 'border-red-500 text-red-700 bg-white' : 'border-gray-500 text-gray-700 bg-white'
                                }`}>
                                  {risk.status}
                                </span>
                              ),
                              reason: risk.reason,
                            })) ) || []
                          );
                          return (
                            <TableMui
                              columns={[
                                { key: 'number', label: 'S.No.', width: '48px' },
                                { key: 'company', label: 'Company Name', minWidth: '150px' },
                                { key: 'overall', label: 'Overall Status', minWidth: '120px', textAlign: 'center' },
                                { key: 'category', label: 'Category', minWidth: '180px' },
                                { key: 'status', label: 'Status', minWidth: '80px', textAlign: 'center' },
                                { key: 'reason', label: 'Reason', minWidth: '300px' },
                              ]}
                              rows={tableRows}
                              maxHeight="400px"
                            />
                          );
                        })()}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                    <p className="text-sm text-blue-800">
                      <strong>Next Steps:</strong> No risk analysis parameters available. Risk analysis completed. You can now review the results or export this data.
                    </p>
                  </div>
                )}

                {/* Continue button removed from inline content to keep footer navigation consistent */}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <p className="text-sm text-gray-600">Please complete Step 2 (Screening) first to access risk analysis.</p>
                <button
                  onClick={() => setCurrentStep(1)}
                  className="inline-flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
                >
                  <span>Go back to Step 2</span>
                  <FiArrowLeft className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        );

      case 3:
        return (
          <div className="space-y-2">

            {/* Display previous risk analysis results summary */}
            {riskAnalysisResponse?.all_companies && riskAnalysisResponse.all_companies.length > 0 ? (
              <>
                <div className="bg-gray-50 rounded-lg pt-3">
                  <h4 className="text-md font-semibold text-gray-900">Overall Summary</h4>
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="bg-white rounded-lg p-3 border border-gray-200">
                      <p className="text-xs text-gray-600 font-medium">Sourced Companies</p>
                      <p className="text-2xl font-bold text-gray-900">{(filterResponse?.companies?.qualified || []).length}</p>
                    </div>
                    <div className="bg-white rounded-lg p-3 border border-gray-200">
                      <p className="text-xs text-gray-600 font-medium">Screened Companies</p>
                      <p className="text-2xl font-bold text-indigo-600">{(screeningResponse?.company_details || []).length}</p>
                    </div>
                    <div className="bg-white rounded-lg p-3 border border-green-200">
                      <p className="text-xs text-gray-600 font-medium">Risk Passed</p>
                      <p className="text-2xl font-bold text-green-600">
                        {riskAnalysisResponse.all_companies.filter((c: any) => String(getOverall(c)).toUpperCase() === 'SAFE').length}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Companies Table */}
                 <div className="bg-gray-50 rounded-lg p-3">
                    <h4 className="text-md font-semibold text-gray-800">Report generation</h4>
                    <p className="text-sm text-gray-600">A comprehensive report will be generated based on the previous findings. Click <strong>Generate</strong> to start.</p>
                  {/* <TableMui
                    columns={[
                      { key: 'number', label: 'S.No.', width: '48px' },
                      { key: 'company', label: 'Company Name', minWidth: '200px' },
                      { key: 'overall', label: 'Overall Status', minWidth: '120px', textAlign: 'center' },
                    ]}
                    rows={riskAnalysisResponse.all_companies.map((company: any, index: number) => ({
                      number: index + 1,
                      company: company.company_name,
                      overall: (
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                          (String(getOverall(company)).toUpperCase() === 'SAFE')
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {getOverall(company) || 'N/A'}
                        </span>
                      ),
                    }))}
                    maxHeight="300px"
                  /> */}
                 </div>

                {/* Agent Thinking Accordion - for report generation streaming */}
                {(showAccordionStep === 3 || (aggregatedThinkingByStep[3].length > 0 && showAccordionStep === 3)) && (
                  <div ref={accordionRef}>
                    <AgentThinkingAccordion aggregatedThinking={aggregatedThinkingByStep[3]} defaultOpen={true} containerClass="max-w-full px-0 pb-6" isStreaming={showStreamingPanel} />
                  </div>
                )}

                {/* Report Success Message */}
                {reportFilePath && (
                  <div className="ml-4 mt-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h4 className="text-md font-semibold text-green-900 mb-2">
                          <FiCheck className="inline-block w-5 h-5 mr-2 text-green-600" />
                          Mandate Report has been generated successfully
                        </h4>
                        <p className="text-sm text-green-800">
                          The comprehensive risk analysis report is ready for download.
                        </p>
                      </div>
                      <button
                        onClick={() => openReportInBrowser(reportFilePath)}
                        className="ml-4 px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors flex items-center gap-2 whitespace-nowrap"
                      >
                        <FiDownload className="w-4 h-4" />
                        Download Report
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : null}

            {/* Generate button removed from inline content to keep footer navigation consistent */}
          </div>
        );

      default:
        return null;
    }
  };
  return (
    <div className="flex flex-col min-h-full bg-gray-50">
      {/* Header */}
      <Header
        title="Reporting Agent"
        subtitle="Generate comprehensive risk analysis report based on fund mandate"
        currentStep={currentStep}
        stepContent={[
          { title: 'Sourcing Companies', subtitle: 'Choose necessary sourcing parameters from the mandate to find candidate companies' },
          { title: 'Screening Companies', subtitle: 'Select screening parameters and sourced companies to screen' },
          { title: 'Risk Analysis', subtitle: 'Choose risk analysis parameters to perform risk assessment on screened companies' },
        ]}
      />

      {/* Main Content Area with Streaming Panel */}
      <div className="flex-1 overflow-hidden">
        <div className="flex flex-row gap-6 px-6 py-6 h-full">
          {/* Main Content Container - Resizes based on Agent Thinking panel */}
          <div className={`flex-1 flex flex-col min-w-0 transition-all duration-300`}>
            {/* Left Panel - Wizard, Parameters, and Results */}
            <div ref={mainContentRef} className="flex-1 overflow-y-auto">
              <div className="w-full">
                {/* Wizard Steps */}
                <div className="mb-4">
                  <div className="flex items-center" style={{ gap: 0 }}>
                    {stepTitles.map((title, index) => {
                      const completed = isStepCompleted(index);
                      const active = index === currentStep;
                      const clip = getClipPath(index, stepTitles.length);
                      return (
                        <div key={index} className="flex items-center" style={{ marginLeft: index > 0 ? '-15px' : undefined }}>
                          <button
                            onClick={() => {
                              if (canNavigateToStep(index)) {
                                setShowAccordionStep(null);
                                setCurrentStep(index);
                              }
                            }}
                            disabled={!canNavigateToStep(index)}
                            className={`flex items-center space-x-3 font-medium transition-all duration-200 focus:outline-none ${
                              !canNavigateToStep(index) ? 'opacity-50 cursor-not-allowed' : ''
                            }`}
                            style={{
                              height: '48px',
                              padding: index === 0 ? '0 25px 0 20px' : '0 25px 0 35px',
                              clipPath: clip,
                              background: active ? '#4F46E5' : completed ? '#F0F4FF' : '#FFFFFF',
                              color: active ? '#FFFFFF' : completed ? '#4F46E5' : '#6B7280',
                              border: active ? 'none' : completed ? '1px solid #CBD5E1' : '1px solid #E5E7EB',
                              cursor: 'pointer',
                            }}
                          >
                            <div className={`flex items-center justify-center text-xs font-semibold flex-shrink-0`} style={{
                              width: '24px',
                              height: '24px',
                              borderRadius: '50%',
                              background: active ? '#FFFFFF' : completed ? '#EBF2FF' : '#F3F4F6',
                              color: active ? '#4F46E5' : completed ? '#4F46E5' : '#9CA3AF',
                            }}>
                              {completed ? <FiCheck className="w-3 h-3" /> : <span>{index + 1}</span>}
                            </div>
                            <span style={{ fontSize: '14px' }}>{title}</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Step Content */}
                <div className="p-2">
                  {renderStepContent()}
                </div>

                {/* Navigation Buttons */}
                <div className="flex justify-between">
                  {currentStep > 0 && (
                    <button
                      onClick={prevStep}
                      className="flex items-center space-x-2 px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <FiArrowLeft className="w-4 h-4" />
                      <span>Back</span>
                    </button>
                  )}

                  <div className="flex items-center space-x-4 ml-auto">
                    {currentStep === 0 && (
                      <button
                        onClick={filterResponse ? nextStep : handleSourceCompanies}
                        disabled={isSubmitting || (filterResponse ? false : getSelectedSourcingItems().length === 0)}
                        className={`flex items-center space-x-2 px-6 py-3 rounded-lg font-medium transition-colors ${
                          isSubmitting || (filterResponse ? false : getSelectedSourcingItems().length === 0)
                            ? 'hidden bg-gray-300 text-gray-600 cursor-not-allowed'
                            : 'bg-indigo-600 text-white hover:bg-indigo-700'
                        }`}
                      >
                        {isSubmitting ? (
                          <span>Sourcing...</span>
                        ) : filterResponse ? (
                          <>
                            <span>Next</span>
                            <FiArrowRight className="w-4 h-4" />
                          </>
                        ) : (
                          <span>Source Companies</span>
                        )}
                      </button>
                    )}

                    {currentStep === 1 && (
                      <button
                        onClick={screeningResponse ? nextStep : handleScreenCompanies}
                        disabled={isSubmitting || (screeningResponse ? false : (getSelectedScreeningItems().length === 0 || getSelectedCompanyList().length === 0))}
                        className={`flex items-center space-x-2 px-6 py-3 rounded-lg font-medium transition-colors ${
                          isSubmitting || (screeningResponse ? false : (getSelectedScreeningItems().length === 0 || getSelectedCompanyList().length === 0))
                            ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
                            : 'bg-indigo-600 text-white hover:bg-indigo-700'
                        }`}
                      >
                        {isSubmitting ? (
                          <span>Screening...</span>
                        ) : screeningResponse ? (
                          <>
                            <span>Next</span>
                            <FiArrowRight className="w-4 h-4" />
                          </>
                        ) : (
                          <span>Screen Companies</span>
                        )}
                      </button>
                    )}

                    {currentStep === 2 && riskAnalysisList && riskAnalysisList.length > 0 && (
                      riskAnalysisResponse && riskAnalysisResponse.all_companies && riskAnalysisResponse.all_companies.length > 0 ? (
                        <button
                          onClick={nextStep}
                          className="flex items-center space-x-2 px-6 py-3 rounded-lg font-medium transition-colors bg-indigo-600 text-white hover:bg-indigo-700"
                        >
                          <span>Next</span>
                          <FiArrowRight className="w-4 h-4" />
                        </button>
                      ) : (
                        <button
                          onClick={handleAnalyzeRisk}
                          disabled={isSubmitting || getSelectedRiskAnalysisItems().length === 0}
                          className={`flex items-center space-x-2 px-6 py-3 rounded-lg font-medium transition-colors ${
                            isSubmitting || getSelectedRiskAnalysisItems().length === 0
                              ? 'cursor-not-allowed bg-gray-300 text-gray-600'
                              : 'bg-indigo-600 text-white hover:bg-indigo-700'
                          }`}
                        >
                          {isSubmitting ? <span>Analyzing...</span> : <span>Analyze Risk</span>}
                        </button>
                      )
                    )}

                    {currentStep === 3 && (
                      // Footer Generate button (shows when no report yet)
                      !reportFilePath && (
                        <button
                          onClick={handleGenerateReport}
                          disabled={isSubmitting || !riskAnalysisResponse?.all_companies || riskAnalysisResponse.all_companies.length === 0}
                          className={`flex items-center space-x-2 px-6 py-3 rounded-lg font-medium transition-colors ${
                            isSubmitting || !riskAnalysisResponse?.all_companies || riskAnalysisResponse.all_companies.length === 0
                              ? 'cursor-not-allowed bg-gray-300 text-gray-600 disabled:opacity-50'
                              : 'bg-indigo-600 text-white hover:bg-indigo-700'
                          }`}
                        >
                          {isSubmitting ? (
                            <span>Generating...</span>
                          ) : (
                            <>
                              <span>Generate</span>
                              <FiArrowRight className="w-4 h-4" />
                            </>
                          )}
                        </button>
                      )
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Agent Thinking Container - Collapsible (Right Sidebar) */}
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
      </div>

      {/* Company Detail Dialog */}
      <Dialog
        open={companyDetailOpen}
        onClose={closeCompanyDetail}
        maxWidth="md"
        PaperProps={{ sx: { maxHeight: '85vh', width: '600px', borderRadius: '12px' } }}
      >
        <DialogTitle sx={{
          fontWeight: 'bold',
          fontSize: '1.25rem',
          padding: '20px',
          background: '#FFFFFF',
          color: '#1F2937',
          borderBottom: '1px solid #E5E7EB',
          borderRadius: '12px 12px 0 0'
        }}>
          {selectedCompanyDetail?.['Company '] || selectedCompanyDetail?.['Company'] || 'Company Details'}
        </DialogTitle>
        <DialogContent sx={{ padding: '24px', overflowY: 'auto', maxHeight: 'calc(85vh - 130px)' }}>
          {selectedCompanyDetail && (
            <div className="space-y-6">
              {/* Company Attributes Grid */}
              <div className="grid grid-cols-3 gap-4">
                {Object.entries(selectedCompanyDetail).map(([key, value]: [string, any]) => {
                  // Skip Risks as we'll handle it separately
                  if (key === 'Risks' || key === 'risks' || key === 'Company ' || key === 'Company') {
                    return null;
                  }
                  const normalized = String(key).replace(/\s+/g, '').toLowerCase();
                  // hide internal ids and risk/parameter fields
                  if (['id', 'companyid', 'company_id'].includes(normalized)) return null;
                  if (normalized.includes('risk') || normalized.includes('parameter') || normalized.includes('parameters')) return null;

                  return (
                    <div key={key} className="bg-gray-50 rounded-lg p-3 border border-gray-200 hover:border-gray-300 transition-colors">
                      <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">{key}</div>
                      <div className="text-sm font-medium text-gray-900">{formatValue(value)}</div>
                    </div>
                  );
                })}
              </div>

              {/* Display Risks if available */}
              {/* {(selectedCompanyDetail?.['Risks'] || selectedCompanyDetail?.['risks']) && (
                <div className="mt-2 pt-6 border-t border-gray-200">
                  <div className="text-lg font-bold text-gray-900 mb-4">Risk Assessment</div>
                  <div className="grid grid-cols-2 gap-3">
                    {Object.entries(selectedCompanyDetail['Risks'] || selectedCompanyDetail['risks']).map(([riskKey, riskValue]: [string, any]) => {
                      return (
                        <div key={riskKey} className="rounded-lg p-3 border border-gray-200 bg-gray-50">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="font-semibold text-sm text-gray-800">{riskKey}</div>
                              <div className="text-sm font-medium mt-1 text-gray-700">
                                {formatValue(riskValue)}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )} */}
            </div>
          )}
        </DialogContent>
        <DialogActions sx={{ padding: '16px 24px', borderTop: '1px solid #E5E7EB' }}>
          <Button
            onClick={closeCompanyDetail}
            variant="contained"
            size="small"
            sx={{ backgroundColor: '#4F46E5', '&:hover': { backgroundColor: '#4338CA' }, textTransform: 'none', borderRadius: '6px', fontWeight: '500' }}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
};

export default SourcingAgent;
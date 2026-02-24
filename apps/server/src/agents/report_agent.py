import asyncio
import io
import json
import re
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any, TypedDict

from azure.identity import DefaultAzureCredential
from azure.keyvault.secrets import SecretClient
from dotenv import load_dotenv
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.tools import tool
from langchain_openai import AzureChatOpenAI
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

load_dotenv()

# ============================================================================
# AZURE KEYVAULT SETUP
# ============================================================================

KEYVAULT_URI = "https://fstodevazureopenai.vault.azure.net/"
credential = DefaultAzureCredential()
kvclient = SecretClient(vault_url=KEYVAULT_URI, credential=credential)

secrets_map = {}
secret_names = ["llm-base-endpoint", "llm-mini", "llm-mini-version", "llm-api-key"]
for secret_name in secret_names:
    try:
        secret = kvclient.get_secret(secret_name)
        secrets_map[secret_name] = secret.value
    except Exception as e:
        print(f"Error retrieving secret '{secret_name}': {e}")
        raise

AZURE_OPENAI_ENDPOINT = secrets_map.get("llm-base-endpoint")
DEPLOYMENT_NAME = secrets_map.get("llm-mini")
OPENAI_API_VERSION = secrets_map.get("llm-mini-version")
GPT5_API_KEY = secrets_map.get("llm-api-key")


# ============================================================================
# EVENT STREAMING CALLBACK
# ============================================================================

class ReportEventCallback(BaseCallbackHandler):
    """Emits meaningful agent thinking and analysis events"""

    def __init__(self, event_queue=None):
        self.event_queue = event_queue
        self.buffer = ""
        self.token_count = 0
        self.sentence_endings = {'.', '!', '?'}

    def on_llm_new_token(self, token: str, **kwargs) -> None:
        """Buffers tokens and emits meaningful complete thoughts"""
        self.buffer += token
        self.token_count += 1

        has_sentence_ending = any(ending in self.buffer for ending in self.sentence_endings)

        if has_sentence_ending and self.token_count >= 30:
            content = self.buffer.strip()
            if content and len(content) > 20:
                if self.event_queue:
                    self.event_queue.put({
                        "type": "agent_thinking",
                        "content": content,
                        "timestamp": datetime.now().isoformat()
                    })
            self.buffer = ""
            self.token_count = 0

    def on_llm_end(self, response, **kwargs) -> None:
        """Flushes remaining content and captures token usage"""
        content = self.buffer.strip()
        if content and len(content) > 20:
            if self.event_queue:
                self.event_queue.put({
                    "type": "agent_thinking",
                    "content": content,
                    "timestamp": datetime.now().isoformat()
                })
        self.buffer = ""
        self.token_count = 0

        # Capture token usage from response
        if hasattr(response, 'usage_metadata'):
            usage = response.usage_metadata
            if usage:
                print(f"[CALLBACK TOKEN] Captured from usage_metadata: {usage}")
                accumulate_tokens(usage)

    def on_agent_action(self, action, **kwargs):
        """Capture agent's tool selection"""
        if self.event_queue:
            self.event_queue.put({
                "type": "agent_thinking",
                "content": f"Executing: {action.tool}",
                "timestamp": datetime.now().isoformat()
            })

    def on_tool_start(self, serialized: dict, input_str: str, **kwargs):
        """Tool is about to execute"""
        tool_name = serialized.get("name", "unknown")
        if self.event_queue:
            self.event_queue.put({
                "type": "tool_invocation",
                "tool": tool_name,
                "message": f"Processing {tool_name}...",
                "timestamp": datetime.now().isoformat()
            })


def get_azure_llm_report(event_queue=None):
    """Initialize Azure OpenAI for report generation with streaming"""
    try:
        return AzureChatOpenAI(
            azure_deployment=DEPLOYMENT_NAME,
            openai_api_version=OPENAI_API_VERSION,
            azure_endpoint=AZURE_OPENAI_ENDPOINT,
            api_key=GPT5_API_KEY,
            temperature=1,
            streaming=True,
            callbacks=[ReportEventCallback(event_queue=event_queue)]
        )
    except Exception as e:
        print(f"Error initializing Azure LLM: {str(e)}")
        raise e


# ============================================================================
# GLOBAL STATE FOR REPORT GENERATION WORKFLOW
# ============================================================================

event_queue_global = None
token_usage = {"prompt_tokens": 0, "completion_tokens": 0}


def set_event_queue_global(event_queue_param):
    """Sets the global event queue for real-time streaming"""
    global event_queue_global
    event_queue_global = event_queue_param


def reset_token_usage():
    """Resets token usage counters at the start of analysis"""
    global token_usage
    token_usage = {"prompt_tokens": 0, "completion_tokens": 0}


def accumulate_tokens(usage_dict: dict[str, int]):
    """Accumulates token usage across all LLM calls"""
    global token_usage
    if usage_dict:
        token_usage["prompt_tokens"] += usage_dict.get("prompt_tokens", 0)
        token_usage["completion_tokens"] += usage_dict.get("completion_tokens", 0)
        print(
            f"[TOKEN] Accumulated - Prompt: {token_usage['prompt_tokens']}, Completion: {token_usage['completion_tokens']}")


# ============================================================================
# REPORT DATA STRUCTURES
# ============================================================================

class RiskParameter(BaseModel):
    """Represents a failed or notable risk parameter"""
    name: str = Field(description="Name of the parameter")
    status: str = Field(description="SAFE or UNSAFE")
    reason: str = Field(description="Detailed explanation")


class CompanyRiskSummary(BaseModel):
    """Summary of company risk assessment"""
    company_name: str = Field(description="Company name")
    overall_status: str = Field(description="SAFE or UNSAFE")
    safe_parameters: int = Field(description="Number of parameters passed")
    unsafe_parameters: int = Field(description="Number of parameters failed")
    failed_parameters: list[RiskParameter] = Field(default_factory=list)


class RiskReportData(BaseModel):
    """Complete risk assessment report data"""
    generated_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    total_companies: int = Field(description="Total companies analyzed")
    safe_companies: int = Field(description="Companies with SAFE status")
    unsafe_companies: int = Field(description="Companies with UNSAFE status")
    success_rate: float = Field(description="Percentage of safe companies")
    company_summaries: list[CompanyRiskSummary] = Field(default_factory=list)
    executive_summary: str = Field(description="Verbose executive summary by LLM")
    key_findings: list[str] = Field(description="Key findings from analysis")
    critical_risks: list[str] = Field(description="Critical risks requiring attention")


# ============================================================================
# SHARED DATA STORAGE FOR AGENT WORKFLOW
# ============================================================================

_agent_workflow_state = {
    "mandate_id": None,
    "mandate_details": None,
    "sourced_companies": [],
    "screened_companies": [],
    "risk_analysis": [],
    "risk_results": [],
    "report_data": None,
    "pdf_bytes": None,
    "output_path": None
}


def reset_workflow_state():
    """Reset the workflow state for a new report generation"""
    global _agent_workflow_state
    _agent_workflow_state = {
        "mandate_id": None,
        "mandate_details": None,
        "sourced_companies": [],
        "screened_companies": [],
        "risk_analysis": [],
        "risk_results": [],
        "report_data": None,
        "pdf_bytes": None,
        "output_path": None
    }


def set_workflow_mandate_id(mandate_id: int):
    """Set the mandate ID for the workflow"""
    _agent_workflow_state["mandate_id"] = mandate_id


# LLM will be initialized when needed by create_report_generation_agent()
# Removed module-level initialization to avoid errors before function definition


# ============================================================================
# AGENT TOOLS - DATA FETCHING
# ============================================================================

@tool
def fetch_mandate_data(mandate_id: int) -> str:
    """
    Fetches all data from database for a given mandate.

    This tool retrieves:
    1. Mandate details (fund name, strategy, vintage year, etc.)
    2. Sourced companies (all companies identified during sourcing phase)
    3. Screened companies (screening decisions and reasons)
    4. Risk analysis results (detailed risk parameter assessments)

    The fetched data is stored in the workflow state for use by subsequent tools.

    Args:
        mandate_id: The ID of the fund mandate to fetch data for

    Returns:
        JSON string containing a summary of fetched data (record counts, mandate name)
    """
    try:
        db_data = asyncio.run(fetch_report_data_from_database(mandate_id, event_queue_global))

        # Store in workflow state
        _agent_workflow_state["mandate_id"] = mandate_id
        _agent_workflow_state["mandate_details"] = db_data.get('mandate_details')
        _agent_workflow_state["sourced_companies"] = db_data.get('sourced_companies', [])
        _agent_workflow_state["screened_companies"] = db_data.get('screened_companies', [])
        _agent_workflow_state["risk_analysis"] = db_data.get('risk_analysis', [])

        # Convert risk_analysis records from database into report format
        risk_analysis = db_data.get('risk_analysis', [])
        sourced_companies = db_data.get('sourced_companies', [])
        risk_results = []

        for risk_rec in risk_analysis:
            company_name = 'Unknown'
            if hasattr(risk_rec, 'company_id'):
                for company in sourced_companies:
                    if hasattr(company, 'id') and company.id == risk_rec.company_id:
                        company_name = company.company_name if hasattr(company, 'company_name') else 'Unknown'
                        break

            risk_result = {
                'company_name': company_name,
                'overall_result': getattr(risk_rec, 'overall_result', 'UNKNOWN'),
                'parameter_analysis': getattr(risk_rec, 'parameter_analysis', {}) or {},
                'overall_assessment': getattr(risk_rec, 'overall_assessment', {}) or {}
            }
            risk_results.append(risk_result)
        _agent_workflow_state["risk_results"] = risk_results

        mandate_name = db_data.get('mandate_details', {}).get('legal_name', 'Unknown') if db_data.get(
            'mandate_details') else 'Unknown'
        log_msg = (
            f"✓ Fetched mandate data: {mandate_name} | "
            f"Sourced: {len(sourced_companies)} | "
            f"Screened: {len(db_data.get('screened_companies', []))} | "
            f"Risk analyzed: {len(risk_results)}"
        )
        print(f"[TOOL: fetch_mandate_data] {log_msg}")
        if event_queue_global:
            event_queue_global.put({
                'type': 'tool_result',
                'tool': 'fetch_mandate_data',
                'message': log_msg,
                'timestamp': datetime.now().isoformat()
            })

        return json.dumps({
            'status': 'success',
            'mandate_id': mandate_id,
            'mandate_name': mandate_name,
            'sourced_companies_count': len(sourced_companies),
            'screened_companies_count': len(db_data.get('screened_companies', [])),
            'risk_analyzed_count': len(risk_results)
        })

    except Exception as e:
        error_msg = f"Error fetching mandate data: {str(e)}"
        print(f"[TOOL: fetch_mandate_data] ERROR: {error_msg}")
        traceback.print_exc()
        if event_queue_global:
            event_queue_global.put({
                'type': 'tool_error',
                'tool': 'fetch_mandate_data',
                'error': error_msg,
                'timestamp': datetime.now().isoformat()
            })
        return json.dumps({'status': 'error', 'error': error_msg})


# ============================================================================
# AGENT TOOL - PDF GENERATION
# ============================================================================

@tool
def analyze_and_generate_report_pdf(output_path: str = None) -> str:
    """
    Analyzes all fetched data comprehensively and generates a complete professional PDF report.

    This unified tool performs full analysis and report generation:
    1. Analyzes sourced companies (sourcing stage insights)
    2. Analyzes screened companies (screening stage decisions and their impact)
    3. Analyzes risk assessment results (parameter failures and company status)
    4. Generates LLM-based verbose executive summary covering all three stages
    5. Extracts key findings and critical risks from the complete investment process
    6. Generates professional PDF with mandate details, tables, and comprehensive analysis

    The report explains EVERYTHING: sourcing context, screening decisions, risk assessments,
    and how they collectively inform the investment decision.

    Args:
        output_path: Optional file path to save the PDF. If not provided, PDF is only generated in memory.

    Returns:
        JSON string containing analysis summary, PDF generation status, file path, and comprehensive report data
    """
    try:
        # Get all fetched data from workflow state
        risk_results = _agent_workflow_state.get("risk_results", [])
        sourced_companies = _agent_workflow_state.get("sourced_companies", [])
        screened_companies = _agent_workflow_state.get("screened_companies", [])
        mandate_details = _agent_workflow_state.get("mandate_details")

        if not risk_results:
            raise ValueError("No risk results found. Run fetch_mandate_data first.")

        # ===== STEP 1: Parse and structure all data =====
        company_summaries = []
        all_unsafe_params = {}
        total_safe = 0
        total_unsafe = 0

        for result in risk_results:
            company_name = result.get("company_name", "Unknown")
            overall_status = result.get("overall_result", "UNKNOWN")

            if overall_status == "SAFE":
                total_safe += 1
            else:
                total_unsafe += 1

            param_analysis = result.get("parameter_analysis", {})
            failed_params = []
            safe_count = 0
            unsafe_count = 0

            for param_name, param_data in param_analysis.items():
                if isinstance(param_data, dict):
                    status = param_data.get("status", "UNKNOWN")
                    reason = param_data.get("reason", "No details")

                    if status == "SAFE":
                        safe_count += 1
                    else:
                        unsafe_count += 1
                        failed_params.append({
                            "name": param_name,
                            "status": status,
                            "reason": reason
                        })
                        all_unsafe_params[param_name] = all_unsafe_params.get(param_name, 0) + 1

            company_summaries.append({
                "company_name": company_name,
                "overall_status": overall_status,
                "safe_parameters": safe_count,
                "unsafe_parameters": unsafe_count,
                "failed_parameters": failed_params
            })

        total_companies = len(risk_results)
        success_rate = (total_safe / total_companies * 100) if total_companies > 0 else 0

        # ===== STEP 2: Build context from all three stages =====
        # SOURCING CONTEXT
        if sourced_companies:
            sourcing_details = "\n".join([
                f"  - {company.company_name if hasattr(company, 'company_name') else 'Unknown'} "
                f"({company.sector if hasattr(company, 'sector') else 'N/A'})"
                for company in sourced_companies[:10]  # First 10 for summary
            ])
        else:
            sourcing_details = ""

        # SCREENING CONTEXT
        screening_outcomes = {}
        for screening in screened_companies:
            status = getattr(screening, 'status', 'UNKNOWN')
            screening_outcomes[status] = screening_outcomes.get(status, 0) + 1

        # RISK ASSESSMENT CONTEXT
        critical_params_text = "\n".join([
            f"  - {param}: {count} company(ies) flagged"
            for param, count in sorted(all_unsafe_params.items(), key=lambda x: x[1], reverse=True)[:5]
        ]) if all_unsafe_params else "No critical parameters identified"

        # ===== STEP 3: Generate comprehensive LLM analysis =====
        companies_text = "\n".join([
            f"{s['company_name']}: {s['overall_status']} ({s['safe_parameters']} passed, {s['unsafe_parameters']} failed)"
            for s in company_summaries
        ])

        # Build comprehensive analysis prompt covering all stages
        analysis_prompt = ChatPromptTemplate.from_template("""
You are a Professional Investment Risk Analyst. Analyze the COMPLETE investment process covering three critical stages:
SOURCING → SCREENING → RISK ASSESSMENT

SOURCING INSIGHTS:
Total sourced candidates: {sourced_count}
{sourcing_details}

SCREENING RESULTS:
Total screened: {screening_count}
Outcomes: {screening_outcomes}

RISK ASSESSMENT DATA:
Total companies analyzed: {total_companies}
Companies passed risk assessment: {safe_companies}
Companies failed risk assessment: {unsafe_companies}
Success rate: {success_rate}%

COMPANY RISK STATUS:
{companies_summary}

CRITICAL PARAMETER FAILURES:
{critical_params}

Generate a COMPREHENSIVE executive summary (5-7 sentences) that:
1. Summarizes the sourcing strategy and market identification approach
2. Discusses the screening effectiveness and how it narrowed the opportunity set
3. Analyzes the risk assessment outcomes and parameter findings
4. Connects all three stages: how sourcing led to screening, which led to risk findings
5. Provides investment recommendation based on the complete analysis
6. Highlights portfolio concentration risks or opportunities

Write in professional, formal tone suitable for executive investment committees.
""")

        llm_instance = get_azure_llm_report(event_queue=event_queue_global)

        analysis_response = (analysis_prompt | llm_instance).invoke({
            "sourced_count": len(sourced_companies),
            "sourcing_details": sourcing_details if sourcing_details else "No sourced companies available",
            "screening_count": len(screened_companies),
            "screening_outcomes": str(screening_outcomes),
            "total_companies": total_companies,
            "safe_companies": total_safe,
            "unsafe_companies": total_unsafe,
            "success_rate": round(success_rate, 2),
            "companies_summary": companies_text,
            "critical_params": critical_params_text
        })

        executive_summary = analysis_response.content if hasattr(analysis_response, 'content') else str(
            analysis_response)

        # ===== STEP 4: Extract key findings covering all stages =====
        findings_prompt = ChatPromptTemplate.from_template("""
You are a Professional Investment Analyst. Extract 6-8 KEY FINDINGS from the investment pipeline analysis:

SOURCING STAGE: {sourced_count} candidates identified
SCREENING STAGE: {screening_count} companies screened with {screening_passed} passed
RISK ASSESSMENT STAGE: {success_rate}% success rate across {total_companies} analyzed companies

RISK DATA:
{companies_summary}

CRITICAL RISKS:
{critical_params}

Extract key findings as actionable insights across ALL THREE stages. Return as JSON array:
["Finding about sourcing effectiveness", "Finding about screening impact", "Finding about risk patterns", ...]

Focus on: sourcing efficiency, screening selectivity, risk concentration, portfolio quality, investment viability.
""")

        findings_response = (findings_prompt | llm_instance).invoke({
            "sourced_count": len(sourced_companies),
            "screening_count": len(screened_companies),
            "screening_passed": total_companies,
            "success_rate": round(success_rate, 2),
            "total_companies": total_companies,
            "companies_summary": companies_text,
            "critical_params": critical_params_text
        })

        findings_text = findings_response.content if hasattr(findings_response, 'content') else str(findings_response)

        key_findings = []
        try:
            json_match = re.search(r'\[.*\]', findings_text, re.DOTALL)
            if json_match:
                key_findings = json.loads(json_match.group())
                key_findings = [str(f) for f in key_findings if f]
        except (json.JSONDecodeError, AttributeError) as e:
            print(f"Failed to parse key findings: {e}")
            key_findings = [
                f"Sourced {len(sourced_companies)} investment candidates through structured market analysis",
                f"Screening process evaluated {len(screened_companies)} companies against mandate criteria",
                f"Risk assessment achieved {success_rate:.1f}% compliance rate across {total_companies} companies",
                f"Identified {total_unsafe} companies with mandate parameter violations requiring attention",
                "Portfolio concentration risks identified in critical parameters affecting multiple companies",
                "Investment decision framework successfully applied across entire sourcing-screening-risk pipeline"
            ]

        # ===== STEP 5: Identify critical risks =====
        critical_risks = []
        for param, count in sorted(all_unsafe_params.items(), key=lambda x: x[1], reverse=True)[:5]:
            critical_risks.append(f"{param}: Affects {count} company(ies) - Portfolio concentration risk")

        # ===== STEP 6: Assemble complete report data =====
        report_data = {
            "generated_at": datetime.now().isoformat(),
            "total_companies": total_companies,
            "safe_companies": total_safe,
            "unsafe_companies": total_unsafe,
            "success_rate": round(success_rate, 2),
            "company_summaries": company_summaries,
            "executive_summary": executive_summary,
            "key_findings": key_findings[:7],
            "critical_risks": critical_risks
        }

        _agent_workflow_state["report_data"] = report_data

        # ===== STEP 7: Generate PDF =====
        pdf_bytes = _build_pdf_from_report(
            report_data,
            mandate_details=mandate_details,
            sourced_companies=sourced_companies,
            screened_companies=screened_companies,
            risk_analysis=_agent_workflow_state.get("risk_analysis")
        )

        _agent_workflow_state["pdf_bytes"] = pdf_bytes

        file_path = None
        if output_path:
            output_path_obj = Path(output_path)
            output_path_obj.parent.mkdir(parents=True, exist_ok=True)

            if output_path_obj.stem == 'report':
                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                output_path_obj = output_path_obj.parent / f"report_{timestamp}.pdf"

            with open(output_path_obj, 'wb') as f:
                f.write(pdf_bytes)
            file_path = str(output_path_obj.absolute())
            _agent_workflow_state["output_path"] = file_path

        log_msg = (
            f"✓ Analyzed complete investment pipeline and generated report | "
            f"Sourced: {len(sourced_companies)} | Screened: {len(screened_companies)} | "
            f"Risk analyzed: {total_companies} | PDF Size: {len(pdf_bytes)} bytes"
        )
        print(f"[TOOL: analyze_and_generate_report_pdf] {log_msg}")
        if event_queue_global:
            event_queue_global.put({
                'type': 'tool_result',
                'tool': 'analyze_and_generate_report_pdf',
                'message': log_msg,
                'timestamp': datetime.now().isoformat()
            })

        return json.dumps({
            'status': 'success',
            'sourced_companies': len(sourced_companies),
            'screened_companies': len(screened_companies),
            'risk_analyzed': total_companies,
            'success_rate': report_data.get('success_rate', 0),
            'pdf_size_bytes': len(pdf_bytes),
            'file_path': file_path,
            'report_summary': {
                'total_companies': report_data.get('total_companies'),
                'safe_companies': report_data.get('safe_companies'),
                'unsafe_companies': report_data.get('unsafe_companies'),
                'key_findings_count': len(report_data.get('key_findings', [])),
                'critical_risks_count': len(report_data.get('critical_risks', []))
            }
        })

    except Exception as e:
        error_msg = f"Error in report analysis and generation: {str(e)}"
        print(f"[TOOL: analyze_and_generate_report_pdf] ERROR: {error_msg}")
        traceback.print_exc()
        if event_queue_global:
            event_queue_global.put({
                'type': 'tool_error',
                'tool': 'analyze_and_generate_report_pdf',
                'error': error_msg,
                'timestamp': datetime.now().isoformat()
            })
        return json.dumps({'status': 'error', 'error': error_msg})


# ============================================================================
# LANGGRAPH STATE DEFINITION
# ============================================================================

class ReportGenerationState(TypedDict):
    """State for the report generation LangGraph"""
    messages: list
    mandate_id: int | None
    output_path: str | None


# ============================================================================
# REPORT GENERATION AGENT - LANGGRAPH IMPLEMENTATION
# ============================================================================

REPORT_AGENT_SYSTEM_PROMPT = """You are a Professional Investment Report Generation Agent.

Your role is to orchestrate a two-stage investment report generation workflow that comprehensively covers
the entire investment pipeline: SOURCING → SCREENING → RISK ASSESSMENT.

AVAILABLE TOOLS - Use them in sequence:

1. fetch_mandate_data(mandate_id)
   - Fetches ALL raw data from database:
     * Mandate details (fund name, strategy, vintage year, etc.)
     * Sourced companies (companies identified during sourcing phase)
     * Screened companies (screening stage decisions and reasons)
     * Risk analysis results (detailed risk parameter assessments for each company)
   - Use this FIRST to load all database records
   - Returns: Summary of fetched data with record counts

2. analyze_and_generate_report_pdf(output_path)
   - Takes fetched data and performs comprehensive analysis + report generation:
     * SOURCING ANALYSIS: Reviews sourced companies and market identification strategy
     * SCREENING ANALYSIS: Analyzes screening outcomes and effectiveness
     * RISK ASSESSMENT: Deep analysis of risk parameters, failed checks, and portfolio patterns
     * SYNTHESIS: Generates verbose LLM-based executive summary connecting all three stages
     * KEY FINDINGS: Extracts 6-8 findings covering the complete investment pipeline
     * PDF GENERATION: Creates professional report with all data, analysis, and insights
   - Use this SECOND after fetching mandate data
   - Returns: Complete report data with PDF file path

WORKFLOW SEQUENCE:
1. User provides mandate_id
2. Use fetch_mandate_data to load ALL data from database (sourcing, screening, risk analysis)
3. Use analyze_and_generate_report_pdf to perform complete analysis and generate professional PDF
4. Report includes everything: sourcing context, screening decisions, risk findings, and comprehensive insights

KEY PRINCIPLES:
- All data comes from the database (first tool)
- Second tool handles ALL analysis and report generation in one unified operation
- Report must explain EVERYTHING: why companies were sourced, how they were screened, risk assessment results
- Executive summary should connect sourcing → screening → risk findings into coherent narrative
- Strictly follow the two-step sequence: fetch_mandate_data → analyze_and_generate_report_pdf"""


def _create_report_graph(llm_instance, tools):
    """Create the LangGraph for report generation"""

    graph = StateGraph(ReportGenerationState)

    # Bind tools to LLM for proper tool calling
    llm_with_tools = llm_instance.bind_tools(tools)

    # Add agent node
    def agent_node(state):
        """Agent node that calls LLM with tools"""
        messages = state.get("messages", [])
        mandate_id = state.get("mandate_id")
        output_path = state.get("output_path")

        if not messages:
            messages = []

        # Build the system prompt with context
        system_message = REPORT_AGENT_SYSTEM_PROMPT

        # Build messages list for LLM - use LangChain message objects
        llm_messages = []

        # Add system message
        llm_messages.append(SystemMessage(content=system_message))

        # Convert and add other messages
        for msg in messages:
            if isinstance(msg, (HumanMessage, AIMessage, ToolMessage, SystemMessage)):
                llm_messages.append(msg)
            elif isinstance(msg, dict):
                role = msg.get("role", "")
                content = msg.get("content", "")
                if role == "user":
                    llm_messages.append(HumanMessage(content=content))
                elif role == "assistant":
                    llm_messages.append(AIMessage(content=content))
                elif role == "tool":
                    llm_messages.append(ToolMessage(content=content, tool_call_id=msg.get("tool_call_id", "")))
            elif hasattr(msg, 'content'):
                llm_messages.append(msg)

        # Get LLM response with tool binding
        response = llm_with_tools.invoke(llm_messages)

        # Ensure response is an AIMessage
        if not isinstance(response, AIMessage):
            response = AIMessage(content=str(response.content) if hasattr(response, 'content') else str(response))

        # Add response to messages
        new_messages = messages + [response]

        return {
            "messages": new_messages,
            "mandate_id": mandate_id,
            "output_path": output_path
        }

    graph.add_node("agent", agent_node)

    # Add tool node
    def tool_node(state):
        """Execute tools and return tool messages"""
        messages = state.get("messages", [])
        if not messages:
            return state

        last_message = messages[-1]

        # Check if last message has tool calls
        if not hasattr(last_message, 'tool_calls') or not last_message.tool_calls:
            return state

        # Process each tool call
        tool_results = []
        for tool_call in last_message.tool_calls:
            tool_name = tool_call.get("name") if isinstance(tool_call, dict) else getattr(tool_call, 'name', '')
            tool_input = tool_call.get("args") if isinstance(tool_call, dict) else getattr(tool_call, 'args', {})
            tool_call_id = tool_call.get("id") if isinstance(tool_call, dict) else getattr(tool_call, 'id', '')

            # Find and execute the tool
            for available_tool in tools:
                if available_tool.name == tool_name:
                    try:
                        result = available_tool.invoke(tool_input)
                        tool_results.append(ToolMessage(
                            content=str(result),
                            tool_call_id=tool_call_id,
                            name=tool_name
                        ))
                    except Exception as e:
                        print(f"[TOOL ERROR] {tool_name}: {str(e)}")
                        traceback.print_exc()
                        tool_results.append(ToolMessage(
                            content=f"Error executing {tool_name}: {str(e)}",
                            tool_call_id=tool_call_id,
                            name=tool_name
                        ))
                    break

        # Add tool results to messages
        new_messages = messages + tool_results

        return {
            "messages": new_messages,
            "mandate_id": state.get("mandate_id"),
            "output_path": state.get("output_path")
        }

    graph.add_node("tools", tool_node)

    # Set entry point
    graph.add_edge(START, "agent")

    # Add conditional edges
    def should_continue(state):
        messages = state.get("messages", [])
        if not messages:
            return "end"

        last_message = messages[-1]

        # Check if it's an AI message with tool calls
        if hasattr(last_message, 'tool_calls') and last_message.tool_calls:
            return "tools"

        # Check if it's a tool message - go back to agent
        if isinstance(last_message, ToolMessage):
            return "agent"

        # If no tool calls, we're done
        return "end"

    graph.add_conditional_edges("agent", should_continue, {
        "tools": "tools",
        "agent": "agent",
        "end": END
    })

    graph.add_edge("tools", "agent")

    return graph.compile()


def create_report_generation_agent(event_queue=None):
    """
    Creates and returns a configured report generation agent using LangGraph.

    This agent orchestrates a clean two-step workflow:
    1. Fetches mandate data from database
    2. Analyzes data and generates comprehensive PDF report

    Args:
        event_queue: Optional queue for streaming progress events

    Returns:
        Compiled LangGraph for report generation workflow
    """
    set_event_queue_global(event_queue)

    llm_instance = get_azure_llm_report(event_queue=event_queue)

    # Define tools for the clean agent workflow (2 tools only)
    tools = [
        fetch_mandate_data,
        analyze_and_generate_report_pdf
    ]

    # Create and return the compiled graph
    return _create_report_graph(llm_instance, tools)


# ============================================================================
# MAIN ORCHESTRATION - Agent-Based Workflow
# ============================================================================

def create_report_with_agent(
        mandate_id: int,
        output_path: str | None = None,
        event_queue: Any | None = None
) -> tuple:
    """
    Creates a comprehensive report using the agent-based workflow with LangGraph.

    This is the PRIMARY recommended entry point. It orchestrates the clean
    two-step report generation pipeline:
    1. Fetches all data via fetch_mandate_data tool
    2. Analyzes data and generates PDF via analyze_and_generate_report_pdf tool

    Args:
        mandate_id: ID of the fund mandate to generate report for
        output_path: Optional path to save PDF file
        event_queue: Optional queue for streaming progress events

    Returns:
        Tuple of (file_path, pdf_bytes, report_json_string)
    """
    try:
        # Reset workflow state and token usage
        reset_workflow_state()
        reset_token_usage()
        set_event_queue_global(event_queue)

        # Emit session start event
        if event_queue:
            event_queue.put({
                'type': 'report_session_start',
                'message': f'Starting report generation for mandate {mandate_id}',
                'timestamp': datetime.now().isoformat()
            })

        # Create and run the agent
        agent_graph = create_report_generation_agent(event_queue=event_queue)

        # Build the user request
        user_request = f"""
Generate a comprehensive investment report for mandate ID {mandate_id} that covers the ENTIRE investment pipeline:
SOURCING → SCREENING → RISK ASSESSMENT.

Follow the workflow:
1. First, fetch all mandate data using fetch_mandate_data(mandate_id={mandate_id})
2. Then, analyze the complete pipeline and generate the PDF report using analyze_and_generate_report_pdf(output_path='{output_path}')

The report should explain everything: sourcing strategy, screening effectiveness, risk assessment results, and
how they all connect to form the investment decision.
"""

        # Initialize state for LangGraph
        initial_state = {
            "messages": [HumanMessage(content=user_request)],
            "mandate_id": mandate_id,
            "output_path": output_path
        }

        # Run the graph
        agent_graph.invoke(initial_state)

        # Extract final results from workflow state
        file_path = _agent_workflow_state.get("output_path")
        pdf_bytes = _agent_workflow_state.get("pdf_bytes", b'')
        report_data = _agent_workflow_state.get("report_data", {})

        # Print token summary
        print(
            f"[TOKEN SUMMARY] Total tokens used - Prompt: {token_usage['prompt_tokens']}, Completion: {token_usage['completion_tokens']}")

        # Emit session complete event with token usage
        if event_queue:
            event_queue.put({
                'type': 'report_complete',
                'message': 'Report generation complete',
                'timestamp': datetime.now().isoformat(),
                'file_path': file_path,
                'pdf_size_bytes': len(pdf_bytes),
                'token_usage': token_usage,
                'report_summary': {
                    'total_companies': report_data.get('total_companies'),
                    'safe_companies': report_data.get('safe_companies'),
                    'unsafe_companies': report_data.get('unsafe_companies'),
                    'success_rate': report_data.get('success_rate')
                }
            })

        return (file_path, pdf_bytes, json.dumps(report_data, indent=2))

    except Exception as e:
        error_msg = f"Agent-based report generation failed: {str(e)}"
        print(f"[AGENT WORKFLOW ERROR] {error_msg}")
        traceback.print_exc()
        if event_queue:
            event_queue.put({
                'type': 'error',
                'message': error_msg,
                'timestamp': datetime.now().isoformat()
            })
        raise


# ============================================================================
# PDF REPORT GENERATION
# ============================================================================

def _build_pdf_from_report(
        report_dict: dict[str, Any],
        mandate_details: dict[str, Any] | None = None,
        sourced_companies: list[Any] | None = None,
        screened_companies: list[Any] | None = None,
        risk_analysis: list[Any] | None = None
) -> bytes:
    """Generate a professional PDF report from structured report data with mandate details and page numbers"""
    pdf_buffer = io.BytesIO()

    # ===== UTILITY FUNCTION: Clean all bullet characters and whitespace from text =====
    def clean_text(text):
        """Remove all special characters, Unicode noise, and excessive whitespace"""
        if not isinstance(text, str) or not text:
            return ""

        # STEP 1: Remove ALL Unicode bullet and special characters
        chars_to_remove = [
            '•', '●', '◆', '◇', '○', '■', '□', '▪', '▫', '◉', '◎', '◌', '◍', '⊙', '⊚', '⊛',
            '‣', '›', '⁌', '⁍', '⁎', '‹', '✓', '✗', '✔', '✘', '✕', '✖', '✚', '✜', '✝', '✞', '✟', '✠', '✡', '✢', '✣',
            '✤', '✥',
            '➤', '➢', '▸', '▹', '►', '▶', '▷', '→', '⇒', '↦', '⟹', '⟶', '←', '⇐', '↤', '⟸', '⟵',
            '∙', '∘', '⋅', '◦', '‧', '⋆', '★', '✦', '✧', '⁎', '⁕', '⁘', '⁙', '⁚', '⁛', '⁜',
            '–', '—', '−', '‐', '‑', '‒', '⸺', '⸻',
            '※', '‼', '⁇', '⁈', '⁉', '‾', '‿', '⁀', '⁁', '⁂', '⁃', '⁄', '⁅', '⁆', '⁊', '⁋',
            '┌', '┐', '└', '┘', '├', '┤', '┬', '┴', '┼', '│', '─', '┕', '┗', '┑', '┒', '┓', '┏',
            '±', '∓', '×', '÷', '∗', '∞', '√', '∜', '∛', '∝', '≈', '≉', '≠', '≡', '≢'
        ]

        for char in chars_to_remove:
            text = text.replace(char, '')

        # STEP 2: Remove leading bullet patterns at line start
        text = re.sub(r'^[\s]*[-\*•●◆◇○■□▪▫‣›⁌⁍⁎✓✗✔✘✕✖➤➢▸▹►∙∘⋅◦‧]+[\s]*', '', text, flags=re.MULTILINE)

        # STEP 3: Remove leading special punctuation at line start
        text = re.sub(r'^[\s]*[!@#$%^&*()+=\[\]{}|;:\'",<>/?\\~`]+[\s]*', '', text, flags=re.MULTILINE)

        # STEP 4: Remove multiple consecutive spaces and tabs - CRITICAL for PDF whitespace
        text = re.sub(r'[ \t]+', ' ', text)

        # STEP 5: Remove any remaining standalone special characters
        text = re.sub(r'[^\w\s\.\,\:\;\!\?\-\(\)\'\"]', '', text)

        # STEP 6: Clean up spacing around punctuation
        text = re.sub(r'\s+([.,:;!?])', r'\1', text)
        text = re.sub(r'([.,:;!?])\s+', r'\1 ', text)

        # STEP 7: Remove leading/trailing whitespace and newlines
        text = text.strip()

        # STEP 8: Collapse multiple newlines into single newline
        text = re.sub(r'\n\s*\n', '\n', text)
        text = re.sub(r'\n\s+', '\n', text)

        return text if text else ""

    # Create a custom canvas class for page borders and page numbers
    class BorderedCanvas:
        def __init__(self, *args, **kwargs):
            pass

        def __call__(self, canvas, doc):
            """Add professional borders and page numbers to each page"""
            canvas.saveState()

            # Draw professional border around page
            from reportlab.lib.colors import HexColor
            border_color = HexColor('#1a3a52')
            canvas.setStrokeColor(border_color)
            canvas.setLineWidth(2)

            # Draw rectangle border with some margin
            margin = 0.5 * inch
            canvas.rect(margin, margin, letter[0] - 2 * margin, letter[1] - 2 * margin, stroke=1, fill=0)

            # Add inner subtle border
            canvas.setLineWidth(0.5)
            inner_margin = 0.6 * inch
            canvas.rect(inner_margin, inner_margin, letter[0] - 2 * inner_margin, letter[1] - 2 * inner_margin,
                        stroke=1, fill=0)

            # Add page number at bottom right (positioned lower to avoid border collision)
            canvas.setFont("Helvetica", 9)
            page_num = canvas.getPageNumber()
            canvas.drawRightString(7.2 * inch, 0.3 * inch, f"Page {page_num}")

            canvas.restoreState()

    doc = SimpleDocTemplate(
        pdf_buffer,
        pagesize=letter,
        rightMargin=0.75 * inch,
        leftMargin=0.75 * inch,
        topMargin=0.75 * inch,
        bottomMargin=0.75 * inch
    )

    styles = getSampleStyleSheet()

    # Define professional custom styles
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=26,
        textColor=colors.HexColor('#1a3a52'),
        spaceAfter=6,
        alignment=TA_CENTER,
        fontName='Helvetica-Bold'
    )

    # Mandate details subtitle style - smaller than main title
    mandate_subtitle_style = ParagraphStyle(
        'MandateSubtitle',
        parent=styles['Normal'],
        fontSize=16,
        textColor=colors.HexColor('#1a3a52'),
        alignment=TA_CENTER,
        spaceAfter=8,
        spaceBefore=4,
        fontName='Helvetica-Bold'
    )

    heading_style = ParagraphStyle(
        'CustomHeading',
        parent=styles['Heading2'],
        fontSize=13,
        textColor=colors.HexColor('#1a3a52'),
        spaceAfter=6,
        spaceBefore=8,
        fontName='Helvetica-Bold',
        borderColor=colors.HexColor('#1a3a52'),
        borderWidth=1,
        borderPadding=4
    )

    subheading_style = ParagraphStyle(
        'CustomSubHeading',
        parent=styles['Heading3'],
        fontSize=10,
        textColor=colors.HexColor('#2e5266'),
        spaceAfter=3,
        spaceBefore=6,
        fontName='Helvetica-Bold'
    )

    body_style = ParagraphStyle(
        'CustomBody',
        parent=styles['Normal'],
        fontSize=9,
        alignment=TA_JUSTIFY,
        spaceAfter=3,
        leading=11
    )

    story = []

    # ===== CREATE COMPANY ID TO COMPANY NAME MAPPING =====
    # Build a map of company_id -> company_name from sourced_companies list
    # Apply clean_text() to all database fields to remove Unicode noise
    company_map = {}
    if sourced_companies:
        for company in sourced_companies:
            if hasattr(company, 'id') and hasattr(company, 'company_name'):
                company_map[company.id] = {
                    'name': clean_text(company.company_name),
                    'sector': clean_text(getattr(company, 'sector', 'N/A')),
                    'industry': clean_text(getattr(company, 'industry', 'N/A')),
                    'country': clean_text(getattr(company, 'country', 'N/A'))
                }

    # ===== PAGE 1: TITLE & MANDATE DETAILS ONLY =====
    story.append(Paragraph("RISK ASSESSMENT REPORT", title_style))
    story.append(Spacer(1, 0.15 * inch))
    story.append(Paragraph("MANDATE DETAILS", mandate_subtitle_style))

    # ===== MANDATE DETAILS TABLE (FULLY DYNAMIC & CENTERED) =====
    if mandate_details:
        # Dynamically build mandate details based on what's available
        details_rows = []

        # Add fields that exist
        if mandate_details.get('legal_name'):
            details_rows.append(["Fund Name", clean_text(mandate_details.get('legal_name'))])

        if mandate_details.get('strategy_type'):
            details_rows.append(["Strategy Type", clean_text(mandate_details.get('strategy_type'))])

        if mandate_details.get('vintage_year'):
            details_rows.append(["Vintage Year", str(mandate_details.get('vintage_year'))])

        if mandate_details.get('primary_analyst'):
            details_rows.append(["Primary Analyst", clean_text(mandate_details.get('primary_analyst'))])

        if mandate_details.get('processing_date'):
            details_rows.append(["Processing Date", clean_text(mandate_details.get('processing_date'))])

        if mandate_details.get('description') and mandate_details.get('description').strip():
            desc_para = Paragraph(clean_text(mandate_details.get('description')), body_style)
            details_rows.append(["Description", desc_para])

        # Calculate dynamic column width based on number of rows
        # Adjust vertical spacing based on content
        content_height = 0.2 * inch * len(details_rows)
        vertical_spacer = max(0.5 * inch, (7.5 * inch - content_height) / 2)

        story.append(Spacer(1, vertical_spacer))

        # Calculate dynamic column widths
        # Label column width based on longest label
        label_width = 1.8 * inch
        value_width = 3.2 * inch

        # Create dynamic table
        if details_rows:
            mandate_table = Table(details_rows, colWidths=[label_width, value_width])
            mandate_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (1, 0), colors.HexColor('#1a3a52')),
                ('TEXTCOLOR', (0, 0), (1, 0), colors.whitesmoke),
                ('ALIGN', (0, 0), (0, -1), 'LEFT'),
                ('ALIGN', (1, 0), (1, -1), 'LEFT'),
                ('VALIGN', (0, 0), (1, -1), 'MIDDLE'),
                ('FONTNAME', (0, 0), (1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (1, 0), 10),
                ('BOTTOMPADDING', (0, 0), (1, 0), 8),
                ('TOPPADDING', (0, 0), (1, 0), 8),
                ('BACKGROUND', (0, 1), (1, -1), colors.HexColor('#f5f5f5')),
                ('GRID', (0, 0), (1, -1), 1.5, colors.HexColor('#1a3a52')),
                ('FONTNAME', (0, 1), (0, -1), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 1), (0, -1), 9),
                ('FONTSIZE', (1, 1), (1, -1), 9),
                ('VALIGN', (0, 1), (1, -1), 'TOP'),
                ('ROWBACKGROUNDS', (0, 1), (1, -1), [colors.white, colors.HexColor('#f9f9f9')]),
                ('TOPPADDING', (0, 1), (1, -1), 6),
                ('BOTTOMPADDING', (0, 1), (1, -1), 6),
                ('LEFTPADDING', (0, 0), (1, -1), 12),
                ('RIGHTPADDING', (0, 0), (1, -1), 12)
            ]))

            # Create a centered wrapper for the table
            from reportlab.platypus import Table as RLTable
            centered_wrapper = RLTable([[mandate_table]], colWidths=[5.0 * inch])
            centered_wrapper.setStyle(TableStyle([
                ('ALIGN', (0, 0), (0, 0), 'CENTER'),
                ('VALIGN', (0, 0), (0, 0), 'MIDDLE'),
                ('LEFTPADDING', (0, 0), (0, 0), 0),
                ('RIGHTPADDING', (0, 0), (0, 0), 0),
                ('TOPPADDING', (0, 0), (0, 0), 0),
                ('BOTTOMPADDING', (0, 0), (0, 0), 0)
            ]))

            story.append(centered_wrapper)

        # Page break after mandate table
        story.append(PageBreak())
    else:
        # If no mandate details, just page break
        story.append(Spacer(1, 0.5 * inch))
        story.append(PageBreak())

    # ===== PAGE 2+: ANALYSIS SECTIONS START HERE =====
    story.append(Paragraph("OVERVIEW & ASSESSMENT", heading_style))
    story.append(Spacer(1, 0.04 * inch))

    # Build comprehensive overview with all three contexts
    overview_text = "This comprehensive risk assessment report covers the entire investment process across three critical stages:"
    story.append(Paragraph(clean_text(overview_text), body_style))
    story.append(Spacer(1, 0.04 * inch))

    # Add sourcing overview
    story.append(Paragraph("<b>1. SOURCING STAGE:</b>", subheading_style))
    if sourced_companies and len(sourced_companies) > 0:
        sourcing_summary = f"Identified and evaluated {len(sourced_companies)} potential investment opportunities across multiple sectors and geographies."
        story.append(Paragraph(clean_text(sourcing_summary), body_style))
    story.append(Spacer(1, 0.03 * inch))

    # Add screening overview
    story.append(Paragraph("<b>2. SCREENING STAGE:</b>", subheading_style))
    if screened_companies and len(screened_companies) > 0:
        screening_count = len(screened_companies)
        screening_summary = f"Screened {screening_count} companies against mandate criteria and strategic fit metrics."
        story.append(Paragraph(clean_text(screening_summary), body_style))
    story.append(Spacer(1, 0.03 * inch))

    # Add risk assessment overview
    story.append(Paragraph("<b>3. RISK ASSESSMENT STAGE:</b>", subheading_style))
    total_cos = report_dict.get('total_companies', 0) or 0
    safe_cos = report_dict.get('safe_companies', 0) or 0
    unsafe_cos = report_dict.get('unsafe_companies', 0) or 0
    success_rate = report_dict.get('success_rate', 0) or 0

    if total_cos > 0:
        risk_summary = f"Conducted detailed risk analysis on {total_cos} companies. {safe_cos} companies ({success_rate:.1f}%) passed all risk parameters. {unsafe_cos} companies require attention."
        story.append(Paragraph(clean_text(risk_summary), body_style))
    story.append(Spacer(1, 0.04 * inch))

    # Add executive summary from LLM
    story.append(Paragraph("<b>EXECUTIVE SUMMARY:</b>", subheading_style))
    executive_summary = report_dict.get('executive_summary', '')
    if executive_summary and str(executive_summary).strip():
        executive_summary = clean_text(str(executive_summary))
        if executive_summary:
            story.append(Paragraph(executive_summary, body_style))
    story.append(Spacer(1, 0.04 * inch))

    # ===== EXECUTIVE SUMMARY TABLE (IN THE MIDDLE) =====
    story.append(Paragraph("EXECUTIVE SUMMARY", heading_style))

    exec_data = [
        ['Metric', 'Value', 'Percentage'],
        ['Total Companies', str(report_dict.get('total_companies', 0)), '100%'],
        ['Companies - SAFE', str(report_dict.get('safe_companies', 0)),
         f"{report_dict.get('success_rate', 0):.1f}%"],
        ['Companies - UNSAFE', str(report_dict.get('unsafe_companies', 0)),
         f"{100 - report_dict.get('success_rate', 0):.1f}%"]
    ]

    exec_table = Table(exec_data, colWidths=[2.0 * inch, 1.5 * inch, 1.5 * inch])
    exec_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1a3a52')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 10),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 6),
        ('TOPPADDING', (0, 0), (-1, 0), 6),
        ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#f0f0f0')),
        ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#cccccc')),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, -1), 9),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f9f9f9')]),
        ('TOPPADDING', (0, 1), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6)
    ]))
    story.append(exec_table)
    story.append(Spacer(1, 0.05 * inch))

    # ===== SOURCED COMPANIES SECTION =====
    if sourced_companies:
        story.append(Paragraph("SOURCED COMPANIES", heading_style))
        sourced_data = [['Company Name', 'Sector', 'Industry', 'Country']]
        for company in sourced_companies:
            # Use company_map that was built at the beginning
            company_id = company.id if hasattr(company, 'id') else None
            if company_id and company_id in company_map:
                company_name = company_map[company_id]['name']
                sector = company_map[company_id]['sector']
                industry = company_map[company_id]['industry']
                country = company_map[company_id]['country']
            else:
                # Fallback to direct attributes - also clean them
                company_name = clean_text(company.company_name if hasattr(company, 'company_name') else 'N/A')
                sector = clean_text(company.sector if hasattr(company, 'sector') else 'N/A')
                industry = clean_text(company.industry if hasattr(company, 'industry') else 'N/A')
                country = clean_text(company.country if hasattr(company, 'country') else 'N/A')

            sourced_data.append([
                company_name,
                sector,
                industry,
                country
            ])

        sourced_table = Table(sourced_data, colWidths=[2.0 * inch, 1.5 * inch, 1.5 * inch, 1.0 * inch])
        sourced_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1a3a52')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 9),
            ('FONTSIZE', (0, 1), (-1, -1), 8),
            ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#f5f5f5')),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#cccccc')),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f9f9f9')]),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('LEFTPADDING', (0, 0), (-1, -1), 6),
            ('RIGHTPADDING', (0, 0), (-1, -1), 6),
            ('WORDWRAP', (0, 0), (-1, -1), True)
        ]))
        story.append(sourced_table)
        story.append(Spacer(1, 0.04 * inch))

    # ===== SCREENED COMPANIES SECTION =====
    if screened_companies:
        story.append(Paragraph("SCREENED COMPANIES", heading_style))
        screened_data = [['Company Name', 'Status', 'Reason']]
        for screening in screened_companies:
            # Use company_id to lookup company name from company_map
            company_id = getattr(screening, 'company_id', None)
            if company_id and company_id in company_map:
                company_name = company_map[company_id]['name']
            elif company_id:
                company_name = f"Company {company_id}"
            else:
                company_name = 'N/A'

            status = clean_text(screening.status if hasattr(screening, 'status') and screening.status else 'N/A')
            reason = clean_text(
                screening.reason if hasattr(screening, 'reason') and screening.reason else 'No details')[:60]
            screened_data.append([company_name, status, reason])

        # Dynamic column widths based on available space (6.5 inches available after margins)
        # Company Name: 1.8 inches, Status: 1.0 inches, Reason: 3.7 inches
        screened_table = Table(screened_data, colWidths=[1.8 * inch, 1.0 * inch, 3.7 * inch])
        screened_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1a3a52')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('VALIGN', (0, 0), (0, -1), 'MIDDLE'),
            ('VALIGN', (1, 0), (1, -1), 'MIDDLE'),
            ('VALIGN', (2, 0), (2, -1), 'TOP'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 9),
            ('FONTSIZE', (0, 1), (-1, -1), 7.5),
            ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#f5f5f5')),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#cccccc')),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f9f9f9')]),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
            ('LEFTPADDING', (0, 0), (0, -1), 6),
            ('LEFTPADDING', (1, 0), (1, -1), 6),
            ('LEFTPADDING', (2, 0), (2, -1), 8),
            ('RIGHTPADDING', (0, 0), (0, -1), 6),
            ('RIGHTPADDING', (1, 0), (1, -1), 6),
            ('RIGHTPADDING', (2, 0), (2, -1), 8),
            ('WORDWRAP', (2, 0), (2, -1), True)
        ]))
        story.append(screened_table)
        story.append(Spacer(1, 0.04 * inch))
    # ===== CRITICAL RISKS (moved before Risk Assessment Results) =====
    critical_risks = report_dict.get('critical_risks', [])
    if critical_risks:
        story.append(Paragraph("CRITICAL RISK PARAMETERS", heading_style))
        story.append(Spacer(1, 0.02 * inch))

        for idx, risk in enumerate(critical_risks, 1):
            # Triple-clean: use clean_text() + strict character preservation
            clean_risk = clean_text(str(risk))

            # Keep ONLY safe ASCII letters, numbers, spaces, and basic punctuation
            clean_risk = ''.join(c if (c.isalnum() or c in ' .,;:!?\'"()-') else '' for c in clean_risk)
            clean_risk = re.sub(r'\s+', ' ', clean_risk).strip()

            risk_parts = clean_risk.split(' - ')
            risk_param = risk_parts[0].strip()
            risk_impact = risk_parts[1].strip() if len(risk_parts) > 1 else ''

            if risk_param:
                story.append(Paragraph(
                    f"{idx}. <b>{risk_param}</b>",
                    body_style
                ))
                if risk_impact:
                    story.append(Paragraph(
                        f"Impact: {clean_text(risk_impact)}",
                        body_style
                    ))
                story.append(Spacer(1, 0.03 * inch))

        story.append(Spacer(1, 0.06 * inch))

    # ===== COMPANY ASSESSMENTS =====
    company_summaries = report_dict.get('company_summaries', [])
    if company_summaries:
        # Check if we need a page break (if content is too much)
        # Only add page break if there are many companies
        if len(company_summaries) > 5:
            story.append(PageBreak())
        else:
            story.append(Spacer(1, 0.04 * inch))

        story.append(Paragraph("RISK ASSESSMENT RESULTS", heading_style))
        story.append(Spacer(1, 0.04 * inch))

        for idx, company in enumerate(company_summaries, 1):
            company_name = clean_text(company.get('company_name', f'Company {idx}'))
            overall_status = company.get('overall_status', 'UNKNOWN')
            safe_params = company.get('safe_parameters', 0)
            unsafe_params = company.get('unsafe_parameters', 0)

            # Company header with status color
            color = '#28a745' if overall_status == 'SAFE' else '#dc3545'
            status_text = '✓ PASSED' if overall_status == 'SAFE' else '✗ FAILED'

            # Company title
            story.append(Paragraph(f"{idx}. {company_name}", subheading_style))

            # Overall status and parameter summary
            story.append(Paragraph(
                f"<b>Overall Assessment:</b> <font color='{color}'><b>{status_text}</b></font> | "
                f"<b>Parameters:</b> {safe_params} passed, {unsafe_params} require attention",
                body_style
            ))
            story.append(Spacer(1, 0.02 * inch))

            # Detailed parameter analysis
            failed_params = company.get('failed_parameters', [])

            if failed_params or safe_params > 0:
                story.append(Paragraph("<b>Parameter Analysis:</b>", body_style))
                story.append(Spacer(1, 0.01 * inch))

                # Detailed elaboration for each parameter
                for param_idx, param in enumerate(failed_params, 1):
                    param_name = clean_text(param.get('name', 'Unknown'))
                    param_reason = clean_text(param.get('reason', 'No details'))

                    story.append(Paragraph(
                        f"<b>{param_idx}. {param_name}</b> <font color='#dc3545'>[UNSAFE]</font>",
                        body_style
                    ))
                    story.append(Paragraph(
                        f"{param_reason}",
                        body_style
                    ))
                    story.append(Spacer(1, 0.01 * inch))

                # Add note for passed parameters
                if safe_params > 0:
                    story.append(Paragraph(
                        f"<b>Note:</b> {safe_params} additional parameter(s) met mandate requirements.",
                        body_style
                    ))
            else:
                story.append(Paragraph(
                    "<b>Assessment Summary:</b> All evaluated parameters meet mandate requirements. "
                    "This company demonstrates full compliance with the fund's risk criteria across all assessed dimensions.",
                    body_style
                ))

            # Investment recommendation based on status
            story.append(Spacer(1, 0.02 * inch))
            if overall_status == 'SAFE':
                story.append(Paragraph(
                    "<b>Recommendation:</b> <font color='#28a745'>APPROVED</font>",
                    body_style
                ))
            else:
                story.append(Paragraph(
                    "<b>Recommendation:</b> <font color='#dc3545'>REQUIRES REMEDIATION</font>",
                    body_style
                ))

            story.append(Spacer(1, 0.03 * inch))

    # ===== KEY FINDINGS (at the end) =====
    story.append(Spacer(1, 0.05 * inch))
    story.append(Paragraph("KEY FINDINGS & INSIGHTS", heading_style))
    story.append(Spacer(1, 0.03 * inch))

    key_findings = report_dict.get('key_findings', [])
    if key_findings and len(key_findings) > 0:
        for i, finding in enumerate(key_findings, 1):
            # Clean finding text comprehensively
            clean_finding = clean_text(str(finding) if finding else "")

            # Strict character filtering
            clean_finding = ''.join(c if (c.isalnum() or c in ' .,;:!?\'"()- ') else '' for c in clean_finding)

            # Normalize whitespace
            clean_finding = re.sub(r'\s+', ' ', clean_finding).strip()

            if clean_finding and len(clean_finding) > 3:
                story.append(Paragraph(f"{i}. {clean_finding}", body_style))
                story.append(Spacer(1, 0.02 * inch))
    else:
        story.append(Paragraph("No additional findings identified.", body_style))

    story.append(Spacer(1, 0.04 * inch))

    # ===== FOOTER =====
    generated_date = report_dict.get('generated_at', 'N/A')
    if generated_date and generated_date != 'N/A':
        generated_date = clean_text(str(generated_date))

    footer_text = f"Risk Assessment Report | Generated: {generated_date} | By Report Agent"
    story.append(Paragraph(footer_text, styles['Normal']))

    # Build PDF with professional borders and page numbers
    doc.build(story, onFirstPage=BorderedCanvas(), onLaterPages=BorderedCanvas())
    pdf_buffer.seek(0)
    return pdf_buffer.getvalue()


# ============================================================================
# DATABASE DATA FETCHING FOR REPORT GENERATION
# ============================================================================

async def fetch_report_data_from_database(mandate_id: int, event_queue: Any | None = None) -> dict[str, Any]:
    """
    Fetch all relevant data from database based on mandate_id.

    Retrieves:
    - Mandate details from FundMandate
    - Sourced companies by fetching unique company_ids from Screening and RiskAnalysis tables
    - Screened companies from Screening table
    - Risk analysis results from RiskAnalysis table

    Args:
        mandate_id: ID of the fund mandate
        event_queue: Optional queue for streaming progress events

    Returns:
        Dictionary containing sourced_companies, screened_companies, risk_analysis, and mandate_details
    """
    try:
        from types import SimpleNamespace

        from database.repositories.companyRepository import CompanyRepository
        from database.repositories.fundRepository import FundMandateRepository
        from database.repositories.riskAssessmentRepository import RiskAssessmentRepository
        from database.repositories.screeningRepository import ScreeningRepository
        from database.repositories.sourcingRepository import SourcingRepository

        if event_queue:
            event_queue.put({
                'type': 'report_progress',
                'message': f'Fetching data for mandate {mandate_id}...',
                'timestamp': datetime.now().isoformat()
            })

        # Fetch mandate details using fetch_by_id
        mandate = await FundMandateRepository.fetch_by_id(mandate_id)
        if not mandate:
            print(f"[DB FETCH] Mandate {mandate_id} not found")
            mandate_details = None
        else:
            mandate_details = {
                'id': mandate.id,
                'legal_name': mandate.legal_name,
                'strategy_type': mandate.strategy_type,
                'vintage_year': mandate.vintage_year,
                'primary_analyst': mandate.primary_analyst,
                'processing_date': mandate.processing_date.strftime('%B %d, %Y') if mandate.processing_date else None,
                'description': mandate.description
            }
            print(f"[DB FETCH] ✓ Loaded mandate: {mandate.legal_name}")
            if event_queue:
                event_queue.put({
                    'type': 'report_progress',
                    'message': f'Loaded mandate: {mandate.legal_name}',
                    'timestamp': datetime.now().isoformat()
                })

        # Fetch screening and risk records using repository methods (used elsewhere in report)
        screened_records = await ScreeningRepository.get_screenings_by_mandate(mandate_id)
        risk_records = await RiskAssessmentRepository.get_results_by_mandate(mandate_id)

        # Attempt to load sourced companies from SourcingRepository first
        sourced_companies = []
        try:
            sourcings = await SourcingRepository.get_sourcings_by_mandate(mandate_id)
        except Exception as e:
            print(f"[DB FETCH] Warning: could not load sourcings for mandate {mandate_id}: {e}")
            sourcings = []

        if sourcings:
            for s in sourcings:
                try:
                    data = getattr(s, 'company_data', {}) or {}

                    # First try to get the canonical Company record (if present) so we can use its company_name
                    company_obj = None
                    try:
                        company_obj = await CompanyRepository.fetch_by_id(getattr(s, 'company_id', None))
                    except Exception:
                        company_obj = None

                    # Determine company_name using authoritative Company.company_name first
                    if company_obj and getattr(company_obj, 'company_name', None):
                        company_name = company_obj.company_name
                    else:
                        # Normalize common key names from sourcing.company_data
                        company_name = data.get('company_name') or data.get('Company') or data.get('name') or data.get(
                            'company')

                    sector = data.get('sector') or data.get('Sector') or data.get('industry_sector') or getattr(
                        company_obj, 'sector', None)
                    industry = data.get('industry') or data.get('Industry') or data.get('sub_industry') or getattr(
                        company_obj, 'industry', None)
                    country = data.get('country') or data.get('Country') or getattr(company_obj, 'country', None)

                    obj = SimpleNamespace(
                        id=getattr(s, 'company_id', None),
                        company_id=getattr(s, 'company_id', None),
                        company_name=company_name or f"Company {getattr(s, 'company_id', None)}",
                        sector=sector or 'N/A',
                        industry=industry or 'N/A',
                        country=country or 'N/A',
                        company_data=data,
                        selected_parameters=getattr(s, 'selected_parameters', None)
                    )
                    sourced_companies.append(obj)
                except Exception as e:
                    print(f"[DB FETCH] Warning: error mapping sourcing row to company object: {e}")
                    continue

            print(f"[DB FETCH] ✓ Loaded {len(sourced_companies)} sourced companies (from SourcingRepository)")
            if event_queue:
                event_queue.put({
                    'type': 'report_progress',
                    'message': f'Loaded {len(sourced_companies)} sourced companies (from SourcingRepository)',
                    'timestamp': datetime.now().isoformat()
                })
        else:
            # Fallback: derive company ids from screening and risk tables (legacy behavior)
            sourced_company_ids = set()
            for screening in screened_records:
                if screening.company_id:
                    sourced_company_ids.add(screening.company_id)
            for risk_analysis in risk_records:
                if risk_analysis.company_id:
                    sourced_company_ids.add(risk_analysis.company_id)

            # Fetch company details for each sourced company using fetch_by_id
            for company_id in sourced_company_ids:
                try:
                    company = await CompanyRepository.fetch_by_id(company_id)
                    if company:
                        sourced_companies.append(company)
                except Exception as e:
                    print(f"[DB FETCH] Warning: Could not fetch company {company_id}: {str(e)}")
                    continue

            print(f"[DB FETCH] ✓ Loaded {len(sourced_companies)} sourced companies (fallback)")
            if event_queue:
                event_queue.put({
                    'type': 'report_progress',
                    'message': f'Loaded {len(sourced_companies)} sourced companies (fallback)',
                    'timestamp': datetime.now().isoformat()
                })

        # Fetch screened companies using get_screenings_by_mandate
        screened_companies = screened_records
        print(f"[DB FETCH] ✓ Loaded {len(screened_companies)} screened companies")
        if event_queue:
            event_queue.put({
                'type': 'report_progress',
                'message': f'Loaded {len(screened_companies)} screened companies',
                'timestamp': datetime.now().isoformat()
            })

        # Fetch risk analysis results using get_results_by_mandate
        risk_analysis = risk_records
        print(f"[DB FETCH] ✓ Loaded {len(risk_analysis)} risk analysis results")
        if event_queue:
            event_queue.put({
                'type': 'report_progress',
                'message': f'Loaded {len(risk_analysis)} risk analysis results',
                'timestamp': datetime.now().isoformat()
            })

        return {
            'mandate_details': mandate_details,
            'sourced_companies': sourced_companies,
            'screened_companies': screened_companies,
            'risk_analysis': risk_analysis
        }

    except Exception as e:
        print(f"[DB FETCH ERROR] Error fetching report data: {str(e)}")
        import traceback
        traceback.print_exc()
        raise


# ============================================================================
# MAIN REPORT CREATION FUNCTION
# ============================================================================

def create_report_pdf(
        risk_results: list[dict[str, Any]] | None = None,
        output_path: str | None = None,
        event_queue: Any | None = None,
        mandate_id: int | None = None
) -> tuple:
    """
    Creates a comprehensive risk assessment report from database records using mandate_id.

    IMPORTANT: This function now ALWAYS fetches data from the database using mandate_id.
    The risk_results parameter is IGNORED if mandate_id is provided.

    WORKFLOW:
    1. If mandate_id is provided → Fetch all data from database (sourcing, screening, risk_analysis tables)
    2. Generate comprehensive report with LLM analysis
    3. Create professional PDF with all mandate details
    4. Return (file_path, pdf_bytes, report_json_string)

    Args:
        risk_results: DEPRECATED - not used when mandate_id is provided
        output_path: Optional path to save PDF file
        event_queue: Optional queue for streaming progress events
        mandate_id: REQUIRED - ID of the fund mandate to fetch all data from

    Returns:
        Tuple of (file_path or None, pdf_bytes, report_json_string)
    """
    print(f"\n[REPORT GENERATION] Creating report from database (mandate_id={mandate_id})")

    if not mandate_id:
        raise Exception("mandate_id is required for report generation from database")

    # Delegate to the agent-based workflow which fetches from database
    return create_report_with_agent(
        mandate_id=mandate_id,
        output_path=output_path,
        event_queue=event_queue
    )


def save_report_pdf(
        risk_results: list[dict[str, Any]],
        output_dir: str = './reports'
) -> str:
    """
    Convenience function to save a report PDF file.

    Args:
        risk_results: List of risk assessment results
        output_dir: Directory to save the PDF

    Returns:
        Path to the generated PDF file
    """
    output_dir_path = Path(output_dir)
    output_dir_path.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    output_file = output_dir_path / f"risk_report_{timestamp}.pdf"

    file_path, _, _ = create_report_pdf(risk_results, str(output_file))
    return file_path
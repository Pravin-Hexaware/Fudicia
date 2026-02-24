# mandate_screening.py - Pure LangGraph Implementation with StructuredTools
import json
import operator
import os
import sys
import traceback
from typing import Annotated, Any, TypedDict

from dotenv import load_dotenv
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langgraph.graph import END, START, StateGraph

# Add src directory to path for imports
src_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if src_dir not in sys.path:
    sys.path.insert(0, src_dir)

load_dotenv()

# Import Azure LLM
from utils.llm_testing import get_azure_chat_openai

# Import StructuredTools from screening_tools
from utils.screening_tools import (
    profitability_valuation_screening_tool,
    scale_liquidity_screening_tool,
)


# ================== STATE DEFINITION ==================
class AgentState(TypedDict):
    """State for Bottom-Up Fundamental Analysis Agent"""
    messages: Annotated[list[BaseMessage], operator.add]
    mandate_id: int | None
    mandate_parameters: dict[str, Any] | None
    company_id_list: list[int] | None
    tools_executed: int  # Counter for tools that have been executed
    all_tool_results: dict[str, Any]  # Accumulated results from all tools


# ================== TOOLS REGISTRY ==================
tools = [
    scale_liquidity_screening_tool,
    profitability_valuation_screening_tool
]

# ================== Get LLM ==================
try:
    llm = get_azure_chat_openai()
    print("[AGENT] ✅ LLM loaded successfully")
except Exception as e:
    print(f"[AGENT] ❌ Error loading LLM: {e}")
    raise


# ================== AGENT NODE ==================
def agent_node(state: AgentState) -> dict:
    """Invoke LLM: emit THINKING first, then tool calls. Separate messages for streaming."""
    messages = state.get("messages", [])
    mandate_id = state.get("mandate_id")
    mandate_parameters = state.get("mandate_parameters")
    company_id_list = state.get("company_id_list")
    tools_executed = state.get("tools_executed", 0)
    all_tool_results = state.get("all_tool_results", {})

    print(f"\n[AGENT] Processing: {len(messages)} messages")
    print(
        f"[AGENT] mandate_id={mandate_id}, params={len(mandate_parameters) if mandate_parameters else 0}, companies={len(company_id_list) if company_id_list else 'all'}")
    print(f"[AGENT] Tools executed so far: {tools_executed}/2")

    # Extract mandate data from first message if not in state
    if not mandate_id and messages:
        for msg in messages:
            if isinstance(msg, HumanMessage):
                try:
                    content = json.loads(msg.content)
                    mandate_id = content.get("mandate_id")
                    mandate_parameters = content.get("mandate_parameters")
                    company_id_list = content.get("company_id_list")
                    print(f"[AGENT] Extracted from message: mandate_id={mandate_id}")
                    break
                except:
                    pass

    # System prompt with explicit termination instruction
    system_prompt = """You are the BOTTOM-UP FUNDAMENTAL ANALYSIS AGENT.

MANDATE: THINK STEP-BY-STEP. Analyze and screen companies based on mandate_parameters.

DIMENSIONS:
1. SCALE & LIQUIDITY: revenue, ebitda, net_income, market_cap
2. PROFITABILITY & VALUATION: gross_profit_margin, return_on_equity, debt_to_equity, pe_ratio, price_to_book, dividend_yield, growth

⚠️ CRITICAL - YOU MUST EMIT THINKING TEXT FIRST - EVERY LLM CALL BEFORE TOOL
═════════════════════════════════════════════════════════════════════════════

MANDATORY FORMAT - EVERY RESPONSE STARTS WITH:

Thought: I am a Bottom-Up Fundamental Analysis Agent responsible for screening companies...
Analysis: [Your step-by-step analysis of the parameters and strategy]
Action: [name of tool(s) to execute]

THEN the tools execute.

═════════════════════════════════════════════════════════════════════════════

FINAL OUTPUT MUST BE VALID JSON with thinking included:
{
  "mandate_id": <int>,
  "analysis": "Your step-by-step thinking and reasoning here. Explain what parameters were found, which tools were called, and what the results mean.",
  "tools_used": ["tool_name1", "tool_name2"],
  "company_details": [
    {"id": 1, "Company": "Name", "status": "Pass", "reason": "reason"},
    {"id": 2, "Company": "Name", "status": "Conditional", "reason": "missing X,Y,Z", "null_parameters": ["X", "Y", "Z"]}
  ]
}

RULES:
- Show thinking in analysis field
- Call tools ONLY as needed based on parameters present
- Pass mandate_parameters EXACTLY - never modify
- If 1 tool → use its results
- If 2 tools → use intersection (companies passing BOTH)
- Output ONLY JSON at end, no extra text"""

    messages_with_system = [SystemMessage(content=system_prompt)] + messages

    # Check if we already have tool results
    has_tool_results = any(isinstance(m, ToolMessage) for m in messages)

    print(f"[AGENT] Has tool results: {has_tool_results}")

    try:
        responses_to_return = []

        # STEP 1: Get THINKING text (without tools)
        print("[AGENT] Getting thinking/analysis from LLM...")
        thinking_response = llm.invoke(messages_with_system)
        responses_to_return.append(thinking_response)
        print("[AGENT] ✅ Thinking emitted")

        # STEP 2: Conditional tool call (if no tool results yet)
        if not has_tool_results:
            print("[AGENT] Getting tool calls from LLM...")
            llm_with_tools = llm.bind_tools(tools)
            tool_response = llm_with_tools.invoke(messages_with_system)
            responses_to_return.append(tool_response)

            if hasattr(tool_response, 'tool_calls') and tool_response.tool_calls:
                print(f"[AGENT] ✅ Tool calls: {[tc.get('name') for tc in tool_response.tool_calls]}")
            else:
                print("[AGENT] No tool calls - summary ready")
        else:
            print("[AGENT] Tool results already present, skipping tool calls")

        return {"messages": responses_to_return}

    except Exception as e:
        print(f"[AGENT] ❌ Error: {e}")
        traceback.print_exc()
        error_msg = AIMessage(content=f"Error: {str(e)}")
        return {"messages": [error_msg]}


# ================== CUSTOM TOOLS NODE ==================
def tools_node(state: AgentState) -> dict:
    """Execute tools and track completion to prevent infinite loops."""
    messages = state.get("messages", [])
    tools_executed = state.get("tools_executed", 0)
    all_tool_results = state.get("all_tool_results", {})

    last_message = messages[-1] if messages else None

    if not hasattr(last_message, 'tool_calls') or not last_message.tool_calls:
        print("[TOOLS NODE] No tool calls found, returning without change")
        return {}

    print(f"\n[TOOLS NODE] Executing tools. Tools executed so far: {tools_executed}/2")

    tool_results = []
    tool_dict = {tool.name: tool for tool in tools}

    for tool_call in last_message.tool_calls:
        tool_name = tool_call.get("name")
        tool_input = tool_call.get("args", {})
        tool_call_id = tool_call.get("id")

        print(f"[TOOLS NODE] Executing {tool_name} with id={tool_call_id}")

        if tool_name not in tool_dict:
            print(f"[TOOLS NODE] ❌ Tool {tool_name} not found")
            continue

        try:
            tool = tool_dict[tool_name]
            result = tool.invoke(tool_input)

            # Parse result if it's a JSON string
            if isinstance(result, str):
                try:
                    result_dict = json.loads(result)
                    # Store tool result for final summary
                    all_tool_results[tool_name] = result_dict
                except:
                    pass

            # Create ToolMessage
            tool_message = ToolMessage(
                content=result,
                name=tool_name,
                tool_call_id=tool_call_id
            )
            tool_results.append(tool_message)
            tools_executed += 1

            print(f"[TOOLS NODE] ✅ {tool_name} completed (total executed: {tools_executed}/2)")

        except Exception as e:
            print(f"[TOOLS NODE] ❌ Error executing {tool_name}: {e}")
            traceback.print_exc()
            tool_results.append(ToolMessage(
                content=f"Error executing {tool_name}: {str(e)}",
                name=tool_name,
                tool_call_id=tool_call_id
            ))

    print(f"[TOOLS NODE] Tool execution complete. Total executed: {tools_executed}/2\n")

    return {
        "messages": tool_results,
        "tools_executed": tools_executed,
        "all_tool_results": all_tool_results
    }


# ================== ROUTING LOGIC ==================
def should_continue(state: AgentState) -> str:
    """Route: if last message has tool_calls and haven't executed both tools yet, go to tools; else END"""
    messages = state.get("messages", [])
    tools_executed = state.get("tools_executed", 0)

    if not messages:
        return END

    last_message = messages[-1]
    has_tool_calls = hasattr(last_message, 'tool_calls') and last_message.tool_calls

    # If both tools have executed, end the workflow
    if tools_executed >= 2:
        print(f"[ROUTER] Both tools have executed ({tools_executed}/2) → END")
        return END

    # If there are tool calls to make, route to tools
    if has_tool_calls:
        print(f"[ROUTER] Tool calls detected (executed: {tools_executed}/2) → tools node")
        return "tools"

    print(f"[ROUTER] No tool calls (executed: {tools_executed}/2) → END")
    return END


# ================== CREATE AGENT ==================
def create_bottom_up_fundamental_analysis_agent():
    """Create the agent workflow."""
    print("\n[WORKFLOW] Creating Bottom-Up Fundamental Analysis Agent...")

    workflow = StateGraph(AgentState)

    # Add nodes
    workflow.add_node("agent", agent_node)
    workflow.add_node("tools", tools_node)  # Custom tools handler

    # Add edges
    workflow.add_edge(START, "agent")
    workflow.add_conditional_edges(
        "agent",
        should_continue,
        {"tools": "tools", END: END}
    )
    # After tools, loop back to agent so LLM can decide if more tools needed
    workflow.add_edge("tools", "agent")

    agent = workflow.compile()
    print("[WORKFLOW] ✅ Agent compiled\n")
    return agent


# ================== MAIN TEST ==================
if __name__ == "__main__":
    print("🚀 Bottom-Up Fundamental Analysis Agent\n")

    try:
        agent = create_bottom_up_fundamental_analysis_agent()
    except Exception as e:
        print(f"❌ Failed to create agent: {e}")
        traceback.print_exc()
        exit(1)

    user_payload = {
        "mandate_id": 1,
        "mandate_parameters": {
            "revenue": "> $40M USD",
            "gross_profit_margin": "> 60%",
            "return_on_equity": "> 15%",
            "debt_to_equity": "< 0.5",
            "pe_ratio": "< 40"
        },
        "company_id_list": [1, 2, 3]
    }

    try:
        print("📝 Starting agent invocation...")
        result = agent.invoke({
            "messages": [HumanMessage(content=json.dumps(user_payload))],
            "mandate_id": 1,
            "mandate_parameters": user_payload["mandate_parameters"],
            "company_id_list": user_payload["company_id_list"],
            "tools_executed": 0,
            "all_tool_results": {}
        })
        print("\n✅ Agent completed successfully!")
        print(f"Total messages in result: {len(result.get('messages', []))}")
    except Exception as e:
        print(f"❌ Error: {e}")
        traceback.print_exc()
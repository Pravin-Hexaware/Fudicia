import json
import traceback
from collections import defaultdict
from collections.abc import Iterable
from datetime import datetime
#from logging import exception
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from pydantic import BaseModel

# Import LangGraph agent (pure LangGraph - no CrewAI)
try:
    from agents.mandate_screening import create_bottom_up_fundamental_analysis_agent

    print("[API] ✅ Successfully imported LangGraph agent from mandate_screening")
except Exception as e:
    print(f"[API] ❌ Error importing agent from mandate_screening: {e}")
    import traceback

    traceback.print_exc()
    create_bottom_up_fundamental_analysis_agent = None

# Import screening repository (optional - for database save if needed)
try:
    from database.repositories.screeningRepository import ScreeningRepository
except Exception as e:
    print(f"[API] ⚠️ Could not import ScreeningRepository: {e}")
    ScreeningRepository = None


def aggregate_token_usage(messages: Iterable[Any]) -> dict[str, Any]:
    """
    Inspect a sequence of message objects (AIMessage, ToolMessage, etc.)
    and return aggregated token usage:
      {
        "per_model": {
          "<model_name>": {"input_tokens": X, "output_tokens": Y, "total_tokens": Z},
          ...
        },
        "totals": {"input_tokens": X, "output_tokens": Y, "total_tokens": Z}
      }
    The function is defensive: many providers use different attribute names, so we
    check common fields: `usage_metadata`, `usage`, `metadata`, `extra`.
    """
    per_model = defaultdict(lambda: {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0})
    totals = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}

    def read_usage_dict(d: dict[str, Any]) -> dict[str, int]:
        return {
            "input_tokens": int(d.get("input_tokens", d.get("inputTokens", 0) or 0)),
            "output_tokens": int(d.get("output_tokens", d.get("outputTokens", 0) or 0)),
            "total_tokens": int(d.get("total_tokens", d.get("totalTokens", d.get("total_tokens", 0)) or 0)),
        }

    for m in messages:
        # 1) If message has usage_metadata (LangChain AIMessage uses this name)
        usage_source = None
        model_name = None

        if hasattr(m, "usage_metadata") and m.usage_metadata:
            usage_source = m.usage_metadata
            # try to detect model name if present
            model_name = getattr(m, "model", None) or usage_source.get("model") if isinstance(usage_source,
                                                                                              dict) else None

        # 2) Some providers attach .usage or .usage_data
        elif hasattr(m, "usage") and m.usage:
            usage_source = m.usage
            model_name = getattr(m, "model", None) or (
                usage_source.get("model") if isinstance(usage_source, dict) else None)

        # 3) ToolMessage or other objects may put usage in `metadata` or `extra`
        elif hasattr(m, "metadata") and isinstance(m.metadata, dict):
            meta = m.metadata
            if any(k in meta for k in ("input_tokens", "output_tokens", "total_tokens")):
                usage_source = meta
                model_name = meta.get("model") or getattr(m, "tool_name", None) or None
        elif hasattr(m, "extra") and isinstance(m.extra, dict):
            extra = m.extra
            if any(k in extra for k in ("input_tokens", "output_tokens", "total_tokens")):
                usage_source = extra
                model_name = extra.get("model") or getattr(m, "tool_name", None) or None

        # 4) If we found usage, read and accumulate
        if usage_source and isinstance(usage_source, dict):
            u = read_usage_dict(usage_source)
            key = model_name or usage_source.get("model") or "unknown"
            per_model[key]["input_tokens"] += u["input_tokens"]
            per_model[key]["output_tokens"] += u["output_tokens"]
            per_model[key]["total_tokens"] += u["total_tokens"]
            totals["input_tokens"] += u["input_tokens"]
            totals["output_tokens"] += u["output_tokens"]
            totals["total_tokens"] += u["total_tokens"]

    return {"per_model": dict(per_model), "totals": totals}


def format_metric_reason(reason_text: str) -> str:
    """Enhance tool reason with natural language wrapper. Fallback to raw reason if enhancement fails."""
    if not reason_text:
        return "Meets screening criteria"

    try:
        # Format: "revenue: 50.00 > 40.00 | debt_to_equity: 0.45 < 0.5"
        # Simply add wrapper and basic formatting
        enhanced = reason_text.replace(" | ", ", ").replace("_", " ").lower()
        return f"Passed because: {enhanced}."
    except Exception:
        # If any error, just return tool reason as-is
        return reason_text


def combine_tool_reasons(reasons_list: list) -> str:
    """Combine reasons from multiple tools into a single natural language explanation."""
    if not reasons_list:
        return "Meets all screening criteria"

    if len(reasons_list) == 1:
        # Single tool reason
        return format_metric_reason(reasons_list[0])

    try:
        # Multiple tool reasons - combine them
        all_metrics = []
        for reason in reasons_list:
            if reason:
                # Split by " | " to get individual metrics
                metrics = [m.strip() for m in reason.split(" | ")]
                all_metrics.extend(metrics)

        if all_metrics:
            # Format metrics: "revenue: 50.00 > 40.00" -> "revenue of 50.00 is greater than 40.00"
            formatted_metrics = []
            for metric in all_metrics:
                # Parse "param: value operator threshold"
                if ":" in metric:
                    parts = metric.split(":", 1)
                    param = parts[0].strip().replace("_", " ").title()
                    values = parts[1].strip().split()
                    if len(values) >= 3:
                        value = values[0]
                        op = values[1]
                        threshold = " ".join(values[2:])
                        op_text = {">": "greater than", "<": "less than", ">=": "at least", "<=": "at most",
                                   "==": "equal to"}.get(op, op)
                        formatted_metrics.append(f"{param} of {value} is {op_text} {threshold}")
                    else:
                        formatted_metrics.append(metric)
                else:
                    formatted_metrics.append(metric)

            if formatted_metrics:
                return "This company passed because " + ", ".join(formatted_metrics) + "."

        return "Meets all screening criteria"
    except Exception as e:
        # Fallback: just combine raw reasons
        print("Error combining tool reasons: ", e)
        combined = " AND ".join(reasons_list)
        return f"Passed based on: {combined}"


def enhance_company_reasons_from_tools(company_details: list, all_messages: list) -> list:
    """
    Enhance reasons in company_details by merging reasons from tool results.
    Only enhances companies that are in both tool results (passed both tools).
    """
    if not company_details or not all_messages:
        return company_details

    try:
        # Collect all tool results
        companies_tool_reasons = {}  # {company_id: [reason1, reason2, ...]}

        for msg in all_messages:
            if isinstance(msg, ToolMessage):
                try:
                    tool_content = msg.content if isinstance(msg.content, str) else str(msg.content)
                    parsed = json.loads(tool_content)

                    # Get passed companies from tool
                    passed = parsed.get("passed_companies", [])
                    for company in passed:
                        company_id = company.get("company_id") or company.get("id")
                        reason = company.get("reason", "")

                        if company_id and reason:
                            if company_id not in companies_tool_reasons:
                                companies_tool_reasons[company_id] = []
                            companies_tool_reasons[company_id].append(reason)

                except json.JSONDecodeError:
                    pass
                except Exception as e:
                    print(f"[WS] Error parsing tool message for reasons: {e}")
                    pass

        print(f"[WS] Collected tool reasons for {len(companies_tool_reasons)} companies")

        # Enhance company reasons in final response
        enhanced_details = []
        for company in company_details:
            company_id = company.get("id") or company.get("company_id")

            if company.get("status") == "Pass" and company_id in companies_tool_reasons:
                # This company has tool reasons - merge them
                tool_reasons = companies_tool_reasons[company_id]
                combined_reason = combine_tool_reasons(tool_reasons)

                company["reason"] = combined_reason
                print(f"[WS] Enhanced reason for company {company_id}: {combined_reason[:100]}")

            enhanced_details.append(company)

        return enhanced_details

    except Exception as e:
        print(f"[WS] Error enhancing reasons: {e}")
        return company_details


class ScreeningRequest(BaseModel):
    """Financial Screening Request Model - Database-Driven with Company IDs"""
    mandate_id: int
    mandate_parameters: dict
    company_id: list[int] = None  # Optional: specific companies to screen

    class Config:
        json_schema_extra = {
            "example": {
                "mandate_id": 1,
                "mandate_parameters": {
                    "revenue": "> $40M USD",
                    "debt_to_equity": "< 0.5",
                    "pe_ratio": "< 40"
                },
                "company_id": [1, 2, 3, 5]
            }
        }


class ScreeningResponse(BaseModel):
    """API Response Model - Company Details"""
    mandate_id: int
    company_details: list[dict[str, Any]]
    total_passed: int = 0
    total_conditional: int = 0
    message_count: int = 0


router = APIRouter()


@router.websocket("/api/ws/screen")
async def websocket_screen_companies(websocket: WebSocket):
    """WebSocket endpoint for real-time company screening with streaming of thinking, analysis, action, tool calls, and results."""
    await websocket.accept()

    try:
        print("[WS] ✅ Connection established")

        # Receive request from client
        data = await websocket.receive_json()

        # Extract mandate_id, mandate_parameters, and optional company_id_list
        mandate_id = data.get("mandate_id")
        mandate_parameters = data.get("mandate_parameters", {})
        company_id_list = data.get("company_id")

        # Validate input
        if not mandate_id or not mandate_parameters:
            await websocket.send_json({
                "type": "error",
                "content": "Invalid request: mandate_id and mandate_parameters are required"
            })
            await websocket.close(code=1008)
            return

        mandate_id_int = int(mandate_id)
        print(
            f"[WS] Request: mandate_id={mandate_id_int}, params={len(mandate_parameters)}, companies={len(company_id_list) if company_id_list else 'all'}")

        # Notify client
        await websocket.send_json({
            "type": "info",
            "content": "Creating Bottom-Up Fundamental Analysis Agent..."
        })

        if not create_bottom_up_fundamental_analysis_agent:
            raise Exception("Screening agent factory not available")

        print("[WS] Creating LangGraph agent...")
        agent = create_bottom_up_fundamental_analysis_agent()
        print("[WS] ✅ Agent created")

        # Prepare initial state for LangGraph
        user_message = HumanMessage(content=json.dumps({
            "mandate_id": mandate_id_int,
            "mandate_parameters": mandate_parameters,
            "company_id_list": company_id_list
        }))

        initial_state = {
            "messages": [user_message],
            "mandate_id": mandate_id_int,
            "mandate_parameters": mandate_parameters,
            "company_id_list": company_id_list,
            "tools_executed": 0,
            "all_tool_results": {}
        }

        await websocket.send_json({
            "type": "info",
            "content": f"Screening started for mandate ID: {mandate_id_int}"
        })

        print("[WS] Streaming agent output...")

        # Stream agent events in real-time
        all_messages = []
        streaming_step = 0

        for event in agent.stream(initial_state):
            streaming_step += 1

            # Each event is a dict with node name as key and state update as value
            node_name = list(event.keys())[0]
            state_updates = event[node_name]

            # Extract new messages added in this step
            new_messages = state_updates.get("messages", [])

            for msg in new_messages:
                all_messages.append(msg)
                # msg_type = type(msg).__name__

                try:
                    msg_content = msg.content if hasattr(msg, "content") else str(msg)

                    # Determine message type and send to client
                    if isinstance(msg, AIMessage):
                        has_tools = hasattr(msg, "tool_calls") and msg.tool_calls

                        if has_tools:
                            # This is a tool call message
                            tool_names = [tc.get("name", "unknown") for tc in msg.tool_calls]
                            await websocket.send_json({
                                "type": "action",
                                "step": streaming_step,
                                "tools": tool_names,
                                "content": str(msg_content)
                            })
                            print(f"[WS] Step {streaming_step}: Action - Tool calls: {tool_names}")

                        else:
                            # This is thinking/analysis (text without tool calls)
                            # Try to parse as JSON for structured response
                            try:
                                parsed_json = json.loads(str(msg_content))
                                if "analysis" in parsed_json:
                                    # This looks like final answer
                                    await websocket.send_json({
                                        "type": "analysis",
                                        "step": streaming_step,
                                        "content": parsed_json.get("analysis", str(msg_content))
                                    })
                                    print(f"[WS] Step {streaming_step}: Analysis")
                                else:
                                    # Regular thinking
                                    await websocket.send_json({
                                        "type": "thought",
                                        "step": streaming_step,
                                        "content": str(msg_content)
                                    })
                                    print(f"[WS] Step {streaming_step}: Thought")
                            except json.JSONDecodeError:
                                await websocket.send_json({
                                    "type": "thought",
                                    "step": streaming_step,
                                    "content": str(msg_content)
                                })
                                print(f"[WS] Step {streaming_step}: Thought/Reasoning")
                            except Exception:
                                # Not JSON, send as thinking
                                await websocket.send_json({
                                    "type": "thought",
                                    "step": streaming_step,
                                    "content": str(msg_content)
                                })
                                print(f"[WS] Step {streaming_step}: Thought/Reasoning")

                    elif isinstance(msg, ToolMessage):
                        # Tool result message
                        tool_name = getattr(msg, "name", "unknown")
                        await websocket.send_json({
                            "type": "tool_result",
                            "step": streaming_step,
                            "tool": tool_name,
                            "content": str(msg_content)
                        })
                        print(f"[WS] Step {streaming_step}: Tool Result from {tool_name}")

                except Exception as e:
                    print(f"[WS] Error streaming message: {e}")
                    continue

        print("[WS] ✅ Agent streaming completed")
        print(f"[WS] Total messages collected: {len(all_messages)}")

        # Extract final result from last AIMessage with JSON content
        print("[WS] Processing final results...")

        # Aggregate tokens from all messages
        tokens_info = aggregate_token_usage(all_messages)
        print(f"[WS] Token usage: {tokens_info['totals']}")

        company_details = []

        # Look for the final JSON summary in reverse order
        for msg in reversed(all_messages):
            if isinstance(msg, AIMessage):
                try:
                    content_str = msg.content if isinstance(msg.content, str) else str(msg.content)
                    parsed = json.loads(content_str)

                    if "company_details" in parsed:
                        company_details = parsed.get("company_details", [])
                        print("[WS] Found final summary in messages")
                        break
                except json.JSONDecodeError:
                    pass
                except Exception as e:
                    print(f"[WS] Error parsing message for final summary: {e}")
                    pass

        # If no JSON summary, extract from tool results
        if not company_details:
            print("[WS] Extracting results from tool messages...")
            all_passed = []
            all_conditional = []

            for msg in all_messages:
                if isinstance(msg, ToolMessage):
                    try:
                        tool_content = msg.content if isinstance(msg.content, str) else str(msg.content)
                        parsed = json.loads(tool_content)

                        # Extract passed companies
                        passed = parsed.get("passed_companies", [])
                        if passed:
                            all_passed.extend(passed)
                            print(f"[WS] Found {len(passed)} passed companies from {msg.name}")

                        # Extract conditional companies
                        conditional = parsed.get("conditional_companies", [])
                        if conditional:
                            all_conditional.extend(conditional)
                            print(f"[WS] Found {len(conditional)} conditional companies from {msg.name}")

                    except json.JSONDecodeError:
                        print("[WS] Could not parse tool result")

            # Store results by tool for combining reasons
            companies_by_id = {}  # {company_id: {"company": company_obj, "reasons": [reason1, reason2, ...]}}

            # Process all passed companies
            for company in all_passed:
                company_id = company.get("company_id") or company.get("id")
                if company_id not in companies_by_id:
                    companies_by_id[company_id] = {
                        "company": company,
                        "reasons": []
                    }
                raw_reason = company.get("reason", "")
                if raw_reason:
                    companies_by_id[company_id]["reasons"].append(raw_reason)

            passed_ids_seen = set(companies_by_id.keys())
            dedup_passed = list(companies_by_id.values())

            # Filter conditionals to remove any that are already in passed
            dedup_conditional = []
            for company in all_conditional:
                company_id = company.get("company_id") or company.get("id")
                if company_id not in passed_ids_seen:
                    dedup_conditional.append(company)

            print(f"[WS] After dedup: {len(dedup_passed)} passed, {len(dedup_conditional)} conditional")

            # Build company_details array with combined tool reasons
            for company_data in dedup_passed:
                company = company_data["company"]
                reasons = company_data["reasons"]

                # Combine reasons from all tools into natural language
                if reasons:
                    combined_reason = combine_tool_reasons(reasons)
                else:
                    combined_reason = "Meets all screening criteria"

                company_details.append({
                    "id": company.get("company_id") or company.get("id"),
                    "Company": company.get("Company", "Unknown"),
                    "status": "Pass",
                    "reason": combined_reason
                })

            for company in dedup_conditional:
                null_params = company.get("null_parameters", [])
                null_text = ", ".join(null_params) if null_params else "some metrics"
                reason = f"The company meets most screening criteria but lacks data for {null_text}, preventing complete assessment."
                company_details.append({
                    "id": company.get("company_id") or company.get("id"),
                    "Company": company.get("Company", "Unknown"),
                    "status": "Conditional",
                    "reason": reason,
                    "null_parameters": null_params
                })
        else:
            # Use final summary but enhance the reasons with tool data
            print("[WS] Enhancing final summary reasons with tool data...")
            company_details = enhance_company_reasons_from_tools(company_details, all_messages)

        # Build and send final result
        final_result = {
            "mandate_id": mandate_id_int,
            "company_details": company_details,
            "total_passed": len([c for c in company_details if c.get("status") == "Pass"]),
            "total_conditional": len([c for c in company_details if c.get("status") == "Conditional"]),
            "tokens_used": tokens_info
        }

        await websocket.send_json({
            "type": "final_result",
            "content": final_result
        })

        total_companies = len(company_details)
        passed_count = final_result["total_passed"]
        conditional_count = final_result["total_conditional"]
        print(
            f"[WS] ✅ Results sent: {total_companies} companies ({passed_count} passed, {conditional_count} conditional)")

        # ============================================================================
        # SAVE RESULTS TO DATABASE WITH ENHANCED ERROR HANDLING
        # ============================================================================
        if company_details and ScreeningRepository:
            try:
                print(f"[WS] 💾 Saving {len(company_details)} screening results to database...")

                # Notify client that database save is in progress
                await websocket.send_json({
                    "type": "info",
                    "content": f"Saving {len(company_details)} results to database..."
                })

                # Call repository to save results
                await ScreeningRepository.process_agent_output(
                    fund_mandate_id=mandate_id_int,
                    selected_parameters=mandate_parameters,
                    company_details=company_details,
                    raw_agent_output=json.dumps({
                        "mandate_id": mandate_id_int,
                        "company_details": company_details,
                        "total_passed": passed_count,
                        "total_conditional": conditional_count,
                        "tokens_used": tokens_info,
                        "timestamp": datetime.now().isoformat()
                    })
                )

                print(f"[WS] ✅ Successfully saved {len(company_details)} records to database")

                # Notify client of successful save
                await websocket.send_json({
                    "type": "success",
                    "content": f"✅ Screening results saved successfully - {passed_count} passed, {conditional_count} conditional"
                })

            except Exception as db_error:
                print(f"[WS] ⚠️ Database save failed: {str(db_error)}")
                import traceback
                traceback.print_exc()

                # Notify client of database error but don't fail the request
                try:
                    await websocket.send_json({
                        "type": "warning",
                        "content": f"Results displayed but database save failed: {str(db_error)}"
                    })
                except (ValueError | KeyError | TypeError | Exception) as e:
                    print("Error sending database error message to client: ", e)
                    pass

        elif not company_details:
            print("[WS] ⚠️ No company details to save to database")

        elif not ScreeningRepository:
            print("[WS] ⚠️ Database repository not available - skipping database save")

    except WebSocketDisconnect:
        print("[WS] Client disconnected")

    except Exception as e:
        print(f"[WS] ❌ Error: {str(e)}")
        import traceback
        traceback.print_exc()

        try:
            await websocket.send_json({
                "type": "error",
                "content": f"Server error: {str(e)}"
            })
        except (ValueError | KeyError | TypeError | Exception) as e:
            print("Error sending error message to client: ", e)
            pass

        try:
            await websocket.close(code=1011)
        except (ValueError | KeyError | TypeError | Exception) as e:
            print("Error closing websocket after exception: ", e)
            pass


# ============================================================================
# HTTP POST ENDPOINT - FULL FUNCTIONALITY (MATCHING WEBSOCKET)
# ============================================================================
@router.post("/api/screen-companies", response_model=dict)
async def screen_companies_endpoint(request: ScreeningRequest):
    """
    Screen companies via HTTP endpoint.
    Returns passed and conditional companies.
    """
    try:
        # Validate input
        if not request.mandate_id:
            raise HTTPException(status_code=400, detail="mandate_id is required")
        if not request.mandate_parameters:
            raise HTTPException(status_code=400, detail="mandate_parameters cannot be empty")
        if not create_bottom_up_fundamental_analysis_agent:
            raise HTTPException(status_code=500, detail="Screening agent factory not initialized")

        mandate_id_int = int(request.mandate_id)
        company_id_list = request.company_id

        print(
            f"\n[HTTP] Starting screening - mandate_id={mandate_id_int}, companies={len(company_id_list) if company_id_list else 'all'}")

        # Create agent
        agent = create_bottom_up_fundamental_analysis_agent()

        # Prepare initial state for LangGraph
        user_message = HumanMessage(content=json.dumps({
            "mandate_id": mandate_id_int,
            "mandate_parameters": request.mandate_parameters,
            "company_id_list": company_id_list
        }))

        initial_state = {
            "messages": [user_message],
            "mandate_id": mandate_id_int,
            "mandate_parameters": request.mandate_parameters,
            "company_id_list": company_id_list,
            "tools_executed": 0,
            "all_tool_results": {}
        }

        print("[HTTP] Invoking agent...")

        # Run agent
        result = agent.invoke(initial_state)
        messages = result.get("messages", [])

        print(f"[HTTP] ✅ Agent completed with {len(messages)} messages")

        # Aggregate tokens from all messages
        tokens_info = aggregate_token_usage(messages)
        print(f"[HTTP] Token usage: {tokens_info['totals']}")

        # Extract screening results from all tool messages
        all_passed = []
        all_conditional = []

        for msg in messages:
            if isinstance(msg, ToolMessage):
                try:
                    tool_content = msg.content if isinstance(msg.content, str) else str(msg.content)
                    parsed = json.loads(tool_content)

                    # Extract passed companies
                    passed = parsed.get("passed_companies", [])
                    if passed:
                        all_passed.extend(passed)
                        print(f"[HTTP] Found {len(passed)} passed companies from {msg.name}")

                    # Extract conditional companies
                    conditional = parsed.get("conditional_companies", [])
                    if conditional:
                        all_conditional.extend(conditional)
                        print(f"[HTTP] Found {len(conditional)} conditional companies from {msg.name}")

                except json.JSONDecodeError:
                    print("[HTTP] Could not parse tool result")

        # Build company_details array: passed first, then conditional
        company_details = []

        # Store results by company ID to combine reasons from multiple tools
        companies_by_id = {}  # {company_id: {"company": company_obj, "reasons": [reason1, reason2, ...]}}

        for company in all_passed:
            company_id = company.get("company_id") or company.get("id")
            if company_id not in companies_by_id:
                companies_by_id[company_id] = {
                    "company": company,
                    "reasons": []
                }
            raw_reason = company.get("reason", "")
            if raw_reason:
                companies_by_id[company_id]["reasons"].append(raw_reason)

        # Build final company details with combined reasons
        for company_data in companies_by_id.values():
            company = company_data["company"]
            reasons = company_data["reasons"]

            # Combine reasons from all tools into natural language
            if reasons:
                combined_reason = combine_tool_reasons(reasons)
            else:
                combined_reason = "Meets all screening criteria"

            company_details.append({
                "id": company.get("company_id") or company.get("id"),
                "Company": company.get("Company", "Unknown"),
                "status": "Pass",
                "reason": combined_reason
            })

        for company in all_conditional:
            null_params = company.get("null_parameters", [])
            null_text = ", ".join(null_params) if null_params else "some metrics"
            reason = f"The company meets most screening criteria but lacks data for {null_text}, preventing complete assessment."
            company_details.append({
                "id": company.get("company_id") or company.get("id"),
                "Company": company.get("Company", "Unknown"),
                "status": "Conditional",
                "reason": reason,
                "null_parameters": null_params
            })

        # Build response
        response = {
            "mandate_id": mandate_id_int,
            "company_details": company_details,
            "total_passed": len(all_passed),
            "total_conditional": len(all_conditional),
            "message_count": len(messages),
            "tokens_used": tokens_info
        }

        print(
            f"[HTTP] ✅ Screening complete: {len(company_details)} companies ({len(all_passed)} passed, {len(all_conditional)} conditional)\n")

        # ============================================================================
        # SAVE RESULTS TO DATABASE WITH ENHANCED ERROR HANDLING
        # ============================================================================
        database_saved = False
        database_error = None

        if company_details and ScreeningRepository:
            try:
                print(f"[HTTP] 💾 Saving {len(company_details)} screening results to database...")

                # Prepare enhanced raw output with metadata
                enhanced_output = {
                    "mandate_id": mandate_id_int,
                    "company_details": company_details,
                    "total_passed": len(all_passed),
                    "total_conditional": len(all_conditional),
                    "tokens_used": tokens_info,
                    "timestamp": datetime.now().isoformat(),
                    "message_count": len(messages)
                }

                await ScreeningRepository.process_agent_output(
                    fund_mandate_id=mandate_id_int,
                    selected_parameters=request.mandate_parameters,
                    company_details=company_details,
                    raw_agent_output=json.dumps(enhanced_output)
                )

                database_saved = True
                print(f"[HTTP] ✅ Successfully saved {len(company_details)} records to database")

            except Exception as db_error:
                database_error = str(db_error)
                print(f"[HTTP] ⚠️ Database save failed: {database_error}")
                import traceback
                traceback.print_exc()

        elif not company_details:
            print("[HTTP] ⚠️ No company details to save - database save skipped")

        elif not ScreeningRepository:
            print("[HTTP] ⚠️ Database repository not available - database save skipped")

        # Add database save status to response
        response["database_saved"] = database_saved
        if database_error:
            response["database_error"] = database_error

        return response

    except HTTPException:
        raise
    except Exception as e:
        print(f"[HTTP] ❌ Error: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Screening failed: {str(e)}")

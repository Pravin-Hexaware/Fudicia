import asyncio
import json
import queue
import threading
from datetime import datetime
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ConfigDict

from agents.risk_agent import run_risk_assessment_sync
from database.repositories.riskAssessmentRepository import RiskAssessmentRepository


class RiskAnalysisRequest(BaseModel):
    """Request model for risk analysis - supports both NEW and LEGACY modes"""
    mandate_id: int  # Required for both modes

    # NEW MODE: Use company_id (array of company IDs from Screening table)
    company_id: list[int] | None = None

    # FLEXIBLE MODE: Use companies which can be either List[int] (IDs) or List[Dict] (full data)
    # Combined with risk_parameters
    companies: list[int] | list[dict[str, Any]] | None = None
    risk_parameters: dict[str, str] | None = None

    model_config = ConfigDict(
        json_schema_extra={
            "example_new_mode": {
                "mandate_id": 1,
                "company_id": [5, 12, 18]
            },
            "example_legacy_mode": {
                "mandate_id": 1,
                "companies": [
                    {
                        "Company_id": 1,
                        "Company ": "TestCorp",
                        "Risks": {
                            "Competitive Position": "Strong",
                            "Governance Quality": "Good",
                            "Customer Concentration Risk": "Low",
                            "Vendor / Platform Dependency": "AWS",
                            "Regulatory / Legal Risk": "Low",
                            "Business Model Complexity": "Simple"
                        }
                    }
                ],
                "risk_parameters": {
                    "Competitive Position": "Market leaders",
                    "Governance Quality": "Strong governance",
                    "Customer Concentration Risk": "Diversified",
                    "Vendor / Platform Dependency": "Multi-vendor",
                    "Regulatory / Legal Risk": "Low risk",
                    "Business Model Complexity": "Simple models"
                }
            }
        }
    )


router = APIRouter(prefix="/risk", tags=["risk-analysis"])


# ============================================================================
# ASYNC HELPER FUNCTION TO SAVE RISK ANALYSIS RESULTS TO DATABASE
# ============================================================================

async def save_session_complete_results_async(session_complete_event: dict[str, Any], mandate_id: int,
                                              original_companies: list[dict[str, Any]] | None = None,
                                              company_id_mapping: dict[str, int] | None = None):
    """
    Parse session_complete event and save each company's risk analysis to RiskAnalysis table.
    This is an ASYNC function to be called from async contexts.

    Args:
        session_complete_event: Event with type="session_complete" containing results list
        mandate_id: ID of the fund mandate for foreign key relationship
        original_companies: List of original company payloads to match and extract company_id (LEGACY MODE)
        company_id_mapping: Dict mapping company_name to company_id (NEW MODE)
    """
    try:
        results = session_complete_event.get("results", [])

        if not results:
            print("[DB SAVE] No results to save")
            return

        print(f"[DB SAVE] Saving {len(results)} results to RiskAnalysis table...")

        for result in results:
            try:
                company_name = result.get("company_name")
                parameter_analysis = result.get("parameter_analysis", {})
                overall_status = result.get("overall_result", "UNKNOWN")

                # Use the mandate_id passed to the function (from the WebSocket request)
                fund_mandate_id_to_use = mandate_id if mandate_id is not None else result.get("mandate_id")

                if fund_mandate_id_to_use is None:
                    print(f"[DB SAVE] Skipping save for {company_name}: missing mandate_id")
                    continue

                # Match company_name from result to get Company_id
                company_id = None

                # Try NEW MODE first (company_id_mapping)
                if company_id_mapping and company_name in company_id_mapping:
                    company_id = company_id_mapping[company_name]
                    print(f"[DB SAVE] Found company_id from mapping: {company_name} -> {company_id}")

                # Try LEGACY MODE (original_companies)
                if company_id is None and original_companies:
                    for orig_company in original_companies:
                        orig_name = orig_company.get("Company") or orig_company.get("Company ") or orig_company.get(
                            "company_name")
                        if orig_name and company_name and orig_name.strip().lower() == company_name.strip().lower():
                            # Extract Company_id from the original payload
                            company_id = orig_company.get("Company_id")
                            if company_id is None:
                                company_id = orig_company.get("id")
                            break

                if company_id is None:
                    print(f"[DB SAVE] Skipping save for {company_name}: could not find Company_id")
                    continue

                # Create overall_assessment object
                overall_assessment = {
                    "status": overall_status,
                    "reason": f"Risk assessment completed: {overall_status}"
                }

                print(
                    f"[DB SAVE] Saving: {company_name} (id={company_id}) - status={overall_status} for mandate_id={fund_mandate_id_to_use}")

                # Save to database using repository
                saved_result = await RiskAssessmentRepository.save_assessment_result(
                    fund_mandate_id=fund_mandate_id_to_use,
                    company_id=company_id,
                    company_name=company_name,
                    parameter_analysis=parameter_analysis,
                    overall_assessment=overall_assessment
                )

                print(f"[DB SAVE] ✓ Saved: {company_name} to RiskAnalysis table (record_id={saved_result.id})")

            except Exception as e:
                print(f"[DB SAVE ERROR] Failed to save {company_name}: {str(e)}")
                import traceback
                traceback.print_exc()
                continue

        print("[DB SAVE] ✓ Completed saving all results")

    except Exception as e:
        print(f"[DB SAVE ERROR] Error in save_session_complete_results_async: {str(e)}")
        import traceback
        traceback.print_exc()


# ============================================================================
# WEBSOCKET ENDPOINT FOR REAL-TIME ANALYSIS STREAMING
# ============================================================================

@router.websocket("/analyze")
async def websocket_analyze(websocket: WebSocket):
    """
    Real-time WebSocket endpoint for Risk Assessment of Investment Ideas.

    Receives analysis request and streams all events in real-time:
    - session_start: Analysis session initialized
    - analysis_start: Company analysis started
    - thinking_token: Real-time LLM thinking (streamed as generated)
    - parameter_analysis: Individual parameter verdicts
    - session_complete: All companies analyzed with final results

    WebSocket Communication Flow:
    1. Client connects to ws://server/risk/analyze
    2. Client sends: {"mandate_id": 1, "companies": [...], "risk_parameters": {...}}
    3. Server processes in background thread
    4. Server streams events as they occur
    5. On session_complete, results are persisted to database
    6. Session ends with final results summary
    """
    await websocket.accept()

    try:
        print("\n" + "=" * 80)
        print("🔴 WEBSOCKET CONNECTION ESTABLISHED - RISK ANALYSIS")
        print("=" * 80)

        print("⏳ Waiting for client request...")
        data_json = await websocket.receive_text()
        data = RiskAnalysisRequest(**json.loads(data_json))

        print("\n✅ RECEIVED REQUEST FROM CLIENT:")
        print(f"   - Mandate ID: {data.mandate_id}")

        # Detect mode: NEW MODE if company_id field OR companies field contains integers
        is_companies_id_list = (isinstance(data.companies, list) and len(data.companies) > 0
                                and isinstance(data.companies[0], int))
        use_new_mode = data.company_id or is_companies_id_list

        if use_new_mode:
            print("   - Mode: NEW MODE (database-driven)")
            company_ids = data.company_id or data.companies
            print(f"   - Company IDs: {company_ids}\n")
        else:
            print("   - Mode: LEGACY MODE (payload-driven)")
            print(f"   - Companies: {len(data.companies) if data.companies else 0} companies")
            print(f"   - Risk Parameters: {list(data.risk_parameters.keys()) if data.risk_parameters else []}\n")

        event_queue = queue.Queue()
        company_id_mapping = {}  # For NEW MODE: map company_name -> company_id

        def run_analysis_thread():
            """Runs analysis in background thread to allow async streaming"""
            try:
                print(f"[THREAD] Starting risk assessment with mandate_id={data.mandate_id}")

                # Prepare data based on mode
                if use_new_mode:
                    # NEW MODE: Pass company_id and risk_parameters from frontend
                    analysis_data = {
                        "company_id": data.company_id or data.companies,
                        "risk_parameters": data.risk_parameters or {}
                    }
                else:
                    # LEGACY MODE: Pass companies and risk_parameters
                    analysis_data = {
                        "companies": data.companies or [],
                        "risk_parameters": data.risk_parameters or {}
                    }

                run_risk_assessment_sync(
                    analysis_data,
                    event_queue=event_queue,
                    fund_mandate_id=data.mandate_id
                )
                print("[THREAD] Analysis completed")
            except Exception as e:
                print(f"[THREAD ERROR] {str(e)}")
                event_queue.put({
                    "type": "error",
                    "message": str(e),
                    "timestamp": datetime.now().isoformat()
                })
                event_queue.put(None)

        analysis_thread = threading.Thread(target=run_analysis_thread, daemon=True)
        analysis_thread.start()

        print("Starting real-time event streaming to client...")
        while True:
            try:
                event = event_queue.get(timeout=0.1)

                if event is None:
                    print("Stream complete - all events sent")
                    break

                # Capture company_name -> company_id mapping from company_analysis_start events (NEW MODE only)
                if event.get("type") == "company_analysis_start" and use_new_mode:
                    company_name = event.get("company_name")
                    company_id = event.get("company_id")
                    if company_name and company_id:
                        company_id_mapping[company_name] = company_id
                        print(f"[WEBSOCKET] Mapped company: {company_name} -> {company_id}")

                # Check if this is session_complete event with results to save
                if event.get("type") == "session_complete" and data.mandate_id:
                    print("[WEBSOCKET] Detected session_complete event - saving results to database...")
                    try:
                        # Pass company_id_mapping for NEW MODE, original_companies for LEGACY MODE
                        await save_session_complete_results_async(
                            event,
                            data.mandate_id,
                            original_companies=data.companies if not use_new_mode else None,
                            company_id_mapping=company_id_mapping if use_new_mode else None
                        )
                        print("[WEBSOCKET] ✓ Results saved successfully")
                    except Exception as e:
                        print(f"[WEBSOCKET ERROR] Failed to save results: {str(e)}")
                        import traceback
                        traceback.print_exc()

                await websocket.send_json(event)
                print(f"Streamed: {event.get('type')} - {event.get('company_name', event.get('message', ''))}")

                await asyncio.sleep(0.02)

            except queue.Empty:
                continue
            except Exception as e:
                print(f"Error sending event: {e}")
                break

        print("✅ WEBSOCKET SESSION COMPLETED SUCCESSFULLY\n")

    except WebSocketDisconnect:
        print("❌ WebSocket client disconnected")
    except json.JSONDecodeError as e:
        try:
            await websocket.send_json({
                "type": "error",
                "message": f"Invalid JSON: {str(e)}",
                "timestamp": datetime.now().isoformat()
            })
        except Exception as send_error:
            print(f"Failed to send error message to WebSocket: {send_error}")
        await websocket.close()
    except Exception as e:
        print(f"WebSocket error: {str(e)}")
        try:
            await websocket.send_json({
                "type": "error",
                "message": f"Server error: {str(e)}",
                "timestamp": datetime.now().isoformat()
            })
        except Exception as send_error:
            print(f"Failed to send error message to WebSocket: {send_error}")
        await websocket.close()


# ============================================================================
# HTTP ENDPOINT FOR ANALYSIS WITHOUT STREAMING
# ============================================================================

@router.post("/analyze-http")
async def http_analyze(request: RiskAnalysisRequest):
    """
    HTTP POST endpoint for analysis without real-time streaming.
    Returns all results at once after analysis completes.

    Supports both NEW MODE (fund_mandate_id + company_ids) and LEGACY MODE (full payload).

    Functionality matches WebSocket endpoint but without real-time streaming:
    - Runs risk assessment for all companies
    - Collects all events until session_complete
    - Saves results to database when session_complete is received
    - Returns all collected results as JSON

    Use this endpoint if WebSocket is not available.
    Results are persisted to database after processing completes.
    """
    try:
        print("\n" + "=" * 80)
        print("🟢 HTTP REQUEST RECEIVED - RISK ANALYSIS")
        print("=" * 80)

        print("\n✅ RECEIVED REQUEST:")
        print(f"   - Mandate ID: {request.mandate_id}")

        # Detect mode: NEW MODE if company_id field OR companies field contains integers
        is_companies_id_list = (isinstance(request.companies, list) and len(request.companies) > 0
                                and isinstance(request.companies[0], int))
        use_new_mode = request.company_id or is_companies_id_list

        if use_new_mode:
            print("   - Mode: NEW MODE (database-driven)")
            company_ids = request.company_id or request.companies
            print(f"   - Company IDs: {company_ids}\n")
        else:
            print("   - Mode: LEGACY MODE (payload-driven)")
            print(f"   - Companies: {len(request.companies) if request.companies else 0} companies")
            print(f"   - Risk Parameters: {list(request.risk_parameters.keys()) if request.risk_parameters else []}\n")

        event_queue = queue.Queue()
        all_events = []
        session_complete_event = None
        company_id_mapping = {}  # For NEW MODE: map company_name -> company_id

        def run_analysis_thread():
            """Runs analysis in background thread"""
            try:
                print(f"[THREAD] Starting risk assessment with mandate_id={request.mandate_id}")

                # Prepare data based on mode
                if use_new_mode:
                    # NEW MODE: Pass company_id and risk_parameters from frontend
                    analysis_data = {
                        "company_id": request.company_id or request.companies,
                        "risk_parameters": request.risk_parameters or {}
                    }
                else:
                    # LEGACY MODE: Pass companies and risk_parameters
                    analysis_data = {
                        "companies": request.companies or [],
                        "risk_parameters": request.risk_parameters or {}
                    }

                run_risk_assessment_sync(
                    analysis_data,
                    event_queue=event_queue,
                    fund_mandate_id=request.mandate_id
                )
                print("[THREAD] Analysis completed")
            except Exception as e:
                print(f"[THREAD ERROR] {str(e)}")
                event_queue.put({
                    "type": "error",
                    "message": str(e),
                    "timestamp": datetime.now().isoformat()
                })
                event_queue.put(None)

        analysis_thread = threading.Thread(target=run_analysis_thread, daemon=True)
        analysis_thread.start()

        print("Collecting all events from analysis...")
        while True:
            try:
                event = event_queue.get(timeout=0.5)

                if event is None:
                    print("Analysis complete - all events collected")
                    break

                # Only collect session_complete and error events (skip thinking/analysis events for HTTP)
                if event.get("type") in ["session_complete", "error", "company_analysis_start", "analysis_complete"]:
                    all_events.append(event)
                    print(f"Collected: {event.get('type')} - {event.get('company_name', event.get('message', ''))}")

                # Capture company_name -> company_id mapping from company_analysis_start events (NEW MODE only)
                if event.get("type") == "company_analysis_start" and use_new_mode:
                    company_name = event.get("company_name")
                    company_id = event.get("company_id")
                    if company_name and company_id:
                        company_id_mapping[company_name] = company_id
                        print(f"[HTTP] Mapped company: {company_name} -> {company_id}")

                # Check if this is session_complete event with results to save
                if event.get("type") == "session_complete":
                    session_complete_event = event
                    print("[HTTP] Detected session_complete event - saving results to database...")
                    try:
                        # Use async version in async endpoint
                        await save_session_complete_results_async(
                            event,
                            request.mandate_id,
                            original_companies=request.companies if not use_new_mode else None,
                            company_id_mapping=company_id_mapping if use_new_mode else None
                        )
                        print("[HTTP] ✓ Results saved successfully")
                    except Exception as e:
                        print(f"[HTTP ERROR] Failed to save results: {str(e)}")
                        import traceback
                        traceback.print_exc()

            except queue.Empty:
                continue
            except Exception as e:
                print(f"Error collecting event: {e}")
                break

        # Wait for thread to complete
        analysis_thread.join(timeout=5)

        print("✅ HTTP REQUEST COMPLETED SUCCESSFULLY\n")

        # Extract results from session_complete event if available
        results = []
        if session_complete_event and session_complete_event.get("results"):
            results = session_complete_event.get("results", [])

        return {
            "status": "success",
            "timestamp": datetime.now().isoformat(),
            "total_companies": len(results),
            "results": results
        }

    except Exception as e:
        print(f"[HTTP ERROR] Unexpected error: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            "status": "error",
            "message": str(e),
            "timestamp": datetime.now().isoformat()
        }
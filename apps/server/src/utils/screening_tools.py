# screening_tools.py
import asyncio
import json
import re
from typing import Any

from langchain_core.tools import StructuredTool

from database.models import Sourcing


# ============================================================================
# ACTUAL ASYNC IMPLEMENTATIONS
# ============================================================================
async def _scale_liquidity_screening_impl(
        mandate_id: int,
        mandate_parameters: dict[str, Any] | None = None,
        company_id_list: list[int] | None = None
) -> str:
    """
    Screen companies against SCALE & LIQUIDITY mandate parameters.

    Args:
        mandate_id: Fund mandate ID
        mandate_parameters: Screening parameters (revenue, ebitda, net_income, market_cap). If None, defaults to empty dict.
        company_id_list: Optional list of specific company IDs to screen

    Returns:
        JSON string with passed and conditional companies
    """
    try:
        # Handle None mandate_parameters
        if mandate_parameters is None:
            mandate_parameters = {}

        # Filter only scale/liquidity parameters
        scale_liquidity_params = {
            k: v for k, v in mandate_parameters.items()
            if k.lower() in ["revenue", "ebitda", "net_income", "market_cap"]
        }

        if not scale_liquidity_params:
            print("[SCALE/LIQUIDITY TOOL] No scale/liquidity params in mandate. Skipping.")
            return json.dumps({
                "passed_companies": [],
                "conditional_companies": [],
                "tool_used": "scale_liquidity"
            })

        print("[SCALE/LIQUIDITY TOOL] Starting screening")
        print(f"  - Mandate ID: {mandate_id}")
        if company_id_list:
            print(f"  - Company IDs to screen: {company_id_list}")

        # Await async DB helper
        companies_data = await get_companies_by_mandate_id(mandate_id, company_id_list)

        if not companies_data:
            return json.dumps({
                "passed_companies": [],
                "conditional_companies": [],
                "tool_used": "scale_liquidity"
            })

        print(
            f"[SCALE/LIQUIDITY TOOL] Screening {len(companies_data)} companies against {len(scale_liquidity_params)} scale/liquidity parameters")

        # Screen companies
        screening_results = screen_companies_simple(scale_liquidity_params, companies_data)
        passed_companies = screening_results.get("passed", [])
        conditional_companies = screening_results.get("conditional", [])

        print("[SCALE/LIQUIDITY TOOL] Results:")
        print(f"   Passed: {len(passed_companies)} companies")
        print(f"   Conditional: {len(conditional_companies)} companies")

        # Format output with company_id already present
        passed_list = []
        for company in passed_companies:
            company_data = company["company_details"]
            company_data["status"] = "Pass"
            company_data["reason"] = company.get("reason", "")
            passed_list.append(company_data)

        conditional_list = []
        for company in conditional_companies:
            company_data = company["company_details"]
            company_data["status"] = "Conditional"
            company_data["reason"] = company.get("reason", "")
            company_data["null_parameters"] = company.get("null_parameters", [])
            conditional_list.append(company_data)

        print(
            f"[SCALE/LIQUIDITY TOOL] Returning {len(passed_list)} passed + {len(conditional_list)} conditional companies\n")

        return json.dumps({
            "passed_companies": passed_list,
            "conditional_companies": conditional_list,
            "tool_used": "scale_liquidity",
            "passed_count": len(passed_list),
            "conditional_count": len(conditional_list)
        }, default=str)

    except Exception as e:
        print(f"[SCALE/LIQUIDITY TOOL] Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return json.dumps({
            "passed_companies": [],
            "conditional_companies": [],
            "tool_used": "scale_liquidity",
            "error": str(e)
        })


async def _profitability_valuation_screening_impl(
        mandate_id: int,
        mandate_parameters: dict[str, Any] | None = None,
        company_id_list: list[int] | None = None
) -> str:
    """
    Screen companies against PROFITABILITY & VALUATION mandate parameters.

    Args:
        mandate_id: Fund mandate ID
        mandate_parameters: Screening parameters (gross_profit_margin, return_on_equity, debt_to_equity, pe_ratio, price_to_book, dividend_yield, growth). If None, defaults to empty dict.
        company_id_list: Optional list of specific company IDs to screen

    Returns:
        JSON string with passed and conditional companies
    """
    try:
        # Handle None mandate_parameters
        if mandate_parameters is None:
            mandate_parameters = {}

        # Filter only profitability/valuation parameters
        prof_val_params = {
            k: v for k, v in mandate_parameters.items()
            if k.lower() in [
                "gross_profit_margin", "return_on_equity", "debt_to_equity",
                "pe_ratio", "price_to_book", "dividend_yield", "growth"
            ]
        }

        if not prof_val_params:
            print("[PROFITABILITY/VALUATION TOOL] No profitability/valuation params in mandate. Skipping.")
            return json.dumps({
                "passed_companies": [],
                "conditional_companies": [],
                "tool_used": "profitability_valuation"
            })

        print("[PROFITABILITY/VALUATION TOOL] Starting screening")
        print(f"  - Mandate ID: {mandate_id}")
        if company_id_list:
            print(f"  - Company IDs to screen: {company_id_list}")

        # Await async DB helper
        companies_data = await get_companies_by_mandate_id(mandate_id, company_id_list)

        if not companies_data:
            return json.dumps({
                "passed_companies": [],
                "conditional_companies": [],
                "tool_used": "profitability_valuation"
            })

        print(
            f"[PROFITABILITY/VALUATION TOOL] Screening {len(companies_data)} companies against {len(prof_val_params)} profitability/valuation parameters")

        # Screen companies
        screening_results = screen_companies_simple(prof_val_params, companies_data)
        passed_companies = screening_results.get("passed", [])
        conditional_companies = screening_results.get("conditional", [])

        print("[PROFITABILITY/VALUATION TOOL] Results:")
        print(f"  Passed: {len(passed_companies)} companies")
        print(f"   Conditional: {len(conditional_companies)} companies")

        # Format output with company_id already present
        passed_list = []
        for company in passed_companies:
            company_data = company["company_details"]
            company_data["status"] = "Pass"
            company_data["reason"] = company.get("reason", "")
            passed_list.append(company_data)

        conditional_list = []
        for company in conditional_companies:
            company_data = company["company_details"]
            company_data["status"] = "Conditional"
            company_data["reason"] = company.get("reason", "")
            company_data["null_parameters"] = company.get("null_parameters", [])
            conditional_list.append(company_data)

        print(
            f"[PROFITABILITY/VALUATION TOOL] Returning {len(passed_list)} passed + {len(conditional_list)} conditional companies\n")

        return json.dumps({
            "passed_companies": passed_list,
            "conditional_companies": conditional_list,
            "tool_used": "profitability_valuation",
            "passed_count": len(passed_list),
            "conditional_count": len(conditional_list)
        }, default=str)

    except Exception as e:
        print(f"[PROFITABILITY/VALUATION TOOL] Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return json.dumps({
            "passed_companies": [],
            "conditional_companies": [],
            "tool_used": "profitability_valuation",
            "error": str(e)
        })


# ============================================================================
# HELPER FUNCTIONS (Preserved from mandate_screening.py)
# ============================================================================
def parse_constraint(constraint_str: str) -> tuple:
    """Parse constraint - handles $, %, B, M, T and converts all thresholds into MILLIONS."""
    try:
        constraint_str = str(constraint_str).strip()
        constraint_str = constraint_str.replace("&amp;gt;", "&gt;").replace("&amp;lt;", "&lt;")

        # Special cases
        if constraint_str.lower() == "positive":
            return ">", 0

        if constraint_str.lower() in ["", "-", "na", "n/a", "none", "null"]:
            return "skip", 0

        if "not required" in constraint_str.lower():
            return "skip", 0

        constraint_str = constraint_str.replace("&amp;amp;gt;", "&gt;").replace("&amp;amp;lt;", "&lt;")

        # Extract operator and number
        match = re.search(r'([><]=?|==|!=)\s*([\d.]+)', constraint_str)
        if not match:
            return ">", 0

        operator = match.group(1)
        threshold = float(match.group(2))

        # Identify units
        has_dollar = '$' in constraint_str
        has_billion = 'B' in constraint_str.upper() and 'M' not in constraint_str.upper()
        has_trillion = 'T' in constraint_str.upper()
        has_million = 'M' in constraint_str.upper()
        has_percent = '%' in constraint_str

        # Convert currency amounts → millions
        if has_dollar:
            if has_billion:
                threshold = threshold * 1000
            elif has_trillion:
                threshold = threshold * 1000000
            elif not has_million:
                threshold = threshold / 1_000_000

        # Convert % → decimal
        if has_percent:
            if threshold > 1:
                threshold = threshold / 100

        return operator, threshold

    except Exception:
        return ">", 0


def get_company_value(company: dict, param_name: str) -> float | None:
    """Get numeric value from company - ALL VALUES IN MILLIONS"""
    try:
        param_lower = param_name.lower()

        # Handle REVENUE
        if param_lower == "revenue":
            revenue = company.get("Revenue")
            if revenue is None:
                return None
            return parse_value(revenue)

        # Handle NET INCOME
        if param_lower == "net_income":
            net_income = company.get("Net Income")
            if net_income is None:
                return None
            return parse_value(net_income)

        # Handle MARKET CAP
        if param_lower == "market_cap":
            market_cap = company.get("Market Cap")
            if market_cap is None:
                return None
            return parse_value(market_cap)

        # Handle EBITDA
        if param_lower == "ebitda":
            ebitda_raw = company.get("EBITDA")
            if ebitda_raw is None:
                return None
            return parse_value(ebitda_raw)

        # Handle GROSS PROFIT MARGIN
        if param_lower == "gross_profit_margin":
            gpm = company.get("Gross Profit Margin")
            if gpm is None:
                return None
            parsed = parse_value(gpm)
            if parsed is None:
                return None
            if parsed > 1:
                parsed = parsed / 100
            return parsed

        # Handle RETURN ON EQUITY
        if param_lower == "return_on_equity":
            roe = company.get("Return on Equity")
            if roe is None:
                return None
            parsed = parse_value(roe)
            if parsed is None:
                return None
            if parsed > 1:
                parsed = parsed / 100
            return parsed

        # Standard field mapping
        field_map = {
            "debt_to_equity": ["Debt / Equity"],
            "pe_ratio": ["P/E Ratio"],
            "price_to_book": ["Price/Book"],
            "dividend_yield": ["Dividend Yield"]
        }

        fields = field_map.get(param_lower, [param_name])

        for field in fields:
            if field in company:
                value = company[field]
                if value is None:
                    continue
                parsed = parse_value(value)
                if parsed is not None:
                    return parsed

        return None
    except Exception:
        return None


def parse_value(value: Any) -> float | None:
    """Parse various value formats (B, M, T, %) - RETURNS VALUE IN MILLIONS"""
    try:
        if value is None:
            return None

        if isinstance(value, (int, float)):
            return float(value)

        if isinstance(value, str):
            value_str = str(value).strip()

            # Remove newlines, %, $, commas
            value_str = value_str.replace("\n", "").replace("%", "").replace("$", "").replace(",", "")
            # Remove dots before B, M, T (e.g., "244.12B" -> "24412B")
            value_str = re.sub(r'(\d)\.(\d+)([BMT])', r'\1\2\3', value_str)

            # Handle T (trillions) -> convert to millions
            if 'T' in value_str.upper():
                value_str = value_str.upper().replace('T', '').strip()
                return float(value_str) * 1000000

            # Handle B (billions) -> convert to millions
            if 'B' in value_str.upper():
                value_str = value_str.upper().replace('B', '').strip()
                return float(value_str) * 1000

            # Handle M (millions)
            if 'M' in value_str.upper():
                value_str = value_str.upper().replace('M', '').strip()
                return float(value_str)

            # Plain number
            if value_str:
                return float(value_str)

        return None
    except Exception:
        return None


# ============================================================================
# UPDATED SCREENING FUNCTION - PRESERVE COMPANY_ID
# ============================================================================
def screen_companies_simple(mandate_parameters: dict, companies: list) -> dict:
    """
    Screen companies against mandate parameters.
     OPTIMIZED: Preserves company_id from input without copying
    Returns dict with 'passed' and 'conditional' companies.
    """
    passed_companies = []
    conditional_companies = []

    try:
        if not mandate_parameters or not companies:
            return {"passed": [], "conditional": []}

        for company in companies:
            try:
                company_name = company.get("Company ", company.get("Company", "Unknown")).strip()
                sector = company.get("Sector", "Unknown").strip()
                company_id = company.get("company_id")  # Extract company_id from input

                all_passed = True
                all_non_null_passed = True
                null_params = []
                reasons = []

                for param_name, constraint_str in mandate_parameters.items():
                    if "not required" in str(constraint_str).lower():
                        continue

                    operator, threshold = parse_constraint(constraint_str)

                    if operator == "skip":
                        continue

                    company_value = get_company_value(company, param_name)

                    if company_value is None:
                        null_params.append(param_name)
                        all_passed = False
                        continue

                    if compare_values(company_value, operator, threshold):
                        reasons.append(f"{param_name}: {company_value:.2f} {operator} {threshold:.2f}")
                    else:
                        all_passed = False
                        all_non_null_passed = False
                        break

                # PASSED
                if all_passed:
                    reason_text = " | ".join(reasons)
                    passed_companies.append({
                        "company_name": company_name,
                        "sector": sector,
                        "company_id": company_id,  # Preserve company_id
                        "status": "Pass",
                        "reason": reason_text,
                        "company_details": company  # Keep original company dict with company_id
                    })

                # CONDITIONAL
                elif all_non_null_passed and null_params:
                    reason_text = " | ".join(reasons)
                    null_params_text = ", ".join(null_params)
                    full_reason = f"Missing data: {null_params_text}. All other required metrics meet the mandate: {reason_text}"

                    conditional_companies.append({
                        "company_name": company_name,
                        "sector": sector,
                        "company_id": company_id,  # Preserve company_id
                        "status": "Conditional",
                        "reason": full_reason,
                        "null_parameters": null_params,
                        "company_details": company  # Keep original company dict with company_id
                    })

            except Exception:
                continue

        return {"passed": passed_companies, "conditional": conditional_companies}

    except Exception:
        return {"passed": [], "conditional": []}


def compare_values(actual: float, operator: str, threshold: float) -> bool:
    """Compare actual vs threshold"""
    try:
        if actual is None or threshold is None:
            return False

        if operator == ">" and threshold == 0:
            return actual > 0
        elif operator == ">":
            return actual > threshold
        elif operator == ">=":
            return actual >= threshold
        elif operator == "<":
            return actual < threshold
        elif operator == "<=":
            return actual <= threshold
        elif operator == "==":
            return actual == threshold
        return False
    except Exception:
        return False


# ============================================================================
# OPTIMIZED: DATABASE HELPER - FETCH COMPANIES WITH COMPANY_ID (ASYNC)
# ============================================================================
async def get_companies_by_mandate_id(mandate_id: int, company_id_list: list[int] = None) -> list[dict[str, Any]]:
    """
    OPTIMIZED: Fetch companies from Sourcing table with company_id already embedded.
    Can filter by specific company IDs if provided.

    Args:
        mandate_id: Fund mandate ID
        company_id_list: Optional list of specific company IDs to fetch

    Returns:
        List of company_data dicts (each with company_id already in it).
    """
    try:
        # Build filter query
        filter_kwargs = {
            "fund_mandate_id": mandate_id,
            "deleted_at__isnull": True
        }

        # Query Sourcing table (async ORM call)
        if company_id_list and len(company_id_list) > 0:
            sourcing_records = await Sourcing.filter(**filter_kwargs).filter(company_id__in=company_id_list).all()
            print(
                f"\n [DB FETCH] Fetching specific companies for mandate_id={mandate_id}, company_ids={company_id_list}")
        else:
            sourcing_records = await Sourcing.filter(**filter_kwargs).all()
            print(f"\n [DB FETCH] Fetching ALL companies for mandate_id={mandate_id}")

        print(f"    Total records fetched from DB: {len(sourcing_records)}")

        companies_list = []

        for idx, sourcing in enumerate(sourcing_records, 1):
            company_id = sourcing.company_id
            company_data = sourcing.company_data

            # Handle different data formats
            if isinstance(company_data, str):
                try:
                    company_data = json.loads(company_data)
                except json.JSONDecodeError:
                    print(f"    Record {idx}: Failed to parse JSON, skipping")
                    continue
            elif isinstance(company_data, dict):
                pass
            else:
                print(f"    Record {idx}: Unknown data format, skipping")
                continue

            # Add company_id if not already present
            if "company_id" not in company_data:
                company_data["company_id"] = company_id

            company_name = company_data.get("Company", company_data.get("Company ", "Unknown"))
            print(f"    Record {idx}: ID={company_id}, Company={company_name}")

            companies_list.append(company_data)

        print(f"    Successfully processed {len(companies_list)} companies from DB\n")
        return companies_list

    except Exception as e:
        print(f" [DB FETCH] Error fetching companies by mandate_id: {e}")
        import traceback
        traceback.print_exc()
        return []


# ============================================================================
# SYNC WRAPPER FUNCTIONS FOR STRUCTURED TOOLS - WITH PROPER ASYNC HANDLING
# ============================================================================

def _run_async(coro):
    """Run async coroutine safely in both sync and async contexts."""
    try:
        # Try to get the current event loop
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # If loop is already running (e.g., in FastAPI), we can't use run_until_complete
            # Use nest_asyncio if available, otherwise raise an error
            try:
                import nest_asyncio
                nest_asyncio.apply()
                return asyncio.run(coro)
            except ImportError:
                # Fallback: Create a new thread to run the coroutine
                import threading
                result = [None]
                exception = [None]

                def run_in_thread():
                    try:
                        new_loop = asyncio.new_event_loop()
                        asyncio.set_event_loop(new_loop)
                        result[0] = new_loop.run_until_complete(coro)
                    except Exception as e:
                        exception[0] = e
                    finally:
                        new_loop.close()

                thread = threading.Thread(target=run_in_thread)
                thread.start()
                thread.join()

                if exception[0]:
                    raise exception[0]
                return result[0]
        else:
            return loop.run_until_complete(coro)
    except RuntimeError:
        # No event loop in current thread, create new one
        return asyncio.run(coro)


def scale_liquidity_screening_tool_sync(
        mandate_id: int,
        mandate_parameters: dict[str, Any] | None = None,
        company_id_list: list[int] | None = None
) -> str:
    """Screen companies against SCALE & LIQUIDITY mandate parameters (sync wrapper)."""
    if mandate_parameters is None:
        mandate_parameters = {}
    print(f"[SCALE/LIQUIDITY SYNC] Wrapper called for mandate_id={mandate_id}")
    return _run_async(_scale_liquidity_screening_impl(mandate_id, mandate_parameters, company_id_list))


def profitability_valuation_screening_tool_sync(
        mandate_id: int,
        mandate_parameters: dict[str, Any] | None = None,
        company_id_list: list[int] | None = None
) -> str:
    """Screen companies against PROFITABILITY & VALUATION mandate parameters (sync wrapper)."""
    if mandate_parameters is None:
        mandate_parameters = {}
    print(f"[PROFITABILITY/VALUATION SYNC] Wrapper called for mandate_id={mandate_id}")
    return _run_async(_profitability_valuation_screening_impl(mandate_id, mandate_parameters, company_id_list))


# ============================================================================
# CREATE STRUCTURED TOOLS FOR LANGGRAPH
# ============================================================================
scale_liquidity_screening_tool = StructuredTool.from_function(
    func=scale_liquidity_screening_tool_sync,
    name="scale_liquidity_screening_tool",
    description="Screen companies against SCALE & LIQUIDITY mandate parameters (revenue, ebitda, net_income, market_cap). Fetches from database and returns JSON with passed and conditional companies.",
)

profitability_valuation_screening_tool = StructuredTool.from_function(
    func=profitability_valuation_screening_tool_sync,
    name="profitability_valuation_screening_tool",
    description="Screen companies against PROFITABILITY & VALUATION mandate parameters (gross_profit_margin, return_on_equity, debt_to_equity, pe_ratio, price_to_book, dividend_yield, growth). Fetches from database and returns JSON with passed and conditional companies.",
)
#!/usr/bin/env python3
"""
Post-process raw jobs JSON:
- Filter expired jobs (closing_date < today in Asia/Kabul)
- Extract apply emails from description/details
- Set apply_method field
- Generate summary.json with new/expiring jobs
- Output clean jobs.json for the PWA
"""

import json
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Any, Set

# Kabul is UTC+4:30
KABUL_UTC_OFFSET = timedelta(hours=4, minutes=30)


def get_kabul_today() -> str:
    """Get today's date in Asia/Kabul timezone as YYYY-MM-DD."""
    utc_now = datetime.utcnow()
    kabul_now = utc_now + KABUL_UTC_OFFSET
    return kabul_now.strftime("%Y-%m-%d")


def get_kabul_datetime() -> datetime:
    """Get current datetime in Asia/Kabul timezone."""
    utc_now = datetime.utcnow()
    return utc_now + KABUL_UTC_OFFSET


# Common junk emails to exclude
JUNK_EMAILS = {
    "info@jobs.af",
    "support@jobs.af",
    "admin@jobs.af",
    "noreply@jobs.af",
    "no-reply@jobs.af",
    "example@example.com",
    "test@test.com",
}

# Email regex pattern
EMAIL_PATTERN = re.compile(
    r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'
)


def extract_emails(text: str) -> List[str]:
    """Extract unique, valid emails from text, excluding junk."""
    if not text:
        return []
    
    found = EMAIL_PATTERN.findall(text.lower())
    unique = []
    seen = set()
    
    for email in found:
        email = email.strip().lower()
        if email not in seen and email not in JUNK_EMAILS:
            # Additional validation
            if len(email) > 5 and '.' in email.split('@')[-1]:
                seen.add(email)
                unique.append(email)
    
    return unique[:5]  # Limit to 5 emails max


def extract_apply_emails(job: Dict[str, Any]) -> List[str]:
    """Extract apply emails from job description and details."""
    emails = []
    
    # From description
    if job.get("description"):
        emails.extend(extract_emails(job["description"]))
    
    # From details dict values
    details = job.get("details") or {}
    for key, value in details.items():
        if isinstance(value, str):
            emails.extend(extract_emails(value))
    
    # Deduplicate while preserving order
    seen = set()
    unique = []
    for e in emails:
        if e not in seen:
            seen.add(e)
            unique.append(e)
    
    return unique[:5]


def determine_apply_method(job: Dict[str, Any]) -> str:
    """Determine how to apply for this job."""
    has_url = bool(job.get("apply_url"))
    has_emails = bool(job.get("apply_emails"))
    
    if has_url and has_emails:
        return "both"
    elif has_url:
        return "apply_link"
    elif has_emails:
        return "email"
    else:
        return "unknown"


def is_expired(job: Dict[str, Any], today: str) -> bool:
    """Check if job is expired (closing_date < today)."""
    closing = job.get("closing_date")
    if not closing:
        return False  # Keep jobs without closing date
    
    try:
        # Compare as strings (YYYY-MM-DD format)
        return closing < today
    except Exception:
        return False


def process_jobs(raw_jobs: List[Dict[str, Any]], today: str) -> List[Dict[str, Any]]:
    """Process raw jobs: filter expired, extract emails, set apply_method."""
    processed = []
    
    for job in raw_jobs:
        # Skip expired jobs
        if is_expired(job, today):
            continue
        
        # Extract apply emails
        job["apply_emails"] = extract_apply_emails(job)
        
        # Set apply method
        job["apply_method"] = determine_apply_method(job)
        
        processed.append(job)
    
    # Sort by closing date (soonest first, nulls last)
    def sort_key(j):
        cd = j.get("closing_date")
        if cd:
            return (0, cd)
        return (1, "9999-99-99")
    
    processed.sort(key=sort_key)
    
    return processed


def generate_summary(
    current_jobs: List[Dict[str, Any]],
    previous_jobs: List[Dict[str, Any]],
    today: str
) -> Dict[str, Any]:
    """Generate summary with new jobs and expiring jobs."""
    
    # Get previous URLs
    prev_urls = {j.get("url") for j in previous_jobs if j.get("url")}
    
    # Find new jobs (URL not in previous)
    new_jobs = [j for j in current_jobs if j.get("url") not in prev_urls]
    
    # Find expiring today
    expiring_today = [j for j in current_jobs if j.get("closing_date") == today]
    
    # Find expiring soon (within 3 days)
    try:
        today_date = datetime.strptime(today, "%Y-%m-%d")
        soon_cutoff = (today_date + timedelta(days=3)).strftime("%Y-%m-%d")
        
        expiring_soon = [
            j for j in current_jobs
            if j.get("closing_date") and today < j["closing_date"] <= soon_cutoff
        ]
    except Exception:
        expiring_soon = []
    
    return {
        "generated_at": get_kabul_datetime().isoformat(),
        "today": today,
        "total_jobs": len(current_jobs),
        "new_count": len(new_jobs),
        "expiring_today_count": len(expiring_today),
        "expiring_soon_count": len(expiring_soon),
        "new_jobs": new_jobs[:50],  # Limit for JSON size
        "expiring_today": expiring_today,
        "expiring_soon": expiring_soon[:50],
    }


def main():
    """Main entry point."""
    if len(sys.argv) < 4:
        print("Usage: postprocess.py <raw_jobs.json> <output_jobs.json> <summary.json> [last_jobs.json]")
        sys.exit(1)
    
    raw_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    summary_path = Path(sys.argv[3])
    last_jobs_path = Path(sys.argv[4]) if len(sys.argv) > 4 else None
    
    today = get_kabul_today()
    print(f"[postprocess] Today (Kabul): {today}")
    
    # Load raw jobs
    print(f"[postprocess] Loading raw jobs from: {raw_path}")
    with open(raw_path, "r", encoding="utf-8") as f:
        raw_jobs = json.load(f)
    print(f"[postprocess] Raw jobs count: {len(raw_jobs)}")
    
    # Load previous jobs for comparison
    previous_jobs = []
    if last_jobs_path and last_jobs_path.exists():
        print(f"[postprocess] Loading previous jobs from: {last_jobs_path}")
        try:
            with open(last_jobs_path, "r", encoding="utf-8") as f:
                previous_jobs = json.load(f)
            print(f"[postprocess] Previous jobs count: {len(previous_jobs)}")
        except Exception as e:
            print(f"[postprocess] Warning: Could not load previous jobs: {e}")
    
    # Process jobs
    processed = process_jobs(raw_jobs, today)
    print(f"[postprocess] After filtering expired: {len(processed)} jobs")
    
    # Count apply methods
    methods = {}
    for j in processed:
        m = j.get("apply_method", "unknown")
        methods[m] = methods.get(m, 0) + 1
    print(f"[postprocess] Apply methods: {methods}")
    
    # Generate summary
    summary = generate_summary(processed, previous_jobs, today)
    print(f"[postprocess] New jobs: {summary['new_count']}")
    print(f"[postprocess] Expiring today: {summary['expiring_today_count']}")
    print(f"[postprocess] Expiring soon: {summary['expiring_soon_count']}")
    
    # Ensure output directories exist
    output_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Write outputs
    print(f"[postprocess] Writing processed jobs to: {output_path}")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(processed, f, ensure_ascii=False, indent=2)
    
    print(f"[postprocess] Writing summary to: {summary_path}")
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    
    print("[postprocess] Done!")
    
    # Return summary for use by notify script
    return summary


if __name__ == "__main__":
    main()

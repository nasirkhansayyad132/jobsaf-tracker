#!/usr/bin/env python3
"""
Send email notification about new and expiring jobs via Gmail SMTP.

Environment variables required:
- SMTP_HOST (default: smtp.gmail.com)
- SMTP_PORT (default: 465)
- SMTP_USER (Gmail address)
- SMTP_PASS (Gmail App Password)
- EMAIL_TO (recipient email)
"""

import json
import os
import smtplib
import ssl
import sys
from datetime import datetime, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Dict, Any, List

# Kabul is UTC+4:30
KABUL_UTC_OFFSET = timedelta(hours=4, minutes=30)


def get_kabul_today() -> str:
    """Get today's date in Asia/Kabul timezone."""
    utc_now = datetime.utcnow()
    kabul_now = utc_now + KABUL_UTC_OFFSET
    return kabul_now.strftime("%Y-%m-%d")


def get_kabul_date_formatted() -> str:
    """Get formatted date string."""
    utc_now = datetime.utcnow()
    kabul_now = utc_now + KABUL_UTC_OFFSET
    return kabul_now.strftime("%B %d, %Y")


def escape_html(text: str) -> str:
    """Escape HTML special characters."""
    if not text:
        return ""
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def job_to_html_row(job: Dict[str, Any]) -> str:
    """Convert a job to an HTML table row."""
    title = escape_html(job.get("title") or "Untitled")
    company = escape_html(job.get("company") or "Unknown")
    location = escape_html(job.get("location") or "Afghanistan")
    closing = job.get("closing_date") or "N/A"
    url = job.get("url", "#")
    apply_url = job.get("apply_url")
    apply_emails = job.get("apply_emails") or []
    
    # Build apply links
    apply_links = []
    if apply_url:
        apply_links.append(f'<a href="{escape_html(apply_url)}" style="color:#1e40af;">Apply</a>')
    for email in apply_emails[:2]:  # Limit to 2 emails
        apply_links.append(f'<a href="mailto:{escape_html(email)}" style="color:#16a34a;">✉ {escape_html(email)}</a>')
    
    apply_html = " | ".join(apply_links) if apply_links else '<span style="color:#999;">See job page</span>'
    
    return f"""
    <tr style="border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 12px 8px; vertical-align: top;">
            <a href="{escape_html(url)}" style="color: #1e40af; font-weight: 600; text-decoration: none;">
                {title}
            </a>
            <div style="font-size: 13px; color: #6b7280; margin-top: 4px;">
                🏢 {company} &nbsp;|&nbsp; 📍 {location}
            </div>
        </td>
        <td style="padding: 12px 8px; text-align: center; white-space: nowrap; color: #374151;">
            {closing}
        </td>
        <td style="padding: 12px 8px; font-size: 13px;">
            {apply_html}
        </td>
    </tr>
    """


def build_section(title: str, emoji: str, jobs: List[Dict[str, Any]], max_items: int = 10) -> str:
    """Build an HTML section for a group of jobs."""
    if not jobs:
        return ""
    
    display_jobs = jobs[:max_items]
    remaining = len(jobs) - max_items if len(jobs) > max_items else 0
    
    rows = "\n".join(job_to_html_row(j) for j in display_jobs)
    
    footer = ""
    if remaining > 0:
        footer = f'<p style="color: #6b7280; font-size: 13px; margin-top: 8px;">... and {remaining} more</p>'
    
    return f"""
    <div style="margin-bottom: 32px;">
        <h2 style="color: #1f2937; font-size: 18px; margin-bottom: 12px; border-bottom: 2px solid #1e40af; padding-bottom: 8px;">
            {emoji} {title} ({len(jobs)})
        </h2>
        <table style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr style="background: #f3f4f6; text-align: left;">
                    <th style="padding: 10px 8px; font-weight: 600; color: #374151;">Job</th>
                    <th style="padding: 10px 8px; font-weight: 600; color: #374151; text-align: center;">Closing</th>
                    <th style="padding: 10px 8px; font-weight: 600; color: #374151;">Apply</th>
                </tr>
            </thead>
            <tbody>
                {rows}
            </tbody>
        </table>
        {footer}
    </div>
    """


def build_email_html(summary: Dict[str, Any]) -> str:
    """Build the full HTML email body."""
    today_formatted = get_kabul_date_formatted()
    
    sections = []
    
    # Expiring Today (most urgent)
    if summary.get("expiring_today"):
        sections.append(build_section(
            "⚠️ Expiring TODAY",
            "🔴",
            summary["expiring_today"],
            max_items=15
        ))
    
    # Expiring Soon
    if summary.get("expiring_soon"):
        sections.append(build_section(
            "Expiring in Next 3 Days",
            "🟡",
            summary["expiring_soon"],
            max_items=15
        ))
    
    # New Jobs
    if summary.get("new_jobs"):
        sections.append(build_section(
            "New Jobs Since Yesterday",
            "🆕",
            summary["new_jobs"],
            max_items=15
        ))
    
    if not sections:
        sections.append("""
        <div style="text-align: center; padding: 40px; color: #6b7280;">
            <p style="font-size: 18px;">📭 No updates today</p>
            <p>Check back tomorrow for new job listings.</p>
        </div>
        """)
    
    content = "\n".join(sections)
    
    return f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                 background: #f9fafb; margin: 0; padding: 20px;">
        <div style="max-width: 700px; margin: 0 auto; background: white; border-radius: 12px; 
                    box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden;">
            
            <!-- Header -->
            <div style="background: #1e40af; color: white; padding: 24px; text-align: center;">
                <h1 style="margin: 0; font-size: 24px;">💼 Jobs.af Daily Update</h1>
                <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px;">{today_formatted} (Kabul Time)</p>
            </div>
            
            <!-- Stats Bar -->
            <div style="background: #f3f4f6; padding: 16px 24px; display: flex; justify-content: center; 
                        gap: 24px; flex-wrap: wrap; text-align: center; font-size: 14px;">
                <div>
                    <span style="font-weight: 700; color: #1e40af; font-size: 20px;">{summary.get('total_jobs', 0)}</span>
                    <br><span style="color: #6b7280;">Total Open</span>
                </div>
                <div>
                    <span style="font-weight: 700; color: #16a34a; font-size: 20px;">{summary.get('new_count', 0)}</span>
                    <br><span style="color: #6b7280;">New</span>
                </div>
                <div>
                    <span style="font-weight: 700; color: #dc2626; font-size: 20px;">{summary.get('expiring_today_count', 0)}</span>
                    <br><span style="color: #6b7280;">Expiring Today</span>
                </div>
                <div>
                    <span style="font-weight: 700; color: #f59e0b; font-size: 20px;">{summary.get('expiring_soon_count', 0)}</span>
                    <br><span style="color: #6b7280;">Expiring Soon</span>
                </div>
            </div>
            
            <!-- Content -->
            <div style="padding: 24px;">
                {content}
            </div>
            
            <!-- Footer -->
            <div style="background: #f3f4f6; padding: 16px 24px; text-align: center; font-size: 13px; color: #6b7280;">
                <p style="margin: 0;">
                    View all jobs: <a href="https://jobs.af/jobs" style="color: #1e40af;">jobs.af</a>
                </p>
                <p style="margin: 8px 0 0; font-size: 12px;">
                    You're receiving this because you subscribed to Jobs.af Tracker notifications.
                </p>
            </div>
        </div>
    </body>
    </html>
    """


def send_email(subject: str, html_body: str) -> bool:
    """Send email via SMTP."""
    smtp_host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.environ.get("SMTP_PORT", "465"))
    smtp_user = os.environ.get("SMTP_USER")
    smtp_pass = os.environ.get("SMTP_PASS")
    email_to = os.environ.get("EMAIL_TO")
    
    if not all([smtp_user, smtp_pass, email_to]):
        print("[notify] ERROR: Missing SMTP credentials in environment")
        print(f"  SMTP_USER: {'set' if smtp_user else 'MISSING'}")
        print(f"  SMTP_PASS: {'set' if smtp_pass else 'MISSING'}")
        print(f"  EMAIL_TO: {'set' if email_to else 'MISSING'}")
        return False
    
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = smtp_user
    msg["To"] = email_to
    
    # Plain text fallback
    text_body = "Please view this email in an HTML-capable email client."
    msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))
    
    try:
        print(f"[notify] Connecting to {smtp_host}:{smtp_port}...")
        context = ssl.create_default_context()
        
        with smtplib.SMTP_SSL(smtp_host, smtp_port, context=context) as server:
            print(f"[notify] Logging in as {smtp_user}...")
            server.login(smtp_user, smtp_pass)
            
            # Support multiple recipients
            recipients = [r.strip() for r in email_to.split(",") if r.strip()]
            print(f"[notify] Sending email to {', '.join(recipients)}...")
            server.sendmail(smtp_user, recipients, msg.as_string())
        
        print("[notify] Email sent successfully!")
        return True
        
    except Exception as e:
        print(f"[notify] ERROR sending email: {e}")
        return False


def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        print("Usage: notify_email.py <summary.json>")
        sys.exit(1)
    
    summary_path = Path(sys.argv[1])
    
    print(f"[notify] Loading summary from: {summary_path}")
    with open(summary_path, "r", encoding="utf-8") as f:
        summary = json.load(f)
    
    today = get_kabul_today()
    new_count = summary.get("new_count", 0)
    expiring_today = summary.get("expiring_today_count", 0)
    
    # Build subject line
    subject = f"Jobs.af Daily – NEW: {new_count} | Expiring today: {expiring_today} | {today} (Kabul)"
    
    print(f"[notify] Subject: {subject}")
    print(f"[notify] Total jobs: {summary.get('total_jobs', 0)}")
    print(f"[notify] New: {new_count}")
    print(f"[notify] Expiring today: {expiring_today}")
    print(f"[notify] Expiring soon: {summary.get('expiring_soon_count', 0)}")
    
    # Check if there's anything to report
    if new_count == 0 and expiring_today == 0 and summary.get("expiring_soon_count", 0) == 0:
        print("[notify] No new or expiring jobs. Skipping email.")
        return
    
    # Build and send email
    html_body = build_email_html(summary)
    
    success = send_email(subject, html_body)
    
    if not success:
        sys.exit(1)


if __name__ == "__main__":
    main()

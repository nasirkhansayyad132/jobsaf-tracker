#!/usr/bin/env python3
import argparse, csv, json, os, re
from dataclasses import dataclass, asdict
from datetime import datetime, date, timedelta
from typing import Dict, List, Optional, Set

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeoutError

try:
    from dateutil import parser as dateparser
except Exception:
    dateparser = None

try:
    from tqdm import tqdm
except Exception:
    tqdm = None

BASE = "https://jobs.af"

@dataclass
class JobRecord:
    url: str
    title: Optional[str] = None
    company: Optional[str] = None
    location: Optional[str] = None
    closing_date: Optional[str] = None
    closing_date_raw: Optional[str] = None
    apply_url: Optional[str] = None
    description: Optional[str] = None
    details: Dict[str, str] = None
    scraped_at: str = datetime.utcnow().isoformat(timespec="seconds") + "Z"

def safe_mkdir(p: str):
    if p:
        os.makedirs(p, exist_ok=True)

def normalize_url(u: str) -> str:
    if u.startswith("/"):
        return BASE + u
    if u.startswith("http://") or u.startswith("https://"):
        return u
    return BASE.rstrip("/") + "/" + u.lstrip("/")

def wait_for_cloudflare(page, timeout_ms: int = 45000):
    """Wait for Cloudflare challenge to complete."""
    start = datetime.now()
    max_wait = timedelta(milliseconds=timeout_ms)
    
    while datetime.now() - start < max_wait:
        try:
            text = page.evaluate("() => document.body?.innerText || ''")
            # Check if Cloudflare challenge is present
            if any(s in text for s in ['Verifying you are human', 'Checking your browser', 
                                        'security of your connection', 'Just a moment']):
                page.wait_for_timeout(3000)
                continue
            else:
                # Challenge complete or not present
                break
        except Exception:
            page.wait_for_timeout(1000)
    
    # Extra wait for page to fully load after challenge
    page.wait_for_timeout(2000)
    try:
        page.wait_for_load_state("networkidle", timeout=10000)
    except Exception:
        pass

def goto_with_retry(page, url: str, timeout_ms: int, retries: int = 3):
    """Navigate to URL with retry logic for Cloudflare."""
    for attempt in range(retries):
        try:
            page.set_default_timeout(timeout_ms)
            page.goto(url, wait_until="domcontentloaded")
            wait_for_cloudflare(page, timeout_ms)
            
            # Verify we got actual content, not Cloudflare
            text = page.evaluate("() => document.body?.innerText || ''")
            if 'Verifying you are human' not in text and 'Just a moment' not in text:
                return True
            
            if attempt < retries - 1:
                page.wait_for_timeout(5000)  # Wait before retry
        except Exception as e:
            if attempt < retries - 1:
                page.wait_for_timeout(3000)
            else:
                raise
    return False

def goto(page, url: str, timeout_ms: int):
    """Navigate to a URL, handling Cloudflare."""
    page.set_default_timeout(timeout_ms)
    try:
        page.goto(url, wait_until="domcontentloaded")
    except PWTimeoutError:
        page.goto(url, wait_until="load")
    # Wait for Cloudflare if present
    wait_for_cloudflare(page, timeout_ms)

def force_click(locator, timeout=12000) -> bool:
    try:
        locator.wait_for(state="visible", timeout=timeout)
        locator.scroll_into_view_if_needed()
        locator.click(force=True, timeout=timeout)
        return True
    except Exception:
        return False

def screenshot(page, debug_dir: str, name: str):
    if not debug_dir:
        return
    try:
        page.screenshot(path=os.path.join(debug_dir, name), full_page=True)
    except Exception:
        pass

def click_filters(page) -> bool:
    candidates = [
        page.locator('button:has-text("Filters")').first,
        page.locator('[role="button"]:has-text("Filters")').first,
        page.locator('text="Filters"').first,
        page.locator('text=Filters').first,
    ]
    for c in candidates:
        if force_click(c):
            return True
    return False

def ensure_on_jobs_page(page, filtered_url: str = None) -> bool:
    """
    Check if we're still on the jobs listing page.
    If not, navigate back to the jobs page (with filters if provided).
    """
    current_url = page.url
    
    # Check if we're on a job detail page or somewhere else
    if '/jobs/' in current_url and not current_url.endswith('/jobs') and '?' not in current_url.split('/jobs/')[-1]:
        # We're on a job detail page like /jobs/some-job-id
        print("    [!] Accidentally navigated to job detail page, going back...")
        if filtered_url:
            page.goto(filtered_url, wait_until="domcontentloaded")
        else:
            page.goto("https://jobs.af/jobs", wait_until="domcontentloaded")
        page.wait_for_timeout(1500)
        try:
            page.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            pass
        # Re-open filters
        click_filters(page)
        page.wait_for_timeout(800)
        return True
    
    return False

def jobs_counter_text(page) -> Optional[str]:
    loc = page.locator('text=/\\b\\d+\\s+Available Jobs\\b/i').first
    try:
        if loc.count() and loc.is_visible():
            return loc.inner_text().strip()
    except Exception:
        pass
    return None

def wait_results_refresh(page, old_counter: Optional[str], wait_ms: int):
    page.wait_for_timeout(350)
    if old_counter:
        try:
            page.wait_for_function(
                """(oldText) => {
                    const els = Array.from(document.querySelectorAll('*'));
                    const el = els.find(e => e && e.innerText && /\\b\\d+\\s+Available Jobs\\b/i.test(e.innerText));
                    if (!el) return false;
                    return el.innerText.trim() !== oldText;
                }""",
                arg=old_counter,
                timeout=12000
            )
        except Exception:
            pass
    try:
        page.wait_for_load_state("networkidle", timeout=12000)
    except Exception:
        pass
    page.wait_for_timeout(wait_ms)

def pick_control_near_label(page, label_text: str):
    # Finds the visible control closest BELOW the label, so it won't jump to Company.
    js = r"""
    (labelText) => {
      const norm = s => (s || '').replace(/\s+/g,' ').trim().toLowerCase();
      const target = norm(labelText);

      // Find an element whose text is exactly the label
      const all = Array.from(document.querySelectorAll('*'));
      const labelEl = all.find(el => norm(el.textContent) === target);
      if (!labelEl) return null;

      const lb = labelEl.getBoundingClientRect();
      const root = labelEl.closest('form,section,div') || document.body;

      // Candidate controls for these dropdowns
      const candidates = Array.from(root.querySelectorAll(
        '[role="combobox"],[aria-haspopup="listbox"],div[tabindex="0"],input'
      )).filter(el => {
        const r = el.getBoundingClientRect();
        if (r.width < 30 || r.height < 18) return false;
        if (r.top < lb.bottom - 2) return false; // must be below label
        // exclude the main keyword search input
        if (el.tagName.toLowerCase() === 'input') {
          const ph = (el.getAttribute('placeholder') || '').toLowerCase();
          if (ph.includes('vacancy title') || ph.includes('keyword')) return false;
        }
        return true;
      });

      let best = null;
      let bestScore = 1e18;

      for (const el of candidates) {
        const r = el.getBoundingClientRect();
        const vertical = Math.abs(r.top - lb.bottom);
        const horizontal = Math.abs(r.left - lb.left) * 0.15;
        const score = vertical + horizontal;

        // avoid picking something far away
        if (vertical > 260) continue;

        if (score < bestScore) {
          best = el;
          bestScore = score;
        }
      }
      return best;
    }
    """
    handle = page.evaluate_handle(js, label_text)
    el = handle.as_element()
    if el is None:
        return None
    return el

def open_categories_dropdown(page, debug=False):
    el = pick_control_near_label(page, "Categories")
    if not el:
        return False

    try:
        el.scroll_into_view_if_needed()
    except Exception:
        pass

    # Print some info so you can confirm it's the right field
    if debug:
        try:
            info = page.evaluate("""(e) => {
              const r = e.getBoundingClientRect();
              return {
                tag: e.tagName,
                role: e.getAttribute('role'),
                aria: e.getAttribute('aria-label'),
                ph: e.getAttribute('placeholder'),
                x: r.left, y: r.top, w: r.width, h: r.height
              };
            }""", el)
            print("[i] Categories control picked:", info)
        except Exception:
            pass

    el.click(force=True)
    page.wait_for_timeout(250)
    return True

def find_dropdown_search_box_near_label(page, label_text: str):
    """
    Find the search input within the dropdown that's associated with the given label.
    This ensures we type in the correct dropdown's search box.
    """
    js = r"""
    (labelText) => {
      const norm = s => (s || '').replace(/\s+/g,' ').trim().toLowerCase();
      const target = norm(labelText);

      // Find the label element
      const all = Array.from(document.querySelectorAll('*'));
      const labelEl = all.find(el => {
        const t = norm(el.textContent);
        return t === target && el.children.length === 0;
      }) || all.find(el => norm(el.textContent) === target);
      
      if (!labelEl) return null;

      const lb = labelEl.getBoundingClientRect();

      // Find all visible inputs with "Type to search" placeholder
      const inputs = Array.from(document.querySelectorAll('input[placeholder*="search" i], input[placeholder*="type" i]'));
      
      let best = null;
      let bestDist = 1e18;

      for (const inp of inputs) {
        const r = inp.getBoundingClientRect();
        // Must be visible
        if (r.width < 20 || r.height < 10) continue;
        // Skip if it's the main keyword search
        const ph = (inp.getAttribute('placeholder') || '').toLowerCase();
        if (ph.includes('vacancy title') || ph.includes('keyword')) continue;
        
        // Calculate distance from label - prefer inputs below and close horizontally
        const vertDist = r.top - lb.bottom;
        const horizDist = Math.abs(r.left - lb.left);
        
        // Must be below or very close to the label
        if (vertDist < -50) continue;
        
        // Distance score - prioritize vertical proximity
        const dist = Math.abs(vertDist) + horizDist * 0.5;
        
        if (dist < bestDist) {
          best = inp;
          bestDist = dist;
        }
      }

      // If no labeled match, look for recently appeared dropdown menu inputs
      if (!best) {
        // Find dropdown/listbox containers that are visible
        const dropdowns = Array.from(document.querySelectorAll('[role="listbox"], [class*="dropdown"], [class*="menu"], [class*="select"]'));
        for (const dd of dropdowns) {
          const r = dd.getBoundingClientRect();
          if (r.width < 50 || r.height < 20) continue;
          
          const inp = dd.querySelector('input[placeholder*="search" i], input[placeholder*="type" i]');
          if (inp) {
            const ir = inp.getBoundingClientRect();
            if (ir.width > 20 && ir.height > 10) {
              // Check if this dropdown is near our label
              const vertDist = r.top - lb.bottom;
              const horizDist = Math.abs(r.left - lb.left);
              if (vertDist > -50 && horizDist < 400) {
                const dist = Math.abs(vertDist) + horizDist * 0.5;
                if (dist < bestDist) {
                  best = inp;
                  bestDist = dist;
                }
              }
            }
          }
        }
      }

      return best;
    }
    """
    handle = page.evaluate_handle(js, label_text)
    el = handle.as_element()
    return el

def find_active_dropdown_input(page):
    """
    Find the search input in the currently active/focused dropdown.
    This looks for the most recently appeared visible search input.
    """
    js = r"""
    () => {
      // Look for visible inputs in dropdown-like containers
      const candidates = [];
      
      // Check for inputs with search placeholder that are visible
      const inputs = Array.from(document.querySelectorAll('input'));
      
      for (const inp of inputs) {
        const r = inp.getBoundingClientRect();
        // Must be visible
        if (r.width < 20 || r.height < 10) continue;
        
        const ph = (inp.getAttribute('placeholder') || '').toLowerCase();
        // Skip main search
        if (ph.includes('vacancy title') || ph.includes('keyword')) continue;
        
        // Check if it's a dropdown search input
        if (ph.includes('search') || ph.includes('type')) {
          // Check if it's inside a visible dropdown/popup
          let parent = inp.parentElement;
          let inDropdown = false;
          while (parent) {
            const style = window.getComputedStyle(parent);
            const hasPopupStyle = style.position === 'absolute' || style.position === 'fixed';
            const hasDropdownClass = (parent.className || '').toLowerCase().match(/dropdown|menu|popup|listbox|select|options/);
            const hasRole = parent.getAttribute('role') === 'listbox' || parent.getAttribute('aria-haspopup');
            
            if (hasPopupStyle || hasDropdownClass || hasRole) {
              inDropdown = true;
              break;
            }
            parent = parent.parentElement;
          }
          
          if (inDropdown || ph.includes('search')) {
            candidates.push({
              el: inp,
              rect: r,
              focused: document.activeElement === inp
            });
          }
        }
      }
      
      // Prefer focused input, then topmost visible one
      if (candidates.length === 0) return null;
      
      const focused = candidates.find(c => c.focused);
      if (focused) return focused.el;
      
      // Return the one with smallest top (highest on page among visible ones)
      candidates.sort((a, b) => a.rect.top - b.rect.top);
      return candidates[0].el;
    }
    """
    handle = page.evaluate_handle(js)
    el = handle.as_element()
    return el

def select_one_category(page, search_term: str, wait_after_ms: int, debug=False, already_selected: set = None, filtered_url: str = None):
    """
    Type a search term and click ALL matching options in the dropdown.
    Uses PARTIAL matching (contains) to find all relevant categories.
    Skips anything with 'architect' in the name.
    """
    if already_selected is None:
        already_selected = set()
    
    search_lower = search_term.lower().strip()
    
    # Check if we're still on the jobs page
    ensure_on_jobs_page(page, filtered_url)
    
    old = jobs_counter_text(page)

    # close anything open
    try:
        page.keyboard.press("Escape")
    except Exception:
        pass
    page.wait_for_timeout(300)

    # Get the Categories control
    categories_control = pick_control_near_label(page, "Categories")
    if not categories_control:
        # Try re-opening filters
        click_filters(page)
        page.wait_for_timeout(800)
        categories_control = pick_control_near_label(page, "Categories")
        if not categories_control:
            if debug:
                print(f"    [!] Could not find Categories control, skipping '{search_term}'")
            return already_selected

    try:
        categories_control.scroll_into_view_if_needed()
    except Exception:
        pass

    tag_name = None
    try:
        tag_name = page.evaluate("(el) => el.tagName.toUpperCase()", categories_control)
    except Exception:
        pass

    inp = categories_control if tag_name == "INPUT" else None
    
    if inp:
        inp.click(force=True)
        page.wait_for_timeout(200)
    else:
        categories_control.click(force=True)
        page.wait_for_timeout(400)
        for _ in range(20):
            inp = find_dropdown_search_box_near_label(page, "Categories") or find_active_dropdown_input(page)
            if inp:
                try:
                    if inp.is_visible():
                        break
                except Exception:
                    pass
            inp = None
            page.wait_for_timeout(150)

    if not inp:
        raise RuntimeError('Could not find Categories input.')

    # Clear and type the search term
    inp.focus()
    inp.click(force=True)
    try:
        inp.fill("")
    except Exception:
        pass
    
    inp.type(search_term, delay=30)
    page.wait_for_timeout(1200)
    
    screenshot(page, os.path.expanduser("~/jobsaf_debug"), f"typing_{search_term[:20]}.png")

    inp_box = inp.bounding_box()
    if not inp_box:
        raise RuntimeError("Could not get input bounding box")
    
    if debug:
        print(f"[i] Looking for options containing: '{search_term}'...")

    # JavaScript to find ALL matching options (partial match, case-insensitive)
    # Excludes anything with 'architect' in the name
    js_find_all_options = """
    (args) => {
        const searchTerm = args.searchTerm.toLowerCase().trim();
        const inputY = args.inputY;
        const inputX = args.inputX;
        const alreadySelected = args.alreadySelected || [];
        
        const results = [];
        
        // Find all option-like divs
        const optionDivs = document.querySelectorAll('div[class*="py-2"][class*="px-3"]');
        
        for (const el of optionDivs) {
            const r = el.getBoundingClientRect();
            
            // Must be visible on screen
            if (r.width < 100 || r.height < 20) continue;
            if (r.top < 0 || r.bottom > window.innerHeight) continue;
            
            // Must be near the input horizontally
            if (Math.abs(r.left - inputX) > 80) continue;
            
            // Must be below the input
            if (r.top < inputY + 30) continue;
            
            const text = el.textContent.trim();
            const textLower = text.toLowerCase();
            
            // SKIP anything with 'architect' in the name
            if (textLower.includes('architect')) continue;
            
            // Skip if already selected in our tracking set
            if (alreadySelected.includes(textLower)) continue;
            
            // PARTIAL match: does the option contain our search term?
            if (textLower.includes(searchTerm)) {
                // Check if already selected (has checkmark SVG)
                const hasSvg = el.querySelector('svg') !== null;
                
                results.push({
                    text: text,
                    textLower: textLower,
                    alreadyChecked: hasSvg,
                    centerY: r.top + r.height / 2,
                    centerX: r.left + r.width / 2
                });
            }
        }
        
        // Also check generic divs as fallback
        if (results.length === 0) {
            const allDivs = document.querySelectorAll('div');
            for (const el of allDivs) {
                const r = el.getBoundingClientRect();
                
                if (r.width < 150 || r.width > 450) continue;
                if (r.height < 25 || r.height > 70) continue;
                if (r.top < 0 || r.bottom > window.innerHeight) continue;
                if (Math.abs(r.left - inputX) > 100) continue;
                if (r.top < inputY + 30) continue;
                
                const text = el.textContent.trim();
                const textLower = text.toLowerCase();
                
                if (textLower.includes('architect')) continue;
                if (alreadySelected.includes(textLower)) continue;
                
                if (textLower.includes(searchTerm)) {
                    const hasSvg = el.querySelector('svg') !== null;
                    results.push({
                        text: text,
                        textLower: textLower,
                        alreadyChecked: hasSvg,
                        centerY: r.top + r.height / 2,
                        centerX: r.left + r.width / 2
                    });
                }
            }
        }
        
        return results;
    }
    """
    
    # Find all matching options
    options = page.evaluate(js_find_all_options, {
        'searchTerm': search_lower,
        'inputY': inp_box['y'],
        'inputX': inp_box['x'],
        'alreadySelected': list(already_selected)
    })
    
    # Deduplicate options by text (same category can appear multiple times in DOM)
    seen_texts = set()
    unique_options = []
    for opt in options:
        if opt['textLower'] not in seen_texts and opt['textLower'] not in already_selected:
            seen_texts.add(opt['textLower'])
            unique_options.append(opt)
    options = unique_options
    
    if debug:
        print(f"    Found {len(options)} matching option(s)")
    
    clicked_count = 0
    for opt in options:
        if opt['alreadyChecked']:
            if debug:
                print(f"    [=] '{opt['text']}' already has checkmark")
            already_selected.add(opt['textLower'])
        elif opt['textLower'] in already_selected:
            if debug:
                print(f"    [=] '{opt['text']}' already in our tracking set")
        else:
            # Click the option using mouse coordinates (more reliable)
            try:
                # Verify we're still on the right page before clicking
                if ensure_on_jobs_page(page, None):
                    # Page changed, need to re-search
                    if debug:
                        print(f"    [!] Page changed during selection, stopping this search")
                    break
                
                page.mouse.click(opt['centerX'], opt['centerY'])
                already_selected.add(opt['textLower'])
                clicked_count += 1
                if debug:
                    print(f"    [+] SELECTED: '{opt['text']}'")
                page.wait_for_timeout(500)
                
                # Check if we accidentally navigated away
                if ensure_on_jobs_page(page, None):
                    if debug:
                        print(f"    [!] Navigated away after click, stopping this search")
                    break
                
                # Re-open dropdown if it closed (some dropdowns close after each click)
                # But only if we have more items to click
                remaining = len([o for o in options if not o['alreadyChecked'] and o['textLower'] not in already_selected])
                if remaining > 0:
                    # Check if dropdown is still visible
                    still_open = page.evaluate("""
                        () => {
                            const inputs = document.querySelectorAll('input[placeholder*="search" i]');
                            for (const inp of inputs) {
                                const r = inp.getBoundingClientRect();
                                if (r.width > 50 && r.height > 10) return true;
                            }
                            return false;
                        }
                    """)
                    
                    if not still_open:
                        # Re-open and re-type
                        categories_control = pick_control_near_label(page, "Categories")
                        if categories_control:
                            categories_control.click(force=True)
                            page.wait_for_timeout(400)
                            inp = find_dropdown_search_box_near_label(page, "Categories") or find_active_dropdown_input(page)
                            if inp:
                                try:
                                    inp.fill("")
                                    inp.type(search_term, delay=30)
                                    page.wait_for_timeout(800)
                                except Exception:
                                    pass
                
            except Exception as e:
                if debug:
                    print(f"    [!] Click failed for '{opt['text']}': {str(e)[:50]}")
                # Don't fail entirely, just skip this option
                continue
    
    if len(options) == 0:
        if debug:
            print(f"    [-] No options found for: '{search_term}'")

    page.wait_for_timeout(400)

    # Click outside dropdown to close and apply
    try:
        page.mouse.click(700, 200)
    except Exception:
        pass
    
    page.wait_for_timeout(600)
    wait_results_refresh(page, old, wait_after_ms)
    
    try:
        page.wait_for_load_state("networkidle", timeout=5000)
    except Exception:
        pass
    page.wait_for_timeout(400)
    
    if debug:
        new_count = jobs_counter_text(page)
        print(f"[i] Job count: {old} -> {new_count}")
    
    return already_selected

def mine_links_from_text(text: str) -> Set[str]:
    links = set()
    for m in re.finditer(r"(?:https?://jobs\.af)?(/jobs/[a-z0-9][a-z0-9\-_\/]*)", text, re.I):
        path = m.group(1)
        if "/jobs?" in path:
            continue
        links.add(normalize_url(path))
    return links

def extract_job_links_from_dom(html: str) -> Set[str]:
    soup = BeautifulSoup(html, "html.parser")
    links = set()
    for a in soup.select("a[href]"):
        href = (a.get("href") or "").strip()
        if "/jobs/" in href and "/jobs?" not in href:
            links.add(normalize_url(href))
    links |= mine_links_from_text(html)
    return links

def parse_closing_date(text: str) -> Optional[date]:
    if not text:
        return None
    if dateparser:
        try:
            dt = dateparser.parse(text, fuzzy=True, dayfirst=True)
            if dt:
                return dt.date()
        except Exception:
            return None
    return None

def extract_key_value_details(soup: BeautifulSoup) -> Dict[str, str]:
    details: Dict[str, str] = {}
    
    # Known field labels on jobs.af
    known_labels = {
        'post date', 'closing date', 'reference', 'number of vacancies',
        'salary range', 'years of experience', 'probation period',
        'contract type', 'contract duration', 'minimum education',
        'location', 'company', 'functional area', 'provinces', 'countries',
        'contract extensible'
    }
    
    # Method 1: Look for elements that contain only a label, then get next sibling value
    all_elements = soup.find_all(['div', 'span', 'p', 'dt', 'th', 'td'])
    for el in all_elements:
        text = el.get_text(" ", strip=True).lower()
        
        # Check if this element contains exactly a known label
        if text in known_labels:
            # Get the next sibling element's text as the value
            next_el = el.find_next_sibling()
            if next_el:
                val = next_el.get_text(" ", strip=True)
                if val and len(val) < 200 and val.lower() not in known_labels:
                    # Capitalize the key properly
                    key = text.title()
                    details[key] = val
    
    # Method 2: Look for dt/dd pairs
    for dt_tag in soup.select("dt"):
        key = dt_tag.get_text(" ", strip=True)
        dd = dt_tag.find_next_sibling("dd")
        if key and dd:
            val = dd.get_text(" ", strip=True)
            if val:
                details.setdefault(key, val)

    # Method 3: Look for table rows
    for tr in soup.select("table tr"):
        cells = tr.find_all(["th", "td"])
        if len(cells) >= 2:
            k = cells[0].get_text(" ", strip=True)
            v = cells[1].get_text(" ", strip=True)
            if k and v and len(k) <= 80:
                details.setdefault(k, v)

    # Method 4: Parse line-by-line for "Key: Value" or "Key Value" patterns
    full_text = soup.get_text("\n", strip=True)
    lines = full_text.splitlines()
    
    for i, line in enumerate(lines):
        line_lower = line.strip().lower()
        
        # Check if line is exactly a known label
        if line_lower in known_labels:
            # Next non-empty line is the value
            for j in range(i + 1, min(i + 3, len(lines))):
                val = lines[j].strip()
                if val and val.lower() not in known_labels:
                    key = line.strip().title()
                    details.setdefault(key, val)
                    break
        
        # Also check for "Key: Value" on same line
        elif ":" in line and 3 <= len(line) <= 240:
            left, right = line.split(":", 1)
            k = left.strip()
            v = right.strip()
            if 2 <= len(k) <= 80 and v:
                details.setdefault(k, v)

    return details

def extract_apply_url(soup: BeautifulSoup) -> Optional[str]:
    for a in soup.select("a[href]"):
        href = (a.get("href") or "").strip()
        txt = a.get_text(" ", strip=True).lower()
        if href and ("apply" in txt or "apply now" in txt):
            return normalize_url(href)
    for a in soup.select("a[href*='apply']"):
        href = (a.get("href") or "").strip()
        if href:
            return normalize_url(href)
    return None

def pick_description(soup: BeautifulSoup) -> Optional[str]:
    for sel in ["[id*='description']", "[class*='description']", "article", "main"]:
        el = soup.select_one(sel)
        if el:
            t = el.get_text("\n", strip=True)
            if t and len(t) > 200:
                return t
    if soup.body:
        t = soup.body.get_text("\n", strip=True)
        if t and len(t) > 200:
            return t
    return None

def scrape_job_detail(html: str, url: str) -> JobRecord:
    soup = BeautifulSoup(html, "html.parser")
    rec = JobRecord(url=url, details={})

    h1 = soup.find("h1")
    if h1:
        rec.title = h1.get_text(" ", strip=True)

    rec.details = extract_key_value_details(soup)

    # Extract known fields from details
    for k, v in (rec.details or {}).items():
        lk = k.lower().strip()
        if not rec.company and lk in ("company", "organization", "employer"):
            rec.company = v
        if not rec.location and lk in ("location", "duty station", "city", "provinces"):
            rec.location = v
        # Only match exact "closing date" - NOT "post date"
        if lk == "closing date" and not rec.closing_date_raw:
            rec.closing_date_raw = v
        elif lk in ("deadline", "apply by", "application deadline") and not rec.closing_date_raw:
            rec.closing_date_raw = v

    # Fallback: Regex search for "Closing Date" in the page text
    if not rec.closing_date_raw:
        full = soup.get_text("\n", strip=True)
        
        # Pattern 1: "Closing Date" on one line, date on next line
        # Split into lines and look for the pattern
        lines = full.splitlines()
        for i, line in enumerate(lines):
            if re.match(r'^\s*closing\s+date\s*$', line, re.I):
                # Next line should be the date
                if i + 1 < len(lines):
                    date_line = lines[i + 1].strip()
                    # Check if it looks like a date (e.g., "Jan 24, 2026")
                    if re.match(r'^[A-Za-z]{3,}\s+\d{1,2},?\s*\d{4}$', date_line):
                        rec.closing_date_raw = date_line
                        break
        
        # Pattern 2: "Closing Date: Jan 24, 2026" on same line
        if not rec.closing_date_raw:
            m = re.search(r'Closing\s+Date[:\s]+([A-Za-z]{3,}\s+\d{1,2},?\s*\d{4})', full, re.I)
            if m:
                rec.closing_date_raw = m.group(1)
        
        # Pattern 3: Try "Deadline"
        if not rec.closing_date_raw:
            m = re.search(r'Deadline[:\s]+([A-Za-z]{3,}\s+\d{1,2},?\s*\d{4})', full, re.I)
            if m:
                rec.closing_date_raw = m.group(1)

    if rec.closing_date_raw:
        cd = parse_closing_date(rec.closing_date_raw)
        if cd:
            rec.closing_date = cd.isoformat()

    rec.apply_url = extract_apply_url(soup)
    rec.description = pick_description(soup)
    return rec

def save_csv(path: str, records: List[JobRecord]):
    fields = [
        "url","title","company","location",
        "closing_date","closing_date_raw",
        "apply_url","scraped_at","details_json","description"
    ]
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in records:
            w.writerow({
                "url": r.url,
                "title": r.title,
                "company": r.company,
                "location": r.location,
                "closing_date": r.closing_date,
                "closing_date_raw": r.closing_date_raw,
                "apply_url": r.apply_url,
                "scraped_at": r.scraped_at,
                "details_json": json.dumps(r.details or {}, ensure_ascii=False),
                "description": r.description or "",
            })

def save_json(path: str, records: List[JobRecord]):
    with open(path, "w", encoding="utf-8") as f:
        json.dump([asdict(r) for r in records], f, ensure_ascii=False, indent=2)

def build_category_url(categories: List[str], page: int = 1) -> str:
    """Build jobs.af URL with category filters and page number."""
    from urllib.parse import quote
    
    base = "https://jobs.af/jobs/?"
    params = []
    for cat in categories:
        params.append(f"category={quote(cat)}")
    params.append(f"page={page}")
    return base + "&".join(params)

# Default IT/Tech/Data categories for jobs.af
DEFAULT_TECH_CATEGORIES = [
    "IT - Hardware",
    "IT - Software",
    "IT Billing",
    "Data Security/Protection",
    "Computer Science",
    "Computer Operator",
    "Information Technology",
    "Software engineering",
    "software development ",
    "software development",
    "it software and Hardware",
    "Software developer",
    "Database Developing",
    "Data Management",
    "Data Entry",
    "Data analysis",
    "Data Science",
    "database administration",
    "Database Development",
]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--headful", action="store_true")
    ap.add_argument("--slowmo", type=int, default=250)
    ap.add_argument("--timeout-ms", type=int, default=60000)
    ap.add_argument("--only-open", action="store_true")
    ap.add_argument("--debug-dir", default=os.path.expanduser("~/jobsaf_debug"))
    ap.add_argument("--categories", default="all", help="Comma-separated categories or 'all' for default tech list")
    ap.add_argument("--url", help="Direct URL with category filters (overrides --categories)")
    ap.add_argument("--csv", default=os.path.expanduser("~/jobs_full_open.csv"))
    ap.add_argument("--json", default=os.path.expanduser("~/jobs_full_open.json"))
    args = ap.parse_args()

    safe_mkdir(args.debug_dir)
    
    # Determine which categories to use
    if args.url:
        # User provided a direct URL - we'll use it and just change page numbers
        base_url = args.url
        # Remove existing page parameter if present
        from urllib.parse import urlparse, parse_qs, urlencode
        parsed = urlparse(base_url)
        params = parse_qs(parsed.query)
        # Remove page param, we'll add it ourselves
        params.pop('page', None)
        # Flatten params
        flat_params = []
        for key, values in params.items():
            for v in values:
                flat_params.append((key, v))
        base_url_no_page = f"{parsed.scheme}://{parsed.netloc}{parsed.path}?{urlencode(flat_params)}"
        print(f"[i] Using provided URL with {len(flat_params)} category filters")
        categories = [v for k, v in flat_params if k == 'category']
    elif args.categories.lower() in ('all', 'full', 'tech', 'it'):
        categories = DEFAULT_TECH_CATEGORIES
        base_url_no_page = build_category_url(categories, 1).rsplit('&page=', 1)[0]
        print(f"[i] Using default tech categories ({len(categories)} categories)")
    else:
        categories = [c.strip() for c in args.categories.split(",") if c.strip()]
        base_url_no_page = build_category_url(categories, 1).rsplit('&page=', 1)[0]
        print(f"[i] Using custom categories ({len(categories)} categories)")
    
    print(f"    Categories: {categories[:5]}{'...' if len(categories) > 5 else ''}")

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=not args.headful,
            slow_mo=args.slowmo,
            args=["--disable-blink-features=AutomationControlled"],
        )
        context = browser.new_context(
            viewport={"width": 1280, "height": 720},
            locale="en-US",
            user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        )
        page = context.new_page()

        job_links: Set[str] = set()

        # Mine job links from XHR/fetch text (works even if content-type isn't JSON)
        def on_response(resp):
            try:
                rt = resp.request.resource_type
                if rt not in ("xhr", "fetch"):
                    return
                txt = resp.text()
                job_links.update(mine_links_from_text(txt))
            except Exception:
                return

        page.on("response", on_response)

        # ========== URL-BASED APPROACH ==========
        # Load page 1 to get the total job count and max pages
        print("[1] Loading first page to detect total pages...")
        first_page_url = f"{base_url_no_page}&page=1"
        print(f"    URL: {first_page_url[:100]}...")
        goto(page, first_page_url, args.timeout_ms)
        page.wait_for_timeout(1500)
        
        try:
            page.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            pass
        
        screenshot(page, args.debug_dir, "01_first_page.png")
        
        # Get total job count
        total_jobs_text = jobs_counter_text(page)
        total_jobs = 0
        if total_jobs_text:
            m = re.search(r'(\d+)', total_jobs_text)
            if m:
                total_jobs = int(m.group(1))
        
        print(f"    Found: {total_jobs} Available Jobs")
        
        if total_jobs == 0:
            print("[!] No jobs found. Check if categories are valid.")
            screenshot(page, args.debug_dir, "error_no_jobs.png")
            browser.close()
            return
        
        # Calculate max pages (assuming 10 jobs per page)
        jobs_per_page = 10
        max_pages = (total_jobs + jobs_per_page - 1) // jobs_per_page
        print(f"    Estimated pages: {max_pages} (at {jobs_per_page} jobs/page)")
        
        # Also try to detect max page from pagination UI
        try:
            detected_max = page.evaluate("""
                () => {
                    let maxPage = 1;
                    const spans = document.querySelectorAll('main span, nav span');
                    for (const s of spans) {
                        const text = s.textContent.trim();
                        const num = parseInt(text);
                        if (!isNaN(num) && num > 0 && num < 200) {
                            const r = s.getBoundingClientRect();
                            if (r.width > 10 && r.width < 80 && r.height > 10 && r.height < 80) {
                                if (num > maxPage) maxPage = num;
                            }
                        }
                    }
                    return maxPage;
                }
            """)
            if detected_max > max_pages:
                max_pages = detected_max
            print(f"    Detected max page from UI: {detected_max}")
        except Exception:
            pass
        
        print(f"\n[2] Scraping {max_pages} pages...")
        
        for page_num in range(1, max_pages + 1):
            page_url = f"{base_url_no_page}&page={page_num}"
            
            if page_num > 1:
                # Use retry logic for pagination
                goto_with_retry(page, page_url, args.timeout_ms, retries=2)
                page.wait_for_timeout(1500)
                try:
                    page.wait_for_load_state("networkidle", timeout=10000)
                except Exception:
                    pass
            
            # Scroll to load all jobs on current page
            for _ in range(5):
                page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                page.wait_for_timeout(400)
            page.evaluate("window.scrollTo(0, 0)")
            page.wait_for_timeout(300)
            
            # Collect links from current page
            current_html = page.content()
            
            # Check if we got Cloudflare page
            if 'Verifying you are human' in current_html or 'Just a moment' in current_html:
                print(f"    Page {page_num}/{max_pages}: Cloudflare blocked, retrying...")
                page.wait_for_timeout(5000)
                wait_for_cloudflare(page, 30000)
                current_html = page.content()
            
            before_count = len(job_links)
            job_links |= extract_job_links_from_dom(current_html)
            new_links = len(job_links) - before_count
            
            print(f"    Page {page_num}/{max_pages}: +{new_links} links (total: {len(job_links)})")
            
            if page_num <= 3 or page_num == max_pages:
                screenshot(page, args.debug_dir, f"page_{page_num:02d}.png")
            
            # Early stop if no new links on 2 consecutive pages
            if new_links == 0 and page_num > 1:
                # Double check by trying next page
                page.wait_for_timeout(500)
        
        screenshot(page, args.debug_dir, "99_last_page.png")

        print(f"[5] Links collected: {len(job_links)}")
        if not job_links:
            print("[!] 0 links collected. Check screenshots in", args.debug_dir)
            browser.close()
            return

        links_list = sorted(job_links)
        detail_page = context.new_page()
        detail_page.set_default_timeout(args.timeout_ms)

        records: List[JobRecord] = []
        iterator = tqdm(links_list, desc="Scraping job details") if tqdm else links_list
        for u in iterator:
            try:
                # Use retry logic for job detail pages (Cloudflare protection)
                goto_with_retry(detail_page, u, args.timeout_ms, retries=3)
                
                # Verify we got actual content
                content = detail_page.content()
                if 'Verifying you are human' in content or 'Just a moment' in content:
                    print(f"[!] Cloudflare blocked: {u}")
                    continue
                
                rec = scrape_job_detail(content, u)
                
                # Skip if title is still "jobs.af" (Cloudflare page)
                if rec.title and rec.title.lower().strip() == 'jobs.af':
                    print(f"[!] Got Cloudflare page for: {u}")
                    continue
                    
                records.append(rec)
                if args.debug_dir:
                    print(f"[i] Scraped: {rec.title[:50] if rec.title else 'No title'} | Closing: {rec.closing_date or rec.closing_date_raw or 'unknown'}")
                detail_page.wait_for_timeout(500)  # Slightly longer delay between requests
            except Exception as e:
                if args.debug_dir:
                    print(f"[!] Error scraping {u}: {e}")
                continue

        browser.close()

    if args.only_open:
        today = date.today()
        kept = []
        for r in records:
            # If no closing date found, keep the job (assume it's still open)
            if not r.closing_date:
                kept.append(r)
                continue
            try:
                cd = datetime.strptime(r.closing_date, "%Y-%m-%d").date()
                if cd >= today:
                    kept.append(r)
                else:
                    if args.debug_dir:
                        print(f"[i] Skipping closed job: {r.title} (closed {r.closing_date})")
            except Exception:
                # If we can't parse the date, keep the job
                kept.append(r)
        records = kept
        print(f"[i] After filtering: {len(kept)} open jobs kept")

    save_csv(args.csv, records)
    save_json(args.json, records)

    print("\nDone.")
    print("Saved:", len(records))
    print("CSV:", args.csv)
    print("JSON:", args.json)
    print("Debug screenshots:", args.debug_dir)

if __name__ == "__main__":
    main()

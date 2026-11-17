#!/usr/bin/env python3
"""Syncs data/linkedin_posts.json from the client's Google Sheet tracker.

Usage:
    python scripts/sync_sheet.py                  # live sync from the Sheet
    python scripts/sync_sheet.py --dry-run         # print the summary, write nothing
    python scripts/sync_sheet.py --from-csv a.csv  # offline mode (also used by tests)

Live mode needs GOOGLE_SHEET_ID plus either GOOGLE_SERVICE_ACCOUNT_JSON
(service account, preferred) or GOOGLE_API_KEY (sheet must be link-viewable)
as environment variables. API-key mode only needs the standard library;
service-account mode additionally needs `google-auth` and `requests`
(see scripts/requirements-sync.txt).
"""

import argparse
import csv
import hashlib
import io
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'

HEADER_MAP = {
    'date': 'date',
    'hook': 'title',
    'hook / title': 'title',
    'title': 'title',
    'format': 'format',
    'objective': 'objective',
    'topic': 'topic',
    'new / re-post': 'kind',
    'new/re-post': 'kind',
    'inbound leads': 'inbound_leads',
    'profile views': 'profile_views',
    'follower gained': 'followers_gained',
    'followers gained': 'followers_gained',
    'video watch time': 'video_watch_secs',
    'average watch time': 'avg_watch_secs',
    'avg watch time': 'avg_watch_secs',
    'average watch Time': 'avg_watch_secs',
    'impressions': 'impressions',
    'engagements': 'engagements',
}

EXACT_FORMAT_MATCHES = {
    'image - cartoon': 'Image - Cartoon',
    'image - tweet': 'Image - Tweet',
    'carousel': 'Carousel',
    'article': 'Article',
    'text': 'Text',
    'repost': 'Repost',
    'ai': 'AI Image',
    'video - interview': 'Video - Interview',
    'image - photo': 'Image - Photo',
}

FIELD_ORDER = [
    'id', 'date', 'month', 'title', 'format', 'objective', 'topic', 'kind',
    'impressions', 'engagements', 'profile_views', 'followers_gained',
    'inbound_leads', 'video_watch_secs', 'avg_watch_secs', 'series',
]


class SyncError(Exception):
    """Fatal, user-facing sync error. Caught in main(); never leaves files touched."""


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

def safe_number(raw):
    """Parses a number from a Sheets cell (str/int/float). None if not numeric."""
    if raw is None:
        return None
    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        return raw
    s = str(raw).strip().replace(',', '')
    if s == '':
        return None
    try:
        if re.match(r'^-?\d+$', s):
            return int(s)
        return float(s)
    except ValueError:
        return None


def clean_num(n):
    if n is None:
        return None
    if isinstance(n, float) and n.is_integer():
        return int(n)
    return n


def parse_date(raw):
    """Accepts 'Nov 3, 2026', 'November 3, 2026', ISO 'YYYY-MM-DD', or 'MM/DD/YYYY'."""
    if raw is None:
        return None
    s = str(raw).strip()
    if s == '':
        return None
    if re.match(r'^\d{4}-\d{2}-\d{2}$', s):
        try:
            datetime.strptime(s, '%Y-%m-%d')
            return s
        except ValueError:
            return None
    for fmt in ('%b %d, %Y', '%B %d, %Y', '%m/%d/%Y', '%Y/%m/%d'):
        try:
            return datetime.strptime(s, fmt).strftime('%Y-%m-%d')
        except ValueError:
            continue
    return None


def parse_watch_time(raw):
    """'15m 56s' -> 956, '17s' -> 17. Falls back to a plain number of seconds."""
    if raw is None:
        return None
    s = str(raw).strip().lower()
    if s == '':
        return None
    m = re.match(r'^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?$', s)
    if m and (m.group(1) or m.group(2) or m.group(3)):
        hours = int(m.group(1) or 0)
        minutes = int(m.group(2) or 0)
        seconds = int(m.group(3) or 0)
        return hours * 3600 + minutes * 60 + seconds
    return safe_number(s)


def normalize_format(raw, warnings):
    label = '' if raw is None else str(raw).strip()
    if label == '':
        return 'Unlabelled'
    lower = label.lower()
    if 'person' in lower or 'perosonal' in lower:
        return 'Image - Personal'
    if 'stock' in lower:
        return 'Image - Stock'
    if lower in EXACT_FORMAT_MATCHES:
        return EXACT_FORMAT_MATCHES[lower]
    if lower == 'video - lf':
        return 'Video - Long'
    if lower == 'video - sf':
        return 'Video - Short'
    warnings.append(f"Unrecognised format label kept as-is: '{label}'")
    return label


def normalize_topic(raw):
    label = '' if raw is None else str(raw).strip()
    if label == '':
        return 'Unlabelled'
    if label.lower().startswith('mix'):
        return 'Mix'
    return label


def is_selected_tab(title):
    lower = title.lower()
    return 'analytics' in lower and 'template' not in lower


def is_benchmark_tab(title):
    return 'chris' in title.lower()


def map_headers(header_row):
    mapping = {}
    for idx, raw in enumerate(header_row):
        key = (raw or '').strip().lower()
        if not key:
            continue
        field = HEADER_MAP.get(key)
        if field and field not in mapping:
            mapping[field] = idx
    return mapping


def get_cell(row, idx):
    if idx is None or idx >= len(row):
        return None
    value = row[idx]
    return None if value == '' else value


def build_rows(tab_title, rows, warnings):
    """Returns (normalized_rows, skipped_count) for one tab's raw grid (header + data)."""
    if not rows:
        return [], 0

    header, *data_rows = rows
    mapping = map_headers(header)
    if 'date' not in mapping or 'impressions' not in mapping:
        raise SyncError(f"Tab '{tab_title}' has no recognisable Date or Impressions header")

    benchmark = is_benchmark_tab(tab_title)
    out_rows = []
    skipped = 0

    for raw_row in data_rows:
        if not any(str(c).strip() for c in raw_row if c is not None):
            continue  # fully blank line

        date_str = parse_date(get_cell(raw_row, mapping.get('date')))
        impressions = safe_number(get_cell(raw_row, mapping.get('impressions')))
        engagements = safe_number(get_cell(raw_row, mapping.get('engagements'))) if 'engagements' in mapping else None

        if date_str is None or impressions is None or engagements is None:
            skipped += 1
            continue

        title = str(get_cell(raw_row, mapping.get('title')) or '').strip()
        kind_raw = str(get_cell(raw_row, mapping.get('kind')) or '').strip()
        objective_raw = str(get_cell(raw_row, mapping.get('objective')) or '').strip()

        out_rows.append({
            'date': date_str,
            'month': date_str[:7],
            'title': title,
            'format': normalize_format(get_cell(raw_row, mapping.get('format')), warnings),
            'objective': objective_raw or 'Unlabelled',
            'topic': normalize_topic(get_cell(raw_row, mapping.get('topic'))),
            'kind': kind_raw or 'New',
            'impressions': clean_num(impressions),
            'engagements': clean_num(engagements),
            'profile_views': clean_num(safe_number(get_cell(raw_row, mapping.get('profile_views')))),
            'followers_gained': clean_num(safe_number(get_cell(raw_row, mapping.get('followers_gained')))),
            'inbound_leads': clean_num(safe_number(get_cell(raw_row, mapping.get('inbound_leads')))),
            'video_watch_secs': clean_num(parse_watch_time(get_cell(raw_row, mapping.get('video_watch_secs')))),
            'avg_watch_secs': clean_num(parse_watch_time(get_cell(raw_row, mapping.get('avg_watch_secs')))),
            'series': 'Benchmark (Chris tab)' if benchmark else 'Your posts',
        })

    return out_rows, skipped


# ---------------------------------------------------------------------------
# Input sources
# ---------------------------------------------------------------------------

def parse_combined_csv(text):
    """Combined export format: '## Sheet name: <name>' starts a new tab's CSV block."""
    sections = {}
    current_name = None
    current_lines = []

    def flush():
        if current_name is not None:
            content = '\n'.join(current_lines)
            rows = [row for row in csv.reader(io.StringIO(content)) if any(c.strip() for c in row)]
            sections[current_name] = rows

    for line in text.splitlines():
        m = re.match(r'^##\s*Sheet name:\s*(.+?)\s*$', line)
        if m:
            flush()
            current_name = m.group(1)
            current_lines = []
        elif current_name is not None:
            current_lines.append(line)
    flush()
    return sections


def load_tabs_from_csv(path):
    text = Path(path).read_text(encoding='utf-8')
    return parse_combined_csv(text)


class ApiKeyAuth:
    def __init__(self, api_key):
        self.api_key = api_key

    def get(self, url, params=None):
        import urllib.parse
        import urllib.request
        query = dict(params or {})
        query['key'] = self.api_key
        full_url = f'{url}?{urllib.parse.urlencode(query, doseq=True)}'
        with urllib.request.urlopen(full_url, timeout=30) as resp:
            return json.loads(resp.read().decode('utf-8'))


class ServiceAccountAuth:
    def __init__(self, service_account_json):
        from google.auth.transport.requests import Request
        from google.oauth2 import service_account

        info = json.loads(service_account_json)
        creds = service_account.Credentials.from_service_account_info(
            info, scopes=['https://www.googleapis.com/auth/spreadsheets.readonly'])
        creds.refresh(Request())
        self.token = creds.token

    def get(self, url, params=None):
        import requests
        resp = requests.get(url, params=params, headers={'Authorization': f'Bearer {self.token}'}, timeout=30)
        resp.raise_for_status()
        return resp.json()


def list_sheet_titles(sheet_id, auth):
    data = auth.get(f'{SHEETS_API_BASE}/{sheet_id}', {'fields': 'sheets.properties.title'})
    return [s['properties']['title'] for s in data.get('sheets', [])]


def fetch_tabs_from_api(sheet_id, auth):
    all_titles = list_sheet_titles(sheet_id, auth)
    selected = [t for t in all_titles if is_selected_tab(t)]
    if not selected:
        raise SyncError('No tabs matched "Analytics" (excluding any titled TEMPLATE)')

    ranges = [f"'{t}'!A:Z" for t in selected]
    data = auth.get(f'{SHEETS_API_BASE}/{sheet_id}/values:batchGet', {
        'ranges': ranges,
        'valueRenderOption': 'UNFORMATTED_VALUE',
        'dateTimeRenderOption': 'FORMATTED_STRING',
    })

    tabs = {}
    for title, value_range in zip(selected, data.get('valueRanges', [])):
        tabs[title] = value_range.get('values', [])
    return tabs


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def atomic_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + '.tmp')
    tmp.write_text(content, encoding='utf-8')
    tmp.replace(path)


def reorder(row):
    return {key: row[key] for key in FIELD_ORDER}


def run(args):
    if args.from_csv:
        tabs = load_tabs_from_csv(args.from_csv)
        selected_tabs = {name: rows for name, rows in tabs.items() if is_selected_tab(name)}
    else:
        sheet_id = os.environ.get('GOOGLE_SHEET_ID')
        if not sheet_id:
            raise SyncError('GOOGLE_SHEET_ID is not set')
        sa_json = os.environ.get('GOOGLE_SERVICE_ACCOUNT_JSON')
        api_key = os.environ.get('GOOGLE_API_KEY')
        if sa_json:
            auth = ServiceAccountAuth(sa_json)
        elif api_key:
            auth = ApiKeyAuth(api_key)
        else:
            raise SyncError('Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_API_KEY')
        selected_tabs = fetch_tabs_from_api(sheet_id, auth)

    if not selected_tabs:
        raise SyncError('No tabs selected (looking for titles containing "Analytics", excluding "TEMPLATE")')

    warnings = []
    all_rows = []
    per_tab_summary = []
    total_skipped = 0

    for tab_name, rows in selected_tabs.items():
        tab_rows, skipped = build_rows(tab_name, rows, warnings)
        all_rows.extend(tab_rows)
        total_skipped += skipped
        per_tab_summary.append((tab_name, len(tab_rows), skipped))

    if len(all_rows) == 0:
        raise SyncError('Zero rows resulted from the selected tabs')

    all_rows.sort(key=lambda r: (r['series'], r['date'], r['title']))
    for i, row in enumerate(all_rows, start=1):
        row['id'] = i
    final_rows = [reorder(r) for r in all_rows]

    own_rows = [r for r in final_rows if r['series'] == 'Your posts']
    benchmark_rows = [r for r in final_rows if r['series'] != 'Your posts']

    output_path = Path(args.output)
    existing_own_count = None
    old_content = None
    if output_path.exists():
        old_content = output_path.read_text(encoding='utf-8')
        try:
            existing_data = json.loads(old_content)
            existing_own_count = sum(1 for r in existing_data if r.get('series') == 'Your posts')
        except (ValueError, TypeError):
            existing_own_count = None

    if existing_own_count:
        drop_ratio = (existing_own_count - len(own_rows)) / existing_own_count
        if drop_ratio > 0.10:
            raise SyncError(
                f"'Your posts' row count dropped by {drop_ratio * 100:.1f}% "
                f"({existing_own_count} -> {len(own_rows)}); refusing to overwrite"
            )

    new_content = json.dumps(final_rows, indent=2, ensure_ascii=False) + '\n'
    new_hash = hashlib.sha256(new_content.encode('utf-8')).hexdigest()
    content_changed = old_content != new_content

    meta_path = Path(args.meta_output)
    old_meta = None
    if meta_path.exists():
        try:
            old_meta = json.loads(meta_path.read_text(encoding='utf-8'))
        except (ValueError, TypeError):
            old_meta = None

    now = datetime.now(timezone.utc)
    stale = True
    if old_meta and not content_changed:
        try:
            generated_at = datetime.fromisoformat(old_meta['generatedAt'].replace('Z', '+00:00'))
            stale = (now - generated_at) >= timedelta(days=14)
        except (KeyError, ValueError):
            stale = True

    own_dates = sorted(r['date'] for r in own_rows)
    new_meta = {
        'schemaVersion': 1,
        'generatedAt': now.strftime('%Y-%m-%dT%H:%M:%S.') + f'{now.microsecond // 1000:03d}Z'
        if (content_changed or stale or old_meta is None) else old_meta['generatedAt'],
        'contentHash': new_hash,
        'ownRows': len(own_rows),
        'benchmarkRows': len(benchmark_rows),
        'firstDate': own_dates[0] if own_dates else None,
        'lastDate': own_dates[-1] if own_dates else None,
        'tabs': sorted(selected_tabs.keys()),
    }

    summary_lines = [
        f"Tabs read: {', '.join(sorted(selected_tabs.keys()))}",
    ]
    for name, kept, skipped in per_tab_summary:
        summary_lines.append(f"  {name}: {kept} kept, {skipped} skipped")
    summary_lines.append(
        f"Total: {len(final_rows)} kept (own: {len(own_rows)}, benchmark: {len(benchmark_rows)}); "
        f"{total_skipped} skipped"
    )
    if existing_own_count is not None:
        summary_lines.append(f"New own posts since previous file: {max(0, len(own_rows) - existing_own_count)}")
    if warnings:
        summary_lines.append('Warnings:')
        for w in sorted(set(warnings)):
            summary_lines.append(f'  - {w}')

    summary_text = '\n'.join(summary_lines)
    print(summary_text)

    step_summary_path = os.environ.get('GITHUB_STEP_SUMMARY')
    if step_summary_path:
        with open(step_summary_path, 'a', encoding='utf-8') as f:
            f.write(summary_text + '\n')

    if args.dry_run:
        print('(dry run: no files written)')
        return {'summary': summary_text, 'wrote': False, 'content_changed': content_changed}

    if content_changed:
        atomic_write(output_path, new_content)
    if content_changed or stale or not meta_path.exists():
        atomic_write(meta_path, json.dumps(new_meta, indent=2) + '\n')

    return {'summary': summary_text, 'wrote': True, 'content_changed': content_changed, 'meta': new_meta}


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true', help='Print the summary; write nothing.')
    parser.add_argument('--from-csv', help='Offline mode: read the combined export CSV instead of the API.')
    parser.add_argument('--output', default='data/linkedin_posts.json')
    parser.add_argument('--meta-output', default='data/meta.json')
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    try:
        run(args)
        return 0
    except SyncError as err:
        print(f'ERROR: {err}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())

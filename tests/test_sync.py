import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))

import sync_sheet  # noqa: E402

FIXTURE = ROOT / 'tests' / 'fixtures' / 'sheet_export.csv'


class UnitHelpers(unittest.TestCase):
    def test_parse_date_formats(self):
        self.assertEqual(sync_sheet.parse_date('Nov 3, 2026'), '2026-11-03')
        self.assertEqual(sync_sheet.parse_date('November 3, 2026'), '2026-11-03')
        self.assertEqual(sync_sheet.parse_date('2026-11-03'), '2026-11-03')
        self.assertIsNone(sync_sheet.parse_date(''))
        self.assertIsNone(sync_sheet.parse_date(None))
        self.assertIsNone(sync_sheet.parse_date('not a date'))

    def test_parse_watch_time(self):
        self.assertEqual(sync_sheet.parse_watch_time('15m 56s'), 956)
        self.assertEqual(sync_sheet.parse_watch_time('17s'), 17)
        self.assertEqual(sync_sheet.parse_watch_time('1h 2m 3s'), 3723)
        self.assertIsNone(sync_sheet.parse_watch_time(''))
        self.assertIsNone(sync_sheet.parse_watch_time(None))

    def test_normalize_format_label_normalisation(self):
        warnings = []
        self.assertEqual(sync_sheet.normalize_format('Image - Perosonal Image', warnings), 'Image - Personal')
        self.assertEqual(sync_sheet.normalize_format('VIdeo - SF', warnings), 'Video - Short')
        self.assertEqual(sync_sheet.normalize_format('Video - LF', warnings), 'Video - Long')
        self.assertEqual(sync_sheet.normalize_format('video - interview', warnings), 'Video - Interview')
        self.assertEqual(sync_sheet.normalize_format('', warnings), 'Unlabelled')
        self.assertEqual(sync_sheet.normalize_format('Some New Format', warnings), 'Some New Format')
        self.assertTrue(any('Some New Format' in w for w in warnings))

    def test_normalize_topic(self):
        self.assertEqual(sync_sheet.normalize_topic('Mix - general'), 'Mix')
        self.assertEqual(sync_sheet.normalize_topic('Business'), 'Business')
        self.assertEqual(sync_sheet.normalize_topic(''), 'Unlabelled')

    def test_is_selected_tab(self):
        self.assertTrue(sync_sheet.is_selected_tab('Analytics 2026'))
        self.assertFalse(sync_sheet.is_selected_tab('Analytics TEMPLATE'))
        self.assertFalse(sync_sheet.is_selected_tab('Notes'))

    def test_header_mapping_handles_reordered_and_missing_columns(self):
        header = ['Engagements', 'Date', 'Impressions']  # reordered, several columns missing
        mapping = sync_sheet.map_headers(header)
        self.assertEqual(mapping, {'engagements': 0, 'date': 1, 'impressions': 2})


class BuildRowsTests(unittest.TestCase):
    def setUp(self):
        self.tabs = sync_sheet.load_tabs_from_csv(FIXTURE)

    def test_fixture_loads_three_tabs(self):
        self.assertIn('Analytics 2026', self.tabs)
        self.assertIn('Chris', self.tabs)
        self.assertIn('Analytics TEMPLATE', self.tabs)

    def test_analytics_tab_keeps_valid_rows_and_skips_invalid(self):
        warnings = []
        rows, skipped = sync_sheet.build_rows('Analytics 2026', self.tabs['Analytics 2026'], warnings)
        # Row 3 (blank impressions) and Row 4 (non-numeric engagements) are both skipped.
        self.assertEqual(skipped, 2)
        self.assertEqual(len(rows), 2)

        first = next(r for r in rows if r['title'] == 'Hello world post')
        self.assertEqual(first['date'], '2026-11-03')
        self.assertEqual(first['format'], 'Image - Personal')
        self.assertEqual(first['impressions'], 500)
        self.assertEqual(first['engagements'], 20)
        self.assertEqual(first['profile_views'], 10)
        self.assertEqual(first['followers_gained'], 2)
        self.assertEqual(first['video_watch_secs'], 956)
        self.assertEqual(first['avg_watch_secs'], 45)
        self.assertEqual(first['inbound_leads'], 0)
        self.assertEqual(first['series'], 'Your posts')

        second = next(r for r in rows if r['title'] == 'Second post')
        self.assertEqual(second['format'], 'Video - Short')
        self.assertEqual(second['topic'], 'Mix')
        self.assertEqual(second['kind'], 'Re-post')
        self.assertIsNone(second['profile_views'])
        self.assertIsNone(second['video_watch_secs'])
        self.assertEqual(second['avg_watch_secs'], 17)

    def test_chris_tab_is_benchmark_series(self):
        rows, _ = sync_sheet.build_rows('Chris', self.tabs['Chris'], [])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['series'], 'Benchmark (Chris tab)')

    def test_template_tab_is_excluded_from_selection(self):
        selected = {name: rows for name, rows in self.tabs.items() if sync_sheet.is_selected_tab(name)}
        self.assertNotIn('Analytics TEMPLATE', selected)
        self.assertIn('Analytics 2026', selected)


class SafetyRuleTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.out_path = Path(self.tmpdir.name) / 'linkedin_posts.json'
        self.meta_path = Path(self.tmpdir.name) / 'meta.json'

    def run_sync(self, csv_path, output=None, meta_output=None):
        return sync_sheet.main(['--from-csv', str(csv_path), '--output', str(output or self.out_path),
                                 '--meta-output', str(meta_output or self.meta_path)])

    def write_csv(self, text):
        path = Path(self.tmpdir.name) / 'input.csv'
        path.write_text(text, encoding='utf-8')
        return path

    def test_zero_rows_exits_nonzero_and_writes_nothing(self):
        csv_path = self.write_csv(
            '## Sheet name: Analytics Empty\nDate,Impressions,Engagements\n'
        )
        code = self.run_sync(csv_path)
        self.assertEqual(code, 1)
        self.assertFalse(self.out_path.exists())

    def test_missing_header_exits_nonzero(self):
        csv_path = self.write_csv(
            '## Sheet name: Analytics Broken\nTitle,Engagements\nSomething,5\n'
        )
        code = self.run_sync(csv_path)
        self.assertEqual(code, 1)
        self.assertFalse(self.out_path.exists())

    def test_more_than_10_percent_drop_is_refused_and_leaves_files_untouched(self):
        # First sync: establish a baseline of 10 "Your posts" rows.
        lines = ['## Sheet name: Analytics Baseline', 'Date,Impressions,Engagements,Hook / Title']
        for i in range(10):
            lines.append(f'2026-01-{i + 1:02d},{100 + i},{10 + i},Post {i}')
        baseline_csv = self.write_csv('\n'.join(lines) + '\n')
        code = self.run_sync(baseline_csv)
        self.assertEqual(code, 0)
        baseline_content = self.out_path.read_text(encoding='utf-8')

        # Second sync: only 5 rows (a 50% drop) should be refused.
        lines2 = ['## Sheet name: Analytics Baseline', 'Date,Impressions,Engagements,Hook / Title']
        for i in range(5):
            lines2.append(f'2026-01-{i + 1:02d},{100 + i},{10 + i},Post {i}')
        dropped_csv = self.write_csv('\n'.join(lines2) + '\n')
        code2 = self.run_sync(dropped_csv)

        self.assertEqual(code2, 1)
        self.assertEqual(self.out_path.read_text(encoding='utf-8'), baseline_content)

    def test_unchanged_content_does_not_rewrite_the_file(self):
        code = self.run_sync(FIXTURE)
        self.assertEqual(code, 0)
        mtime1 = self.out_path.stat().st_mtime_ns
        content1 = self.out_path.read_text(encoding='utf-8')

        code2 = self.run_sync(FIXTURE)
        self.assertEqual(code2, 0)
        mtime2 = self.out_path.stat().st_mtime_ns
        content2 = self.out_path.read_text(encoding='utf-8')

        self.assertEqual(content1, content2)
        self.assertEqual(mtime1, mtime2)  # file was never reopened for writing

    def test_dry_run_writes_nothing(self):
        args = sync_sheet.parse_args(['--from-csv', str(FIXTURE), '--dry-run',
                                       '--output', str(self.out_path), '--meta-output', str(self.meta_path)])
        result = sync_sheet.run(args)
        self.assertFalse(result['wrote'])
        self.assertFalse(self.out_path.exists())
        self.assertFalse(self.meta_path.exists())


if __name__ == '__main__':
    unittest.main()

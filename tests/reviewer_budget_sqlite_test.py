"""Actual SQLite concurrency checks for the reviewer admission trigger."""
import concurrent.futures
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest


class ReviewerBudgetTest(unittest.TestCase):
    def test_parallel_requests_cannot_exceed_lifetime_budget(self):
        with tempfile.TemporaryDirectory() as directory:
            database = str(Path(directory) / 'budget.sqlite')
            with closing(sqlite3.connect(database)) as connection, connection:
                connection.execute('CREATE TABLE users (id TEXT PRIMARY KEY)')
                connection.executescript((Path(__file__).resolve().parents[1] / 'migrations/0029_reviewer_access.sql').read_text())
                connection.execute("INSERT INTO users VALUES ('reviewer')")
                connection.execute("INSERT INTO reviewer_accounts(user_id, credential_hash, enabled) VALUES ('reviewer', ?, 1)", ('a' * 64,))

            def reserve(index):
                try:
                    with closing(sqlite3.connect(database, timeout=10)) as connection, connection:
                        connection.execute('INSERT INTO reviewer_cost_reservations VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
                                           ('reviewer', str(index), 'b' * 64, 1_000_000))
                    return True
                except sqlite3.IntegrityError:
                    return False

            with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
                results = list(executor.map(reserve, range(20)))
            self.assertEqual(sum(results), 5)
            self.assertFalse(reserve(0))  # duplicate cannot initiate another upstream call
            with closing(sqlite3.connect(database)) as connection, connection:
                self.assertEqual(connection.execute('SELECT SUM(upper_bound_eur_micros) FROM reviewer_cost_reservations').fetchone()[0], 5_000_000)
                connection.execute("UPDATE reviewer_accounts SET enabled = 0")
            self.assertFalse(reserve(100))


if __name__ == '__main__':
    unittest.main()

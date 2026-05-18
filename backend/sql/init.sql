CREATE TABLE IF NOT EXISTS employee_submissions (
  name TEXT NOT NULL,
  department TEXT NOT NULL,
  email TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  submitted_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_employee_submissions_submitted_at
  ON employee_submissions (submitted_at DESC);

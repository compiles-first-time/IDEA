"""
PostToolUse hook: warns if code written to src/ or tests/ lacks SR references.

Called by Claude Code after every successful Edit/Write/NotebookEdit on src/ or tests/.
Receives JSON on stdin with tool_input.file_path and tool_response.
Exit 0 always (PostToolUse hooks cannot undo the write — only warn).
Prints a warning to stdout if the file does not contain an SR_ reference pattern.

This is the soft enforcement layer. The hard enforcement is in the Git
pre-commit hook (.git/hooks/pre-commit) which blocks commits with files
in src/ or tests/ that have no SR references.
"""
import json
import re
import sys
import os

SR_PATTERN = re.compile(r"SR_[A-Z][A-Z0-9]*_\d+")

try:
    data = json.load(sys.stdin)
except (json.JSONDecodeError, EOFError):
    sys.exit(0)

tool_input = data.get("tool_input", {})
file_path = tool_input.get("file_path", "") or tool_input.get("path", "") or ""

fp_norm = file_path.replace("\\", "/")

# Only check files in src/ or tests/
if "/src/" not in fp_norm and "/tests/" not in fp_norm:
    sys.exit(0)

# Skip .gitkeep files
if os.path.basename(fp_norm) == ".gitkeep":
    sys.exit(0)

# Read the file and check for SR references
try:
    with open(file_path, encoding="utf-8", errors="replace") as f:
        content = f.read()
except (OSError, IOError):
    # If we cannot read the file, do not warn
    sys.exit(0)

if not SR_PATTERN.search(content):
    print(
        f"WARNING: {file_path} has no SR_ reference.\n"
        f"Every file in src/ and tests/ must trace to at least one SR.\n"
        f"Add a comment like: // Implements SR_GOV_01\n"
        f"The Git pre-commit hook will BLOCK commits with files missing SR references.",
        file=sys.stdout,
    )

# Always exit 0 — PostToolUse hooks cannot block after the fact
sys.exit(0)

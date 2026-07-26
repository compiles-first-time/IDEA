"""
PreToolUse hook: blocks writes to read-only directories.

Called by Claude Code before every Edit/Write/NotebookEdit tool use.
Receives JSON on stdin with tool_input.file_path.
Exit 0 = allow.  Exit 2 = block (stderr shown to Claude as the reason).

Protected paths (BLOCKED on any write attempt):
  - spec/           — expanded specs are the build contract (changes in 002-spec-expansion)
  - validation/*.xlsx — workbook is the validation contract (changes in working/)
  - CONVENTIONS.md  — reference, copied from 001/
  - GLOSSARY.md     — reference, copied from 001/
  - DECISION-INDEX.md — reference, copied from 001/
"""
import json
import sys
import os

PROTECTED_DIRS = ["spec/", "spec\\"]
PROTECTED_FILES = [
    "Platform_Requirements_and_Exceptions.xlsx",
    "CONVENTIONS.md",
    "GLOSSARY.md",
    "DECISION-INDEX.md",
]

try:
    data = json.load(sys.stdin)
except (json.JSONDecodeError, EOFError):
    # If we cannot parse the input, allow the action (fail-open for safety)
    sys.exit(0)

tool_input = data.get("tool_input", {})
file_path = tool_input.get("file_path", "") or tool_input.get("path", "") or ""

# Normalize to forward slashes for comparison
fp_norm = file_path.replace("\\", "/")

# Check protected directories
for d in PROTECTED_DIRS:
    d_norm = d.replace("\\", "/")
    if d_norm in fp_norm:
        print(
            f"BLOCKED: {file_path} is in a read-only directory.\n"
            f"Spec changes happen in explore/002-spec-expansion/, "
            f"not in the build directory.\n"
            f"If a spec is wrong, HALT and report to Nick.",
            file=sys.stderr,
        )
        sys.exit(2)

# Check protected files by basename
basename = os.path.basename(fp_norm)
for pf in PROTECTED_FILES:
    if basename == pf:
        print(
            f"BLOCKED: {basename} is a read-only reference file.\n"
            f"Workbook changes happen in D:\\Projects\\IDEA\\working\\.\n"
            f"Reference files (CONVENTIONS, GLOSSARY, DECISION-INDEX) "
            f"are copied from 001/ and must not be modified in build/.",
            file=sys.stderr,
        )
        sys.exit(2)

sys.exit(0)

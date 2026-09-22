"""Ensures `roof_watcher` is importable regardless of where pytest is
invoked from, without requiring an editable install."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

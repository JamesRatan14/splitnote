# Vercel entry point: every path is rewritten here (see vercel.json).
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from splitnote_ai.main import app  # noqa: E402

__all__ = ["app"]

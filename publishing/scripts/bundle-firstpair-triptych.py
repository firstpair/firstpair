#!/usr/bin/env python3
"""Bundle FirstPair Triptych (kept for existing callers and their --check).

The work is done by the generic ``bundle-obsidian-plugin.py``, which embeds
every relative module the plugin reaches, shared ones included.
"""

from __future__ import annotations

import runpy
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parent / "vault" / "plugin" / "firstpair-triptych"

if __name__ == "__main__":
    sys.argv = [str(HERE / "bundle-obsidian-plugin.py"), str(PLUGIN), *sys.argv[1:]]
    runpy.run_path(str(HERE / "bundle-obsidian-plugin.py"), run_name="__main__")

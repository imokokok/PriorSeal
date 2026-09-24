#!/usr/bin/env python3
"""Compatibility launcher for the frozen WAK bundle documentation."""

import os
import sys
from pathlib import Path


SCRIPT = Path(__file__).with_suffix(".mjs")
os.execvp("node", ("node", str(SCRIPT), *sys.argv[1:]))

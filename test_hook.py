#!/usr/bin/env python3

import sys
import json
import os
from datetime import datetime

# Log all hook calls to a file for debugging
log_file = "/Users/leahuriarte/synapse/hook_debug.log"

try:
    stdin_data = sys.stdin.read()

    with open(log_file, "a") as f:
        f.write(f"\n=== Hook called at {datetime.now().isoformat()} ===\n")
        f.write(f"Working directory: {os.getcwd()}\n")
        f.write(f"Input data: {stdin_data}\n")
        f.write("=" * 50 + "\n")

    # Always pass through the input
    print(stdin_data, end='')

except Exception as e:
    with open(log_file, "a") as f:
        f.write(f"ERROR: {e}\n")
    # Always pass through input on error
    if 'stdin_data' in locals():
        print(stdin_data, end='')
    else:
        print('')

sys.exit(0)
#!/bin/bash
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Compile if missing or source changed
if [[ ! -x ./clippy-pet ]] || [[ clippy-pet.swift -nt clippy-pet ]]; then
    echo "Compiling clippy-pet..."
    swiftc -O clippy-pet.swift -o clippy-pet
fi

# Ensure frames exist
if [[ ! -d assets/frames ]] || [[ -z "$(ls -A assets/frames 2>/dev/null)" ]]; then
    echo "Extracting frames..."
    python3 extract_frames.py
fi

exec ./clippy-pet

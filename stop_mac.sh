#!/bin/bash

echo "========================================"
echo "  Stopping 3D Surface Measurement UI"
echo "========================================"
echo ""

# Kill processes by port
lsof -ti:8000 | xargs kill -9 2>/dev/null
lsof -ti:5173 | xargs kill -9 2>/dev/null

echo "  All processes stopped."
echo ""

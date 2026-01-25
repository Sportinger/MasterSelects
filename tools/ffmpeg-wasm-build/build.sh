#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================="
echo "FFmpeg WASM Custom Build - Full Suite"
echo "=========================================="
echo ""
echo "This will build FFmpeg with:"
echo "  - ProRes (prores_ks)"
echo "  - HAP / HAP Q / HAP Alpha"
echo "  - DNxHR (all profiles)"
echo "  - FFV1 (lossless archival)"
echo "  - x264 (H.264)"
echo "  - VP9"
echo "  - Audio: AAC, MP3, Opus, Vorbis, FLAC, ALAC, PCM"
echo "  - Image: PNG, TIFF, DPX, WebP, MJPEG"
echo ""
echo "Estimated time: 25-45 minutes (no cache)"
echo "=========================================="
echo ""

# Copy build script to build context
cp build/build-wasm.sh .

# Build the Docker image with --no-cache to ensure all pkg-config files are created
echo "Step 1/3: Building Docker image with all dependencies..."
echo "(Using --no-cache for clean build)"
docker build --no-cache -t ffmpeg-wasm-builder .

# Create output directory
mkdir -p dist

# Run the build
echo ""
echo "Step 2/3: Creating WASM module..."
docker run --rm -v "$SCRIPT_DIR/dist:/dist" ffmpeg-wasm-builder

# Check output
echo ""
echo "Step 3/3: Verifying output..."
if [ -f "dist/ffmpeg-core.js" ] && [ -f "dist/ffmpeg-core.wasm" ]; then
    echo ""
    echo "=========================================="
    echo "SUCCESS! FFmpeg WASM built successfully"
    echo "=========================================="
    echo ""
    echo "Output files:"
    ls -lh dist/
    echo ""
    echo "Total size:"
    du -sh dist/
    echo ""
    echo "To use in MASterSelects, copy to public/ffmpeg/:"
    echo "  cp dist/* ../public/ffmpeg/"
else
    echo "ERROR: Build failed - output files not found"
    exit 1
fi

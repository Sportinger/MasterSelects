#!/usr/bin/env bash
# Generates synthetic MXF fixtures with native FFmpeg + ffprobe golden JSONs.
#   ./generate.sh small   -> tests/fixtures/mxf/*.mxf (256x128, 4 frames) + *.golden.json  (committed)
#   ./generate.sh bench   (MXF_W/MXF_H/SUFFIX=_4k for 4K) -> tools/mxf-fixtures/out/*.mxf (1080p/4K, 50 frames)           (gitignored)
set -euo pipefail
cd "$(dirname "$0")"
MODE="${1:-small}"
ROOT="$(cd ../.. && pwd)"

if [ "$MODE" = small ]; then
  OUT="$ROOT/tests/fixtures/mxf"; W=256; H=128; N=4; R=25
else
  OUT="${MXF_OUT:-$ROOT/tools/mxf-fixtures/out}"; W="${MXF_W:-1920}"; H="${MXF_H:-1080}"; N=50; R=25
fi
mkdir -p "$OUT"
SRC="testsrc2=size=${W}x${H}:rate=${R}"
AUD="sine=frequency=440:sample_rate=48000"

gen() { # name, extra input args, codec args, format, [audio args]
  local name="$1" fmt="$2"; shift 2
  ffmpeg -hide_banner -loglevel error -y -f lavfi -i "$SRC" -frames:v "$N" "$@" -f "$fmt" "$OUT/$name${SUFFIX:-}.mxf"
  ffprobe -v error -show_format -show_streams -show_packets -show_entries \
    packet=stream_index,pts,dts,duration,size,pos,flags -of json "$OUT/$name${SUFFIX:-}.mxf" > "$OUT/$name${SUFFIX:-}.golden.json"
}

# ProRes 422 HQ in MXF OP1a  (-> TurboRes)
gen prores_hq mxf -c:v prores_ks -profile:v 3 -pix_fmt yuv422p10le -an
# DNxHR HQ (1080p) / DNxHD needs fixed sizes -> DNxHR in OP1a and OP-Atom
gen dnxhr_hq_op1a mxf -c:v dnxhd -profile:v dnxhr_hq -pix_fmt yuv422p -an
gen dnxhr_hq_opatom mxf_opatom -c:v dnxhd -profile:v dnxhr_hq -pix_fmt yuv422p
# MPEG-2 4:2:2 long GOP 50 Mbit/s (XDCAM HD422 like)
gen mpeg2_422_lgop mxf -c:v mpeg2video -pix_fmt yuv422p -b:v 50M -maxrate 50M -minrate 50M -bufsize 17M -g 12 -bf 2 -an
# H.264 High 4:2:2 Intra 10-bit (XAVC-I like)
gen h264_422_intra10 mxf -c:v libx264 -profile:v high422 -pix_fmt yuv422p10le -x264-params keyint=1 -b:v 110M -an
# H.264 High 4:2:2 10-bit long GOP
gen h264_422_lgop10 mxf -c:v libx264 -profile:v high422 -pix_fmt yuv422p10le -g 12 -bf 2 -b:v 25M -an
# H.264 High 10 Intra
gen h264_high10_intra mxf -c:v libx264 -profile:v high10 -pix_fmt yuv420p10le -x264-params keyint=1 -b:v 100M -an

# Interlaced MPEG-2 (top field first)
gen mpeg2_422_interlaced mxf -c:v mpeg2video -pix_fmt yuv422p -b:v 50M -flags +ildct+ilme -top 1 -g 12 -bf 2 -an

# IMX50 / D10 (720x608, MPEG-2 4:2:2 Intra, 4ch AES3). D10 needs constant 250000-byte frames.
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "testsrc2=size=720x608:rate=25" -f lavfi -i "$AUD"   -frames:v "$N" -c:v mpeg2video -pix_fmt yuv422p -flags +ildct+low_delay -dc 10 -ps 1 -qmin 1 -qmax 3 -top 1 -g 1   -b:v 50000k -minrate 50000k -maxrate 50000k -bufsize 2000000 -rc_init_occupancy 2000000 -intra_vlc 1 -non_linear_quant 1   -c:a pcm_s24le -ar 48000 -ac 4 -shortest -f mxf_d10 "$OUT/imx50_d10.mxf"
ffprobe -v error -show_format -show_streams -show_packets -show_entries   packet=stream_index,pts,dts,duration,size,pos,flags -of json "$OUT/imx50_d10.mxf" > "$OUT/imx50_d10.golden.json"

# PCM audio variant with video (OP1a, 4 mono tracks)
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "$SRC" -f lavfi -i "$AUD" -frames:v "$N" \
  -c:v mpeg2video -pix_fmt yuv422p -b:v 50M -g 12 -bf 2 -c:a pcm_s24le -ar 48000 -ac 2 -shortest -f mxf "$OUT/mpeg2_422_pcm.mxf"
ffprobe -v error -show_format -show_streams -show_packets -show_entries \
  packet=stream_index,pts,dts,duration,size,pos,flags -of json "$OUT/mpeg2_422_pcm.mxf" > "$OUT/mpeg2_422_pcm.golden.json"

ls -la "$OUT" | awk '{print $5, $9}'

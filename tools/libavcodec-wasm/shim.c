// Minimal libavcodec decode shim for MasterSelects (LGPL build, no libavformat).
// API: dec_open / dec_send / dec_receive / dec_flush / dec_close + accessors.
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <libavcodec/avcodec.h>
#include <libavutil/imgutils.h>
#include <emscripten.h>

typedef struct { AVCodecContext *ctx; AVPacket *pkt; AVFrame *frame; } Dec;

EMSCRIPTEN_KEEPALIVE Dec *dec_open(const char *name, const uint8_t *extra, int extra_size, int threads) {
  const AVCodec *c = avcodec_find_decoder_by_name(name);
  if (!c) return NULL;
  Dec *d = calloc(1, sizeof(Dec));
  d->ctx = avcodec_alloc_context3(c);
  d->pkt = av_packet_alloc();
  d->frame = av_frame_alloc();
  d->ctx->thread_count = threads > 0 ? threads : 1;
  if (extra_size > 0) {
    d->ctx->extradata = av_mallocz(extra_size + AV_INPUT_BUFFER_PADDING_SIZE);
    memcpy(d->ctx->extradata, extra, extra_size);
    d->ctx->extradata_size = extra_size;
  }
  if (avcodec_open2(d->ctx, c, NULL) < 0) { avcodec_free_context(&d->ctx); free(d); return NULL; }
  return d;
}

EMSCRIPTEN_KEEPALIVE int dec_send(Dec *d, const uint8_t *data, int size, double pts) {
  if (!data) return avcodec_send_packet(d->ctx, NULL); // drain
  av_packet_unref(d->pkt);
  if (av_new_packet(d->pkt, size) < 0) return -1;
  memcpy(d->pkt->data, data, size);
  d->pkt->pts = (int64_t)pts;
  return avcodec_send_packet(d->ctx, d->pkt);
}

// 0 = frame ready, AVERROR(EAGAIN) = need input, AVERROR_EOF = drained
EMSCRIPTEN_KEEPALIVE int dec_receive(Dec *d) { av_frame_unref(d->frame); return avcodec_receive_frame(d->ctx, d->frame); }
EMSCRIPTEN_KEEPALIVE void dec_flush(Dec *d) { avcodec_flush_buffers(d->ctx); }
EMSCRIPTEN_KEEPALIVE void dec_close(Dec *d) { if (!d) return; av_frame_free(&d->frame); av_packet_free(&d->pkt); avcodec_free_context(&d->ctx); free(d); }

EMSCRIPTEN_KEEPALIVE int dec_width(Dec *d) { return d->frame->width; }
EMSCRIPTEN_KEEPALIVE int dec_height(Dec *d) { return d->frame->height; }
EMSCRIPTEN_KEEPALIVE int dec_pix_fmt(Dec *d) { return d->frame->format; }
EMSCRIPTEN_KEEPALIVE double dec_pts(Dec *d) { return (double)d->frame->pts; }
EMSCRIPTEN_KEEPALIVE int dec_interlaced(Dec *d) { return (d->frame->flags & AV_FRAME_FLAG_INTERLACED) ? 1 : 0; }
EMSCRIPTEN_KEEPALIVE int dec_tff(Dec *d) { return (d->frame->flags & AV_FRAME_FLAG_TOP_FIELD_FIRST) ? 1 : 0; }
EMSCRIPTEN_KEEPALIVE uint8_t *dec_plane(Dec *d, int i) { return d->frame->data[i]; }
EMSCRIPTEN_KEEPALIVE int dec_stride(Dec *d, int i) { return d->frame->linesize[i]; }
EMSCRIPTEN_KEEPALIVE int dec_pix_fmt_yuv422p10() { return AV_PIX_FMT_YUV422P10LE; }
EMSCRIPTEN_KEEPALIVE int dec_pix_fmt_yuv422p() { return AV_PIX_FMT_YUV422P; }
EMSCRIPTEN_KEEPALIVE int dec_pix_fmt_yuv420p10() { return AV_PIX_FMT_YUV420P10LE; }
EMSCRIPTEN_KEEPALIVE int dec_pix_fmt_yuv420p() { return AV_PIX_FMT_YUV420P; }
EMSCRIPTEN_KEEPALIVE uint8_t *dec_malloc(int n) { return malloc(n); }
EMSCRIPTEN_KEEPALIVE void dec_free(uint8_t *p) { free(p); }

// h2645_sei.o references the AOM film-grain cleanup, but aom_film_grain.c is only built with HEVC.
// AV1 film-grain SEI never occurs in the MPEG-2/VC-3/H.264 paths, so nothing is ever allocated.
void ff_aom_uninit_film_grain_params(void *params) { (void)params; }

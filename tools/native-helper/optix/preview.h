#pragma once
#include "optix_host.h"
#include <memory>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

// One long-lived context, pipeline and GAS. The helper owns the fixed job directory
// and sends bounded commands over stdin; no browser-supplied file names reach here.
struct PreviewScene {
  Snapshot scene;
  std::unique_ptr<Buffer> fibers, materials, lights, bounds, accel, temporary, pixels, depth;
  OptixTraversableHandle handle = 0;
  uint32_t width = 0, height = 0, samples = 0;
  size_t cursor = 0;
  struct Tile {
    uint32_t x, y, w, h;
  };
  std::vector<Tile> tiles;
  double buildMs = 0;

  void load(Pipeline &pipeline, const std::filesystem::path &root) {
    Snapshot incoming = readSnapshot((root / "scene.mspx").string().c_str());
    bool sameSize = fibers && incoming.fibers.size() == scene.fibers.size();
    bool sameGeometry = sameSize && std::memcmp(incoming.fibers.data(), scene.fibers.data(),
                                                incoming.fibers.size() * sizeof(Fiber)) == 0;
    scene = std::move(incoming);
    materials = std::make_unique<Buffer>(scene.materials.size() * sizeof(Material));
    lights = std::make_unique<Buffer>(scene.lights.size() * sizeof(Light));
    materials->upload(scene.materials.data(), scene.materials.size() * sizeof(Material));
    lights->upload(scene.lights.data(), scene.lights.size() * sizeof(Light));
    buildMs = 0;
    if (!sameGeometry) {
      std::vector<OptixAabb> aabbs;
      aabbs.reserve(scene.fibers.size());
      for (const auto &f : scene.fibers)
        aabbs.push_back({std::min(f.a.x - f.a.w, f.b.x - f.b.w), std::min(f.a.y - f.a.w, f.b.y - f.b.w),
                         std::min(f.a.z - f.a.w, f.b.z - f.b.w), std::max(f.a.x + f.a.w, f.b.x + f.b.w),
                         std::max(f.a.y + f.a.w, f.b.y + f.b.w), std::max(f.a.z + f.a.w, f.b.z + f.b.w)});
      if (!sameSize) {
        fibers = std::make_unique<Buffer>(scene.fibers.size() * sizeof(Fiber));
        bounds = std::make_unique<Buffer>(aabbs.size() * sizeof(OptixAabb));
      }
      fibers->upload(scene.fibers.data(), scene.fibers.size() * sizeof(Fiber));
      bounds->upload(aabbs.data(), aabbs.size() * sizeof(OptixAabb));
      uint32_t flags = OPTIX_GEOMETRY_FLAG_DISABLE_ANYHIT;
      OptixBuildInput input{};
      input.type = OPTIX_BUILD_INPUT_TYPE_CUSTOM_PRIMITIVES;
      input.customPrimitiveArray.aabbBuffers = &bounds->pointer;
      input.customPrimitiveArray.numPrimitives = unsigned(aabbs.size());
      input.customPrimitiveArray.flags = &flags;
      input.customPrimitiveArray.numSbtRecords = 1;
      OptixAccelBuildOptions options{};
      options.buildFlags = OPTIX_BUILD_FLAG_PREFER_FAST_TRACE | OPTIX_BUILD_FLAG_ALLOW_UPDATE;
      options.operation = sameSize ? OPTIX_BUILD_OPERATION_UPDATE : OPTIX_BUILD_OPERATION_BUILD;
      OptixAccelBufferSizes sizes{};
      OPTIX(optixAccelComputeMemoryUsage(pipeline.context, &options, &input, 1, &sizes));
      if (!sameSize)
        accel = std::make_unique<Buffer>(sizes.outputSizeInBytes);
      size_t scratch = sameSize ? sizes.tempUpdateSizeInBytes : sizes.tempSizeInBytes;
      if (!temporary || temporary->bytes < scratch)
        temporary = std::make_unique<Buffer>(scratch);
      auto started = Clock::now();
      OPTIX(optixAccelBuild(pipeline.context, 0, &options, &input, 1, temporary->pointer, temporary->bytes,
                            accel->pointer, accel->bytes, &handle, nullptr, 0));
      CUDA(cudaDeviceSynchronize());
      buildMs = elapsed(started);
    }
    reset(scene.frame);
  }

  void reset(const Frame &frame) {
    require(frame.size.x >= 1 && frame.size.x <= 1920 && frame.size.y >= 1 && frame.size.y <= 1080 &&
                std::floor(frame.size.x) == frame.size.x && std::floor(frame.size.y) == frame.size.y,
            "Invalid preview size");
    require(frame.limits.x >= 1 && frame.limits.x <= 16 && frame.limits.y == scene.lights.size(),
            "Invalid preview limits");
    for (size_t i = 0; i < sizeof(Frame) / 4; i++) {
      if (i >= 76 && i < 88)
        continue;
      float value;
      std::memcpy(&value, reinterpret_cast<const char *>(&frame) + i * 4, 4);
      require(std::isfinite(value), "Non-finite preview frame");
    }
    scene.frame = frame;
    uint32_t w = uint32_t(frame.size.x), h = uint32_t(frame.size.y);
    if (width != w || height != h || !pixels) {
      width = w;
      height = h;
      pixels = std::make_unique<Buffer>(size_t(w) * h * sizeof(float4));
      depth = std::make_unique<Buffer>(size_t(w) * h * sizeof(float));
      tiles.clear();
      for (uint32_t y = 0; y < h; y += 32)
        for (uint32_t x = 0; x < w; x += 128)
          tiles.push_back({x, y, std::min(128u, w - x), std::min(32u, h - y)});
      auto distance = [w, h](const Tile &t) {
        double x = (t.x + t.w * .5) / w - .5, y = (t.y + t.h * .5) / h - .5;
        return x * x + y * y;
      };
      std::stable_sort(tiles.begin(), tiles.end(),
                       [&](const Tile &a, const Tile &b) { return distance(a) < distance(b); });
    }
    CUDA(cudaMemset(reinterpret_cast<void *>(pixels->pointer), 0, pixels->bytes));
    std::vector<float> clear(size_t(width) * height, 1);
    depth->upload(clear.data(), clear.size() * sizeof(float));
    samples = 0;
    cursor = 0;
  }

  void frame(Pipeline &pipeline, const OptixShaderBindingTable &sbt, Buffer &parameters,
             const std::filesystem::path &root, unsigned count, bool restart) {
    require(pixels && count >= 1 && count <= 4, "Preview scene missing or invalid sample batch");
    Frame next{};
    std::cin.read(reinterpret_cast<char *>(&next), sizeof(next));
    require(bool(std::cin), "Truncated preview frame");
    if (restart)
      reset(next);
    // With no reset the camera must remain unchanged; the browser identifies stale responses.
    else
      require(std::memcmp(&next, &scene.frame, sizeof(next)) == 0, "Changed preview frame requires reset");
    unsigned target = std::min(65536u, samples + count);
    LaunchParams p{handle,
                   reinterpret_cast<Fiber *>(fibers->pointer),
                   reinterpret_cast<Material *>(materials->pointer),
                   reinterpret_cast<Light *>(lights->pointer),
                   reinterpret_cast<float4 *>(pixels->pointer),
                   reinterpret_cast<float *>(depth->pointer),
                   scene.frame,
                   0,
                   0,
                   0,
                   0};
    auto started = Clock::now();
    double gpuMs = 0;
    cudaEvent_t begin, end;
    CUDA(cudaEventCreate(&begin));
    CUDA(cudaEventCreate(&end));
    while (samples < target) {
      auto tile = tiles[cursor];
      p.firstColumn = tile.x;
      p.firstRow = tile.y;
      p.sampleIndex = samples;
      parameters.upload(&p, sizeof(p));
      CUDA(cudaEventRecord(begin));
      OPTIX(optixLaunch(pipeline.pipeline, 0, parameters.pointer, sizeof(p), &sbt, tile.w, tile.h, 1));
      CUDA(cudaEventRecord(end));
      CUDA(cudaEventSynchronize(end));
      float ms;
      CUDA(cudaEventElapsedTime(&ms, begin, end));
      gpuMs += ms;
      if (++cursor == tiles.size()) {
        cursor = 0;
        samples++;
      }
      if (gpuMs >= 8 || elapsed(started) >= 20)
        break;
    }
    CUDA(cudaEventDestroy(begin));
    CUDA(cudaEventDestroy(end));
    double renderMs = elapsed(started);
    // One bounded batch in flight; leave GPU time for the browser and desktop.
    std::this_thread::sleep_for(std::chrono::milliseconds(4));
    std::vector<float4> image(size_t(width) * height);
    std::vector<float> depths(image.size());
    CUDA(cudaMemcpy(image.data(), reinterpret_cast<void *>(pixels->pointer), pixels->bytes,
                    cudaMemcpyDeviceToHost));
    CUDA(cudaMemcpy(depths.data(), reinterpret_cast<void *>(depth->pointer), depths.size() * sizeof(float),
                    cudaMemcpyDeviceToHost));
    for (size_t n = 0; n < tiles.size(); n++) {
      auto tile = tiles[n];
      float divisor = float(std::max(1u, samples + (n < cursor ? 1u : 0u)));
      for (uint32_t y = tile.y; y < tile.y + tile.h; y++)
        for (uint32_t x = tile.x; x < tile.x + tile.w; x++) {
          auto &c = image[size_t(y) * width + x];
          c.x /= divisor;
          c.y /= divisor;
          c.z /= divisor;
          c.w /= divisor;
          if (samples == 0 && n >= cursor)
            c.w = -1;
        }
    }
    std::ofstream output(root / "preview.rgba-depth", std::ios::binary);
    output.write(reinterpret_cast<char *>(image.data()), pixels->bytes);
    output.write(reinterpret_cast<char *>(depths.data()), depths.size() * sizeof(float));
    require(bool(output), "Cannot write preview image");
    output.close();
    std::cout << std::fixed << std::setprecision(6) << "{\"width\":" << width << ",\"height\":" << height
              << ",\"samples\":" << samples << ",\"partialSample\":" << double(cursor) / tiles.size()
              << ",\"segments\":" << scene.fibers.size() << ",\"gpuMs\":" << gpuMs
              << ",\"renderWallMs\":" << renderMs << ",\"buildMs\":" << buildMs
              << ",\"totalMs\":" << elapsed(started) << "}" << std::endl;
  }
};

inline int runPreview(const std::filesystem::path &root, const std::filesystem::path &ptx) {
#ifdef _WIN32
  _setmode(_fileno(stdin), _O_BINARY);
#endif
  int count = 0, selected = -1;
  size_t memory = 0;
  CUDA(cudaGetDeviceCount(&count));
  for (int i = 0; i < count; i++) {
    cudaDeviceProp p{};
    CUDA(cudaGetDeviceProperties(&p, i));
    if (p.major >= 7 && p.totalGlobalMem > memory) {
      selected = i;
      memory = p.totalGlobalMem;
    }
  }
  require(selected >= 0, "No supported NVIDIA GPU found");
  CUDA(cudaSetDevice(selected));
  Pipeline pipeline;
  pipeline.init(ptx);
  Buffer records(3 * sizeof(Record)), parameters(sizeof(LaunchParams));
  Record host[3]{};
  for (int i = 0; i < 3; i++)
    OPTIX(optixSbtRecordPackHeader(pipeline.groups[i], &host[i]));
  records.upload(host, sizeof(host));
  OptixShaderBindingTable sbt{};
  sbt.raygenRecord = records.pointer;
  sbt.missRecordBase = records.pointer + sizeof(Record);
  sbt.missRecordStrideInBytes = sizeof(Record);
  sbt.missRecordCount = 1;
  sbt.hitgroupRecordBase = records.pointer + 2 * sizeof(Record);
  sbt.hitgroupRecordStrideInBytes = sizeof(Record);
  sbt.hitgroupRecordCount = 1;
  PreviewScene scene;
  std::cout << "{\"ready\":true}" << std::endl;
  std::string line;
  while (std::getline(std::cin, line)) {
    require(line.size() < 64, "Invalid preview command");
    std::istringstream command(line);
    std::string action;
    command >> action;
    if (action == "load") {
      scene.load(pipeline, root);
      std::cout << "{\"loaded\":true}" << std::endl;
    } else if (action == "frame") {
      unsigned samples = 0, restart = 0;
      command >> samples >> restart;
      require(bool(command) && restart <= 1, "Invalid frame command");
      scene.frame(pipeline, sbt, parameters, root, samples, restart != 0);
    } else
      throw std::runtime_error("Unknown preview command");
  }
  return 0;
}

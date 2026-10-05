#include "optix_host.h"
#include "preview.h"

int main(int argc, char **argv) {
  try {
    if (argc == 3 && std::string(argv[1]) == "--preview")
      return runPreview(argv[2],
                        std::filesystem::absolute(argv[0]).parent_path() / "masterselects-optix.ptx");
    require(argc >= 4 && argc <= 5,
            "Usage: masterselects-optix snapshot.mspx output.rgba32f samples [albedo]");
    auto started = Clock::now();
    unsigned samples = unsigned(std::stoul(argv[3]));
    require(samples >= 1 && samples <= 64, "Samples must be 1..64");
    Snapshot scene = readSnapshot(argv[1]);
    double readMs = elapsed(started);
    auto initStart = Clock::now();
    // Prefer a discrete RTX-capable NVIDIA device; CUDA does not expose the integrated Intel adapter.
    int count = 0;
    CUDA(cudaGetDeviceCount(&count));
    require(count > 0, "No CUDA device found");
    int selected = -1;
    size_t memory = 0;
    cudaDeviceProp prop{};
    for (int i = 0; i < count; i++) {
      cudaDeviceProp p{};
      CUDA(cudaGetDeviceProperties(&p, i));
      if (p.major >= 7 && p.totalGlobalMem > memory) {
        selected = i;
        memory = p.totalGlobalMem;
        prop = p;
      }
    }
    require(selected >= 0, "No supported NVIDIA GPU found");
    CUDA(cudaSetDevice(selected));
    Pipeline pipeline;
    pipeline.init(std::filesystem::absolute(argv[0]).parent_path() / "masterselects-optix.ptx");
    double initMs = elapsed(initStart);
    auto uploadStart = Clock::now();
    std::vector<OptixAabb> bounds;
    bounds.reserve(scene.fibers.size());
    for (const auto &f : scene.fibers)
      bounds.push_back({std::min(f.a.x - f.a.w, f.b.x - f.b.w), std::min(f.a.y - f.a.w, f.b.y - f.b.w),
                        std::min(f.a.z - f.a.w, f.b.z - f.b.w), std::max(f.a.x + f.a.w, f.b.x + f.b.w),
                        std::max(f.a.y + f.a.w, f.b.y + f.b.w), std::max(f.a.z + f.a.w, f.b.z + f.b.w)});
    Buffer fibers(scene.fibers.size() * sizeof(Fiber)), materials(scene.materials.size() * sizeof(Material)),
        lights(scene.lights.size() * sizeof(Light)), aabbs(bounds.size() * sizeof(OptixAabb));
    fibers.upload(scene.fibers.data(), scene.fibers.size() * sizeof(Fiber));
    materials.upload(scene.materials.data(), scene.materials.size() * sizeof(Material));
    lights.upload(scene.lights.data(), scene.lights.size() * sizeof(Light));
    aabbs.upload(bounds.data(), bounds.size() * sizeof(OptixAabb));
    double uploadMs = elapsed(uploadStart);
    auto buildStart = Clock::now();
    uint32_t flags = OPTIX_GEOMETRY_FLAG_DISABLE_ANYHIT;
    OptixBuildInput input{};
    input.type = OPTIX_BUILD_INPUT_TYPE_CUSTOM_PRIMITIVES;
    input.customPrimitiveArray.aabbBuffers = &aabbs.pointer;
    input.customPrimitiveArray.numPrimitives = unsigned(bounds.size());
    input.customPrimitiveArray.flags = &flags;
    input.customPrimitiveArray.numSbtRecords = 1;
    OptixAccelBuildOptions build{};
    build.buildFlags = OPTIX_BUILD_FLAG_PREFER_FAST_TRACE;
    build.operation = OPTIX_BUILD_OPERATION_BUILD;
    OptixAccelBufferSizes sizes{};
    OPTIX(optixAccelComputeMemoryUsage(pipeline.context, &build, &input, 1, &sizes));
    Buffer temporary(sizes.tempSizeInBytes), accel(sizes.outputSizeInBytes);
    OptixTraversableHandle handle;
    OPTIX(optixAccelBuild(pipeline.context, 0, &build, &input, 1, temporary.pointer, temporary.bytes,
                          accel.pointer, accel.bytes, &handle, nullptr, 0));
    CUDA(cudaDeviceSynchronize());
    double buildMs = elapsed(buildStart);
    uint32_t width = uint32_t(scene.frame.size.x), height = uint32_t(scene.frame.size.y);
    size_t pixelBytes = size_t(width) * height * sizeof(float4);
    Buffer pixels(pixelBytes), parameterBuffer(sizeof(LaunchParams)), records(3 * sizeof(Record));
    CUDA(cudaMemset(reinterpret_cast<void *>(pixels.pointer), 0, pixelBytes));
    Record hostRecords[3]{};
    for (int i = 0; i < 3; i++)
      OPTIX(optixSbtRecordPackHeader(pipeline.groups[i], &hostRecords[i]));
    records.upload(hostRecords, sizeof(hostRecords));
    OptixShaderBindingTable sbt{};
    sbt.raygenRecord = records.pointer;
    sbt.missRecordBase = records.pointer + sizeof(Record);
    sbt.missRecordStrideInBytes = sizeof(Record);
    sbt.missRecordCount = 1;
    sbt.hitgroupRecordBase = records.pointer + 2 * sizeof(Record);
    sbt.hitgroupRecordStrideInBytes = sizeof(Record);
    sbt.hitgroupRecordCount = 1;
    LaunchParams params{handle,
                        reinterpret_cast<Fiber *>(fibers.pointer),
                        reinterpret_cast<Material *>(materials.pointer),
                        reinterpret_cast<Light *>(lights.pointer),
                        reinterpret_cast<float4 *>(pixels.pointer),
                        nullptr,
                        scene.frame,
                        0,
                        0,
                        argc == 5 ? 1u : 0u,
                        0};
    cudaEvent_t begin, end;
    CUDA(cudaEventCreate(&begin));
    CUDA(cudaEventCreate(&end));
    double gpuMs = 0;
    auto renderStart = Clock::now();
    uint32_t rows = 8;
    for (unsigned sample = 0; sample < samples; sample++)
      for (uint32_t y = 0; y < height;) {
        require(elapsed(started) < 110000, "Native render exceeded its 110-second limit");
        uint32_t bandRows = std::min(rows, height - y);
        params.firstRow = y;
        params.sampleIndex = sample;
        parameterBuffer.upload(&params, sizeof(params));
        CUDA(cudaEventRecord(begin));
        OPTIX(optixLaunch(pipeline.pipeline, 0, parameterBuffer.pointer, sizeof(params), &sbt, width,
                          bandRows, 1));
        CUDA(cudaEventRecord(end));
        CUDA(cudaEventSynchronize(end));
        float ms;
        CUDA(cudaEventElapsedTime(&ms, begin, end));
        gpuMs += ms;
        y += bandRows;
        // Aim for <= 8 ms kernels; one in flight, with desktop time between submissions.
        rows = std::clamp(uint32_t(std::max(1.f, std::floor(bandRows * 8.f / std::max(ms, .1f)))), 1u, 64u);
        std::this_thread::sleep_for(std::chrono::milliseconds(4));
      }
    double renderMs = elapsed(renderStart);
    CUDA(cudaEventDestroy(begin));
    CUDA(cudaEventDestroy(end));
    auto downloadStart = Clock::now();
    std::vector<float4> image(size_t(width) * height);
    CUDA(cudaMemcpy(image.data(), reinterpret_cast<void *>(pixels.pointer), pixelBytes,
                    cudaMemcpyDeviceToHost));
    for (auto &p : image) {
      p.x /= samples;
      p.y /= samples;
      p.z /= samples;
      p.w /= samples;
    }
    std::ofstream output(argv[2], std::ios::binary);
    require(bool(output), "Cannot open result file");
    output.write(reinterpret_cast<const char *>(image.data()), pixelBytes);
    require(bool(output), "Cannot write result file");
    output.close();
    double downloadMs = elapsed(downloadStart);
    std::cout << std::fixed << std::setprecision(3) << "{\"backend\":\"OptiX 9.1\",\"gpu\":\"" << prop.name
              << "\",\"width\":" << width << ",\"height\":" << height << ",\"samples\":" << samples
              << ",\"segments\":" << scene.fibers.size() << ",\"readMs\":" << readMs
              << ",\"initializationMs\":" << initMs << ",\"uploadMs\":" << uploadMs
              << ",\"buildMs\":" << buildMs << ",\"gpuMs\":" << gpuMs << ",\"renderWallMs\":" << renderMs
              << ",\"downloadMs\":" << downloadMs << ",\"totalMs\":" << elapsed(started) << "}\n";
    return 0;
  } catch (const std::exception &e) {
    std::cerr << e.what() << "\n";
    return 1;
  }
}

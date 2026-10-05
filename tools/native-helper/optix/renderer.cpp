#include "snapshot.h"
#include <chrono>
#include <cuda.h>
#include <filesystem>
#include <iomanip>
#include <iostream>
#include <optix_function_table_definition.h>
#include <optix_stack_size.h>
#include <optix_stubs.h>
#include <sstream>
#include <thread>

#define CUDA(call)                                                                                           \
  do {                                                                                                       \
    auto error = (call);                                                                                     \
    if (error != cudaSuccess)                                                                                \
      throw std::runtime_error(std::string(#call) + ": " + cudaGetErrorString(error));                       \
  } while (0)
#define OPTIX(call)                                                                                          \
  do {                                                                                                       \
    auto error = (call);                                                                                     \
    if (error != OPTIX_SUCCESS)                                                                              \
      throw std::runtime_error(std::string(#call) + ": " + optixGetErrorName(error));                        \
  } while (0)
using Clock = std::chrono::steady_clock;
double elapsed(Clock::time_point start) {
  return std::chrono::duration<double, std::milli>(Clock::now() - start).count();
}
struct Buffer {
  CUdeviceptr pointer = 0;
  size_t bytes = 0;
  explicit Buffer(size_t n) : bytes(std::max(size_t(16), n)) {
    CUDA(cudaMalloc(reinterpret_cast<void **>(&pointer), bytes));
  }
  ~Buffer() {
    if (pointer)
      cudaFree(reinterpret_cast<void *>(pointer));
  }
  void upload(const void *data, size_t n) {
    require(n <= bytes, "GPU upload overflow");
    if (n)
      CUDA(cudaMemcpy(reinterpret_cast<void *>(pointer), data, n, cudaMemcpyHostToDevice));
  }
  Buffer(const Buffer &) = delete;
  Buffer &operator=(const Buffer &) = delete;
};
struct alignas(OPTIX_SBT_RECORD_ALIGNMENT) Record {
  char header[OPTIX_SBT_RECORD_HEADER_SIZE];
};
struct Pipeline {
  OptixDeviceContext context = nullptr;
  OptixModule module = nullptr;
  OptixPipeline pipeline = nullptr;
  OptixProgramGroup groups[3]{};
  ~Pipeline() {
    if (pipeline)
      optixPipelineDestroy(pipeline);
    for (auto group : groups)
      if (group)
        optixProgramGroupDestroy(group);
    if (module)
      optixModuleDestroy(module);
    if (context)
      optixDeviceContextDestroy(context);
  }
  void init(const std::filesystem::path &ptxPath) {
    CUDA(cudaFree(nullptr));
    OPTIX(optixInit());
    OptixDeviceContextOptions options{};
    OPTIX(optixDeviceContextCreate(nullptr, &options, &context));
    std::ifstream file(ptxPath, std::ios::binary);
    require(bool(file), "Cannot read sibling masterselects-optix.ptx");
    std::string ptx((std::istreambuf_iterator<char>(file)), {});
    OptixModuleCompileOptions moduleOptions{};
    moduleOptions.optLevel = OPTIX_COMPILE_OPTIMIZATION_DEFAULT;
    moduleOptions.debugLevel = OPTIX_COMPILE_DEBUG_LEVEL_NONE;
    OptixPipelineCompileOptions pipelineOptions{};
    pipelineOptions.traversableGraphFlags = OPTIX_TRAVERSABLE_GRAPH_FLAG_ALLOW_SINGLE_GAS;
    pipelineOptions.numPayloadValues = 2;
    pipelineOptions.numAttributeValues = 0;
    pipelineOptions.pipelineLaunchParamsVariableName = "params";
    pipelineOptions.usesPrimitiveTypeFlags = OPTIX_PRIMITIVE_TYPE_FLAGS_CUSTOM;
    char log[4096];
    size_t logSize = sizeof(log);
    auto result = optixModuleCreate(context, &moduleOptions, &pipelineOptions, ptx.data(), ptx.size(), log,
                                    &logSize, &module);
    if (result != OPTIX_SUCCESS) {
      std::cerr.write(log, std::min(logSize, sizeof(log)));
      OPTIX(result);
    }
    OptixProgramGroupDesc descriptions[3]{};
    descriptions[0].kind = OPTIX_PROGRAM_GROUP_KIND_RAYGEN;
    descriptions[0].raygen = {module, "__raygen__path"};
    descriptions[1].kind = OPTIX_PROGRAM_GROUP_KIND_MISS;
    descriptions[1].miss = {module, "__miss__path"};
    descriptions[2].kind = OPTIX_PROGRAM_GROUP_KIND_HITGROUP;
    descriptions[2].hitgroup.moduleCH = module;
    descriptions[2].hitgroup.entryFunctionNameCH = "__closesthit__fiber";
    descriptions[2].hitgroup.moduleIS = module;
    descriptions[2].hitgroup.entryFunctionNameIS = "__intersection__fiber";
    OptixProgramGroupOptions groupOptions{};
    logSize = sizeof(log);
    OPTIX(optixProgramGroupCreate(context, descriptions, 3, &groupOptions, log, &logSize, groups));
    OptixPipelineLinkOptions link{};
    link.maxTraceDepth = 1;
    logSize = sizeof(log);
    OPTIX(optixPipelineCreate(context, &pipelineOptions, &link, groups, 3, log, &logSize, &pipeline));
    OptixStackSizes stack{};
    for (auto group : groups)
      OPTIX(optixUtilAccumulateStackSizes(group, &stack, pipeline));
    uint32_t traversal, state, continuation;
    OPTIX(optixUtilComputeStackSizes(&stack, 1, 0, 0, &traversal, &state, &continuation));
    OPTIX(optixPipelineSetStackSize(pipeline, traversal, state, continuation, 1));
  }
};

int main(int argc, char **argv) {
  try {
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
                        scene.frame,
                        0,
                        0,
                        argc == 5 ? 1u : 0u};
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

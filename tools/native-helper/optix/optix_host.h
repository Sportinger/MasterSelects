#pragma once
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

#pragma once
#include "scene.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <fstream>
#include <stdexcept>
#include <vector>

struct Snapshot {
  Frame frame;
  std::vector<Fiber> fibers;
  std::vector<Material> materials;
  std::vector<Light> lights;
};
inline void require(bool ok, const char *reason) {
  if (!ok)
    throw std::runtime_error(reason);
}
template <class T> std::vector<T> readRecords(std::ifstream &in, uint32_t bytes) {
  require(bytes % sizeof(T) == 0, "Invalid snapshot record size");
  std::vector<T> records(bytes / sizeof(T));
  in.read(reinterpret_cast<char *>(records.data()), bytes);
  require(bool(in), "Truncated snapshot");
  return records;
}
inline Snapshot readSnapshot(const char *path) {
  std::ifstream in(path, std::ios::binary | std::ios::ate);
  require(bool(in), "Cannot open snapshot");
  auto bytes = in.tellg();
  require(bytes >= 64 && bytes <= 1024ll * 1024 * 1024, "Snapshot must be between 64 bytes and 1 GiB");
  in.seekg(0);
  uint32_t header[16];
  in.read(reinterpret_cast<char *>(header), 64);
  require(header[0] == 0x5850534d && header[1] == 1, "Unsupported snapshot format");
  require(header[2] == sizeof(Frame), "Invalid frame size");
  uint64_t total = 64;
  for (int i = 2; i < 8; i++)
    total += header[i];
  require(total == uint64_t(bytes), "Invalid snapshot length");
  for (int i = 8; i < 16; i++)
    require(header[i] == 0, "Unsupported snapshot extension");
  Snapshot s{};
  in.read(reinterpret_cast<char *>(&s.frame), sizeof(Frame));
  s.lights = readRecords<Light>(in, header[3]);
  s.materials = readRecords<Material>(in, header[4]);
  auto instances = readRecords<Instance>(in, header[5]);
  auto page0 = readRecords<Fiber>(in, header[6]), page1 = readRecords<Fiber>(in, header[7]);
  const Frame &f = s.frame;
  require(f.size.x >= 1 && f.size.y >= 1 && f.size.x <= 1920 && f.size.y <= 1080 &&
              std::floor(f.size.x) == f.size.x && std::floor(f.size.y) == f.size.y,
          "Maximum benchmark size is 1920 x 1080");
  require(f.limits.x >= 1 && f.limits.x <= 16 && f.limits.y == s.lights.size() && s.lights.size() <= 64,
          "Invalid render limits");
  require(f.scene.y == instances.size() && instances.size() <= 4096 && !instances.empty(),
          "Invalid instance count");
  require(s.materials.size() <= 512 && !s.materials.empty(), "Invalid materials");
  for (size_t i = 0; i < sizeof(Frame) / 4; i++) {
    if (i >= 76 && i < 88)
      continue;
    float v;
    std::memcpy(&v, reinterpret_cast<const char *>(&f) + i * 4, 4);
    require(std::isfinite(v), "Non-finite frame value");
  }
  for (const auto &light : s.lights) {
    require(light.positionKind.w >= 1 && light.positionKind.w <= 4, "Unsupported light");
    require(light.positionKind.w != 3 || light.radiance.w < .5f,
            "HDR environment maps are not supported by this prototype");
  }
  for (const auto &inst : instances) {
    require(inst.refs.z == 0 && inst.info.x == 3, "Prototype supports visible, shadow-casting fibers only");
    for (int row = 0; row < 6; row++) {
      float4 expected = make_float4(0, 0, 0, 0);
      reinterpret_cast<float *>(&expected)[row % 3] = 1;
      for (int col = 0; col < 4; col++)
        require(reinterpret_cast<float *>(&expected)[col] ==
                    reinterpret_cast<const float *>(&inst.transforms[row])[col],
                "Prototype requires world-space fibers");
    }
    require(inst.info.y <= 16000000 && uint64_t(s.fibers.size()) + inst.info.y <= 16000000,
            "Too many fiber segments");
    for (uint32_t n = 0; n < inst.info.y; n++) {
      uint64_t index = uint64_t(inst.refs.y) + n;
      bool second = index >= f.limits.w;
      uint64_t local = second ? index - f.limits.w : index;
      const auto &page = second ? page1 : page0;
      require(local < page.size(), "Fiber index outside snapshot");
      Fiber fiber = page[size_t(local)];
      if (fiber.material & (1u << 17))
        continue;
      uint64_t material = uint64_t(inst.refs.w) + (fiber.material & 65535);
      require(material < s.materials.size() && material < 65536, "Invalid fiber material");
      require(s.materials[size_t(material)].header.x == 1, "Prototype requires hair materials");
      fiber.material = (fiber.material & 0xffff0000u) | uint32_t(material);
      const float *endpoints = reinterpret_cast<const float *>(&fiber);
      for (int i = 0; i < 8; i++)
        require(std::isfinite(endpoints[i]) && std::abs(endpoints[i]) < 1e15f, "Invalid fiber endpoint");
      require(fiber.a.w >= 0 && fiber.b.w >= 0, "Invalid fiber radius");
      if (fiber.a.w == 0 && fiber.b.w == 0)
        continue;
      s.fibers.push_back(fiber);
    }
  }
  require(!s.fibers.empty(), "No visible fibers in snapshot");
  return s;
}

// Exclusive prefix sum of u32 values, deterministic: each workgroup scans 256 values in shared
// memory, the per-group sums are scanned on the next level, then added back level by level.

struct ScanParams { count: u32, dispatchWidth: u32, pad0: u32, pad1: u32 };

@group(0) @binding(0) var<storage, read_write> scanValues: array<u32>;
@group(0) @binding(1) var<storage, read_write> scanSums: array<u32>;
@group(0) @binding(2) var<uniform> scan: ScanParams;

var<workgroup> scanShared: array<u32, 256>;

fn scanGroup(group: vec3u) -> u32 {
  return group.x + group.y * scan.dispatchWidth;
}

@compute @workgroup_size(256)
fn scanBlocks(@builtin(workgroup_id) group: vec3u, @builtin(local_invocation_index) lane: u32) {
  let block = scanGroup(group);
  let index = block * 256u + lane;
  var value = 0u;
  if (index < scan.count) {
    value = scanValues[index];
  }
  scanShared[lane] = value;
  workgroupBarrier();
  for (var offset = 1u; offset < 256u; offset *= 2u) {
    var add = 0u;
    if (lane >= offset) {
      add = scanShared[lane - offset];
    }
    workgroupBarrier();
    scanShared[lane] += add;
    workgroupBarrier();
  }
  if (index < scan.count) {
    scanValues[index] = scanShared[lane] - value;
  }
  if (lane == 255u) {
    scanSums[block] = scanShared[255];
  }
}

@compute @workgroup_size(256)
fn addBlockOffsets(@builtin(workgroup_id) group: vec3u, @builtin(local_invocation_index) lane: u32) {
  let block = scanGroup(group);
  let index = block * 256u + lane;
  if (index < scan.count) {
    scanValues[index] += scanSums[block];
  }
}

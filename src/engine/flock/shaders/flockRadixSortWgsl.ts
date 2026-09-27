export const FLOCK_RADIX_WORKGROUP = 256;
export const FLOCK_RADIX_BITS = 4;

/** Stable LSD radix sort of (cell key, particle identity) pairs. */
export const FLOCK_RADIX_SORT_WGSL = /* wgsl */ `
struct Pair { key: u32, identity: u32, };
struct Params { count: u32, groups: u32, shift: u32, dispatchWidth: u32, };
@group(0) @binding(0) var<storage, read> input: array<Pair>;
@group(0) @binding(1) var<storage, read_write> output: array<Pair>;
// Digit-major histogram, replaced in place with exclusive workgroup offsets.
@group(0) @binding(2) var<storage, read_write> offsets: array<u32>;
@group(0) @binding(3) var<storage, read_write> totals: array<u32>;
@group(0) @binding(4) var<uniform> params: Params;
var<workgroup> masks: array<atomic<u32>, 128>;
var<workgroup> scan: array<u32, 256>;

fn groupIndex(group: vec3u) -> u32 { return group.x + group.y * params.dispatchWidth; }
fn digit(key: u32) -> u32 { return (key >> params.shift) & 15u; }

// Bitsets give an exact stable rank without depending on atomic execution order.
fn buildMasks(index: u32, lane: u32) {
  if (lane < 128u) { atomicStore(&masks[lane], 0u); }
  workgroupBarrier();
  if (index < params.count) {
    let bin = digit(input[index].key);
    atomicOr(&masks[bin * 8u + lane / 32u], 1u << (lane & 31u));
  }
  workgroupBarrier();
}

@compute @workgroup_size(256)
fn histogram(@builtin(workgroup_id) group: vec3u, @builtin(local_invocation_index) lane: u32) {
  let block = groupIndex(group);
  if (block >= params.groups) { return; }
  buildMasks(block * 256u + lane, lane);
  if (lane < 16u) {
    var count = 0u;
    for (var word = 0u; word < 8u; word++) { count += countOneBits(atomicLoad(&masks[lane * 8u + word])); }
    offsets[lane * params.groups + block] = count;
  }
}

// One workgroup per digit. Lanes scan disjoint contiguous stripes, then combine
// their totals. This supports large populations without quadratic group scans.
@compute @workgroup_size(256)
fn scanHistogram(@builtin(workgroup_id) group: vec3u, @builtin(local_invocation_index) lane: u32) {
  let bin = group.x;
  let stripe = (params.groups + 255u) / 256u;
  let first = lane * stripe;
  let last = min(first + stripe, params.groups);
  var sum = 0u;
  for (var i = first; i < last; i++) { sum += offsets[bin * params.groups + i]; }
  scan[lane] = sum;
  workgroupBarrier();
  for (var distance = 1u; distance < 256u; distance *= 2u) {
    var previous = 0u;
    if (lane >= distance) { previous = scan[lane - distance]; }
    workgroupBarrier();
    scan[lane] += previous;
    workgroupBarrier();
  }
  var prefix = scan[lane] - sum;
  if (lane == 255u) { totals[bin] = scan[lane]; }
  for (var i = first; i < last; i++) {
    let count = offsets[bin * params.groups + i];
    offsets[bin * params.groups + i] = prefix;
    prefix += count;
  }
}

@compute @workgroup_size(256)
fn scatter(@builtin(workgroup_id) group: vec3u, @builtin(local_invocation_index) lane: u32) {
  let block = groupIndex(group);
  if (block >= params.groups) { return; }
  let index = block * 256u + lane;
  buildMasks(index, lane);
  if (index >= params.count) { return; }
  let pair = input[index];
  let bin = digit(pair.key);
  var rank = 0u;
  for (var word = 0u; word < lane / 32u; word++) {
    rank += countOneBits(atomicLoad(&masks[bin * 8u + word]));
  }
  let before = (1u << (lane & 31u)) - 1u;
  rank += countOneBits(atomicLoad(&masks[bin * 8u + lane / 32u]) & before);
  var base = 0u;
  for (var d = 0u; d < bin; d++) { base += totals[d]; }
  output[base + offsets[bin * params.groups + block] + rank] = pair;
}
`;

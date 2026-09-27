/** Identity is independent of physical storage order. A zero header means identity layout. */
export function flockIdentityWgsl(binding: number): string {
  return /* wgsl */ `
@group(0) @binding(${binding}) var<storage, read> particleOrder: array<u32>;
fn particleSlot(identity: u32) -> u32 {
  if (particleOrder[0] == 0u) { return identity; }
  return particleOrder[1u + particleOrder[0] + identity];
}
fn particleIdentity(slot: u32) -> u32 {
  if (particleOrder[0] == 0u) { return slot; }
  return particleOrder[1u + slot];
}
`;
}

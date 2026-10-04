export const GENERATOR_VERSION = 'island-v8';
export interface WorldConfig { seed: string; islandSizeMeters: number }
export interface WorldDescriptor extends WorldConfig { generatorVersion: string }
export function parseWorldConfig(value: unknown): WorldConfig {
  if (!value || typeof value !== 'object') throw new Error('World configuration must be an object.');
  const v = value as Record<string, unknown>;
  if (typeof v.seed !== 'string' || !v.seed.trim() || v.seed.length > 256)
    throw new Error('seed must be a nonempty string of at most 256 characters.');
  // The upper guard protects coordinate precision; worlds are not allocated by total area.
  if (typeof v.islandSizeMeters !== 'number' || !Number.isFinite(v.islandSizeMeters)
    || v.islandSizeMeters < 128 || v.islandSizeMeters > 100_000_000)
    throw new Error('islandSizeMeters must be a finite number between 128 and 100,000,000.');
  return { seed: v.seed, islandSizeMeters: v.islandSizeMeters };
}

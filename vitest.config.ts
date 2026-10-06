import {defineConfig} from 'vitest/config';

// Geometry and generation tests are CPU/memory intensive. Bound concurrency
// so local WebGPU testing does not starve twenty simultaneous test processes.
export default defineConfig({test:{maxWorkers:2,testTimeout:15000,hookTimeout:15000}});

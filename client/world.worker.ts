/// <reference lib="webworker" />
import { WorldGenerator } from '../shared/world';
import { generateChunk, type ChunkRequest } from '../shared/mesh';
import type { WorldConfig } from '../shared/config';
let world: WorldGenerator;
self.onmessage = (event: MessageEvent<{ config?: WorldConfig; request?: ChunkRequest;profile?:boolean }>) => {
  if (event.data.config) {const start=performance.now();world=new WorldGenerator(event.data.config);self.postMessage({workerReady:true,generationMs:performance.now()-start});}
  if (event.data.request) {
    try {
      const chunk = generateChunk(world, event.data.request,event.data.profile);
      self.postMessage(chunk, [chunk.vertices.buffer, chunk.indices.buffer, chunk.water.vertices.buffer, chunk.water.indices.buffer]);
    } catch (error) { self.postMessage({ key: event.data.request.key, error: String(error) }); }
  }
};

import {MeshoptSimplifier} from 'meshoptimizer/simplifier';
import type {VolumeMesh} from './volume';
export const initializeMeshRefinement=()=>MeshoptSimplifier.ready;
/** Topology-preserving reduction below the volume's sample precision. Material
 * borders are locked and normals participate in the error metric. This mesh
 * serves rendering; the edit field is exact. */
export function refineVolumeMeshes(meshes:VolumeMesh[],error=.0015):VolumeMesh[]{return meshes.map(mesh=>{
  const prepared=mesh.prepared?.[[.0015,.005,.02,.08].indexOf(error)];if(prepared)return prepared;
  if(mesh.indices.length<600)return mesh;
  const normals=new Float32Array(mesh.vertices.length/16*3);for(let i=0;i<normals.length/3;i++)for(let k=0;k<3;k++)normals[i*3+k]=mesh.vertices[i*16+3+k];
  const [indices]=MeshoptSimplifier.simplifyWithAttributes(mesh.indices,mesh.vertices,16,normals,3,[.15,.15,.15],null,Math.floor(mesh.indices.length*.12/3)*3,error,['LockBorder','ErrorAbsolute']);
  const [remap,count]=MeshoptSimplifier.compactMesh(indices),vertices=new Float32Array(count*16);for(let i=0;i<remap.length;i++)if(remap[i]!==0xffffffff)vertices.set(mesh.vertices.subarray(i*16,i*16+16),remap[i]*16);
  return {material:mesh.material,indices,vertices};
});}

/** Collision has no shading normals or material seams. Weld those duplicate
 * vertices before reducing the surface, retaining its topology and openings.
 * The absolute error is 2.5 mm in object coordinates (one tenth of a sample). */
export function collisionSurfaceMeshes(meshes:VolumeMesh[]):VolumeMesh[]{
  const merged=mergeVolumeMeshes(meshes.map(m=>({...m,material:'collision'})))[0];if(!merged)return [];
  const positions=new Float32Array(merged.vertices.length/16*3);for(let i=0;i<positions.length/3;i++)positions.set(merged.vertices.subarray(i*16,i*16+3),i*3);
  const weld=MeshoptSimplifier.generatePositionRemap(positions,3),indices=merged.indices.map(i=>weld[i]);
  const [reduced]=MeshoptSimplifier.simplify(indices,positions,3,Math.floor(indices.length*.02/3)*3,.0025,['LockBorder','ErrorAbsolute']);
  const [remap,count]=MeshoptSimplifier.compactMesh(reduced),vertices=new Float32Array(count*16);for(let i=0;i<remap.length;i++)if(remap[i]!==0xffffffff)vertices.set(merged.vertices.subarray(i*16,i*16+16),remap[i]*16);
  return [{material:'collision',vertices,indices:reduced}];
}

/** Copy and join cached spatial patches after refinement, without transferring
 * the immutable worker cache's buffers to the main thread. */
export function mergeVolumeMeshes(meshes:VolumeMesh[]):VolumeMesh[]{
  const groups=new Map<string,VolumeMesh[]>();for(const m of meshes){const group=groups.get(m.material)??[];group.push(m);groups.set(m.material,group);}
  return [...groups].map(([material,group])=>{const vertices=new Float32Array(group.reduce((n,m)=>n+m.vertices.length,0)),indices=new Uint32Array(group.reduce((n,m)=>n+m.indices.length,0));let v=0,t=0;for(const m of group){vertices.set(m.vertices,v);for(let k=0;k<m.indices.length;k++)indices[t+k]=m.indices[k]+v/16;v+=m.vertices.length;t+=m.indices.length;}return {material,vertices,indices};});
}


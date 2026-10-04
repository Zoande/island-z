import {lodShader} from './lod';
export const common = /* wgsl */`
struct Frame {
  vp: mat4x4f, inverse: mat4x4f, light: mat4x4f,
  camera: vec4f, sun: vec4f, time: vec4f, settings: vec4f,
};
@group(0) @binding(0) var<uniform> frame: Frame;
fn worldHash(p: vec2i, seed: u32) -> f32 {
  var h = (bitcast<u32>(p.x) * 374761393u) ^ (bitcast<u32>(p.y) * 668265263u) ^ seed;
  h = (h ^ (h >> 13u)) * 1274126177u; h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}
fn worldNoise(p: vec2f, seed: u32) -> f32 {
  let cell = vec2i(floor(p)); let t = fract(p);
  let s = t*t*t*(t*(t*6.0-15.0)+10.0);
  return mix(mix(worldHash(cell,seed),worldHash(cell+vec2i(1,0),seed),s.x),
    mix(worldHash(cell+vec2i(0,1),seed),worldHash(cell+vec2i(1,1),seed),s.x),s.y);
}
fn oceanCoast(p: vec2f) -> f32 {
  let radius = frame.settings.y * 0.5; let n = p / radius; let seed = bitcast<u32>(frame.settings.w);
  let warp = n + vec2f(worldNoise(n*2.1+vec2f(23.0,0.0),seed+4u),worldNoise(n*2.1+vec2f(0.0,-17.0),seed+5u))*.14-vec2f(.07);
  let q = n*2.2+vec2f(11.0,0.0);
  let boundary = .75 + ((worldNoise(q,seed+6u)*.5+worldNoise(q*2.03,seed+977u)*.25+worldNoise(q*2.03*2.03,seed+1948u)*.125)/.875-.5)*.23;
  return (boundary-length(warp))*radius;
}
fn skyColor(dir: vec3f) -> vec3f {
  let horizon = vec3f(0.66, 0.78, 0.85);
  let zenith = vec3f(0.17, 0.37, 0.63);
  var color = mix(horizon, zenith, pow(clamp(dir.y, 0.0, 1.0), 0.5));
  let towardSun = max(dot(dir, frame.sun.xyz), 0.0);
  color += vec3f(1.0, 0.76, 0.43) * pow(towardSun, 18.0) * 0.16;
  color += vec3f(8.0, 6.7, 4.8) * smoothstep(0.9996, 0.9999, towardSun);
  // Broad, subtle wisps rather than a baked sky photograph.
  let p = dir.xz / max(dir.y + 0.12, 0.1);
  let wisps = sin(p.x * 1.2 + sin(p.y * 1.6)) * sin(p.y * 2.4 + p.x * 0.25);
  let cloud = smoothstep(0.58, 0.88, wisps) * smoothstep(0.04, 0.2, dir.y) * 0.32;
  color = mix(color, vec3f(0.9, 0.94, 0.97), cloud);
  return color;
}
fn fog(color: vec3f, position: vec3f) -> vec3f {
  if(frame.settings.z > .5) { return color; }
  let distance = length(position);
  if(frame.camera.w > 0.0) {
    let submersion=smoothstep(0.0,.18,frame.camera.w);
    let light=exp(-frame.camera.w*.018);
    let transmission=exp(-distance*vec3f(.065,.028,.020));
    let underwater=color*transmission*vec3f(.70,.94,.94)*light+vec3f(.018,.16,.18)*light*(vec3f(1.0)-transmission);
    return mix(color,underwater,submersion);
  }
  let amount = 1.0 - exp(-distance * 0.00014);
  return mix(color, skyColor(normalize(position)), clamp(amount, 0.0, 0.91));
}
`;
function makeSceneShader(compact:boolean) { return /* wgsl */`
diagnostic(off, derivative_uniformity);
${common}
${lodShader}
@group(0) @binding(1) var shadowMap: texture_depth_2d;
@group(0) @binding(2) var shadowSampler: sampler_comparison;
@group(1) @binding(0) var albedo: texture_2d_array<f32>;
@group(1) @binding(1) var materialSampler: sampler;
@group(1) @binding(2) var normalRoughness: texture_2d_array<f32>;
struct Material { tile: vec4f, flags: vec4f, tint: vec4f };
@group(1) @binding(3) var<uniform> material: Material;
@group(1) @binding(4) var groundAlbedo: texture_2d_array<f32>;
@group(1) @binding(5) var groundNormal: texture_2d_array<f32>;
struct Vertex {
  @location(0) position: vec3f, @location(1) normal: vec3f,
  @location(2) uv: vec2f, ${compact?'':'@location(3) weights: vec4f,'}
  @location(4) instance: vec4f, @location(5) rotation: vec4f,
  ${compact?'':'@location(6) extraWeights: vec4f,'}
  ${compact?'@location(7) fade: vec3f,':''}
};
struct Interpolated {
  @builtin(position) clip: vec4f, @location(0) position: vec3f,
  @location(1) normal: vec3f, @location(2) uv: vec2f,
  @location(3) weights: vec4f, @location(4) world: vec3f,
  @location(5) extraWeights: vec4f,
  @location(6) @interpolate(flat) fade: vec3f,
};
fn transform(v: Vertex) -> Interpolated {
  var p = v.position * v.instance.w;
  let q = v.rotation;
  p += 2.0 * cross(q.xyz, cross(q.xyz, p) + q.w * p);
  let n = v.normal + 2.0 * cross(q.xyz, cross(q.xyz, v.normal) + q.w * v.normal);
  let anchor = v.instance.xyz;
  let windAmount = select(material.flags.z * max(v.position.y, 0.0), 0.0, frame.settings.z > .5);
  let phase = (anchor.x + frame.camera.x) * .021 + (anchor.z + frame.camera.z) * .031;
  let wave = sin(frame.time.x * 1.3 + phase);
  p.x += wave * windAmount * 0.04;
  p.z += sin(frame.time.x * 1.6 + phase) * windAmount * 0.025;
  var out: Interpolated;
  out.position = p + anchor;
  out.clip = frame.vp * vec4f(out.position, 1.0);
  out.normal = n; out.uv = v.uv; out.weights = ${compact?'vec4f(0.0)':'v.weights'};
  out.extraWeights = ${compact?'vec4f(0.0)':'v.extraWeights'};
  out.fade=${compact?'v.fade':'vec3f(1.0,0.0,1.0)'};
  out.world = out.position + frame.camera.xyz;
  return out;
}
@vertex fn vertexMain(v: Vertex) -> Interpolated { return transform(v); }
@vertex fn shadowVertex(v: Vertex) -> Interpolated {
  var out = transform(v); out.clip = frame.light * vec4f(out.position, 1.0); return out;
}
@fragment fn shadowFragment(v: Interpolated) {
  if(!lodVisible(v.clip.xy,v.fade)){discard;}
  if (material.flags.w <= 0.0) { return; }
  let texel = textureSampleLevel(albedo, materialSampler, v.uv, i32(material.tile.x), 0.0);
  if (texel.a < material.flags.w) { discard; }
}
fn shadow(position: vec3f, normal: vec3f) -> f32 {
  if (frame.settings.x < 0.5) { return 1.0; }
  let projected = frame.light * vec4f(position + normal * 0.18, 1.0);
  let p = projected.xyz / projected.w;
  let uv = vec2f(p.x * 0.5 + 0.5, -p.y * 0.5 + 0.5);
  if (any(uv < vec2f(0.003)) || any(uv > vec2f(0.997)) || p.z < 0.0 || p.z > 1.0) { return 1.0; }
  let size=vec2f(textureDimensions(shadowMap));let texel=1.0/size;
  if(frame.settings.x<1.5){return textureSampleCompareLevel(shadowMap,shadowSampler,uv,p.z-.0012);}
  // Factor the same separable 3x3 bilinear PCF kernel into four lookups.
  // Kernel coverage, receiver bias, and shadow softness remain unchanged.
  let f=fract(uv*size-.5);let a=(vec2f(2.0)-f)/3.0;let b=(vec2f(1.0)+f)/3.0;
  let lo=-vec2f(1.0)-f+1.0/(vec2f(2.0)-f);
  let hi=vec2f(1.0)-f+f/(vec2f(1.0)+f);
  return textureSampleCompareLevel(shadowMap,shadowSampler,uv+lo*texel,p.z-.0012)*a.x*a.y
    +textureSampleCompareLevel(shadowMap,shadowSampler,uv+vec2f(hi.x,lo.y)*texel,p.z-.0012)*b.x*a.y
    +textureSampleCompareLevel(shadowMap,shadowSampler,uv+vec2f(lo.x,hi.y)*texel,p.z-.0012)*a.x*b.y
    +textureSampleCompareLevel(shadowMap,shadowSampler,uv+hi*texel,p.z-.0012)*b.x*b.y;
}
fn pbr(base: vec3f, roughness: f32, n: vec3f, position: vec3f, visibility: f32, foliage: f32) -> vec3f {
  let l = frame.sun.xyz; let view = normalize(-position); let h = normalize(l + view);
  let nl = max(dot(n, l), 0.0); let nv = max(dot(n, view), 0.001);
  let nh = max(dot(n, h), 0.0); let vh = max(dot(view, h), 0.0);
  let a = roughness * roughness; let a2 = a * a;
  let denom = nh * nh * (a2 - 1.0) + 1.0;
  let distribution = a2 / max(3.14159 * denom * denom, 0.0001);
  let k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
  let geometry = (nl / (nl * (1.0 - k) + k)) * (nv / (nv * (1.0 - k) + k));
  let fresnel = vec3f(0.04) + vec3f(0.96) * pow(1.0 - vh, 5.0);
  let specular = distribution * geometry * fresnel / max(4.0 * nl * nv, 0.001);
  let direct = (base * (1.0 - fresnel) / 3.14159 + specular) * nl * vec3f(3.5, 3.24, 2.85) * visibility;
  let ambient = base * mix(vec3f(0.18, 0.17, 0.12), vec3f(0.38, 0.45, 0.53), n.y * 0.5 + 0.5);
  let transmitted = base * foliage * pow(max(dot(-n, l), 0.0), 1.5) * 0.32;
  return direct + ambient + transmitted;
}
@fragment fn fragmentMain(v: Interpolated, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  // Capture gradients before any screen-door/alpha discard. Otherwise mip
  // selection in partially covered pixel quads is undefined.
  let uvDx=dpdx(v.uv);let uvDy=dpdy(v.uv);
  let worldDx=dpdx(v.world);let worldDy=dpdy(v.world);
  if(!lodVisible(v.clip.xy,v.fade)){discard;}
  var normal = normalize(v.normal); if (!front) { normal = -normal; }
  var base = vec4f(0.0); var details = vec4f(0.5, 0.5, 1.0, 0.9);
  if (${compact?'false':'material.flags.x < 0.5'}) {
    let blend = pow(abs(normal), vec3f(5.0)); let axes = blend / max(blend.x + blend.y + blend.z, 0.001);
    let weights = max(v.weights, vec4f(0.0)); let extra = max(v.extraWeights, vec4f(0.0));
    let total = max(dot(weights + extra, vec4f(1.0)), 0.001);
    let dx = worldDx; let dy = worldDy;
    details = vec4f(0.0);
    for (var i = 0u; i < 8u; i++) {
      var weight = 0.0;
      if (i < 4u) { weight = weights[i] / total; } else { weight = extra[i - 4u] / total; }
      if (weight < 0.003) { continue; }
      var scale = select(0.125, 0.0625, i == 3u);
      if (i == 5u) { scale = 0.65; }
      var a: vec4f; var b: vec4f; var c: vec4f; var nr: vec4f;
      if (i < 4u) {
        a = textureSampleGrad(albedo, materialSampler, v.world.zy * scale, i32(i), dx.zy * scale, dy.zy * scale);
        b = textureSampleGrad(albedo, materialSampler, v.world.xz * scale, i32(i), dx.xz * scale, dy.xz * scale);
        c = textureSampleGrad(albedo, materialSampler, v.world.xy * scale, i32(i), dx.xy * scale, dy.xy * scale);
        nr = textureSampleGrad(normalRoughness, materialSampler, v.world.xz * scale, i32(i), dx.xz * scale, dy.xz * scale);
      } else {
        a = textureSampleGrad(groundAlbedo, materialSampler, v.world.zy * scale, i32(i - 4u), dx.zy * scale, dy.zy * scale);
        b = textureSampleGrad(groundAlbedo, materialSampler, v.world.xz * scale, i32(i - 4u), dx.xz * scale, dy.xz * scale);
        c = textureSampleGrad(groundAlbedo, materialSampler, v.world.xy * scale, i32(i - 4u), dx.xy * scale, dy.xy * scale);
        nr = textureSampleGrad(groundNormal, materialSampler, v.world.xz * scale, i32(i - 4u), dx.xz * scale, dy.xz * scale);
      }
      base += (a * axes.x + b * axes.y + c * axes.z) * weight;
      details += nr * weight;
    }
    // Broad coherent variation suppresses the repeated texture impression at a distance.
    base = vec4f(base.rgb * (0.93 + 0.07 * sin(v.world.x * 0.03 + sin(v.world.z * 0.02))), base.a);
  } else {
    base = textureSampleGrad(albedo, materialSampler, v.uv, i32(material.tile.x),uvDx,uvDy);
    if (base.a < material.flags.w) { discard; }
    let normalLayer = select(i32(material.tile.x), 0, material.flags.x == 2.0 || material.flags.x == 4.0);
    details = textureSampleGrad(normalRoughness, materialSampler, v.uv, normalLayer, uvDx, uvDy);
  }
  if (base.a < material.flags.w) { discard; }
  if (material.flags.w > 0.0) { base = vec4f(base.rgb / max(base.a, 0.001), base.a); }
  if (${compact?'false':'material.flags.x < .5'}) {
    let wetSand = v.weights.x * (1.0-smoothstep(.3,1.8,v.world.y));
    base = vec4f(base.rgb * (1.0-wetSand*.30),base.a);
    details.a = mix(details.a,.52,wetSand);
  }
  let tangent = normalize(select(cross(vec3f(0.0, 1.0, 0.0), normal), cross(vec3f(1.0, 0.0, 0.0), normal), abs(normal.y) > 0.95));
  let bitangent = cross(normal, tangent);
  normal = normalize(normal + tangent * (details.x * 2.0 - 1.0) * 0.22 + bitangent * (details.y * 2.0 - 1.0) * 0.22);
  let leaf = select(0.0, 1.0, material.flags.x == 2.0 || material.flags.x == 4.0);
  var visibility=1.0;
  // A backlit surface has zero direct sunlight; its shadow lookup cannot affect the result.
  if(dot(normal,frame.sun.xyz)>0.0) { visibility=shadow(v.position,normal); }
  let light = pbr(base.rgb * material.tint.rgb, clamp(details.a * material.flags.y, 0.35, 1.0), normal, v.position, visibility, leaf);
  return vec4f(fog(light, v.position), 1.0);
}
`; }
export const sceneShader=makeSceneShader(false);
export const sceneryShader=makeSceneShader(true);
export const buildPreviewShader=sceneryShader.replace('struct Material {', '@group(2) @binding(0) var<uniform> previewColor:vec4f;\nstruct Material {')
  .replace('return vec4f(fog(light, v.position), 1.0);',`let rim=pow(1.0-abs(dot(normal,normalize(-v.position))),2.0);
  return vec4f(previewColor.rgb*(.65+rim*1.6),.22+rim*.28);`);
export const lightingFunctions=sceneryShader.slice(sceneryShader.indexOf('fn shadow(position'),sceneryShader.indexOf('@fragment fn fragmentMain'));
export const octahedral=/*wgsl*/`
fn octEncode(n:vec3f)->vec2f {
  let p=n.xy/(abs(n.x)+abs(n.y)+abs(n.z));
  return select(p,(vec2f(1.0)-abs(p.yx))*select(vec2f(-1.0),vec2f(1.0),p>=vec2f(0.0)),n.z<0.0)*.5+.5;
}
fn octDecode(uv:vec2f)->vec3f {
  let p=uv*2.0-1.0;var n=vec3f(p,1.0-abs(p.x)-abs(p.y));
  if(n.z<0.0){n=vec3f((vec2f(1.0)-abs(n.yx))*select(vec2f(-1.0),vec2f(1.0),n.xy>=vec2f(0.0)),n.z);}
  return normalize(n);
}`;
const bakeStart=sceneryShader.indexOf('  var visibility=1.0;');
export const impostorBakeShader=(sceneryShader.slice(0,bakeStart)+`
  var out:BakeOut;out.color=vec4f(base.rgb*material.tint.rgb,1.0);
  out.surface=vec4f(octEncode(normal),clamp(details.a*material.flags.y,.35,1.0),leaf);return out;
}
`).replace('@fragment fn fragmentMain(v: Interpolated, @builtin(front_facing) front: bool) -> @location(0) vec4f {',`${octahedral}
struct BakeOut {@location(0) color:vec4f,@location(1) surface:vec4f};
@fragment fn fragmentMain(v: Interpolated,@builtin(front_facing) front:bool)->BakeOut {`);
export const skyShader = /* wgsl */`
${common}
struct Out { @builtin(position) clip: vec4f, @location(0) uv: vec2f };
@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> Out {
  let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: Out; out.clip = vec4f(p[index], 0.99999, 1.0); out.uv = p[index]; return out;
}
@fragment fn fragmentMain(v: Out) -> @location(0) vec4f {
  let world = frame.inverse * vec4f(v.uv, 1.0, 1.0);
  if(frame.camera.w > 0.0){return vec4f(mix(skyColor(normalize(world.xyz/world.w)),vec3f(.018,.16,.18)*exp(-frame.camera.w*.018),smoothstep(0.0,.18,frame.camera.w)),1.0);}
  return vec4f(skyColor(normalize(world.xyz / world.w)), 1.0);
}
`;
export const waterShader = /* wgsl */`
${common}
@group(1) @binding(0) var opaqueColor: texture_2d<f32>;
@group(1) @binding(1) var opaqueDepth: texture_depth_2d;
@group(1) @binding(2) var waterSampler: sampler;
struct Vertex { @location(0) position: vec3f, @location(1) normal: vec3f, @location(2) uv: vec2f, @location(3) water: vec4f,
  @location(4) instance: vec4f, @location(6) transitions: vec4f };
struct Out { @builtin(position) clip: vec4f, @location(0) position: vec3f, @location(1) waveNormal: vec3f,
  @location(2) flowUV: vec2f, @location(3) water: vec4f, @location(4) transitions: vec4f };
fn waveAt(xz: vec2f) -> vec3f {
  var height = 0.0; var dx = 0.0; var dz = 0.0;
  let dirs = array<vec2f, 4>(normalize(vec2f(.92,.38)),normalize(vec2f(.67,.74)),normalize(vec2f(-.38,.92)),normalize(vec2f(.85,-.53)));
  let frequencies = array<f32, 4>(.085,.17,.37,.81);
  let amplitudes = array<f32, 4>(.48,.21,.065,.024);
  for (var i = 0u; i < 4u; i++) {
    let phase = dot(xz, dirs[i]) * frequencies[i] - frame.time.x * sqrt(9.81*frequencies[i]);
    height += sin(phase) * amplitudes[i];
    dx += cos(phase) * amplitudes[i] * frequencies[i] * dirs[i].x;
    dz += cos(phase) * amplitudes[i] * frequencies[i] * dirs[i].y;
  }
  return vec3f(height, dx, dz);
}
@vertex fn vertexMain(v: Vertex) -> Out {
  var out: Out;
  out.water = v.water; out.flowUV = v.uv; out.transitions = v.transitions;
  if(v.water.z < .5) {
    let anchor = floor(frame.camera.xz / 12.0) * 12.0 - frame.camera.xz;
    let xz = v.position.xz + anchor;
    let wave = waveAt(xz + frame.camera.xz);
    out.position = vec3f(xz.x,wave.x-frame.camera.y,xz.y);
    out.waveNormal = normalize(vec3f(-wave.y,1.0,-wave.z));
    out.transitions = vec4f(1.0,0.0,0.0,0.0);
  } else {
    out.position = v.position + v.instance.xyz;
    let world = out.position.xz + frame.camera.xz;
    let lake = clamp(v.transitions.y,0.0,1.0); let mouth = clamp(v.transitions.x,0.0,1.0);
    let lakeWave = waveAt(world*.35);
    let riverWave = sin(v.uv.x*.7-frame.time.x*(1.0+v.water.w)*3.0)*.035;
    let inlandWave = mix(riverWave,lakeWave.x*.025,lake);
    let oceanWave = waveAt(world);
    out.position.y += mix(inlandWave,oceanWave.x,mouth);
    let inlandNormal = normalize(mix(v.normal,vec3f(-lakeWave.y*.025,1.0,-lakeWave.z*.025),lake));
    out.waveNormal = normalize(mix(inlandNormal,vec3f(-oceanWave.y,1.0,-oceanWave.z),mouth));
  }
  out.clip = frame.vp * vec4f(out.position, 1.0);
  return out;
}
@fragment fn fragmentMain(v: Out) -> @location(0) vec4f {
  let pixel = vec2i(v.clip.xy); let dimensions = vec2f(textureDimensions(opaqueColor));
  let uv = v.clip.xy / dimensions;
  let depth = textureLoad(opaqueDepth, pixel, 0);
  if (v.clip.z > depth + 0.000001) { discard; }
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let hit = frame.inverse * vec4f(ndc, depth, 1.0);
  let ground = hit.xyz / hit.w;
  let thickness = clamp(v.position.y - ground.y, 0.0, 50.0);
  let world = v.position.xz + frame.camera.xz;
  let ocean = v.water.z < .5; let river = v.water.z > .5 && v.water.z < 1.5;
  let oceanAmount = clamp(v.transitions.x,0.0,1.0); let lakeAmount = clamp(v.transitions.y,0.0,1.0);
  let riverAmount = select(0.0,(1.0-oceanAmount)*(1.0-lakeAmount),river);
  if(ocean && oceanCoast(world)>24.0) {discard;}
  var rippleUV = world;
  if(river) {rippleUV=vec2f(v.flowUV.x-frame.time.x*(1.0+v.water.w)*1.8,v.flowUV.y*8.0);}
  let fineWave = waveAt(rippleUV*3.7); let stillWave = waveAt(world*3.7);
  var flowNormal = vec2f(fineWave.y,fineWave.z);
  if(river) {flowNormal=v.water.xy*fineWave.y+vec2f(-v.water.y,v.water.x)*fineWave.z;}
  let rippleNormal = mix(vec2f(stillWave.y,stillWave.z),flowNormal,riverAmount);
  let n = normalize(v.waveNormal+vec3f(-rippleNormal.x,0.0,-rippleNormal.y)*mix(.18,.52,oceanAmount));
  let view = normalize(-v.position); let fresnel = 0.025 + 0.975 * pow(1.0 - max(dot(n, view), 0.0), 5.0);
  if(frame.camera.w > .04) {
    let upward=max(dot(-n,view),0.0);
    let window=smoothstep(.62,.78,upward);
    let reflection=vec3f(.035,.20,.22)+vec3f(.025,.04,.025)*sin(rippleUV.x*.9+frame.time.x);
    let transmittedSky=skyColor(normalize(vec3f(-view.x*.75,upward,-view.z*.75)))*vec3f(.65,.88,.92);
    return vec4f(fog(mix(reflection,transmittedSky,window),v.position),1.0);
  }
  let shallow = mix(vec3f(.09,.24,.19),vec3f(.045,.40,.36),oceanAmount);
  let deep = mix(vec3f(.035,.095,.10),vec3f(.012,.085,.16),oceanAmount);
  let water = mix(shallow,deep,1.0-exp(-thickness*.10));
  let refractedUV = clamp(uv+n.xz*.0015*min(thickness,3.0),vec2f(.001),vec2f(.999));
  let terrainColor = textureSampleLevel(opaqueColor, waterSampler, refractedUV, 0.0).rgb;
  let transmitted = mix(terrainColor * vec3f(0.78, 0.92, 0.86), water, 1.0 - exp(-thickness * 0.16));
  var color = mix(transmitted, skyColor(reflect(-view, n)), fresnel);
  let h = normalize(view + frame.sun.xyz);
  color += vec3f(2.8,2.35,1.8)*pow(max(dot(n,h),0.0),mix(650.0,240.0,oceanAmount));
  let flowFoam = worldNoise(rippleUV*1.8,41u)*.65+worldNoise(rippleUV*5.3,71u)*.35;
  let stillFoam = worldNoise(world*1.8,41u)*.65+worldNoise(world*5.3,71u)*.35;
  let foamNoise = mix(stillFoam,flowFoam,riverAmount);
  let wash = sin(thickness*3.5-frame.time.x*1.45+worldNoise(world*.12,83u)*4.0)*.5+.5;
  var foam = (1.0-smoothstep(.10,2.1,thickness))*smoothstep(.32,.68,foamNoise+wash*.25)*mix(.16,.85,oceanAmount);
  if(river) {
    let streak = smoothstep(.52,.77,foamNoise+sin(v.flowUV.x*.38-frame.time.x*(2.0+v.water.w)*2.3)*.15);
    foam=max(foam,streak*smoothstep(.75,2.5,v.water.w)*.85*riverAmount*(1.0-v.transitions.z*.5));
    foam=max(foam,smoothstep(.65,.97,abs(v.flowUV.y))*streak*.25*riverAmount);
  }
  foam=max(foam,smoothstep(.14,.23,length(n.xz))*smoothstep(.63,.82,foamNoise)*.20*oceanAmount);
  let caustic = pow(max(0.0,sin(world.x*2.1+sin(world.y*1.9+frame.time.x)) * sin(world.y*2.3-world.x*.3)),10.0);
  color += vec3f(.12,.15,.11)*caustic*exp(-thickness*.7)*(1.0-fresnel);
  color=mix(color,vec3f(.88,.93,.90),foam);
  return vec4f(fog(color, v.position), 1.0);
}
`;
export const postShader = /* wgsl */`
@group(0) @binding(0) var scene: texture_2d<f32>;
@group(0) @binding(1) var sceneSampler: sampler;
@group(0) @binding(2) var<uniform> waterView:vec4f;
struct Out { @builtin(position) clip: vec4f, @location(0) uv: vec2f };
@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> Out {
  let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: Out; out.clip = vec4f(p[index], 0.0, 1.0); out.uv = vec2f(p[index].x * 0.5 + 0.5, 0.5 - p[index].y * 0.5); return out;
}
fn tone(x: vec3f) -> vec3f { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0)); }
fn luminance(x: vec3f) -> f32 { return dot(x, vec3f(0.299, 0.587, 0.114)); }
@fragment fn fragmentMain(v: Out) -> @location(0) vec4f {
  let texel = 1.0 / vec2f(textureDimensions(scene));
  let wet=smoothstep(0.0,.18,waterView.x);
  let warp=vec2f(sin(v.uv.y*32.0+waterView.y*1.4),cos(v.uv.x*27.0+waterView.y*1.1))*.0009*wet;
  let uv=clamp(v.uv+warp,vec2f(.001),vec2f(.999));
  let c = textureSample(scene, sceneSampler, uv).rgb;
  let n = textureSample(scene, sceneSampler, uv + vec2f(0.0, -texel.y)).rgb;
  let s = textureSample(scene, sceneSampler, uv + vec2f(0.0, texel.y)).rgb;
  let e = textureSample(scene, sceneSampler, uv + vec2f(texel.x, 0.0)).rgb;
  let w = textureSample(scene, sceneSampler, uv + vec2f(-texel.x, 0.0)).rgb;
  let range = max(max(luminance(n), luminance(s)), max(luminance(e), luminance(w))) - min(min(luminance(n), luminance(s)), min(luminance(e), luminance(w)));
  let blend = smoothstep(0.08, 0.3, range) * 0.40;
  var filtered = mix(c, (n + s + e + w) * 0.25, blend);
  let edge=smoothstep(.2,.7,length(v.uv-vec2f(.5)));
  filtered*=mix(vec3f(1.0),vec3f(.83,.96,.98)*(1.0-edge*.20),wet);
  return vec4f(pow(tone(filtered), vec3f(1.0 / 2.2)), 1.0);
}
`;

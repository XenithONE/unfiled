import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { createLycorisField, createHeroLycoris } from './lycoris.js';
import { createSaiEnvironment } from './sai-environment.js';
import { createHeightFogPass, MAX_MIST_LIGHTS } from './height-fog.js';
import { createRealisticPassenger } from './realistic-passenger.js';
import { createFilmSequence, FILM_DURATION, SHOTS, SAI_Z, CROSSING_TIME } from './film-sequence.js';
import { createTwilightSky, createSkyEnvironment, AFTERGLOW_DIRECTION } from './sky.js';
import { createFloatingLanterns, createBowLantern, createFloatingBlooms } from './lanterns.js';
import { createOnibi } from './spirits.js';
import { createGodRayPass } from './godrays.js';
import { createGradePass } from './grade.js';

const capture = new URLSearchParams(location.search).has('capture');
const DURATION=FILM_DURATION;
const canvas=document.querySelector('#art');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance',preserveDrawingBuffer:capture});
renderer.setPixelRatio(capture ? 1 : Math.min(devicePixelRatio,1.5));
renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.NoToneMapping;
renderer.info.autoReset=false;
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const scene=new THREE.Scene();
scene.background=null;
scene.fog=new THREE.FogExp2(new THREE.Color().setRGB(.026,.033,.046),.0070);
const camera=new THREE.PerspectiveCamera(44,innerWidth/innerHeight,.045,650);
const clock={time:0};
const rand=(()=>{let seed=7384261;return()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};})();
const clamp=THREE.MathUtils.clamp;
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);};
function riverCenter(z){return 4.2*Math.sin(-z*.012)+.8*Math.sin(-z*.036);}
function shore(z){return 12.0+.22*Math.sin(z*.45)+.75*Math.sin(z*.075)+.12*Math.sin(z*1.37);}
function bankHeight(x,z){const d=Math.abs(x-riverCenter(z))-shore(z);return -.065+.43*smooth(-.1,3.6,d)+.029*Math.max(0,Math.min(d-2.5,19))+.045*Math.sin(z*.38+x*.9)+(.018+.065*smooth(2.,7.,d))*Math.sin(z*.16+x*.48);}

// Dusk light: a dim indigo sky, a low warm key from the sunken sun in the west,
// and a cold high fill that alone casts the soft contact shadows.
const sky=createTwilightSky();scene.add(sky);
scene.environment=createSkyEnvironment(renderer,1);scene.environmentIntensity=1.0;
const hemisphere=new THREE.HemisphereLight(0x6c7a92,0x17130f,.55);scene.add(hemisphere);
const afterglow=new THREE.DirectionalLight(0xffa15c,.95);afterglow.position.copy(AFTERGLOW_DIRECTION).multiplyScalar(80);scene.add(afterglow,afterglow.target);
const skyFill=new THREE.DirectionalLight(0x9aaac4,.24);scene.add(skyFill,skyFill.target);
skyFill.castShadow=true;skyFill.shadow.mapSize.set(4096,4096);Object.assign(skyFill.shadow.camera,{left:-22,right:22,top:22,bottom:-22,near:.5,far:140});skyFill.shadow.bias=-.00020;skyFill.shadow.normalBias=.018;
const skyFillDirection=new THREE.Vector3(.32,1,.42).normalize();
const cheats=[0,1].map(()=>{const l=new THREE.PointLight(0xff9a52,0,4.5,2);scene.add(l);return l;});

const loader=new THREE.TextureLoader();
const loadMap=async(path,color=false)=>{const t=await loader.loadAsync(path);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=Math.min(16,renderer.capabilities.getMaxAnisotropy());if(color)t.colorSpace=THREE.SRGBColorSpace;return t;};
const [woodMap,woodNormal,woodRough,mudMap,mudNormal,mudRough,pebbleMap,pebbleNormal,pebbleRough]=await Promise.all([
loadMap('./assets/wood_planks/diff.jpg',true),loadMap('./assets/wood_planks/nor_gl.jpg'),loadMap('./assets/wood_planks/rough.jpg'),
loadMap('./assets/brown_mud/diff.jpg',true),loadMap('./assets/brown_mud/nor_gl.jpg'),loadMap('./assets/brown_mud/rough.jpg'),
loadMap('./assets/ganges_river_pebbles/diff.jpg',true),loadMap('./assets/ganges_river_pebbles/nor_gl.jpg'),loadMap('./assets/ganges_river_pebbles/rough.jpg')]);

// A broad, gently rising gravel apron separates the water and the flower beds.
const groundMat=new THREE.MeshStandardMaterial({map:mudMap,normalMap:mudNormal,normalScale:new THREE.Vector2(.48,.48),roughnessMap:mudRough,roughness:.83,color:0x747e82,vertexColors:true});
const gravelMat=new THREE.MeshStandardMaterial({map:pebbleMap,normalMap:pebbleNormal,normalScale:new THREE.Vector2(.85,.85),roughnessMap:null,roughness:.94,envMapIntensity:.15,color:0x8b949b,vertexColors:true});
for(const side of [-1,1])for(const section of [{start:-.2,end:4.6,cols:34,scale:2.2,mat:gravelMat},{start:4.6,end:35,cols:55,scale:1.3,mat:groundMat}]){
 const pos=[],uv=[],col=[],ids=[],rows=480,cols=section.cols;
 for(let j=0;j<=rows;j++){const z=26-j*.60;for(let i=0;i<=cols;i++){const d=section.start+(section.end-section.start)*i/cols;const x=riverCenter(z)+side*(shore(z)+d),y=bankHeight(x,z);pos.push(x,y,z);uv.push(x/section.scale,z/section.scale);const wet=smooth(-.04,.28,y);const shade=.43+.37*wet+.065*Math.sin(x*1.3+z*.31);col.push(shade*.96,shade,shade);if(i<cols&&j<rows){const a=j*(cols+1)+i,b=a+cols+1;if(side===1)ids.push(a,a+1,b,b,a+1,b+1);else ids.push(a,b,a+1,b,b+1,a+1);}}}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));g.setIndex(ids);g.computeVertexNormals();const mesh=new THREE.Mesh(g,section.mat);mesh.receiveShadow=true;scene.add(mesh);
}
const dummy=new THREE.Object3D();
// Composed stone towers for the Sai-no-Kawara shot, between camera and river.
const saiZ=SAI_Z,saiBank=riverCenter(saiZ)+shore(saiZ);
const towerSizes=(scale,levels)=>Array.from({length:levels},(_,j)=>{const k=1-j/levels;return[(.075+.16*Math.pow(k,.85))*scale,(.034+.018*k)*scale,(.065+.135*Math.pow(k,.85))*scale];});
// A field of small towers recedes along the gravel toward the afterglow.
const cairnRandom=(()=>{let seed=2207;return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};})();
const extraCairns=[];
for(let i=0;i<17;i++){const z=saiZ-.2-i*.78-cairnRandom()*.5,d=.45+cairnRandom()*2.75,scale=.40+cairnRandom()*.55,levels=3+Math.floor(cairnRandom()*6);if(i<3&&d>1.9)continue;const x=riverCenter(z)+shore(z)+d;
 // Keep the lens's own foreground clear: no tower within 1.8 m of the camera.
 if(Math.hypot(x-(saiBank+3.0),z-(saiZ-9.2))<1.8)continue;extraCairns.push({x,z,sizes:towerSizes(scale,levels)});}
const saiEnvironment=createSaiEnvironment(THREE,{riverCenter,shore,bankHeight,woodMap,woodNormal,woodRough,mudNormal,extraCairns});scene.add(saiEnvironment);

// Scattered fine dead stems and bank litter, with no lush leaves under blooming Lycoris.
const litterPos=[];
for(let i=0;i<1150;i++){const z=12-rand()*85,side=rand()>.5?1:-1,x=riverCenter(z)+side*(shore(z)+3.+rand()*5.),y=bankHeight(x,z)+.012;const a=rand()*6.28,l=.035+rand()*.22;litterPos.push(x,y,z,x+Math.cos(a)*l,y+.008,z+Math.sin(a)*l);}
const litterG=new THREE.BufferGeometry();litterG.setAttribute('position',new THREE.Float32BufferAttribute(litterPos,3));scene.add(new THREE.LineSegments(litterG,new THREE.LineBasicMaterial({color:0x5b5543,transparent:true,opacity:.44})));

const saiCamera={x:saiBank+2.88,z:saiZ-9.05};
const lilies=createLycorisField(THREE,bankHeight,riverCenter,shore,{exclusions:[{x:saiCamera.x,z:saiCamera.z,r:.65},...extraCairns.map(c=>({x:c.x,z:c.z,r:.30}))]});scene.add(lilies);
const heroZ=-8,heroX=riverCenter(heroZ)+shore(heroZ)+2.15;
const heroAnchor=[heroX,bankHeight(heroX,heroZ),heroZ];
const heroLycoris=createHeroLycoris(THREE,{seed:78031});heroLycoris.position.fromArray(heroAnchor);scene.add(heroLycoris);
// Close, fully detailed flowers frame the Sai-no-Kawara lens from the inland side.
const saiFlowers=[[-.63,1.47,40211],[-1.26,1.54,40217],[-1.19,2.45,40223],[-.21,2.31,40229],[-.05,1.12,40231]].map(([dx,dz,seed])=>{
 const flower=createHeroLycoris(THREE,{seed});const x=saiCamera.x+dx,z=saiCamera.z+dz;flower.position.set(x,bankHeight(x,z),z);
 flower.rotation.y=seed*.37;flower.scale.setScalar(.92+((seed*13)%7)/40);scene.add(flower);return flower;});
const filmSequence=createFilmSequence({riverCenter,shore,bankHeight,heroAnchor,bridgeZ:saiEnvironment.userData.bridge.z});

// A tangled, low understorey of bent grass and dead straw breaks up exposed mud.
// These are other meadow plants; the flowering Lycoris itself remains leafless.
const grassMat=new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.96,envMapIntensity:.45});
for(let variant=0;variant<4;variant++){
 const pp=[],cc=[];
 for(let blade=0;blade<15;blade++){
  const angle=rand()*6.283,bx=(rand()-.5)*.19,bz=(rand()-.5)*.19,h=.018+Math.pow(rand(),1.8)*.095,lean=.035+rand()*.22,w=.0025+rand()*.0045;
  const color=new THREE.Color().setHSL(.17+rand()*.07,.16+rand()*.12,.14+rand()*.14,THREE.SRGBColorSpace);const rows=[];
  for(let k=0;k<=4;k++){const t=k/4,cx=bx+Math.cos(angle)*lean*t*t,cy=h*Math.sin(t*1.92),cz=bz+Math.sin(angle)*lean*t*t,width=w*Math.pow(1-t,.75);rows.push([new THREE.Vector3(cx+Math.sin(angle)*width,cy,cz-Math.cos(angle)*width),new THREE.Vector3(cx-Math.sin(angle)*width,cy,cz+Math.cos(angle)*width)]);}
  for(let k=0;k<4;k++){for(const p of [rows[k][0],rows[k+1][0],rows[k][1],rows[k][1],rows[k+1][0],rows[k+1][1]]){pp.push(p.x,p.y,p.z);const oc=.48+.52*Math.min(1,p.y/.045);cc.push(color.r*oc,color.g*oc,color.b*oc);}}
 }
 const gg=new THREE.BufferGeometry();gg.setAttribute('position',new THREE.Float32BufferAttribute(pp,3));gg.setAttribute('color',new THREE.Float32BufferAttribute(cc,3));gg.computeVertexNormals();
 const instances=[];for(let i=0;i<7400;i++){const z=19-rand()*179,side=rand()<.5?-1:1,inland=2.8+Math.pow(rand(),1.3)*12,x=riverCenter(z)+side*(shore(z)+inland),y=bankHeight(x,z);if(y<.12||rand()>.70+.22*Math.sin(z*.9+inland*2.3))continue;instances.push([x,y,z]);}
 const mesh=new THREE.InstancedMesh(gg,grassMat,instances.length);for(let i=0;i<instances.length;i++){const[x,y,z]=instances[i];dummy.position.set(x,y+.003,z);dummy.rotation.set(0,rand()*6.283,0);dummy.scale.setScalar(.6+rand()*.95);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);}mesh.receiveShadow=true;mesh.computeBoundingSphere();scene.add(mesh);
}

// Black water. The mirror carries the afterglow and every lantern; ripples
// stretch their reflections into vertical streaks and scatter small glints.
const MAX_GLINTS=16;
const actualWaterNormal=await loadMap('./assets/water/normals.jpg');
const water=new Water(new THREE.PlaneGeometry(700,700),{textureWidth:capture?2048:1024,textureHeight:capture?2048:1024,waterNormals:actualWaterNormal,sunDirection:AFTERGLOW_DIRECTION.clone(),sunColor:new THREE.Color().setRGB(1,.62,.34),waterColor:0x040d12,distortionScale:1.25,fog:true});water.rotation.x=-Math.PI/2;water.position.y=0;water.material.uniforms.size.value=6.2;water.material.uniforms.mirrorSampler.value.type=THREE.HalfFloatType;
Object.assign(water.material.uniforms,{boatPosition:{value:new THREE.Vector2()},boatHeading:{value:0},boatTime:{value:0},
 glowDirection:{value:AFTERGLOW_DIRECTION.clone()},glowColor:{value:new THREE.Color().setRGB(.24,.075,.026)},glowStrength:{value:1},mistAmbient:{value:new THREE.Color().setRGB(.0105,.0155,.026)},
 glintPosition:{value:Array.from({length:MAX_GLINTS},()=>new THREE.Vector3(0,-100,0))},glintColor:{value:Array.from({length:MAX_GLINTS},()=>new THREE.Vector3())}});
water.material.defines={MAX_GLINTS};
const wf=water.material.fragmentShader;
const replaceOnce=(source,from,to)=>{if(!source.includes(from))throw new Error('Water shader patch target missing: '+from.slice(0,48));return source.replace(from,to);};
let waterShader=replaceOnce(wf,'uniform float alpha;','uniform float alpha; uniform vec2 boatPosition; uniform float boatHeading; uniform float boatTime; uniform vec3 glowDirection,glowColor,mistAmbient; uniform float glowStrength; uniform vec3 glintPosition[MAX_GLINTS],glintColor[MAX_GLINTS]; float hgWater(float c,float g){float g2=g*g;return (1.-g2)/(12.5663706*pow(1.+g2-2.*g*c,1.5));}');
waterShader=replaceOnce(waterShader,'float rf0 = 0.3;','float rf0 = 0.024;');
waterShader=replaceOnce(waterShader,'vec3( 0.1 ) + reflectionSample * 0.9 + reflectionSample * specularLight','reflectionSample * 0.96 + specularLight * 0.55');
waterShader=replaceOnce(waterShader,'sunLight( surfaceNormal, eyeDirection, 100.0, 2.0, 0.5','sunLight( surfaceNormal, eyeDirection, 220.0, 1.0, 0.0');
waterShader=replaceOnce(waterShader,'vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );',`vec3 surfaceNormal = normalize( noise.xzy * vec3( .46, 1.0, .46 ) );
 vec2 rel=worldPosition.xz-boatPosition;
 float cy=cos(boatHeading),sy=sin(boatHeading);
 vec2 local=vec2(cy*rel.x-sy*rel.y,sy*rel.x+cy*rel.y);
 vec2 localSlope=vec2(0.);
 // Millimetre-scale pressure ripples at the actual curved waterline.
 float q=clamp((1.5-local.y)/5.1,0.,1.);
 float waterline=.70*pow(max(.00001,sin(3.14159265*(.19+.81*q))),.70)*.73;
 float edge=abs(local.x)-waterline;
 float hullMask=smoothstep(-3.60,-3.22,local.y)*(1.-smoothstep(1.44,1.79,local.y));
 float hullRipple=sin(edge*43.-boatTime*1.05+local.y*.8)*exp(-max(edge,0.)*9.)*smoothstep(-.012,.022,edge)*hullMask*.060;
 localSlope+=vec2(sign(local.x)*hullRipple,hullRipple*.15*sin(local.y));
 // A soft partial cusp precedes the stem; no closed graphic ring or white foam.
 vec2 bow=local-vec2(0.,-3.55);float radius=length(bow);
 float frontMask=1.-smoothstep(-.04,.25,bow.y);
 float bowRipple=sin(radius*35.-boatTime*.90)*exp(-radius*3.8)*smoothstep(.025,.10,radius)*frontMask*.036;
 localSlope+=bow/max(radius,.001)*bowRipple;
 // Two fine diverging wakes trail the transom, with irregular capillary detail.
 float aft=max(local.y-1.5,0.);
 float wakeEdge=abs(local.x)-(.43+aft*.22);
 float trailMask=smoothstep(1.48,1.83,local.y)*exp(-aft*.23);
 float trailWave=(sin(wakeEdge*37.-boatTime*1.22)+.20*sin(wakeEdge*61.+aft*.9-boatTime*.73))*exp(-abs(wakeEdge)*8.5)*trailMask*.070;
 localSlope+=vec2(sign(local.x)*trailWave,-.22*trailWave);
 vec2 worldSlope=vec2(cy*localSlope.x+sy*localSlope.y,-sy*localSlope.x+cy*localSlope.y);
 surfaceNormal=normalize(surfaceNormal+vec3(worldSlope.x,0.,worldSlope.y));`);
waterShader=replaceOnce(waterShader,'vec3 reflectionSample = vec3( texture2D( mirrorSampler, mirrorCoord.xy / mirrorCoord.w + distortion ) );',
 `// Ripples stretch reflected lights vertically, as on real night water.
  vec2 ruv=mirrorCoord.xy/mirrorCoord.w+distortion*vec2(.42,1.65);
  vec2 blur=vec2(.0008,.0016);
  vec3 reflectionSample=texture2D(mirrorSampler,ruv).rgb*.36;
  reflectionSample+=(texture2D(mirrorSampler,ruv+blur).rgb+texture2D(mirrorSampler,ruv-blur).rgb+texture2D(mirrorSampler,ruv+vec2(blur.x,-blur.y)).rgb+texture2D(mirrorSampler,ruv+vec2(-blur.x,blur.y)).rgb)*.16;
  // The reflected ray also crosses the mist: warm toward the afterglow.
  vec3 reflectedRay=reflect(-eyeDirection,vec3(0.,1.,0.));
  float reflectedPhase=.72*hgWater(dot(reflectedRay,glowDirection),.86)+.28*hgWater(dot(reflectedRay,glowDirection),.40);
  vec3 reflectedMist=mistAmbient+glowColor*glowStrength*reflectedPhase;
  reflectionSample=mix(reflectionSample,reflectedMist,.42*(1.-exp(-distance*.030)));
  // Lantern and spirit-flame glints on individual ripples.
  vec3 glints=vec3(0.);
  for(int i=0;i<MAX_GLINTS;i++){
    vec3 toLight=glintPosition[i]-worldPosition.xyz;
    float d2=dot(toLight,toLight);
    vec3 halfway=normalize(normalize(toLight)+eyeDirection);
    float spec=pow(max(dot(surfaceNormal,halfway),0.),620.)*1.6+pow(max(dot(surfaceNormal,halfway),0.),60.)*.05;
    glints+=glintColor[i]*spec/(1.+d2*1.4);
    // Turbid water glows faintly in a small pool beneath each flame.
    glints+=glintColor[i]*.042/(1.+d2*10.);
  }`);
waterShader=replaceOnce(waterShader,'vec3 outgoingLight = albedo;','vec3 outgoingLight = albedo + glints;');
water.material.fragmentShader=waterShader;
water.material.fog=false;
scene.add(water);

// A narrow Japanese river skiff, built as individual weathered strakes and ribs.
const boat=new THREE.Group();scene.add(boat);
const woodMaterials=Array.from({length:8},(_,i)=>new THREE.MeshPhysicalMaterial({map:woodMap,normalMap:woodNormal,normalScale:new THREE.Vector2(.27,.27),roughnessMap:woodRough,roughness:.75,color:new THREE.Color().setRGB(.50+i*.015,.51+i*.010,.48+i*.009),clearcoat:.20,clearcoatRoughness:.38,side:THREE.DoubleSide}));
const iron=new THREE.MeshStandardMaterial({color:0x302e29,roughness:.68,metalness:.45});
const tar=new THREE.MeshStandardMaterial({color:0x292d28,roughness:.86});
function hullWidth(z){const q=clamp((1.5-z)/5.1,0,1);return .70*Math.pow(Math.max(0,Math.sin(Math.PI*(.19+.81*q))),.70);}
function rimY(z){return .47+.105*Math.pow(clamp((-z-1.7)/1.9,0,1),2)+.023*Math.sin(z*.7);}
function plankStrip(side,band){const pos=[],uv=[],ids=[],N=58;for(let j=0;j<=N;j++){const z=1.5-j*5.1/N,w=hullWidth(z);for(let k=0;k<2;k++){const q=(band+(k?.97:.015))/6;const y=-.15+q*(rimY(z)+.15);const x=side*w*(.51+.49*Math.pow(q,.65))+.0025*Math.sin(z*17.+band*1.13);pos.push(x,y,z);uv.push((z+3.6)/2.5,((band+1)%8)/9+.012+k*.072);if(j<N&&k===0){const a=j*2;ids.push(a,a+1,a+2,a+1,a+3,a+2);}}}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ids);g.computeVertexNormals();const m=new THREE.Mesh(g,woodMaterials[(band+side+8)%8]);m.castShadow=m.receiveShadow=true;boat.add(m);}
for(const side of [-1,1])for(let band=0;band<6;band++)plankStrip(side,band);
function curveBeam(points,radius,mat,segments=70){const g=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),segments,radius,8,false);if(mat.map){const tuv=g.attributes.uv;for(let n=0;n<tuv.count;n++)tuv.setXY(n,tuv.getX(n)*2.,.24+tuv.getY(n)*.065);}const m=new THREE.Mesh(g,mat);m.castShadow=m.receiveShadow=true;boat.add(m);return m;}
for(const side of [-1,1]){const pts=[];for(let i=0;i<=60;i++){const z=1.5-i*5.1/60;pts.push(new THREE.Vector3(side*hullWidth(z),rimY(z)+.012,z));}curveBeam(pts,.029,woodMaterials[5]);
 for(let k=1;k<6;k++){const pts=[];for(let i=0;i<=60;i++){const z=1.5-i*5.1/60,q=k/6;pts.push(new THREE.Vector3(side*hullWidth(z)*(.51+.49*Math.pow(q,.65)), -.15+q*(rimY(z)+.15)-.002,z));}curveBeam(pts,.0015,tar);}}
// Each floor board samples one strip of the scanned timber, following its grain.
for(let i=0;i<9;i++){const x=(i-4)*.081,pos=[],uv=[],ids=[],N=50;for(let j=0;j<=N;j++){const z=1.45-j*4.81/N;const w=hullWidth(z)*.52;for(let k=0;k<2;k++){const xx=clamp(x+(k? .038:-.038),-w,w);pos.push(xx,.040+.009*Math.sin(z*.8),z);uv.push((z+3.6)/2.3,(i%8)/9+.016+k*.071);}if(j<N){const a=j*2;ids.push(a,a+2,a+1,a+1,a+2,a+3);}}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ids);g.computeVertexNormals();const m=new THREE.Mesh(g,woodMaterials[i%8]);m.receiveShadow=true;boat.add(m);}
function woodBox(w,h,d,x,y,z,material=woodMaterials[3]){const g=new THREE.BoxGeometry(w,h,d);const uv=g.attributes.uv;for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*w/1.5,.125+uv.getY(i)*.06);const m=new THREE.Mesh(g,material);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;boat.add(m);return m;}
for(const z of [.64,-.53,-1.75,-2.55]){const pts=[];for(let i=0;i<=20;i++){const t=-1+i/10,q=Math.pow(Math.abs(t),1.65);pts.push(new THREE.Vector3(t*hullWidth(z)*(.52+.45*q),.036+q*.36,z));}curveBeam(pts,.024,woodMaterials[6],30);}
woodBox(hullWidth(-1.78)*1.88,.057,.27,0,.328,-1.78);
woodBox(hullWidth(.67)*1.89,.052,.27,0,.31,.67);
woodBox(hullWidth(-.53)*1.83,.055,.30,0,.305,-.53);
// A closed, shaped transom and submerged bottom remain solid in the aerial view.
{
 const pos=[],uv=[],idx=[],N=12,z=1.48;
 for(let i=0;i<=N;i++){const q=i/N,y=-.15+q*(rimY(z)+.15),w=hullWidth(z)*(.51+.49*Math.pow(q,.65));for(const side of [-1,1]){pos.push(side*w,y,z);uv.push(.10+(side+1)*.26,.015+q*.085);}if(i<N){const a=i*2;idx.push(a,a+1,a+2,a+1,a+3,a+2);}}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();const stern=new THREE.Mesh(g,woodMaterials[4]);stern.castShadow=stern.receiveShadow=true;boat.add(stern);
 curveBeam([new THREE.Vector3(-hullWidth(z),rimY(z)+.012,z),new THREE.Vector3(0,rimY(z)+.018,z),new THREE.Vector3(hullWidth(z),rimY(z)+.012,z)],.030,woodMaterials[5],20);
}
{
 const pos=[],uv=[],idx=[],N=64;
 for(let i=0;i<=N;i++){const z=1.48-i*5.08/N,w=hullWidth(z)*.512;for(const side of [-1,1]){pos.push(side*w,-.151,z);uv.push((z+3.6)/2.5,.71+(side+1)*.032);}if(i<N){const a=i*2;idx.push(a,a+2,a+1,a+1,a+2,a+3);}}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();const bottom=new THREE.Mesh(g,woodMaterials[2]);bottom.castShadow=bottom.receiveShadow=true;boat.add(bottom);
}
const passenger=await createRealisticPassenger(THREE);passenger.position.set(0,0,-.53);boat.add(passenger);
// Fine dark nail heads catch a little reflected sky.
const nails=new THREE.InstancedMesh(new THREE.SphereGeometry(.006,7,5),iron,116);let ni=0;
for(const side of [-1,1])for(let j=0;j<29;j++){const z=1.36-j*.167;for(const q of [.83,.35]){dummy.position.set(side*hullWidth(z)*(.51+.49*Math.pow(q,.65)), -.15+q*(rimY(z)+.15),z);dummy.scale.set(1,.6,1);dummy.rotation.set(0,0,0);dummy.updateMatrix();nails.setMatrixAt(ni++,dummy.matrix);}}boat.add(nails);
// Mooring rope loosely coiled in the forward footwell.
const ropeMat=new THREE.MeshStandardMaterial({color:0x8e8064,roughness:.98});
const ropePoints=[];for(let i=0;i<=280;i++){const t=i/280,a=t*Math.PI*8,r=.04+.12*t;ropePoints.push(new THREE.Vector3(.11+Math.cos(a)*r,.065+.015*Math.sin(a*2),-2.20+Math.sin(a)*r*.78));}curveBeam(ropePoints,.009,ropeMat,280);
const ropeEnd=[];for(let i=0;i<=24;i++){const t=i/24;ropeEnd.push(new THREE.Vector3(.14+Math.sin(t*4)*.06,.070+t*t*.29,-2.15-t*.71));}curveBeam(ropeEnd,.009,ropeMat,45);
const bowLantern=createBowLantern();boat.add(bowLantern);
// 旅支度: the staff (杖) lies along the floor at the passenger's right and the
// sedge hat (編笠) rests before the left foot — set beside the dead, as in a coffin.
const staff=new THREE.Mesh(new THREE.CylinderGeometry(.0130,.0142,1.34,8),new THREE.MeshStandardMaterial({color:0xd9d2c2,roughness:.74}));
staff.position.set(.315,.066,-.20);staff.rotation.set(Math.PI/2+.012,0,-.018);staff.castShadow=staff.receiveShadow=true;boat.add(staff);
const strawMap=await loadMap('./assets/character/shiroshozoku/waraji-straw.png',true);strawMap.repeat.set(3,1);
const hatProfile=[];for(let i=0;i<=24;i++){const t=i/24;hatProfile.push(new THREE.Vector2(.002+.218*t,.118*(1-t)+.010*Math.sin(Math.PI*t)));}
const hat=new THREE.Mesh(new THREE.LatheGeometry(hatProfile,48),new THREE.MeshStandardMaterial({map:strawMap,color:0xb8a27a,roughness:.92,side:THREE.DoubleSide}));
hat.position.set(-.105,.058,-1.68);hat.rotation.set(-.10,.6,.16);hat.castShadow=hat.receiveShadow=true;boat.add(hat);

// The departed cast no reflection: the mirror pass renders the ferry without its passenger.
const mirrorRender=water.onBeforeRender;
water.onBeforeRender=(...args)=>{const shown=passenger.visible;passenger.visible=false;mirrorRender(...args);passenger.visible=shown;};water.userData.mirrorRender=mirrorRender;

const lanterns=createFloatingLanterns({riverCenter,hullWidth,bridgeZ:saiEnvironment.userData.bridge.z,scripted:[
 // 灯籠流し: one lantern passes close to the water-level lens, another beyond it.
 t=>[riverCenter(-6)+2.32-.03*(t-6),-8.1-.26*(t-6)],
 t=>[riverCenter(-6)+.45+.02*(t-6),-11.2-.30*(t-6)],
]});scene.add(lanterns);
const blooms=createFloatingBlooms({riverCenter,hullWidth,bridgeZ:saiEnvironment.userData.bridge.z,hero:heroLycoris});scene.add(blooms);
const groundAt=(d,z)=>{const x=riverCenter(z)+shore(z)+d;return[x,bankHeight(x,z),z];};
const onibiAt=(d,lift,z,phase,size,intensity)=>{const p=groundAt(d,z);return{position:[p[0],Math.max(p[1],0)+lift,z],phase,size,intensity};};
const onibi=createOnibi([
 // Sai-no-Kawara: among the stone towers.
 onibiAt(1.25,.80,saiZ-2.2,.4,.30,1.0),onibiAt(2.55,1.05,saiZ-5.1,2.1,.26,.85),onibiAt(-.9,.75,saiZ-7.0,3.7,.25,.75),onibiAt(-2.6,1.15,saiZ-3.4,5.2,.24,.65),
 // The opening shore, over the water behind the flower.
 onibiAt(-3.4,.85,-4.2,1.3,.26,.8),onibiAt(-9.5,.95,1.5,4.4,.24,.6),
 // The boundary: on both banks beside the bridge.
 {position:[riverCenter(-47)-shore(-47)+1.8,1.1,-46.5],phase:.9,size:.28,intensity:.8},
 {position:[riverCenter(-48)+shore(-48)-1.2,1.3,-47.8],phase:2.9,size:.26,intensity:.8},
 {position:[riverCenter(-52)-4.5,1.6,-53.5],phase:4.8,size:.22,intensity:.55},
]);scene.add(onibi);

// Post: atmosphere (contact shadow, lens, mist, halos) → god rays → bloom → film grade.
const targetRT=new THREE.WebGLRenderTarget(innerWidth,innerHeight,{type:THREE.HalfFloatType,samples:4});
targetRT.depthTexture=new THREE.DepthTexture(innerWidth,innerHeight,THREE.UnsignedIntType);targetRT.depthBuffer=true;
const composer=new EffectComposer(renderer,targetRT);composer.addPass(new RenderPass(scene,camera));
const heightFog=createHeightFogPass(THREE,ShaderPass,camera);heightFog.uniforms.glowDirection.value.copy(AFTERGLOW_DIRECTION);composer.addPass(heightFog);
const godRays=createGodRayPass(ShaderPass,camera,heightFog.sharedDepth);composer.addPass(godRays);
const bloom=new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),.45,.42,1.5);
bloom.highPassUniforms.smoothWidth.value=1.6;
bloom.bloomTintColors.forEach((c,i)=>c.set(1,1-.06*i,1-.13*i));
const bloomSetSize=bloom.setSize.bind(bloom);
// Blur radii are authored at 1080p; a 4K render steps twice as far per tap.
bloom.setSize=(w,h)=>{bloomSetSize(w,h);const k=Math.max(1,w/1920);for(const m of bloom.separableBlurMaterials)m.uniforms.invSize.value.multiplyScalar(k);};
bloom.setSize(innerWidth,innerHeight);
composer.addPass(bloom);
const grade=createGradePass(ShaderPass);composer.addPass(grade);

const beyondWhite=new THREE.Color().setRGB(.40,.31,.21);
const lightPool=[],toCamera=new THREE.Vector3();
const bowLight={position:new THREE.Vector3(),color:new THREE.Color(),power:0};
function collectLights(lanternLights,spiritLights,bowPower){
 lightPool.length=0;
 if(bowPower>0){bowLight.position.copy(bowLantern.userData.worldCenter());bowLight.power=bowPower*.55;bowLight.color.setRGB(1,.62,.34).multiplyScalar(bowLight.power);lightPool.push(bowLight);}
 for(const l of lanternLights)if(l.power>.02)lightPool.push(l);
 for(const l of spiritLights)if(l.power>.02)lightPool.push(l);
 for(const l of lightPool)l.rank=l.power/(1+toCamera.subVectors(l.position,camera.position).lengthSq());
 lightPool.sort((a,b)=>b.rank-a.rank);
 const fog=heightFog.lights;
 for(let i=0;i<MAX_MIST_LIGHTS;i++){const l=lightPool[i];if(l){fog.position[i].copy(l.position);fog.color[i].set(l.color.r,l.color.g,l.color.b);}else{fog.position[i].set(0,-500,0);fog.color[i].set(0,0,0);}}
 const glintPosition=water.material.uniforms.glintPosition.value,glintColor=water.material.uniforms.glintColor.value;
 for(let i=0;i<MAX_GLINTS;i++){const l=lightPool[i];if(l){glintPosition[i].copy(l.position);glintColor[i].set(l.color.r,l.color.g,l.color.b);}else{glintPosition[i].set(0,-100,0);glintColor[i].set(0,0,0);}}
}

// Lanterns go out one by one in the epilogue, the farthest last.
const extinguishOrder=lanterns.userData.lanterns.map((_,i)=>((i*7919)%97)/97);
let extinguishProgress=0;
const extinguish=(i)=>{const start=extinguishOrder[i]*.86;return 1-smooth(start,start+.08,extinguishProgress);};
// When the ferry passes the boundary, a breath runs outward through the lanterns left behind.
const bridgeCenter=new THREE.Vector2(riverCenter(saiEnvironment.userData.bridge.z),saiEnvironment.userData.bridge.z);
const breath=(x,z,t)=>{const d=Math.hypot(x-bridgeCenter.x,z-bridgeCenter.y),k=(t-CROSSING_TIME-.05-d*.075)/.16;return 1-.78*Math.exp(-k*k);};

function renderAt(time){
 renderer.info.reset();const t=clamp(Number(time)||0,0,DURATION);clock.time=t;
 const film=filmSequence.sample(t),look=film.look,heading=film.boatYaw;
 boat.position.fromArray(film.boatPosition);boat.rotation.set(.003*Math.sin(t*.83),heading,.007*Math.sin(t*.93+.6));
 camera.position.fromArray(film.cameraPosition);camera.lookAt(...film.cameraTarget);
 if(camera.fov!==film.cameraFov){camera.fov=film.cameraFov;camera.updateProjectionMatrix();}
 camera.updateMatrixWorld();boat.updateMatrixWorld(true);
 if(window.__SANZU)window.__SANZU.filmSample=film;
 // Afterglow: the sky, the key light and the mist dim together at nightfall.
 sky.material.uniforms.glow.value=look.skyGlow;sky.material.uniforms.time.value=t;
 afterglow.intensity=.95*look.skyGlow*look.afterglowKey;
 water.material.uniforms.glowStrength.value=look.glow;water.material.uniforms.sunColor.value.setRGB(1,.62,.34).multiplyScalar(look.skyGlow);
 heightFog.uniforms.glowStrength.value=look.glow;scene.environmentIntensity=1.0*(.45+.55*look.skyGlow);
 heightFog.uniforms.density.value=look.fogDensity;heightFog.uniforms.nearMist.value.fromArray(look.nearMist);
 heightFog.uniforms.beyondDensity.value=look.beyondDensity;heightFog.uniforms.beyondColor.value.setRGB(.36,.17,.06).lerp(beyondWhite,look.beyondWhite).multiplyScalar(look.beyondBoost);
 heightFog.uniforms.haloDensity.value=look.haloDensity;
 heightFog.uniforms.time.value=t;grade.uniforms.time.value=t;
 heightFog.uniforms.focusDistance.value=film.focusDistance;heightFog.uniforms.aperturePx.value=film.aperturePx;heightFog.uniforms.maxBlur.value=film.maxBlur;
 grade.uniforms.exposure.value=look.exposure;grade.uniforms.fade.value=look.fade;grade.uniforms.flash.value=look.flash;
 bloom.strength=look.bloom;
 // Shadows follow the subject of each shot; the cold fill stays high and soft.
 const subject=film.shotId==='shore'||film.shotId==='farewell'?heroAnchor:film.shotId==='sai'?[saiBank,0,saiZ]:film.boatPosition;
 skyFill.target.position.set(subject[0],0,subject[2]);skyFill.position.copy(skyFill.target.position).addScaledVector(skyFillDirection,70);
 skyFill.target.updateMatrixWorld();
 // Practical lights.
 bowLantern.userData.update(t);bowLantern.userData.light.intensity=look.bowLight;bowLantern.userData.paper.color.setRGB(3.1,2.15,1.25).multiplyScalar(look.bowLight>0?1:.04);
 cheats.forEach((light,i)=>{const c=look.cheat&&look.cheat[i];light.intensity=c?c.intensity:0;if(c){light.position.fromArray(c.position);light.color.set(c.color);light.distance=c.distance;}});
 extinguishProgress=look.extinguish;
 const lanternLights=lanterns.userData.update(t,{position:film.boatPosition,yaw:heading},{visible:look.lanterns,extinguish:look.extinguish>0?extinguish:null,pulse:Math.abs(t-CROSSING_TIME)<2.5?breath:null});
 blooms.userData.update(t,{position:film.boatPosition,yaw:heading});
 const spiritLights=onibi.userData.update(t,look.onibi);
 collectLights(lanternLights,spiritLights,look.bowLight);
 godRays.aim(AFTERGLOW_DIRECTION,look.godRays);
 if(lilies.userData.update)lilies.userData.update(t);if(saiEnvironment.userData.update)saiEnvironment.userData.update(t);
 if(passenger.userData.update)passenger.userData.update(t);
 if(heroLycoris.userData.update)heroLycoris.userData.update(t);for(const flower of saiFlowers)flower.userData.update(t+flower.rotation.y);
 water.material.uniforms.time.value=t*.16;water.material.uniforms.boatPosition.value.set(boat.position.x,boat.position.z);water.material.uniforms.boatHeading.value=heading;water.material.uniforms.boatTime.value=t;
 composer.render();
}
window.ART_DURATION=DURATION;window.SHOTS=SHOTS;window.renderAt=renderAt;
window.__SANZU={scene,camera,renderer,boat,water,lilies,saiEnvironment,composer,heightFog,godRays,bloom,grade,groundMat,gravelMat,passenger,heroLycoris,filmSequence,lanterns,blooms,onibi,bowLantern,sky,filmSample:null};
window.addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();composer.setSize(innerWidth,innerHeight);renderAt(clock.time);});
renderAt(0);window.ART_STATS={flowerCount:lilies.userData.flowerCount,nearCount:lilies.children.filter(m=>m.name.includes('LOD 0')).reduce((n,m)=>n+m.count,0),flowerTriangles:lilies.userData.triangleCount,lanterns:lanterns.userData.count,triangles:renderer.info.render.triangles,drawCalls:renderer.info.render.calls};window.__ART_READY=true;
if(!capture){const start=performance.now();function frame(now){renderAt(((now-start)/1000)%DURATION);requestAnimationFrame(frame);}requestAnimationFrame(frame);}

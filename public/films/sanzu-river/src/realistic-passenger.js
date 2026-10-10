import {ShaderChunk} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

/** 白装束 (kyōkatabira closed right over left (左前), obi, neck bag with six coins, hand
 *  guards, prayer beads, gaiters, tabi, waraji); anatomical head and hands.
 *  Built by scripts/build-shiroshozoku.py and assemble-shiroshozoku-passenger.py. */
export async function createRealisticPassenger(THREE) {
  const {scene}=await new GLTFLoader().loadAsync(new URL('../assets/character/funeral-passenger-v2.glb',import.meta.url).href);
  scene.name='Departed passenger — anatomical model and simulated burial robe';
  const softened=new Map();
  scene.traverse(object=>{
    if(!object.isMesh)return;
    object.castShadow=true;object.receiveShadow=true;
    const materials=Array.isArray(object.material)?object.material:[object.material];
    for(const material of materials){
      for(const name of ['map','normalMap','roughnessMap','aoMap']){
        if(material[name])material[name].anisotropy=8;
      }
    }
    if(/linen|kyokatabira|zudabukuro|tabi|cord|cotton|tekko/i.test(materials[0].name)&&!/waraji/i.test(materials[0].name)){
      const cloth=softened.get(materials[0])??clothify(THREE,materials[0]);softened.set(materials[0],cloth);
      object.material=cloth;
    }
  });
  fitForeheadCloth(THREE,scene);
  scene.userData.description='A fictional deceased adult with closed eyelids, lowered head, pale skin, relaxed anatomical hands and a physically settled white burial kimono.';
  scene.userData.credits='Original head built for this film on the MakeHuman hm08 base mesh and targets (CC0); hands adapted from MakeHuman hm08 (CC0). See assets/CREDITS.md.';
  return scene;
}

// Linen and cotton: a soft sheen at grazing angles, and direct light that wraps a
// little past the terminator as it does through and around woven cloth, so the
// folds shade softly instead of breaking hard like paper.
const WRAPPED_LIGHT=ShaderChunk.lights_physical_pars_fragment.replace(
  'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
  'reflectedLight.directDiffuse += saturate( ( dot( geometryNormal, directLight.direction ) + clothWrap ) / ( 1.0 + clothWrap ) ) * directLight.color * BRDF_Lambert( material.diffuseColor );');
function clothify(THREE,source){
  const m=source.isMeshPhysicalMaterial?source.clone():Object.assign(new THREE.MeshPhysicalMaterial(),{
    name:source.name,color:source.color.clone(),map:source.map,normalMap:source.normalMap,normalScale:source.normalScale.clone(),
    roughnessMap:source.roughnessMap,aoMap:source.aoMap,side:source.side,
  });
  m.roughness=Math.max(.9,source.roughness??.9);m.metalness=0;
  m.sheen=1;m.sheenRoughness=.55;m.sheenColor=new THREE.Color(.50,.50,.48);
  m.specularIntensity=.35;
  if(m.normalMap)m.normalScale.multiplyScalar(1.6);
  m.onBeforeCompile=shader=>{
    shader.uniforms.clothWrap={value:.42};
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>','#include <common>\nuniform float clothWrap;')
      .replace('#include <lights_physical_pars_fragment>',WRAPPED_LIGHT);
  };
  m.customProgramCacheKey=()=>'woven-cloth-wrap-v1';
  return m;
}

// The exported 天冠 stands up from the brow like a cone. A real one is a flat
// white triangle tied against the forehead, apex up, its base on the binding just
// above the brows. Rebuild it by projecting a triangular sheet onto the forehead,
// a few millimetres proud of the skin.
function fitForeheadCloth(THREE,root){
  const byName=label=>{let found=null;root.traverse(o=>{if(!found&&o.isMesh&&o.name.replace(/_/g,' ').startsWith(label))found=o;});return found;};
  const cloth=byName('Triangular white burial forehead cloth'),head=byName('Anatomical head');
  if(!cloth||!head)return;
  root.updateMatrixWorld(true);
  const pose=cloth.parent,toWorld=pose.matrixWorld,toLocal=pose.matrixWorld.clone().invert();
  const raycaster=new THREE.Raycaster(),forward=new THREE.Vector3(0,0,1).transformDirection(toWorld);
  const cols=16,rows=14,grid=[];
  for(let j=0;j<=rows;j++){
    const v=j/rows,y=.181+v*.068,half=.051*Math.pow(1-v,1.04)+.0012;
    const row=[];
    for(let i=0;i<=cols;i++){
      const x=(i/cols*2-1)*half;
      raycaster.set(new THREE.Vector3(x,y,-.4).applyMatrix4(toWorld),forward);raycaster.far=.6;
      const hit=raycaster.intersectObject(head,false)[0];
      row.push(hit?hit.point.clone().applyMatrix4(toLocal).z:null);
    }
    grid.push(row);
  }
  // Rays above the skull miss: carry the brow's slope upward from the last hits.
  for(let i=0;i<=cols;i++){
    let last=null,slope=0;
    for(let j=0;j<=rows;j++){
      if(grid[j][i]===null)grid[j][i]=(last??-.09)+Math.max(slope,.0012);
      else if(last!==null)slope=grid[j][i]-last;
      last=grid[j][i];
    }
  }
  // Cloth is stiffer than skin: smooth the projected surface before offsetting it.
  for(let pass=0;pass<3;pass++)for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){
    const n=[grid[j][i],grid[j][Math.max(0,i-1)],grid[j][Math.min(cols,i+1)],grid[Math.max(0,j-1)][i],grid[Math.min(rows,j+1)][i]];
    grid[j][i]=n.reduce((a,b)=>a+b,0)/n.length;
  }
  const positions=[],uvs=[],index=[];
  for(let j=0;j<=rows;j++){
    const v=j/rows,y=.181+v*.068,half=.051*Math.pow(1-v,1.04)+.0012;
    for(let i=0;i<=cols;i++){
      const u=i/cols;
      // Thin cotton: a few soft ripples, and the edges lie pressed to the brow.
      const edge=Math.min(1,Math.min(u,1-u,1-v)*5),ripple=.0007*Math.sin(u*9.1+v*5.3)*Math.sin(v*7.7+1.3);
      positions.push((u*2-1)*half,y,Math.min(grid[j][i],grid[0][Math.round(cols/2)]+.03)-.0042-.0035*v+ripple+.0018*(1-edge));
      uvs.push(u,v);
      if(i<cols&&j<rows){const a=j*(cols+1)+i,b=a+cols+1;index.push(a,b,a+1,a+1,b,b+1);}
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geometry.setIndex(index);geometry.computeVertexNormals();
  const material=clothify(THREE,cloth.material);material.side=THREE.DoubleSide;
  const sheet=new THREE.Mesh(geometry,material);
  sheet.name='Flat triangular forehead cloth fitted to the brow';
  sheet.castShadow=sheet.receiveShadow=true;
  pose.add(sheet);
  cloth.visible=false;
}

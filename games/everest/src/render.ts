import * as T from 'three';
import { center, ground, COURSE, LENGTH, random, rampGradient, featureRampLift } from './course';
import type { Rider } from './sim';
import type { MountainEvent } from './events';

const snow = new T.MeshStandardMaterial({ color: 0xf5faff, roughness: .82, vertexColors: true });
const mat = (color: number, extra = {}) => new T.MeshStandardMaterial({ color, roughness: .8, ...extra });
const rockMat = mat(0x87949d, { roughness:.94 });
const iceMat = mat(0x8bcedd, { roughness: .32, metalness: .15, flatShading: true });
const darkMat = new T.MeshBasicMaterial({ color: 0x173e57 });
let softParticle:T.Texture|undefined;
function mesh(g: T.BufferGeometry, m: T.Material, parent: T.Object3D, x=0, y=0, z=0) { const o = new T.Mesh(g, m); o.position.set(x,y,z);o.receiveShadow=true; parent.add(o); return o; }
const box = (w:number,h:number,d:number) => new T.BoxGeometry(w,h,d);
function terrainHeight(s:number, x:number) {return ground(s,x);}
function hash(x:number,y:number){const n=Math.sin(x*127.1+y*311.7)*43758.5453;return n-Math.floor(n);}
function noise(x:number,y:number){const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);return T.MathUtils.lerp(T.MathUtils.lerp(hash(ix,iy),hash(ix+1,iy),u),T.MathUtils.lerp(hash(ix,iy+1),hash(ix+1,iy+1),u),v);}
function mountainGeo(radius:number,height:number,seed:number) {
  const n=80,p:number[]=[],uv:number[]=[],idx:number[]=[],colors:number[]=[];
  for(let j=0;j<=n;j++)for(let i=0;i<=n;i++){
    const x=(i/n*2-1)*radius,z=(j/n*2-1)*radius,rad=Math.sqrt((x/radius)**2+(z/radius)**2),a=Math.atan2(z,x);
    const profile=Math.max(0,1-rad/(.78+.14*Math.sin(a*3+seed)+.08*Math.cos(a*7)));
    const ridge=1-Math.abs(noise(x*.012+seed,z*.012)*2-1);
    const h=height*Math.pow(profile,1.45)+height*.08*ridge*Math.pow(Math.max(0,1-rad),.9)+noise(x*.045,z*.045)*height*.009*Math.max(0,1-rad);
    p.push(x,h,z);uv.push(x/70,z/70);
    if(i<n&&j<n){const a=j*(n+1)+i,b=a+1,c=a+n+1,d=c+1;idx.push(a,c,b,b,c,d);}
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();
  const normal=g.getAttribute('normal');for(let i=0;i<p.length/3;i++){const snowy=T.MathUtils.smoothstep(normal.getY(i)-noise(p[i*3]*.009,p[i*3+2]*.009)*.08,.25,.78);const c=new T.Color(0x59697b).lerp(new T.Color(0xe6f0fa),snowy);c.multiplyScalar(.9+noise(p[i*3]*.02,p[i*3+2]*.02)*.13);colors.push(c.r,c.g,c.b);}g.setAttribute('color',new T.Float32BufferAttribute(colors,3));return g;
}
function makeRider(color:number) {
  const group=new T.Group(), body=new T.Group(); group.add(body);
  const jacket=mat(color,{roughness:.72}),pants=mat(0x13252f),black=mat(0x15252e),goggles=mat(0xffc86f,{metalness:.85,roughness:.11});
  const shape=new T.Shape();shape.moveTo(-.24,-1.23);shape.bezierCurveTo(-.4,-1.9,.4,-1.9,.24,-1.23);shape.lineTo(.2,1.23);shape.bezierCurveTo(.35,1.8,-.35,1.8,-.2,1.23);shape.closePath();
  const board=mesh(new T.ExtrudeGeometry(shape,{depth:.065,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.025,bevelThickness:.015}),mat(0x122b35,{metalness:.28,roughness:.25}),body,0,.1,0);board.rotation.x=-Math.PI/2;
  mesh(box(.1,.02,2.75),mat(color,{metalness:.2}),body,0,.19,0);
  const bone=(a:number[],b:number[],radius:number,m:T.Material)=>{const v1=new T.Vector3(...a),v2=new T.Vector3(...b),delta=v2.clone().sub(v1);const o=mesh(new T.CapsuleGeometry(radius,Math.max(.01,delta.length()-radius*1.1),4,10),m,body);o.position.copy(v1.add(v2).multiplyScalar(.5));o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize());return o;};
  for(const side of [-1,1]){
    const boot=mesh(box(.55,.23,.31),black,body,.02,.29,side*.57);boot.rotation.y=side*.2;
    mesh(box(.39,.04,.36),mat(0x91a5ad),body,.02,.19,side*.57);
    bone([.02,.42,side*.57],[.25,.76,side*.5],.17,pants);bone([.25,.76,side*.5],[-.06,1.06,side*.18],.2,pants);
    bone([-.05,1.55,side*.32],[.23,1.28,side*.63],.15,jacket);bone([.23,1.28,side*.63],[.43,1.06,side*.47],.13,jacket);
    mesh(new T.SphereGeometry(.15,12,8),black,body,.43,1.04,side*.47);
  }
  const torso=mesh(new T.CapsuleGeometry(.31,.4,6,14),jacket,body,-.12,1.38,0);torso.scale.z=1.17;torso.rotation.z=-.2;
  const pack=mesh(new T.CapsuleGeometry(.21,.27,4,10),mat(0x1a3642),body,-.43,1.4,.04);pack.scale.x=.6;
  mesh(box(.055,.58,.63),mat(0x283b45),body,-.29,1.49,0);
  const helmet=mesh(new T.SphereGeometry(.255,24,16),black,body,-.11,1.99,-.06);helmet.scale.set(1,1.05,.98);
  const visor=mesh(new T.SphereGeometry(.26,24,12,0,Math.PI*.7,Math.PI*.3,Math.PI*.32),goggles,body,-.065,2.02,-.07);visor.rotation.y=Math.PI*.14;
  mesh(box(.29,.09,.39),mat(color),body,-.2,1.81,-.05);
  group.traverse(o=>{if(o instanceof T.Mesh){o.castShadow=true;o.receiveShadow=true;}});
  const shadow=mesh(new T.CircleGeometry(1.2,32),new T.MeshBasicMaterial({map:softParticle,color:0x2d4867,transparent:true,opacity:.12,depthWrite:false}),group,0,.025,0);shadow.rotation.x=-Math.PI/2;shadow.scale.set(.65,1.5,1);shadow.castShadow=false;
  return {group,body,shadow};
}
export class MountainView {
  renderer: T.WebGLRenderer; scene=new T.Scene(); cameras=[new T.PerspectiveCamera(69,1,.1,6200),new T.PerspectiveCamera(69,1,.1,6200)];
  avatars=new Map<string,ReturnType<typeof makeRider>>(); camerasReady=[false,false];
  flakes:T.Points; flakeArray:Float32Array; trails:T.LineSegments; trailArray=new Float32Array(3600); trailIndex=0;
  reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  eventMeshes=new Map<number,T.InstancedMesh>();
  eventClouds=new Map<number,T.Points>();
  scenery:{object:T.Object3D;s:number}[]=[];
  sun:T.DirectionalLight;powder:T.Points;powderArray=new Float32Array(600*3);powderVel=new Float32Array(600*3);powderLife=new Float32Array(600);powderCursor=0;
  constructor(container:HTMLElement) {
    this.renderer=new T.WebGLRenderer({antialias:true,powerPreference:'high-performance',preserveDrawingBuffer:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,matchMedia('(pointer:coarse)').matches?1.2:1.75)); this.renderer.setSize(innerWidth,innerHeight);
    this.renderer.outputColorSpace=T.SRGBColorSpace; this.renderer.toneMapping=T.ACESFilmicToneMapping; this.renderer.toneMappingExposure=.95;
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFShadowMap;
    container.append(this.renderer.domElement); this.scene.background=new T.Color(0x7baccc); this.scene.fog=new T.FogExp2(0x9ebfda,.00028);
    this.scene.add(new T.HemisphereLight(0xcce6ff,0x536b94,1.45));
    const sun=this.sun=new T.DirectionalLight(0xffe9c7,3.2);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-75;sun.shadow.camera.right=75;sun.shadow.camera.top=75;sun.shadow.camera.bottom=-75;sun.shadow.camera.near=1;sun.shadow.camera.far=650;sun.shadow.bias=-.0003;sun.shadow.normalBias=.12;sun.shadow.radius=2;sun.position.set(-150,280,-180);this.scene.add(sun,sun.target);
    const sky=new T.Mesh(new T.SphereGeometry(5800,24,16),new T.ShaderMaterial({side:T.BackSide,depthWrite:false,uniforms:{top:{value:new T.Color(0x327fbd)},bottom:{value:new T.Color(0xcfdfec)}},vertexShader:'varying vec3 vPos; void main(){vPos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec3 vPos;uniform vec3 top;uniform vec3 bottom;void main(){vec3 d=normalize(vPos);float h=d.y;vec3 c=mix(bottom,top,pow(max(0.,h),.5));float sun=max(0.,dot(d,normalize(vec3(-.45,.58,-.5))));c+=vec3(1.,.82,.56)*pow(sun,100.)*.4+vec3(1.,.95,.8)*pow(sun,2500.);float wisps=pow(.5+.5*sin(d.x*45.+sin(d.z*36.)*3.+d.y*82.),12.)*smoothstep(.04,.35,h)*(1.-smoothstep(.45,.9,h))*.06;c+=vec3(wisps*0.08);gl_FragColor=vec4(c,1.);}'}));
    sky.name='sky';this.scene.add(sky);
    const loader=new T.TextureLoader();const texture=(url:string,color=false)=>{const t=loader.load(url);t.wrapS=t.wrapT=T.RepeatWrapping;t.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());if(color)t.colorSpace=T.SRGBColorSpace;return t;};
    snow.map=texture(new URL('../assets/snow-color.jpg',import.meta.url).href,true);snow.normalMap=texture(new URL('../assets/snow-normal.jpg',import.meta.url).href);snow.normalScale.set(.24,.24);
    snow.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',T.ShaderChunk.map_fragment.replace('diffuseColor *= sampledDiffuseColor;','diffuseColor *= vec4(mix(vec3(1.0), sampledDiffuseColor.rgb, 0.23), sampledDiffuseColor.a);'));};
    rockMat.map=texture(new URL('../assets/rock-color.jpg',import.meta.url).href,true);rockMat.normalMap=texture(new URL('../assets/rock-normal.jpg',import.meta.url).href);rockMat.normalScale.set(.9,.9);
    for(let start=-200; start<LENGTH+600;start+=280) this.terrain(start);
    const rng=random(157);
    for(let s=-600; s<LENGTH+1800; s+=800) {
      for(const side of [-1,1]) {
        const h=600+rng()*950, r=600+rng()*500, x=side*(1700+rng()*650);
        const geo=mountainGeo(r,h,Math.floor(rng()*100000));geo.rotateY(rng()*6);
        // Sink each mountain's base into the descending surface instead of leaving a floating flat skirt.
        const positions=geo.getAttribute('position'),base=ground(s,x);
        for(let i=0;i<positions.count;i++)positions.setY(i,positions.getY(i)+ground(s-positions.getZ(i),x+positions.getX(i))-base);
        geo.computeVertexNormals();
        mesh(geo,snow,this.scene,x,Math.min(base-150,-h-120),-s);
      }
    }
    this.features(); this.camp();
    const stones=new T.InstancedMesh(new T.IcosahedronGeometry(1,0),rockMat,1900),stone=new T.Object3D();
    for(let i=0;i<1900;i++){const s=rng()*(LENGTH+200),x=(rng()-.5)*2400,k=.25+rng()*.8;stone.position.set(x,ground(s,x)-k*.25,-s);stone.rotation.set(rng(),rng()*6,rng());stone.scale.set(k*1.6,k*.65,k);stone.updateMatrix();stones.setMatrixAt(i,stone.matrix);}this.scene.add(stones);
    this.flakeArray=new Float32Array(480*3);
    for(let i=0;i<this.flakeArray.length;i+=3) { this.flakeArray[i]=(rng()-.5)*110;this.flakeArray[i+1]=rng()*45;this.flakeArray[i+2]=(rng()-.5)*120; }
    const fg=new T.BufferGeometry(); fg.setAttribute('position',new T.BufferAttribute(this.flakeArray,3));
    this.flakes=new T.Points(fg,new T.PointsMaterial({color:0xffffff,size:.12,transparent:true,opacity:.6,depthWrite:false}));this.scene.add(this.flakes);
    const tg=new T.BufferGeometry();tg.setAttribute('position',new T.BufferAttribute(this.trailArray,3));tg.setDrawRange(0,0);
    this.trails=new T.LineSegments(tg,new T.LineBasicMaterial({color:0x91b4c7,transparent:true,opacity:.5}));this.trails.frustumCulled=false;this.scene.add(this.trails);
    const pc=document.createElement('canvas');pc.width=64;pc.height=64;const ctx=pc.getContext('2d')!,grad=ctx.createRadialGradient(32,32,0,32,32,32);grad.addColorStop(0,'rgba(255,255,255,1)');grad.addColorStop(.3,'rgba(255,255,255,.65)');grad.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=grad;ctx.fillRect(0,0,64,64);softParticle=new T.CanvasTexture(pc);const pg=new T.BufferGeometry();pg.setAttribute('position',new T.BufferAttribute(this.powderArray,3));this.powder=new T.Points(pg,new T.PointsMaterial({map:softParticle,color:0xf3fbff,size:1.4,transparent:true,opacity:.65,depthWrite:false}));this.powder.frustumCulled=false;this.scene.add(this.powder);(this.flakes.material as T.PointsMaterial).map=softParticle;(this.flakes.material as T.PointsMaterial).needsUpdate=true;
    window.addEventListener('resize',()=>this.renderer.setSize(innerWidth,innerHeight));
  }
  terrain(start:number) {
    const vertices:number[]=[],colors:number[]=[],indices:number[]=[],uvs:number[]=[],nx=180,nz=36;
    for(let iz=0;iz<=nz;iz++) for(let ix=0;ix<=nx;ix++) {
      const s=start+iz/nz*280;
      const x=(ix/nx*2-1)*1850;
      vertices.push(center(s)+x,terrainHeight(s,x),-s);
      uvs.push(x/6,s/6);
      const shade=Math.sin(s*.007+x*.007)*.02+noise(x*.01,s*.01)*.035;
      const c=new T.Color(0xeaf3ff); c.multiplyScalar(.93+shade); colors.push(c.r,c.g,c.b);
      if(iz<nz&&ix<nx) { const a=iz*(nx+1)+ix,b=a+1,c=a+nx+1,d=c+1; indices.push(a,b,c,b,d,c); }
    }
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));g.setIndex(indices);g.computeVertexNormals();mesh(g,snow,this.scene);
  }
  features() {
    const rng=random(81);
    for(const f of COURSE) {
      const g=new T.Group(); g.position.set(center(f.s)+f.x,ground(f.s,f.x),-f.s);g.rotation.x=-.475;this.scene.add(g);
      this.scenery.push({object:g,s:f.s});
      if(f.kind==='rock') {
        const geo=new T.IcosahedronGeometry(1,2),p=geo.getAttribute('position');for(let i=0;i<p.count;i++){const k=.82+noise(p.getX(i)*3+f.id,p.getZ(i)*3)*.4;p.setXYZ(i,p.getX(i)*k,p.getY(i)*k,p.getZ(i)*k);}geo.computeVertexNormals();
        const r=mesh(geo,rockMat,g,0,f.size*.35,0);r.scale.set(f.width*.55,f.size*.65,f.width*.6);r.rotation.y=rng()*6;r.castShadow=true;
        const cap=mesh(new T.IcosahedronGeometry(1,2),snow,g,0,f.size*.76,-.1);cap.scale.set(f.width*.39,f.size*.18,f.width*.37);cap.castShadow=true;
      }
      if(f.kind==='ramp') {
        g.position.set(0,0,0);g.rotation.set(0,0,0);const p:number[]=[],uv:number[]=[],idx:number[]=[],col:number[]=[];
        for(let j=0;j<=12;j++)for(let i=0;i<=8;i++){const s=f.s-18+j/12*18,x=f.x+(i/8-.5)*f.width;p.push(x,ground(s,x)+featureRampLift(f,s,x),-s);uv.push(x/6,s/6);col.push(.95,.98,1);if(j<12&&i<8){const a=j*9+i;idx.push(a,a+1,a+9,a+1,a+10,a+9);}}
        const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(p,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setAttribute('color',new T.Float32BufferAttribute(col,3));geo.setIndex(idx);geo.computeVertexNormals();const deck=mesh(geo,snow,g);deck.castShadow=true;
      }
      if(f.kind==='gap') {
        const w=f.width/2,d=f.size/2;
        const shape=new T.Shape(); shape.moveTo(-w,-d); shape.lineTo(-w*.55,-d*.76);shape.lineTo(-w*.25,-d*1.12);shape.lineTo(w*.6,-d*.8);shape.lineTo(w,-d);shape.lineTo(w,d*.5);shape.lineTo(w*.6,d);shape.lineTo(0,d*.8);shape.lineTo(-w*.4,d*1.15);shape.lineTo(-w,d*.6);
        const crack=mesh(new T.ShapeGeometry(shape),darkMat,g,0,.24,0);crack.rotation.x=-Math.PI/2;
        for(const side of [-1,1]) { const lip=mesh(box(f.width,1.25,.65),iceMat,g,0,.2,side*d);lip.rotation.z=side*.01; }
      }
      if(f.kind==='ring') {
        const ring=mesh(new T.TorusGeometry(3.7,.19,6,32),mat(0xffc478,{emissive:0xff762f,emissiveIntensity:.45}),g,0,5,0);ring.rotation.x=.475;
      }
      if(f.kind==='boost') for(let i=0;i<3;i++) { const arrow=new T.Shape();arrow.moveTo(-2,0);arrow.lineTo(0,-2);arrow.lineTo(2,0);arrow.lineTo(2,1);arrow.lineTo(0,-1);arrow.lineTo(-2,1);const a=mesh(new T.ShapeGeometry(arrow),new T.MeshBasicMaterial({color:0x29bfc3,side:T.DoubleSide}),g,0,.14,i*3);a.rotation.x=-Math.PI/2; }
    }
    // Blue seracs frame the icefall; the middle stays broad and readable.
    const geo=new T.ConeGeometry(1,1,5), inst=new T.InstancedMesh(geo,iceMat,180),dummy=new T.Object3D();
    for(let i=0;i<180;i++) { const s=3800+rng()*1900,x=(i%2?1:-1)*(240+rng()*700),h=5+rng()*23;dummy.position.set(center(s)+x,terrainHeight(s,x)+h*.4,-s);dummy.rotation.set(rng()*.2,rng()*6,rng()*.25);dummy.scale.set(5+rng()*8,h,5+rng()*8);dummy.updateMatrix();inst.setMatrixAt(i,dummy.matrix); }inst.castShadow=true;this.scene.add(inst);
  }
  markers() {
    for(let s=0;s<LENGTH;s+=110) for(const side of [-1,1]) {
      const x=side*43,y=ground(s,x),wx=center(s)+x;
      mesh(box(.13,3.5,.13),mat(0x365c70),this.scene,wx,y+1.75,-s);
      const flag=mesh(new T.PlaneGeometry(1.5,.75),new T.MeshBasicMaterial({color:side>0?0xff9068:0x4fb8c1,side:T.DoubleSide}),this.scene,wx+.8,y+3,-s);flag.rotation.y=.3;
    }
    // Strings of expedition prayer flags at the summit.
    for(let i=0;i<26;i++) { const x=-42+i*3.3,s=25,y=ground(s,x)+5+Math.abs(x)*.02; mesh(box(1.15,.8,.04),mat([0xf5a257,0x58adcb,0xf2f0d7,0xd86f61,0x74a69b][i%5]),this.scene,center(s)+x,y,-s); }
  }
  camp() {
    for(let i=0;i<24;i++) { const s=LENGTH+10+(i%6)*14,x=(i<12?-1:1)*(25+Math.floor(i/6)*12);const tent=mesh(new T.ConeGeometry(4,4,4),mat(i%2?0xff9a35:0xf4ce70,{flatShading:true}),this.scene,center(s)+x,ground(s,x)+2,-s);tent.rotation.y=Math.PI/4; }
    const s=LENGTH;const g=new T.Group();g.position.set(center(s),ground(s),-s);this.scene.add(g);
    const glow=mesh(new T.CylinderGeometry(3,9,320,24,1,true),new T.MeshBasicMaterial({color:0xffa865,transparent:true,opacity:.16,depthWrite:false,side:T.DoubleSide}),g,0,160,0);glow.name='camp-beacon';
    const c=document.createElement('canvas');c.width=1024;c.height=128;const ctx=c.getContext('2d')!;ctx.fillStyle='#153d50';ctx.fillRect(0,0,1024,128);ctx.fillStyle='#fff3dc';ctx.font='bold 66px sans-serif';ctx.textAlign='center';ctx.fillText('BASE CAMP  /  5,364 M',512,88);
    const banner=mesh(new T.PlaneGeometry(32,4),new T.MeshBasicMaterial({map:new T.CanvasTexture(c),side:T.DoubleSide}),g,0,9,1);banner.rotation.x=-.15;
  }
  reset() { this.camerasReady=[false,false];this.trailIndex=0;this.trails.geometry.setDrawRange(0,0); }
  drawEvents(events:MountainEvent[],riders:Rider[],time:number,playing:boolean) {
    for(const e of events) {
      let m=this.eventMeshes.get(e.id);
      if(!m){m=new T.InstancedMesh(new T.IcosahedronGeometry(1,2),mat(0xe1edfc,{roughness:1}),100);m.frustumCulled=false;this.eventMeshes.set(e.id,m);this.scene.add(m);}
      m.visible=playing&&e.type!=='wind'&&riders.some(r=>r.s>e.s-230&&r.s<e.s+e.span+70);
      let cloud=this.eventClouds.get(e.id);if(!cloud){const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(new Float32Array(300),3));cloud=new T.Points(g,new T.PointsMaterial({map:(this.powder.material as T.PointsMaterial).map,color:0xf0f8ff,size:62,transparent:true,opacity:.4,depthWrite:false}));cloud.frustumCulled=false;this.eventClouds.set(e.id,cloud);this.scene.add(cloud);}cloud.visible=m.visible&&e.type==='avalanche';
      if(!m.visible)continue;
      const rng=random(e.id*87+Math.floor(e.s)),dummy=new T.Object3D();
      for(let i=0;i<100;i++){
        const f=(time*(e.type==='avalanche'?.19:.12)+rng())%1,s=e.s+rng()*e.span,x=e.side*(750-f*710),size=e.type==='avalanche'?12+rng()*22:2+rng()*7;
        dummy.position.set(center(s)+x,terrainHeight(s,x)+size*.35+(e.type==='serac'?Math.abs(Math.sin(f*15))*9:Math.sin(f*6)*2),-s);
        dummy.rotation.set(time*.7+i,time*.6,0);dummy.scale.set(size,size*(e.type==='avalanche'?.6:1.8),size);dummy.updateMatrix();m.setMatrixAt(i,dummy.matrix);
        cloud.geometry.getAttribute('position').setXYZ(i,dummy.position.x,dummy.position.y+size*.8,dummy.position.z);
      }m.instanceMatrix.needsUpdate=true;cloud.geometry.getAttribute('position').needsUpdate=true;
    }
  }
  draw(riders:Rider[], focuses:Rider[], dt:number, menu=false) {
    for(const item of this.scenery)item.object.visible=focuses.some(r=>Math.abs(item.s-r.s)<1100);
    const ids=new Set(riders.map(r=>r.id));for(const [id,a] of this.avatars)if(!ids.has(id)){this.scene.remove(a.group);this.avatars.delete(id);}
    for(const r of riders) {
      let a=this.avatars.get(r.id);if(!a){a=makeRider(r.color);this.avatars.set(r.id,a);this.scene.add(a.group);}
      a.group.position.set(center(r.s)+r.x,ground(r.s,r.x),-r.s);a.group.rotation.y=-r.heading;
      const slope=Math.atan((ground(r.s+Math.cos(r.heading),r.x+Math.sin(r.heading))-ground(r.s-Math.cos(r.heading),r.x-Math.sin(r.heading)))/2);
      const rampSlope=r.ramp>0?Math.atan(rampGradient(r.s,r.x)*Math.cos(r.heading)):0;
      a.body.position.y=r.height+r.ramp+.08;a.body.rotation.order='YXZ';a.body.rotation.set(r.height>0?slope*.35:slope+rampSlope,r.spin,-r.steer*.22);
      if(r.recover>0) a.body.rotation.z=Math.sin(r.time*16)*.6;
      a.shadow.material.opacity=.13/(1+r.height*.2);a.shadow.position.y=.03+r.ramp;a.shadow.rotation.x=-Math.PI/2+slope;
      if(!menu&&r.height<.2&&!r.finish&&dt>0){const amount=Math.ceil(dt*(Math.abs(r.steer)>.2?140:70));for(let n=0;n<amount;n++){const i=this.powderCursor++%600,j=i*3;this.powderArray.set([r.x+(Math.random()-.5)*.5,ground(r.s,r.x)+.15,-r.s+1],j);this.powderVel.set([-Math.sin(r.heading)*r.speed*.18+(Math.random()-.5)*7,2+Math.random()*4,Math.cos(r.heading)*r.speed*.16+Math.random()*3],j);this.powderLife[i]=.3+Math.random()*.65;}}
      if(r.height<.1&&!menu&&!r.finish&&dt>0) {
        const j=this.trailIndex++%600*6;const x=center(r.s)+r.x,z=-r.s;
        this.trailArray.set([x-.12,ground(r.s,r.x)+.08,z,x-r.vx*dt-.12,ground(r.s-r.speed*dt,r.x)+.08,z+r.speed*dt],j);
        this.trails.geometry.attributes.position.needsUpdate=true;this.trails.geometry.setDrawRange(0,Math.min(600,this.trailIndex)*2);
      }
    }
    for(let i=0;i<600;i++){const j=i*3;if(this.powderLife[i]>0){this.powderLife[i]-=dt;this.powderArray[j]+=this.powderVel[j]*dt;this.powderArray[j+1]+=this.powderVel[j+1]*dt;this.powderArray[j+2]+=this.powderVel[j+2]*dt;this.powderVel[j+1]-=8*dt;}else this.powderArray[j+1]=-9999;}this.powder.geometry.attributes.position.needsUpdate=true;
    const r=focuses[0]; this.flakes.position.set(r.x,ground(r.s,r.x)+4,-r.s-25);
    this.sun.position.set(r.x-150,ground(r.s,r.x)+280,-r.s-180);this.sun.target.position.set(r.x,ground(r.s,r.x),-r.s-20);this.sun.target.updateMatrixWorld();
    for(let i=0;i<this.flakeArray.length;i+=3){this.flakeArray[i+1]-=dt*3;if(this.flakeArray[i+1]<0)this.flakeArray[i+1]=45;this.flakeArray[i+2]+=dt*(r.speed*.6+8);if(this.flakeArray[i+2]>60)this.flakeArray[i+2]=-60;}
    this.flakes.geometry.attributes.position.needsUpdate=true;
    const w=innerWidth,h=innerHeight,split=focuses.length>1;this.renderer.setScissorTest(split);
    focuses.forEach((r,i)=>{
      const cam=this.cameras[i],vw=split?w/2:w;
      const dx=Math.sin(r.heading),ds=Math.cos(r.heading);
      const desired=new T.Vector3(r.x-dx*6,ground(r.s-ds*6,r.x-dx*6)+2.4+r.height*.6+r.ramp*.6,-r.s+ds*6);
      if(menu){desired.x+=18;desired.y+=4;desired.z+=12;}
      cam.position.lerp(desired,this.camerasReady[i]?1-Math.exp(-dt*11):1);this.camerasReady[i]=true;
      const target=new T.Vector3(r.x+dx*24,ground(r.s+ds*24,r.x+dx*24)+1.5+r.height*.35,-r.s-ds*24);
      if(menu)target.set(70,ground(r.s+80)+12,-r.s-80);
      cam.lookAt(target); cam.fov+=((menu?66:this.reduced?78:r.boosting?94:80+Math.min(6,r.speed*.1))-cam.fov)*Math.min(1,dt*4);cam.aspect=vw/h;cam.updateProjectionMatrix();
      this.scene.getObjectByName('sky')!.position.copy(cam.position);
      this.renderer.setViewport(i*vw,0,vw,h);if(split)this.renderer.setScissor(i*vw,0,vw,h);
      this.renderer.render(this.scene,cam);
    });
    this.renderer.setScissorTest(false);
  }
}

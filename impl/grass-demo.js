/* ============================================================
   grass-demo.js — 8장 잔디 렌더링 실시간 WebGL2 데모 (10기법)
   각 impl/08-*.html 페이지는 자기 기법의 캔버스 하나만 가진다.
   이 파일을 include하면 존재하는 캔버스의 데모만 초기화된다.
   (원본 mobile-grass-rendering.html의 로직을 그대로 이식)
   드래그=회전, 휠=줌.
   ============================================================ */
(function () {
"use strict";

/* ================= shared math ================= */
const M = {
  persp:(f,a,n,fa)=>{const t=1/Math.tan(f/2);return[t/a,0,0,0,0,t,0,0,0,0,(fa+n)/(n-fa),-1,0,0,2*fa*n/(n-fa),0];},
  mul:(a,b)=>{const r=new Array(16);for(let i=0;i<4;i++)for(let j=0;j<4;j++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+j]*b[i*4+k];r[i*4+j]=s;}return r;},
  look:(e,c,u)=>{const z=M.n(M.s(e,c)),x=M.n(M.cr(u,z)),y=M.cr(z,x);
    return[x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-M.d(x,e),-M.d(y,e),-M.d(z,e),1];},
  s:(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],
  cr:(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],
  d:(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],
  n:a=>{const l=Math.hypot(a[0],a[1],a[2])||1;return[a[0]/l,a[1]/l,a[2]/l];}
};
function field(count,R,seed){
  let s=seed; const rnd=()=>{s=Math.sin(s*12.9898+78.233)*43758.5453;return s-Math.floor(s);};
  const d=new Float32Array(count*6);
  for(let i=0;i<count;i++){const a=rnd()*6.283,r=Math.sqrt(rnd())*R,o=i*6;
    d[o]=Math.cos(a)*r; d[o+1]=Math.sin(a)*r; d[o+2]=rnd()*6.283;
    d[o+3]=0.8+rnd()*0.9; d[o+4]=rnd()*6.283; d[o+5]=rnd();}
  return d;
}
function camBasis(st,center){
  center=center||[0,2,0];
  const e=[Math.cos(st.yaw)*Math.cos(st.pitch)*st.dist,Math.sin(st.pitch)*st.dist+3,Math.sin(st.yaw)*Math.cos(st.pitch)*st.dist];
  const f=M.n(M.s(center,e)),r=M.n(M.cr(f,[0,1,0])),u=M.cr(r,f);
  return {e,f,r,u};
}
function bladeMesh(SEG){const vv=[];for(let i=0;i<=SEG;i++){const t=i/SEG;vv.push(-1,t,1,t);}return {arr:new Float32Array(vv),n:(SEG+1)*2};}
function instVAO(gl,bladeArr,fd){
  const bb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,bb);gl.bufferData(gl.ARRAY_BUFFER,bladeArr,gl.STATIC_DRAW);
  const ib=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,ib);gl.bufferData(gl.ARRAY_BUFFER,fd,gl.STATIC_DRAW);
  const va=gl.createVertexArray();gl.bindVertexArray(va);
  gl.bindBuffer(gl.ARRAY_BUFFER,bb);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
  gl.bindBuffer(gl.ARRAY_BUFFER,ib);
  gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,4,gl.FLOAT,false,24,0);gl.vertexAttribDivisor(1,1);
  gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,2,gl.FLOAT,false,24,16);gl.vertexAttribDivisor(2,1);
  gl.bindVertexArray(null);return va;}
const ENGINES={};
function engine(id,scale){
  scale=scale||1;
  const cv=document.getElementById(id);
  if(!cv) return null;
  const gl=cv.getContext('webgl2',{antialias:true,alpha:false});
  if(!gl){return null;}
  const st={gl,cv,scale,active:false,yaw:0.6,pitch:0.42,dist:24,spin:true,drag:false,lx:0,ly:0,t:0,fps:0,_a:0,_f:0,_l:performance.now()};
  ENGINES[id]=st;
  cv.addEventListener('pointerdown',e=>{st.drag=true;st.lx=e.clientX;st.ly=e.clientY;cv.setPointerCapture(e.pointerId);});
  cv.addEventListener('pointermove',e=>{if(!st.drag)return;st.yaw+=(e.clientX-st.lx)*0.008;st.pitch=Math.max(0.05,Math.min(1.2,st.pitch+(e.clientY-st.ly)*0.006));st.lx=e.clientX;st.ly=e.clientY;});
  cv.addEventListener('pointerup',()=>st.drag=false);
  cv.addEventListener('wheel',e=>{e.preventDefault();st.dist=Math.max(8,Math.min(60,st.dist+e.deltaY*0.02));},{passive:false});
  new ResizeObserver(()=>{const dpr=Math.min(devicePixelRatio||1,2)*scale;cv.width=Math.max(1,cv.clientWidth*dpr);cv.height=Math.max(1,cv.clientHeight*dpr);}).observe(cv);
  st.vp=function(){const asp=cv.width/cv.height||1;
    const e=[Math.cos(st.yaw)*Math.cos(st.pitch)*st.dist,Math.sin(st.pitch)*st.dist+3,Math.sin(st.yaw)*Math.cos(st.pitch)*st.dist];
    st.eye=e; return M.mul(M.persp(1.0,asp,0.1,220),M.look(e,[0,2,0],[0,1,0]));};
  st.loop=function(cb){function fr(now){
    if(!st.active){st._l=now;requestAnimationFrame(fr);return;}
    const dt=(now-st._l)/1000;st._l=now;st.t+=dt;st._a+=dt;st._f++;
    if(st._a>=0.5){st.fps=st._f/st._a;st._a=0;st._f=0;} if(st.spin)st.yaw+=dt*0.14;
    gl.viewport(0,0,cv.width,cv.height); cb(dt); requestAnimationFrame(fr);} requestAnimationFrame(fr);};
  return st;
}
function compile(gl,vs,fs){
  const c=(t,s)=>{const sh=gl.createShader(t);gl.shaderSource(sh,s);gl.compileShader(sh);
    if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw gl.getShaderInfoLog(sh);return sh;};
  const p=gl.createProgram();gl.attachShader(p,c(gl.VERTEX_SHADER,vs));gl.attachShader(p,c(gl.FRAGMENT_SHADER,fs));
  gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw gl.getProgramInfoLog(p);return p;}
function groundProg(gl){
  return compile(gl,
   `#version 300 es
    precision highp float;layout(location=0) in vec2 p;uniform mat4 uVP;out vec2 v;
    void main(){v=p;gl_Position=uVP*vec4(p.x*34.0,0.0,p.y*34.0,1.0);}`,
   `#version 300 es
    precision highp float;in vec2 v;out vec4 o;
    void main(){float r=length(v);o=vec4(mix(vec3(0.09,0.15,0.08),vec3(0.04,0.07,0.045),r),1.0);}`);
}
function groundVAO(gl){const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const va=gl.createVertexArray();gl.bindVertexArray(va);gl.bindBuffer(gl.ARRAY_BUFFER,b);
  gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);gl.bindVertexArray(null);return va;}
function grassCardTex(gl){
  const N=128,cvx=document.createElement('canvas');cvx.width=cvx.height=N;const x=cvx.getContext('2d');
  x.clearRect(0,0,N,N);
  for(let i=0;i<16;i++){const bx=8+Math.random()*112;const bw=6+Math.random()*7;const bend=(Math.random()-0.5)*36;
    const g=x.createLinearGradient(0,N,0,10);
    g.addColorStop(0,'#173a12');g.addColorStop(1,'#6bbf3a');
    x.fillStyle=g;x.beginPath();x.moveTo(bx-bw,N);
    x.quadraticCurveTo(bx+bend*0.5,N*0.5,bx+bend,8);
    x.quadraticCurveTo(bx+bend+bw*0.6,N*0.5,bx+bw,N);x.closePath();x.fill();}
  const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,cvx);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return t;}

const $=id=>document.getElementById(id);
const STATE={geo:{wire:false,spin:true},bill:{heat:false,spin:true},shell:{spin:true},terr:{lod:true,spin:true},
  ray:{spin:true},tramp:{spin:false},bez:{spin:true},toon:{spin:true},wind:{spin:false,vec:false},lod:{spin:true,rings:true}};

/* ============================================================ ① GEOMETRY ============================================================ */
function initGeo(){
  if(!$('c_geo'))return; const eng=engine('c_geo'); const hud=$('h_geo'); if(!eng){hud.textContent='WebGL2 미지원';return;}
  const gl=eng.gl;
  const SEG=6,vv=[];for(let i=0;i<=SEG;i++){const t=i/SEG;vv.push(-1,t,1,t);}
  const bA=new Float32Array(vv),bN=(SEG+1)*2;
  const MAX=120000,fd=field(MAX,30,1234.5);
  const VS=`#version 300 es
  precision highp float;
  layout(location=0) in vec2 aB;layout(location=1) in vec4 iA;layout(location=2) in vec2 iC;
  uniform mat4 uVP;uniform float uT,uW;out vec3 vCol;out float vT;
  void main(){float t=aB.y,side=aB.x,h=iA.w,ang=iA.z;float w=(1.0-t)*0.06;
    float sway=(sin(uT*1.6+iC.x+iA.x*0.3)+0.4*sin(uT*3.1+iC.x*1.7))*0.5*uW*t*t;
    vec3 dir=vec3(cos(ang),0.,sin(ang));vec3 p=vec3(iA.x,0.,iA.y);
    p+=dir*side*w;p.y+=t*h;p.x+=sway*0.9;p.z+=sway*0.5;
    vec3 c=mix(vec3(0.09,0.22,0.08),vec3(0.35,0.62,0.20),t)*mix(0.8,1.15,iC.y);
    vCol=c*mix(0.4,1.0,t);vT=t;gl_Position=uVP*vec4(p,1.);}`;
  const FS=`#version 300 es
  precision highp float;in vec3 vCol;in float vT;out vec4 o;
  void main(){o=vec4(vCol+vec3(0.04,0.07,0.02)*pow(vT,3.),1.);}`;
  let P;try{P=compile(gl,VS,FS);}catch(e){hud.textContent='셰이더:'+e;return;}
  const GP=groundProg(gl),gVao=groundVAO(gl);
  const bb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,bb);gl.bufferData(gl.ARRAY_BUFFER,bA,gl.STATIC_DRAW);
  const ib=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,ib);gl.bufferData(gl.ARRAY_BUFFER,fd,gl.STATIC_DRAW);
  const va=gl.createVertexArray();gl.bindVertexArray(va);
  gl.bindBuffer(gl.ARRAY_BUFFER,bb);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
  gl.bindBuffer(gl.ARRAY_BUFFER,ib);
  gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,4,gl.FLOAT,false,24,0);gl.vertexAttribDivisor(1,1);
  gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,2,gl.FLOAT,false,24,16);gl.vertexAttribDivisor(2,1);
  gl.bindVertexArray(null);
  const S={N:40000,W:1,C:1};
  $('geo_N').oninput=e=>{S.N=+e.target.value;$('geo_vN').textContent=S.N.toLocaleString();};
  $('geo_W').oninput=e=>{S.W=+e.target.value;$('geo_vW').textContent=S.W.toFixed(2);};
  $('geo_C').oninput=e=>{S.C=e.target.value/100;$('geo_vC').textContent=e.target.value+'%';};
  gl.clearColor(0.05,0.085,0.07,1);
  eng.loop(()=>{eng.spin=STATE.geo.spin;gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);const VP=eng.vp();
    gl.useProgram(GP);gl.uniformMatrix4fv(gl.getUniformLocation(GP,'uVP'),false,VP);
    gl.bindVertexArray(gVao);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    const n=Math.floor(S.N*S.C);
    gl.useProgram(P);gl.uniformMatrix4fv(gl.getUniformLocation(P,'uVP'),false,VP);
    gl.uniform1f(gl.getUniformLocation(P,'uT'),eng.t);gl.uniform1f(gl.getUniformLocation(P,'uW'),S.W);
    gl.bindVertexArray(va);
    gl.drawArraysInstanced(STATE.geo.wire?gl.LINE_STRIP:gl.TRIANGLE_STRIP,0,bN,n);
    hud.innerHTML=`FPS <b>${eng.fps.toFixed(0)}</b> · 잔디 <b>${n.toLocaleString()}</b><br>드로우콜 <b>1</b> · 정점/포기 ${bN}`;});
}

/* ============================================================ ② BILLBOARD ============================================================ */
function initBill(){
  if(!$('c_bill'))return; const eng=engine('c_bill');const hud=$('h_bill');if(!eng){hud.textContent='WebGL2 미지원';return;}
  const gl=eng.gl;
  const q=new Float32Array([-0.5,0, 0.5,0, -0.5,1, 0.5,1]);
  const MAX=40000,fd=field(MAX,30,77.7);
  const tex=grassCardTex(gl);
  const VS=`#version 300 es
  precision highp float;
  layout(location=0) in vec2 aQ;layout(location=1) in vec4 iA;layout(location=2) in vec2 iC;
  uniform mat4 uVP;uniform vec3 uRight;uniform float uT,uW;out vec2 vUv;out float vShade;
  void main(){float h=iA.w*1.6;vec3 c=vec3(iA.x,0.,iA.y);
    float sway=(sin(uT*1.5+iC.x)+0.4*sin(uT*3.0+iC.x*1.7))*0.5*uW*aQ.y*aQ.y;
    vec3 p=c+uRight*aQ.x*0.9+vec3(0.,aQ.y*h,0.);p.x+=sway;
    vUv=vec2(aQ.x+0.5,1.0-aQ.y);vShade=mix(0.5,1.0,aQ.y)*mix(0.85,1.1,iC.y);
    gl_Position=uVP*vec4(p,1.);}`;
  const FS=`#version 300 es
  precision highp float;in vec2 vUv;in float vShade;uniform sampler2D uTex;uniform int uHeat;out vec4 o;
  void main(){vec4 t=texture(uTex,vUv);
    if(uHeat==1){ if(t.a<0.3) discard; o=vec4(0.9,0.15,0.05,1.0); return; }
    if(t.a<0.3) discard; o=vec4(t.rgb*vShade,1.0);}`;
  let P;try{P=compile(gl,VS,FS);}catch(e){hud.textContent='셰이더:'+e;return;}
  const GP=groundProg(gl),gVao=groundVAO(gl);
  const qb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,qb);gl.bufferData(gl.ARRAY_BUFFER,q,gl.STATIC_DRAW);
  const ib=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,ib);gl.bufferData(gl.ARRAY_BUFFER,fd,gl.STATIC_DRAW);
  const va=gl.createVertexArray();gl.bindVertexArray(va);
  gl.bindBuffer(gl.ARRAY_BUFFER,qb);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
  gl.bindBuffer(gl.ARRAY_BUFFER,ib);
  gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,4,gl.FLOAT,false,24,0);gl.vertexAttribDivisor(1,1);
  gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,2,gl.FLOAT,false,24,16);gl.vertexAttribDivisor(2,1);
  gl.bindVertexArray(null);
  const S={N:12000,W:1};
  $('bill_N').oninput=e=>{S.N=+e.target.value;$('bill_vN').textContent=S.N.toLocaleString();};
  $('bill_W').oninput=e=>{S.W=+e.target.value;$('bill_vW').textContent=S.W.toFixed(2);};
  gl.clearColor(0.05,0.085,0.07,1);
  eng.loop(()=>{eng.spin=STATE.bill.spin;const heat=STATE.bill.heat;
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);const VP=eng.vp();
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(GP);gl.uniformMatrix4fv(gl.getUniformLocation(GP,'uVP'),false,VP);
    gl.bindVertexArray(gVao);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    const e=eng.eye,rgt=M.n(M.cr([0,1,0],M.n([e[0],0,e[2]])));
    gl.useProgram(P);gl.uniformMatrix4fv(gl.getUniformLocation(P,'uVP'),false,VP);
    gl.uniform3f(gl.getUniformLocation(P,'uRight'),rgt[0],rgt[1],rgt[2]);
    gl.uniform1f(gl.getUniformLocation(P,'uT'),eng.t);gl.uniform1f(gl.getUniformLocation(P,'uW'),S.W);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tex);gl.uniform1i(gl.getUniformLocation(P,'uTex'),0);
    gl.uniform1i(gl.getUniformLocation(P,'uHeat'),heat?1:0);
    if(heat){gl.disable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);}
    else{gl.enable(gl.DEPTH_TEST);gl.disable(gl.BLEND);}
    gl.bindVertexArray(va);gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,S.N);
    gl.disable(gl.BLEND);
    hud.innerHTML=`FPS <b>${eng.fps.toFixed(0)}</b> · 카드 <b>${S.N.toLocaleString()}</b> ×4정점<br>${heat?'<b style="color:#ff8b7a">오버드로우 히트맵</b>':'드로우콜 <b>1</b> · 알파테스트'}`;});
}

/* ============================================================ ③ SHELL ============================================================ */
function initShell(){
  if(!$('c_shell'))return; const eng=engine('c_shell');const hud=$('h_shell');if(!eng){hud.textContent='WebGL2 미지원';return;}
  const gl=eng.gl;eng.dist=20;eng.pitch=0.32;
  const gVao=groundVAO(gl);
  const VS=`#version 300 es
  precision highp float;layout(location=0) in vec2 p;
  uniform mat4 uVP;uniform float uT,uW;uniform int uLayers;
  out vec2 vUv;out float vH;
  void main(){int layer=gl_InstanceID;float ln=float(layer)/float(uLayers);
    float y=ln*1.4;
    vec3 wp=vec3(p.x*30.0,y,p.y*30.0);
    float sway=(sin(uT*1.3+wp.x*0.15+wp.z*0.12))*uW*ln*ln*0.7;
    wp.x+=sway;wp.z+=sway*0.4;
    vUv=p*55.0; vH=ln;
    gl_Position=uVP*vec4(wp,1.);}`;
  const FS=`#version 300 es
  precision highp float;in vec2 vUv;in float vH;uniform float uDensity;out vec4 o;
  float hash(vec2 c){return fract(sin(dot(c,vec2(41.3,289.1)))*43758.5453);}
  void main(){
    vec2 cell=floor(vUv);
    float r1=hash(cell), r2=hash(cell+3.7), r3=hash(cell+7.1);
    if(r1>uDensity) discard;
    float maxH=0.45+0.55*r2;
    if(vH>maxH) discard;
    float t=vH/maxH;
    vec2 center=vec2(0.3+0.4*r2,0.3+0.4*r3);
    vec2 f=fract(vUv)-center;
    f-=vec2(r2-0.5,r3-0.5)*t*0.7;
    float radius=0.30*(1.0-t);
    if(length(f)>radius) discard;
    vec3 c=mix(vec3(0.07,0.19,0.06),vec3(0.46,0.74,0.27),t)*mix(0.7,1.1,r1);
    o=vec4(c,1.0);}`;
  let P;try{P=compile(gl,VS,FS);}catch(e){hud.textContent='셰이더:'+e;return;}
  const S={L:24,D:0.55,W:1};
  $('shell_L').oninput=e=>{S.L=+e.target.value;$('shell_vL').textContent=S.L;};
  $('shell_D').oninput=e=>{S.D=+e.target.value;$('shell_vD').textContent=S.D.toFixed(2);};
  $('shell_W').oninput=e=>{S.W=+e.target.value;$('shell_vW').textContent=S.W.toFixed(2);};
  gl.clearColor(0.05,0.085,0.07,1);
  eng.loop(()=>{eng.spin=STATE.shell.spin;gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);const VP=eng.vp();
    gl.useProgram(P);gl.uniformMatrix4fv(gl.getUniformLocation(P,'uVP'),false,VP);
    gl.uniform1f(gl.getUniformLocation(P,'uT'),eng.t);gl.uniform1f(gl.getUniformLocation(P,'uW'),S.W);
    gl.uniform1f(gl.getUniformLocation(P,'uDensity'),S.D);gl.uniform1i(gl.getUniformLocation(P,'uLayers'),S.L);
    gl.bindVertexArray(gVao);gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,S.L);
    hud.innerHTML=`FPS <b>${eng.fps.toFixed(0)}</b> · 레이어 <b>${S.L}</b><br>드로우콜 <b>1</b> · 픽셀 오버드로우 ×${S.L}`;});
}

/* ============================================================ ④ TERRAIN TEXTURE ============================================================ */
function initTerr(){
  if(!$('c_terr'))return; const eng=engine('c_terr');const hud=$('h_terr');if(!eng){hud.textContent='WebGL2 미지원';return;}
  const gl=eng.gl;
  const GVS=`#version 300 es
  precision highp float;layout(location=0) in vec2 p;uniform mat4 uVP;out vec2 v;
  void main(){v=p;gl_Position=uVP*vec4(p.x*34.0,0.0,p.y*34.0,1.0);}`;
  const GFS=`#version 300 es
  precision highp float;in vec2 v;out vec4 o;
  float h(vec2 c){return fract(sin(dot(c,vec2(41.3,289.1)))*43758.5453);}
  float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
  void main(){vec2 uv=v*40.0;float n=noise(uv)*0.6+noise(uv*3.0)*0.3+noise(uv*9.0)*0.1;
    vec3 c=mix(vec3(0.10,0.20,0.08),vec3(0.30,0.5,0.18),n);
    c*=0.8+0.2*noise(uv*20.0);o=vec4(c,1.0);}`;
  const GP=compile(gl,GVS,GFS),gVao=groundVAO(gl);
  const SEG=5,vv=[];for(let i=0;i<=SEG;i++){const t=i/SEG;vv.push(-1,t,1,t);}
  const bA=new Float32Array(vv),bN=(SEG+1)*2;
  const NEAR=9000,fd=field(NEAR,9,55.5);
  const VS=`#version 300 es
  precision highp float;layout(location=0) in vec2 aB;layout(location=1) in vec4 iA;layout(location=2) in vec2 iC;
  uniform mat4 uVP;uniform float uT;out vec3 vCol;out float vT;
  void main(){float t=aB.y,side=aB.x,h=iA.w,ang=iA.z;float w=(1.0-t)*0.06;
    float sway=sin(uT*1.6+iC.x)*0.3*t*t;vec3 dir=vec3(cos(ang),0.,sin(ang));
    vec3 p=vec3(iA.x,0.,iA.y);p+=dir*side*w;p.y+=t*h;p.x+=sway;
    vCol=mix(vec3(0.09,0.22,0.08),vec3(0.35,0.62,0.20),t)*mix(0.4,1.0,t);vT=t;
    gl_Position=uVP*vec4(p,1.);}`;
  const FS=`#version 300 es
  precision highp float;in vec3 vCol;in float vT;out vec4 o;void main(){o=vec4(vCol,1.);}`;
  let P;try{P=compile(gl,VS,FS);}catch(e){hud.textContent='셰이더:'+e;return;}
  const bb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,bb);gl.bufferData(gl.ARRAY_BUFFER,bA,gl.STATIC_DRAW);
  const ib=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,ib);gl.bufferData(gl.ARRAY_BUFFER,fd,gl.STATIC_DRAW);
  const va=gl.createVertexArray();gl.bindVertexArray(va);
  gl.bindBuffer(gl.ARRAY_BUFFER,bb);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
  gl.bindBuffer(gl.ARRAY_BUFFER,ib);
  gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,4,gl.FLOAT,false,24,0);gl.vertexAttribDivisor(1,1);
  gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,2,gl.FLOAT,false,24,16);gl.vertexAttribDivisor(2,1);
  gl.bindVertexArray(null);
  gl.clearColor(0.05,0.085,0.07,1);
  eng.loop(()=>{eng.spin=STATE.terr.spin;gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);const VP=eng.vp();
    gl.useProgram(GP);gl.uniformMatrix4fv(gl.getUniformLocation(GP,'uVP'),false,VP);
    gl.bindVertexArray(gVao);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    let n=0;if(STATE.terr.lod){n=NEAR;gl.useProgram(P);
      gl.uniformMatrix4fv(gl.getUniformLocation(P,'uVP'),false,VP);gl.uniform1f(gl.getUniformLocation(P,'uT'),eng.t);
      gl.bindVertexArray(va);gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,bN,n);}
    hud.innerHTML=`FPS <b>${eng.fps.toFixed(0)}</b> · 지형 텍스처 1장<br>${n?('근경 blade <b>'+n.toLocaleString()+'</b> (하이브리드)'):'<b>순수 텍스처</b> (가장 쌈)'}`;});
}

/* ============================================================ ⑤ RAYMARCH ============================================================ */
function initRay(){
  if(!$('c_ray'))return; const eng=engine('c_ray',0.72);const hud=$('h_ray');if(!eng){hud.textContent='WebGL2 미지원';return;}
  const gl=eng.gl;eng.dist=12;eng.pitch=0.30;
  const VS=`#version 300 es
  precision highp float;layout(location=0) in vec2 p;out vec2 uv;
  void main(){uv=p;gl_Position=vec4(p,0.,1.);}`;
  const FS=`#version 300 es
  precision highp float;out vec4 O;in vec2 uv;
  uniform vec3 uRo,uF,uR,uU;uniform float uAsp,uT,uFreq,uWind;uniform int uSteps;
  vec2 h2(vec2 p){p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));return fract(sin(p)*43758.5453);}
  float dens(vec3 wp){
    float h=wp.y; if(h<0.0||h>1.0) return 0.0;
    vec2 wind=vec2(sin(uT*1.2+wp.z*0.6),cos(uT*1.0+wp.x*0.6))*0.12*h*h*uWind;
    vec2 xz=(wp.xz+wind)*uFreq; vec2 cell=floor(xz); float d=9.0;
    for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){vec2 g=vec2(float(i),float(j));
      vec2 o=h2(cell+g);vec2 pos=cell+g+o;float dd=length(xz-pos);d=min(d,dd);}
    return d<0.42*(1.0-h)?1.0:0.0;
  }
  void main(){
    vec3 rd=normalize(uF+(uv.x*uAsp*uR+uv.y*uU)*0.55),ro=uRo;
    vec3 sky=mix(vec3(0.55,0.72,0.85),vec3(0.20,0.36,0.52),clamp(rd.y,0.,1.));
    vec3 col=sky; float tHit=34.0;
    if(rd.y<-0.0001){
      float tE=max((1.0-ro.y)/rd.y,0.0);
      float tG=(0.0-ro.y)/rd.y;
      float step=clamp((tG-tE)/float(uSteps),0.008,0.35);
      float t=tE; bool found=false;
      for(int i=0;i<200;i++){ if(i>=uSteps) break;
        vec3 p=ro+rd*t;
        if(dens(p)>0.5){ float h=p.y;
          col=mix(vec3(0.05,0.16,0.04),vec3(0.5,0.78,0.28),h)*mix(0.3,1.0,h)*(0.6+0.4*h);
          tHit=t; found=true; break; }
        if(p.y<=0.0) break;
        t+=step;
      }
      if(!found){ vec3 p=ro+rd*t;
        if(p.y<=0.03){ col=vec3(0.10,0.14,0.07); tHit=tG; }
        else { tHit=t; } }
    }
    float fog=1.0-exp(-tHit*0.05); col=mix(col,sky,fog*0.7);
    O=vec4(pow(max(col,0.0),vec3(0.9)),1.0);
  }`;
  let P;try{P=compile(gl,VS,FS);}catch(e){hud.textContent='셰이더:'+e;return;}
  const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const va=gl.createVertexArray();gl.bindVertexArray(va);gl.bindBuffer(gl.ARRAY_BUFFER,b);
  gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);gl.bindVertexArray(null);
  const S={F:5,W:1,steps:90};
  $('ray_F').oninput=e=>{S.F=+e.target.value;$('ray_vF').textContent=S.F.toFixed(1);};
  $('ray_W').oninput=e=>{S.W=+e.target.value;$('ray_vW').textContent=S.W.toFixed(2);};
  $('ray_S').oninput=e=>{S.steps=+e.target.value;$('ray_vS').textContent=S.steps;};
  eng.loop(()=>{eng.spin=STATE.ray.spin;const cb=camBasis(eng,[0,0.3,0]);const asp=eng.cv.width/eng.cv.height||1;
    gl.disable(gl.DEPTH_TEST);gl.useProgram(P);
    const L=n=>gl.getUniformLocation(P,n);
    gl.uniform3f(L('uRo'),cb.e[0],cb.e[1],cb.e[2]);gl.uniform3f(L('uF'),cb.f[0],cb.f[1],cb.f[2]);
    gl.uniform3f(L('uR'),cb.r[0],cb.r[1],cb.r[2]);gl.uniform3f(L('uU'),cb.u[0],cb.u[1],cb.u[2]);
    gl.uniform1f(L('uAsp'),asp);gl.uniform1f(L('uT'),eng.t);gl.uniform1f(L('uFreq'),S.F);
    gl.uniform1f(L('uWind'),S.W);gl.uniform1i(L('uSteps'),S.steps);
    gl.bindVertexArray(va);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    hud.innerHTML=`FPS <b>${eng.fps.toFixed(0)}</b> · 메시 <b>0</b> (레이마칭)<br>스텝 ${S.steps} · 3D 셀노이즈`;});
}

/* ============================================================ ⑥ TRAMPLE ============================================================ */
function initTramp(){
  if(!$('c_tramp'))return; const eng=engine('c_tramp');const hud=$('h_tramp');if(!eng){hud.textContent='WebGL2 미지원';return;}
  const gl=eng.gl;const bm=bladeMesh(6);const N=45000,fd=field(N,18,321.0);
  const VS=`#version 300 es
  precision highp float;layout(location=0) in vec2 aB;layout(location=1) in vec4 iA;layout(location=2) in vec2 iC;
  uniform mat4 uVP;uniform float uT,uW,uRad;uniform vec2 uPlayer;out vec3 vCol;out float vT;
  void main(){float t=aB.y,side=aB.x,h=iA.w,ang=iA.z;float w=(1.0-t)*0.06;
    vec3 dir=vec3(cos(ang),0.,sin(ang));vec3 p=vec3(iA.x,0.,iA.y);
    float sway=(sin(uT*1.6+iC.x)+0.4*sin(uT*3.1+iC.x*1.7))*0.5*uW*t*t;
    vec2 toB=p.xz-uPlayer;float d=length(toB);float infl=smoothstep(uRad,0.0,d);
    vec2 away=normalize(toB+vec2(0.0001));
    p+=dir*side*w;p.y+=t*h;p.x+=sway*0.9;p.z+=sway*0.5;
    p.xz+=away*infl*t*1.0; p.y-=infl*t*h*0.8;
    vec3 c=mix(vec3(0.09,0.22,0.08),vec3(0.35,0.62,0.20),t)*mix(0.8,1.15,iC.y);
    c=mix(c,c*vec3(1.15,0.98,0.7),infl*0.6);
    vCol=c*mix(0.4,1.0,t);vT=t;gl_Position=uVP*vec4(p,1.);}`;
  const FS=`#version 300 es
  precision highp float;in vec3 vCol;in float vT;out vec4 o;
  void main(){o=vec4(vCol+vec3(0.04,0.07,0.02)*pow(vT,3.),1.);}`;
  let P;try{P=compile(gl,VS,FS);}catch(e){hud.textContent='셰이더:'+e;return;}
  const GP=groundProg(gl),gVao=groundVAO(gl);const va=instVAO(gl,bm.arr,fd);
  const S={W:1,rad:3,player:[0,0],mouse:false};
  $('tramp_R').oninput=e=>{S.rad=+e.target.value;$('tramp_vR').textContent=S.rad.toFixed(1);};
  $('tramp_W').oninput=e=>{S.W=+e.target.value;$('tramp_vW').textContent=S.W.toFixed(2);};
  eng.cv.addEventListener('pointermove',e=>{ if(e.buttons!==0) return;
    const rect=eng.cv.getBoundingClientRect();
    const nx=((e.clientX-rect.left)/rect.width)*2-1, ny=-(((e.clientY-rect.top)/rect.height)*2-1);
    const cb=camBasis(eng,[0,2,0]),asp=rect.width/rect.height;
    const rd=M.n([cb.f[0]+(nx*asp*cb.r[0]+ny*cb.u[0])*0.55,cb.f[1]+(nx*asp*cb.r[1]+ny*cb.u[1])*0.55,cb.f[2]+(nx*asp*cb.r[2]+ny*cb.u[2])*0.55]);
    if(Math.abs(rd[1])<1e-4) return; const tt=-cb.e[1]/rd[1]; if(tt<0) return;
    S.mouse=true; S.player=[cb.e[0]+rd[0]*tt, cb.e[2]+rd[2]*tt]; });
  gl.clearColor(0.05,0.085,0.07,1);
  eng.loop(()=>{eng.spin=STATE.tramp.spin;gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);const VP=eng.vp();
    if(!S.mouse){S.player=[Math.cos(eng.t*0.8)*7,Math.sin(eng.t*0.8)*7];}
    gl.useProgram(GP);gl.uniformMatrix4fv(gl.getUniformLocation(GP,'uVP'),false,VP);
    gl.bindVertexArray(gVao);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.useProgram(P);const L=n=>gl.getUniformLocation(P,n);
    gl.uniformMatrix4fv(L('uVP'),false,VP);gl.uniform1f(L('uT'),eng.t);gl.uniform1f(L('uW'),S.W);
    gl.uniform1f(L('uRad'),S.rad);gl.uniform2f(L('uPlayer'),S.player[0],S.player[1]);
    gl.bindVertexArray(va);gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,bm.n,N);
    hud.innerHTML=`FPS <b>${eng.fps.toFixed(0)}</b> · 잔디 <b>${N.toLocaleString()}</b><br>밟힘 (${S.player[0].toFixed(1)}, ${S.player[1].toFixed(1)}) ${S.mouse?'· 마우스':'· 자동'}`;});
}

/* ============================================================ ⑦ BEZIER ============================================================ */
function initBez(){
  if(!$('c_bez'))return; const eng=engine('c_bez');const hud=$('h_bez');if(!eng){hud.textContent='WebGL2 미지원';return;}
  const gl=eng.gl;const bm=bladeMesh(9),MAX=90000,fd=field(MAX,26,808.0);
  const VS=`#version 300 es
  precision highp float;layout(location=0) in vec2 aB;layout(location=1) in vec4 iA;layout(location=2) in vec2 iC;
  uniform mat4 uVP;uniform float uT,uW,uCurl;out vec3 vCol;out float vT;
  void main(){float t=aB.y,side=aB.x,h=iA.w,ang=iA.z;float w=(1.0-t)*0.055;
    vec3 dir=vec3(cos(ang),0.,sin(ang));vec3 nrm=vec3(-dir.z,0.,dir.x);
    float lean=(0.5+iC.y*0.9)*uCurl;
    float wind=(sin(uT*1.5+iC.x)+0.4*sin(uT*3.0+iC.x*1.7))*0.5*uW;
    lean+=wind*0.8;
    vec3 P0=vec3(0.), P1=nrm*lean*0.15+vec3(0,h*0.35,0), P2=nrm*lean*0.5+vec3(0,h*0.7,0), P3=nrm*lean*0.9+vec3(0,h,0);
    float u=t, iu=1.0-u;
    vec3 cpos=iu*iu*iu*P0+3.0*iu*iu*u*P1+3.0*iu*u*u*P2+u*u*u*P3;
    vec3 base=vec3(iA.x,0.,iA.y);
    vec3 p=base+cpos+dir*side*w;
    vec3 c=mix(vec3(0.08,0.2,0.07),vec3(0.4,0.66,0.24),t)*mix(0.85,1.12,iC.y);
    vCol=c*mix(0.4,1.0,t);vT=t;gl_Position=uVP*vec4(p,1.);}`;
  const FS=`#version 300 es
  precision highp float;in vec3 vCol;in float vT;out vec4 o;
  void main(){o=vec4(vCol+vec3(0.05,0.08,0.03)*pow(vT,3.),1.);}`;
  let P;try{P=compile(gl,VS,FS);}catch(e){hud.textContent='셰이더:'+e;return;}
  const GP=groundProg(gl),gVao=groundVAO(gl);const va=instVAO(gl,bm.arr,fd);
  const S={N:30000,C:1,W:1};
  $('bez_N').oninput=e=>{S.N=+e.target.value;$('bez_vN').textContent=S.N.toLocaleString();};
  $('bez_C').oninput=e=>{S.C=+e.target.value;$('bez_vC').textContent=S.C.toFixed(2);};
  $('bez_W').oninput=e=>{S.W=+e.target.value;$('bez_vW').textContent=S.W.toFixed(2);};
  gl.clearColor(0.05,0.085,0.07,1);
  eng.loop(()=>{eng.spin=STATE.bez.spin;gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);const VP=eng.vp();
    gl.useProgram(GP);gl.uniformMatrix4fv(gl.getUniformLocation(GP,'uVP'),false,VP);
    gl.bindVertexArray(gVao);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.useProgram(P);const L=n=>gl.getUniformLocation(P,n);
    gl.uniformMatrix4fv(L('uVP'),false,VP);gl.uniform1f(L('uT'),eng.t);gl.uniform1f(L('uW'),S.W);gl.uniform1f(L('uCurl'),S.C);
    gl.bindVertexArray(va);gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,bm.n,S.N);
    hud.innerHTML=`FPS <b>${eng.fps.toFixed(0)}</b> · 잔디 <b>${S.N.toLocaleString()}</b><br>큐빅 베지어 · 9세그먼트`;});
}

/* ============================================================ ⑧ TOON ============================================================ */
function initToon(){
  if(!$('c_toon'))return; const eng=engine('c_toon');const hud=$('h_toon');if(!eng){hud.textContent='WebGL2 미지원';return;}
  const gl=eng.gl;const bm=bladeMesh(4),MAX=80000,fd=field(MAX,24,1212.0);
  const VS=`#version 300 es
  precision highp float;layout(location=0) in vec2 aB;layout(location=1) in vec4 iA;layout(location=2) in vec2 iC;
  uniform mat4 uVP;uniform float uT,uW;out float vT;out float vV;
  void main(){float t=aB.y,side=aB.x,h=iA.w*1.15,ang=iA.z;float w=(1.0-t*0.6)*0.11;
    float sway=(sin(uT*1.4+iC.x)+0.4*sin(uT*2.8+iC.x*1.7))*0.5*uW*t*t;
    vec3 dir=vec3(cos(ang),0.,sin(ang));vec3 p=vec3(iA.x,0.,iA.y);
    p+=dir*side*w;p.y+=t*h;p.x+=sway;p.z+=sway*0.4;
    vT=t;vV=iC.y;gl_Position=uVP*vec4(p,1.);}`;
  const FS=`#version 300 es
  precision highp float;in float vT;in float vV;uniform float uBands;out vec4 o;
  void main(){float g=vT; float band=clamp(floor(g*uBands)/(uBands-1.0),0.0,1.0);
    vec3 dark=vec3(0.06,0.20,0.05), lite=vec3(0.55,0.82,0.32);
    vec3 c=mix(dark,lite,band); c=mix(c,c*vec3(1.05,1.02,0.85),step(0.95,g));
    c*=mix(0.9,1.1,vV);
    o=vec4(c,1.0);}`;
  let P;try{P=compile(gl,VS,FS);}catch(e){hud.textContent='셰이더:'+e;return;}
  const GP=groundProg(gl),gVao=groundVAO(gl);const va=instVAO(gl,bm.arr,fd);
  const S={N:28000,B:3,W:1};
  $('toon_N').oninput=e=>{S.N=+e.target.value;$('toon_vN').textContent=S.N.toLocaleString();};
  $('toon_B').oninput=e=>{S.B=+e.target.value;$('toon_vB').textContent=S.B;};
  $('toon_W').oninput=e=>{S.W=+e.target.value;$('toon_vW').textContent=S.W.toFixed(2);};
  gl.clearColor(0.07,0.12,0.10,1);
  eng.loop(()=>{eng.spin=STATE.toon.spin;gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);const VP=eng.vp();
    gl.useProgram(GP);gl.uniformMatrix4fv(gl.getUniformLocation(GP,'uVP'),false,VP);
    gl.bindVertexArray(gVao);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.useProgram(P);const L=n=>gl.getUniformLocation(P,n);
    gl.uniformMatrix4fv(L('uVP'),false,VP);gl.uniform1f(L('uT'),eng.t);gl.uniform1f(L('uW'),S.W);gl.uniform1f(L('uBands'),S.B);
    gl.bindVertexArray(va);gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,bm.n,S.N);
    hud.innerHTML=`FPS <b>${eng.fps.toFixed(0)}</b> · 잔디 <b>${S.N.toLocaleString()}</b><br>툰 셰이딩 · 색밴드 ${S.B}`;});
}

/* ============================================================ ⑨ WIND GRID / VORTICLES ============================================================ */
function initWind(){
  if(!$('c_wind'))return; const eng=engine('c_wind');const hud=$('h_wind');if(!eng){hud.textContent='WebGL2 미지원';return;}
  const gl=eng.gl;eng.pitch=0.55;eng.dist=26;const bm=bladeMesh(6),N=55000,fd=field(N,26,42.0);
  const WINDGLSL=`
    vec2 windAt(vec2 pos,float t,float wS,float vS){
      vec2 dirW=vec2(0.8,0.35);
      float gust=sin(dot(pos,normalize(dirW))*0.25 - t*1.6)*0.5+0.5;
      vec2 base=normalize(dirW)*gust*wS;
      vec2 vc=vec2(cos(t*0.5),sin(t*0.5))*10.0;
      vec2 rel=pos-vc; float r=length(rel);
      vec2 tang=vec2(-rel.y,rel.x)/(r+1.0);
      vec2 vort=tang*exp(-r*0.08)*vS*2.0;
      return base+vort;
    }`;
  const VS=`#version 300 es
  precision highp float;layout(location=0) in vec2 aB;layout(location=1) in vec4 iA;layout(location=2) in vec2 iC;
  uniform mat4 uVP;uniform float uT,uWs,uVs;out vec3 vCol;out float vT;
  ${WINDGLSL}
  void main(){float t=aB.y,side=aB.x,h=iA.w,ang=iA.z;float w=(1.0-t)*0.06;
    vec3 dir=vec3(cos(ang),0.,sin(ang));vec3 p=vec3(iA.x,0.,iA.y);
    vec2 wv=windAt(p.xz,uT,uWs,uVs); float mag=length(wv);
    p+=dir*side*w;p.y+=t*h;
    p.xz+=wv*t*t*0.35; p.y-=min(mag,2.0)*t*h*0.12;
    vec3 c=mix(vec3(0.09,0.22,0.08),vec3(0.36,0.62,0.20),t);
    c=mix(c,vec3(0.6,0.75,0.3),clamp(mag*0.15,0.,0.4));
    vCol=c*mix(0.4,1.0,t);vT=t;gl_Position=uVP*vec4(p,1.);}`;
  const FS=`#version 300 es
  precision highp float;in vec3 vCol;in float vT;out vec4 o;
  void main(){o=vec4(vCol,1.);}`;
  let P;try{P=compile(gl,VS,FS);}catch(e){hud.textContent='셰이더:'+e;return;}
  const AVS=`#version 300 es
  precision highp float;layout(location=0) in vec2 aP;layout(location=1) in vec2 iCell;
  uniform mat4 uVP;uniform float uT,uWs,uVs;out float vHead;
  ${WINDGLSL}
  void main(){vec2 wv=windAt(iCell,uT,uWs,uVs);float mag=length(wv);
    vec2 d=mag>0.001?normalize(wv):vec2(1.,0.);vec2 n=vec2(-d.y,d.x);
    float len=clamp(mag*0.5,0.2,1.6);
    vec2 local=aP;
    vec2 pos=iCell + d*local.x*len + n*local.y*0.18*len;
    vHead=local.x;
    gl_Position=uVP*vec4(pos.x,0.05,pos.y,1.0);}`;
  const AFS=`#version 300 es
  precision highp float;in float vHead;out vec4 o;
  void main(){o=vec4(mix(vec3(0.2,0.5,1.0),vec3(1.0,0.9,0.3),vHead),1.);}`;
  let AP;try{AP=compile(gl,AVS,AFS);}catch(e){AP=null;}
  const GP=groundProg(gl),gVao=groundVAO(gl);const va=instVAO(gl,bm.arr,fd);
  const aGeo=new Float32Array([0,0, 1,0, 0.75,1, 1,0, 0.75,-1]);
  const aBuf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,aBuf);gl.bufferData(gl.ARRAY_BUFFER,aGeo,gl.STATIC_DRAW);
  const cells=[];for(let z=-24;z<=24;z+=4)for(let x=-24;x<=24;x+=4)cells.push(x,z);
  const cellArr=new Float32Array(cells),cellN=cells.length/2;
  const cBuf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,cBuf);gl.bufferData(gl.ARRAY_BUFFER,cellArr,gl.STATIC_DRAW);
  const aVao=gl.createVertexArray();gl.bindVertexArray(aVao);
  gl.bindBuffer(gl.ARRAY_BUFFER,aBuf);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
  gl.bindBuffer(gl.ARRAY_BUFFER,cBuf);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,2,gl.FLOAT,false,0,0);gl.vertexAttribDivisor(1,1);
  gl.bindVertexArray(null);
  const S={Ws:1,Vs:1};
  $('wind_W').oninput=e=>{S.Ws=+e.target.value;$('wind_vW').textContent=S.Ws.toFixed(2);};
  $('wind_V').oninput=e=>{S.Vs=+e.target.value;$('wind_vV').textContent=S.Vs.toFixed(2);};
  gl.clearColor(0.05,0.085,0.07,1);
  eng.loop(()=>{eng.spin=STATE.wind.spin;gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);const VP=eng.vp();
    gl.useProgram(GP);gl.uniformMatrix4fv(gl.getUniformLocation(GP,'uVP'),false,VP);
    gl.bindVertexArray(gVao);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.useProgram(P);let L=n=>gl.getUniformLocation(P,n);
    gl.uniformMatrix4fv(L('uVP'),false,VP);gl.uniform1f(L('uT'),eng.t);gl.uniform1f(L('uWs'),S.Ws);gl.uniform1f(L('uVs'),S.Vs);
    gl.bindVertexArray(va);gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,bm.n,N);
    if(STATE.wind.vec && AP){gl.useProgram(AP);L=n=>gl.getUniformLocation(AP,n);
      gl.uniformMatrix4fv(L('uVP'),false,VP);gl.uniform1f(L('uT'),eng.t);gl.uniform1f(L('uWs'),S.Ws);gl.uniform1f(L('uVs'),S.Vs);
      gl.bindVertexArray(aVao);gl.drawArraysInstanced(gl.LINE_STRIP,0,5,cellN);}
    hud.innerHTML=`FPS <b>${eng.fps.toFixed(0)}</b> · 잔디 <b>${N.toLocaleString()}</b><br>바람장 + 소용돌이(vorticle)${STATE.wind.vec?' · 화살표':''}`;});
}

/* ============================================================ ⑩ LOD COMBINED ============================================================ */
function initLod(){
  if(!$('c_lod'))return; const eng=engine('c_lod');const hud=$('h_lod');if(!eng){hud.textContent='WebGL2 미지원';return;}
  const gl=eng.gl;eng.dist=30;
  const NEAR=18.0, FAR=34.0;
  const GVS=`#version 300 es
  precision highp float;layout(location=0) in vec2 p;uniform mat4 uVP;out vec2 v;
  void main(){v=p;gl_Position=uVP*vec4(p.x*40.0,0.0,p.y*40.0,1.0);}`;
  const GFS=`#version 300 es
  precision highp float;in vec2 v;out vec4 o;uniform int uRings;
  float h(vec2 c){return fract(sin(dot(c,vec2(41.3,289.1)))*43758.5453);}
  float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
  void main(){vec2 uv=v*44.0;float n=noise(uv)*0.6+noise(uv*3.)*0.3+noise(uv*9.)*0.1;
    vec3 c=mix(vec3(0.10,0.20,0.08),vec3(0.30,0.5,0.18),n);
    if(uRings==1){float r=length(v*40.0);
      if(r>34.0)c*=vec3(0.8,0.8,1.0);}
    o=vec4(c,1.0);}`;
  const GP=compile(gl,GVS,GFS),gVao=groundVAO(gl);
  const bm=bladeMesh(6),GEON=60000,fdG=field(GEON,FAR,7.0);
  const GEOVS=`#version 300 es
  precision highp float;layout(location=0) in vec2 aB;layout(location=1) in vec4 iA;layout(location=2) in vec2 iC;
  uniform mat4 uVP;uniform float uT,uNear;uniform vec3 uEye;uniform int uRings;out vec3 vCol;out float vT;out float vKill;
  void main(){float t=aB.y,side=aB.x,h=iA.w,ang=iA.z;float w=(1.0-t)*0.06;
    float dist=length(iA.xy-uEye.xz);
    float fade=1.0-smoothstep(uNear*0.7,uNear,dist);
    vKill=fade;
    vec3 dir=vec3(cos(ang),0.,sin(ang));vec3 p=vec3(iA.x,0.,iA.y);
    float sway=(sin(uT*1.6+iC.x))*0.3*t*t;
    p+=dir*side*w;p.y+=t*h*fade;p.x+=sway;
    vec3 c=mix(vec3(0.09,0.22,0.08),vec3(0.35,0.62,0.20),t)*mix(0.4,1.0,t);
    if(uRings==1)c*=vec3(0.8,1.15,0.8);
    vCol=c;vT=t;gl_Position=uVP*vec4(p,1.);}`;
  const GEOFS=`#version 300 es
  precision highp float;in vec3 vCol;in float vT;in float vKill;out vec4 o;
  void main(){if(vKill<0.02)discard;o=vec4(vCol,1.);}`;
  const GEOP=compile(gl,GEOVS,GEOFS);const vaG=instVAO(gl,bm.arr,fdG);
  const q=new Float32Array([-0.5,0,0.5,0,-0.5,1,0.5,1]);
  const BN=22000,fdB=field(BN,FAR,99.0);const tex=grassCardTex(gl);
  const BVS=`#version 300 es
  precision highp float;layout(location=0) in vec2 aQ;layout(location=1) in vec4 iA;layout(location=2) in vec2 iC;
  uniform mat4 uVP;uniform vec3 uRight,uEye;uniform float uT,uNear,uFar;out vec2 vUv;out float vKill;out float vShade;
  void main(){float dist=length(iA.xy-uEye.xz);
    float fin=smoothstep(uNear*0.7,uNear,dist);
    float fout=1.0-smoothstep(uFar*0.9,uFar,dist);
    float vis=fin*fout; vKill=vis;
    float h=iA.w*1.5;vec3 c=vec3(iA.x,0.,iA.y);
    float sway=sin(uT*1.5+iC.x)*0.3*aQ.y*aQ.y;
    vec3 p=c+uRight*aQ.x*0.9+vec3(0.,aQ.y*h,0.);p.x+=sway;
    vUv=vec2(aQ.x+0.5,1.0-aQ.y);vShade=mix(0.5,1.0,aQ.y);
    gl_Position=uVP*vec4(p,1.);}`;
  const BFS=`#version 300 es
  precision highp float;in vec2 vUv;in float vKill;in float vShade;uniform sampler2D uTex;uniform int uRings;out vec4 o;
  void main(){if(vKill<0.02)discard;vec4 t=texture(uTex,vUv);if(t.a<0.3)discard;
    vec3 c=t.rgb*vShade; if(uRings==1)c*=vec3(1.2,1.1,0.7); o=vec4(c,1.);}`;
  const BP=compile(gl,BVS,BFS);
  const qb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,qb);gl.bufferData(gl.ARRAY_BUFFER,q,gl.STATIC_DRAW);
  const ibB=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,ibB);gl.bufferData(gl.ARRAY_BUFFER,fdB,gl.STATIC_DRAW);
  const vaB=gl.createVertexArray();gl.bindVertexArray(vaB);
  gl.bindBuffer(gl.ARRAY_BUFFER,qb);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
  gl.bindBuffer(gl.ARRAY_BUFFER,ibB);
  gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,4,gl.FLOAT,false,24,0);gl.vertexAttribDivisor(1,1);
  gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,2,gl.FLOAT,false,24,16);gl.vertexAttribDivisor(2,1);
  gl.bindVertexArray(null);
  gl.clearColor(0.05,0.085,0.07,1);
  eng.loop(()=>{eng.spin=STATE.lod.spin;const rings=STATE.lod.rings?1:0;
    gl.enable(gl.DEPTH_TEST);gl.disable(gl.BLEND);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);const VP=eng.vp();const e=eng.eye;
    gl.useProgram(GP);gl.uniformMatrix4fv(gl.getUniformLocation(GP,'uVP'),false,VP);
    gl.uniform1i(gl.getUniformLocation(GP,'uRings'),rings);
    gl.bindVertexArray(gVao);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    const rgt=M.n(M.cr([0,1,0],M.n([e[0],0,e[2]])));
    gl.useProgram(BP);let L=n=>gl.getUniformLocation(BP,n);
    gl.uniformMatrix4fv(L('uVP'),false,VP);gl.uniform3f(L('uRight'),rgt[0],rgt[1],rgt[2]);
    gl.uniform3f(L('uEye'),e[0],e[1],e[2]);gl.uniform1f(L('uT'),eng.t);
    gl.uniform1f(L('uNear'),NEAR);gl.uniform1f(L('uFar'),FAR);gl.uniform1i(L('uRings'),rings);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tex);gl.uniform1i(L('uTex'),0);
    gl.bindVertexArray(vaB);gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,BN);
    gl.useProgram(GEOP);L=n=>gl.getUniformLocation(GEOP,n);
    gl.uniformMatrix4fv(L('uVP'),false,VP);gl.uniform1f(L('uT'),eng.t);gl.uniform1f(L('uNear'),NEAR);
    gl.uniform3f(L('uEye'),e[0],e[1],e[2]);gl.uniform1i(L('uRings'),rings);
    gl.bindVertexArray(vaG);gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,bm.n,GEON);
    hud.innerHTML=`FPS <b>${eng.fps.toFixed(0)}</b> · 근:지오 <b>${(GEON/1000)|0}k</b> 중:빌보드 <b>${(BN/1000)|0}k</b> 원:텍스처<br>거리별 자동 전환`;});
}

/* ============ boot ============ */
function boot(){
  [initGeo,initBill,initShell,initTerr,initRay,initTramp,initBez,initToon,initWind,initLod]
    .forEach(fn=>{try{fn();}catch(e){console.error('잔디 데모 초기화 실패:',fn.name,e);}});
  // 토글 버튼 (data-t/data-k)
  document.querySelectorAll('button[data-t]').forEach(b=>{
    b.onclick=()=>{const t=b.dataset.t,k=b.dataset.k;STATE[t][k]=!STATE[t][k];b.classList.toggle('on',STATE[t][k]);};
  });
  // 이 페이지에 존재하는 데모(들)를 활성화
  Object.keys(ENGINES).forEach(k=>{const e=ENGINES[k];e.active=true;e._l=performance.now();
    const dpr=Math.min(devicePixelRatio||1,2)*e.scale;e.cv.width=Math.max(1,e.cv.clientWidth*dpr);e.cv.height=Math.max(1,e.cv.clientHeight*dpr);});
}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',boot);}else{boot();}

})();

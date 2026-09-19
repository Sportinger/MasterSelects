// Screen-space viewfinder and authored scenic beat, driven by source PTS.
fn searchText(uv:vec2f,origin:vec2f,cell:vec2f,kind:u32)->f32{
 let q=(uv-origin)/cell;
 if(q.x<0||q.y<0||q.y>=1){return 0;}
 let index=u32(q.x);var code=0u;
 switch kind {
 case 0u: {if(index>=17u){return 0;}let chars=array<u32,17>(65u,78u,65u,76u,89u,83u,73u,78u,71u,32u,84u,69u,82u,82u,65u,73u,78u);code=chars[index];}
 case 1u: {if(index>=9u){return 0;}let chars=array<u32,9>(87u,79u,78u,68u,69u,82u,70u,85u,76u);code=chars[index];}
 case 2u: {if(index>=8u){return 0;}let chars=array<u32,8>(68u,82u,79u,80u,32u,83u,73u,77u);code=chars[index];}
 case 3u: {if(index>=6u){return 0;}let chars=array<u32,6>(68u,65u,78u,71u,69u,82u);code=chars[index];}
 case 4u: {if(index>=14u){return 0;}let chars=array<u32,14>(67u,79u,78u,84u,65u,67u,84u,32u,83u,69u,65u,82u,67u,72u);code=chars[index];}
 case 5u: {if(index>=10u){return 0;}let chars=array<u32,10>(83u,73u,77u,85u,76u,65u,84u,73u,79u,78u);code=chars[index];}
 case 6u: {if(index>=5u){return 0;}let chars=array<u32,5>(77u,69u,84u,69u,82u);code=chars[index];}
 default:{return 0;}
 }
 return hudGlyph(code,vec2f(fract(q.x)/.78,q.y));
}

fn searchSegment(uv:vec2f,a:vec2f,b:vec2f,width:f32,aa:f32)->f32{
 let edge=b-a;let d=length(uv-a-edge*clamp(dot(uv-a,edge)/max(dot(edge,edge),.000001),0,1));
 return 1-smoothstep(width,width+aa,d);
}
fn searchHud(uv:vec2f,original:vec4f)->vec4f{
 let time=p.decision.y;let start=p.decision.z;let end=p.decision.w;
 let beat=time-start;let scenic=end>start&&time>=start&&time<end+.45;
 if(uv.x<.02||uv.x>.98||uv.y<.02||uv.y>.98||(!scenic&&p.decisionInfo.z==0&&uv.y>.12)){return original;}
 let blue=vec3f(.08,.72,1);let red=vec3f(1,.14,.12);let white=vec3f(.85,.97,1);
 let aa=1.2/p.lens.y;var ink=vec4f(0);
 let opening=max(0.,time-p.decisionInfo.w);
 let build=smoothstep(0.,.36,opening);
 let textReveal=smoothstep(.20,.64,opening);
 let detailReveal=smoothstep(.48,.70,opening);
 // A restrained, stable status plate contrasts with the moving ground labels.
 let plate=1-smoothstep(0,aa,hudBox(uv,vec2f(.5,.083),vec2f(.445*build,.031*max(.08,build))));
 ink=hudLayer(ink,vec3f(.012,.026,.040),plate*.7*build);
 let border=hudStroke(hudBox(uv,vec2f(.5,.083),vec2f(.445*build,.031*max(.08,build))),.0007,aa);
 ink=hudLayer(ink,blue,border*.55*build);
 let title=searchText(uv,vec2f(.083,.065),vec2f(.038,.013),0u);
 let subtitle=searchText(uv,vec2f(.083,.089),vec2f(.017,.008),4u);
 ink=hudLayer(ink,white,title*.94*select(0.,1.,uv.x<.083+.82*textReveal));
 ink=hudLayer(ink,blue,subtitle*.7*detailReveal);
 let x=(uv.x-.78)/.034;let y=abs(uv.y-.092);
 if(opening>=.48&&x>=0&&x<4&&y<.003){let litIndex=u32(floor(time*3))%4u;ink=hudLayer(ink,blue,select(.18,.95,u32(x)==litIndex)*select(0.,1.,fract(x)<.65));}

 if(opening<.7){return vec4f(mix(original.rgb,ink.rgb,ink.a),original.a+ink.a*(1-original.a));}
 if(!scenic){
  // Connections are a background layer for ALL cards, not just their own.
  for(var i=0u;i<u32(p.decisionInfo.z);i++){
   let a=p.analysis[i*3u];let info=p.analysis[i*3u+1u];
   let origin=p.analysis[i*3u+2u].xy;let size=vec2f(.37,.092)*.52;
   let visibility=abs(info.w);let color=select(blue,red,info.w<0);
   let connector=searchSegment(uv,clamp(a.xy,origin,origin+size),a.xy,.0015,aa);
   let ring=hudStroke(length((uv-a.xy)*vec2f(1,p.lens.z/p.lens.y))-.011,.0012,aa);
   ink=hudLayer(ink,color,max(connector*.78,ring*.85)*visibility);
  }
  for(var i=0u;i<u32(p.decisionInfo.z);i++){
   let a=p.analysis[i*3u];let info=p.analysis[i*3u+1u];
   let visibility=abs(info.w);
   if(visibility<.001){continue;}
   let option=u32(info.x);
   let phase=clamp(a.z/max(a.w,.01),0,1);
   let released=false;let rejected=info.w<0;
   let color=select(blue,red,rejected);
   // Compact cards follow the tracked candidate, with opposite-side placement
   // and a small collision correction when the two contacts converge.
   let scale=.52;
   let size=vec2f(.37,.092)*scale;
   let origin=p.analysis[i*3u+2u].xy;
   if(any(uv<min(origin,a.xy)-vec2f(.025))||any(uv>max(origin+size,a.xy)+vec2f(.025))){continue;}
   let beforeCard=ink;
   let cardUv=(uv-origin)/scale;
   let left=.005;let top=0.;
   let box=hudBox(cardUv,vec2f(left+.18,top+.046),vec2f(.185,.046))*scale;
   ink=hudLayer(ink,select(vec3f(.008,.02,.03),vec3f(.19,.009,.015),rejected),(1-smoothstep(0,aa,box))*.92);
   ink=hudLayer(ink,color,hudStroke(box,.0015,aa)*.95);
   let side=hudGlyph(select(82u,76u,info.z==1),(cardUv-vec2f(left+.008,top+.012))/vec2f(.022,.014));
   let number=hudGlyph(49u+option,(cardUv-vec2f(left+.045,top+.012))/vec2f(.022,.014));
   ink=hudLayer(ink,white,max(side,select(number,0.,released)));
   if(released){
    ink=hudLayer(ink,color,candidateText(cardUv,vec2f(left+.085,top+.012),vec2f(.035,.014),6u));
   }else{
    let label=select(select(0u,1u,phase>.43),2u,rejected);
    ink=hudLayer(ink,color,candidateText(cardUv,vec2f(left+.085,top+.012),vec2f(.035,.014),label));
   }
   let reason=select(select(5u,select(3u,4u,option%2u==1u),rejected),7u,released);
   ink=hudLayer(ink,white,candidateText(cardUv,vec2f(left+.008,top+.038),vec2f(.027,.011),reason)*.85);
   let score=u32(100*select(.43+(info.y-.43)*phase,.24+fract(info.x*.17)*.11,rejected));
   let q=(cardUv-vec2f(left+.25,top+.037))/vec2f(.032,.015);
   if(q.x>=0&&q.x<3){let digits=vec3u(48u+score/10u,48u+score%10u,37u);ink=hudLayer(ink,color,hudGlyph(digits[u32(q.x)],vec2f(fract(q.x)/.8,q.y)));}
   ink=mix(beforeCard,ink,visibility);
  }
 }
 if(scenic){
  // The authored interlude is a fictional cinematic reading, not metric SfM.
  let wonder=smoothstep(.08,.25,beat)*(1-smoothstep(end+.15,end+.45,time));
  let wonderPlate=1-smoothstep(0,aa,hudBox(uv,vec2f(.5,.23),vec2f(.36,.04)));
  ink=hudLayer(ink,vec3f(.02,.06,.08),wonderPlate*wonder*.6);
  ink=hudLayer(ink,white,searchText(uv,vec2f(.18,.212),vec2f(.073,.033),1u)*wonder);
  let measure=smoothstep(.6,.8,beat)*(1-smoothstep(end+.25,end+.45,time));
  let travel=clamp((beat-.65)/.75,0,1);
  let a=vec2f(.62,.28);let b=vec2f(.62,.28+.41*travel);
  let line=searchSegment(uv,a,b,.0012,aa);
  ink=hudLayer(ink,blue,line*measure*.9);
  for(var i=0u;i<9u;i++){
   let level=f32(i)/8.;let yy=.28+.41*level;
   let tick=searchSegment(uv,vec2f(.61,yy),vec2f(.63+select(0.,.01,i%2u==0u),yy),.0008,aa);
   ink=hudLayer(ink,blue,tick*measure*select(0.,.8,level<=travel));
  }
  let endcap=searchSegment(uv,b-vec2f(.032,0),b+vec2f(.032,0),.0014,aa);
  ink=hudLayer(ink,white,endcap*measure);
  let card=1-smoothstep(0,aa,hudBox(uv,vec2f(.785,.50),vec2f(.14,.061)));
  ink=hudLayer(ink,vec3f(.012,.03,.05),card*measure*.82);
  ink=hudLayer(ink,blue,searchText(uv,vec2f(.662,.456),vec2f(.031,.013),2u)*measure);
  let score=u32(clamp(round(p.decisionInfo.x*(1-pow(1-travel,3))),0,999));
  let q=(uv-vec2f(.67,.485))/vec2f(.055,.026);
  if(q.x>=0&&q.x<4){let prefix=select(32u,62u,p.decisionInfo.y>0&&travel>.99);let digits=vec4u(prefix,48u+score/100u,48u+(score/10u)%10u,48u+score%10u);ink=hudLayer(ink,white,hudGlyph(digits[u32(q.x)],vec2f(fract(q.x)/.8,q.y))*measure);}
  ink=hudLayer(ink,blue,searchText(uv,vec2f(.675,.526),vec2f(.044,.016),6u)*measure);
  let danger=smoothstep(1.30,1.45,beat)*(1-smoothstep(end+.15,end+.45,time));
  let pulse=.12+.88*smoothstep(-.25,.25,sin(beat*12.566371));
  let dangerBox=hudBox(uv,vec2f(.5,.77),vec2f(.30,.036));
  ink=hudLayer(ink,vec3f(.12,.008,.014),(1-smoothstep(0,aa,dangerBox))*danger*pulse*.78);
  ink=hudLayer(ink,red,hudStroke(dangerBox,.0015,aa)*danger*pulse);
  ink=hudLayer(ink,red,searchText(uv,vec2f(.30,.754),vec2f(.073,.029),3u)*danger*pulse);
 }
 return vec4f(mix(original.rgb,ink.rgb,ink.a),original.a+ink.a*(1-original.a));
}

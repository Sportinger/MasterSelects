// Compact monospaced glyphs stay sharp when projected onto the ground.
fn hudGlyph(code:u32,uv:vec2f)->f32{
 if(any(uv<vec2f(0))||any(uv>=vec2f(1))){return 0;}
 var bits=0u;
 switch code {
 case 76u: {bits=32539681u;}
 case 82u: {bits=9616943u;}
 case 83u: {bits=16267326u;}
 case 67u: {bits=31491134u;}
 case 65u: {bits=18415150u;}
 case 78u: {bits=18667121u;}
 case 79u: {bits=15255086u;}
 case 75u: {bits=18128177u;}
 case 48u: {bits=15324974u;}
 case 49u: {bits=14815428u;}
 case 50u: {bits=32553487u;}
 case 51u: {bits=16267791u;}
 case 52u: {bits=8682793u;}
 case 53u: {bits=16268351u;}
 case 54u: {bits=15252542u;}
 case 55u: {bits=4334111u;}
 case 56u: {bits=15252014u;}
 case 57u: {bits=16284206u;}
 case 37u: {bits=17895697u;}
 case 68u: {bits=16303663u;}
 case 69u: {bits=32554047u;}
 case 70u: {bits=1096767u;}
 case 71u: {bits=32044094u;}
 case 73u: {bits=32641183u;}
 case 77u: {bits=18405233u;}
 case 80u: {bits=1097263u;}
 case 84u: {bits=4329631u;}
 case 85u: {bits=15255089u;}
 case 87u: {bits=18732593u;}
 case 89u: {bits=4329809u;}
 case 72u: {bits=18415153u;}
 case 74u: {bits=6594844u;}
 case 62u: {bits=1118273u;}
 case 88u: {bits=18157905u;}
 default: {}
 }
 let cell=vec2u(uv*5);return f32((bits>>(cell.y*5u+cell.x))&1u);
}

fn hudStroke(distance:f32,width:f32,aa:f32)->f32{return 1-smoothstep(width,width+aa,abs(distance));}
fn hudBox(uv:vec2f,center:vec2f,halfSize:vec2f)->f32{return max(abs(uv.x-center.x)-halfSize.x,abs(uv.y-center.y)-halfSize.y);}
fn hudLayer(back:vec4f,color:vec3f,opacity:f32)->vec4f{
 let a=clamp(opacity,0,1);let total=a+back.a*(1-a);
 return vec4f(mix(back.rgb,color,a/max(total,.00001)),total);
}
fn hudWord(uv:vec2f,locked:bool)->f32{
 let chars=select(vec4u(83u,67u,65u,78u),vec4u(76u,79u,67u,75u),locked);
 let xy=(uv-vec2f(.11,-.155))/vec2f(.195,.075);
 if(xy.x<0||xy.x>=4){return 0;}
 return hudGlyph(chars[u32(xy.x)],vec2f(fract(xy.x)/.8,xy.y));
}
fn hudScore(uv:vec2f,score:f32)->f32{
 let xy=(uv-vec2f(.27,.60))/vec2f(.16,.075);
 if(xy.x<0||xy.x>=3){return 0;}
 let value=u32(clamp(score*100,0,99));let chars=vec3u(48u+value/10u,48u+value%10u,37u);
 return hudGlyph(chars[u32(xy.x)],vec2f(fract(xy.x)/.8,xy.y));
}
fn hudContour(uv:vec2f)->f32{
 var d=100.;var inside=false;
 for(var i=0u;i<u32(p.options.z);i++){
  let a=p.contour[i].xy;let b=p.contour[(i+1u)%u32(p.options.z)].xy;let edge=b-a;
  d=min(d,length(uv-a-edge*clamp(dot(uv-a,edge)/max(dot(edge,edge),.00000001),0,1)));
  if((a.y>uv.y)!=(b.y>uv.y)){if(uv.x<(b.x-a.x)*(uv.y-a.y)/(b.y-a.y)+a.x){inside=!inside;}}
 }
 return select(d,-d,inside);
}

fn candidateText(uv:vec2f,origin:vec2f,cell:vec2f,kind:u32)->f32{
 let q=(uv-origin)/cell;if(q.x<0||q.y<0||q.y>=1){return 0;}let index=u32(q.x);var code=0u;
 switch kind{
 case 0u:{if(index>=4u){return 0;}let chars=array<u32,4>(71u,82u,73u,80u);code=chars[index];}
 case 1u:{if(index>=5u){return 0;}let chars=array<u32,5>(83u,76u,79u,80u,69u);code=chars[index];}
 case 2u:{if(index>=6u){return 0;}let chars=array<u32,6>(82u,69u,74u,69u,67u,84u);code=chars[index];}
 case 3u:{if(index>=4u){return 0;}let chars=array<u32,4>(83u,76u,73u,80u);code=chars[index];}
 case 4u:{if(index>=4u){return 0;}let chars=array<u32,4>(69u,68u,71u,69u);code=chars[index];}
 case 5u:{if(index>=5u){return 0;}let chars=array<u32,5>(67u,72u,69u,67u,75u);code=chars[index];}
 case 6u:{if(index>=4u){return 0;}let chars=array<u32,4>(76u,79u,67u,75u);code=chars[index];}
 case 7u:{if(index>=4u){return 0;}let chars=array<u32,4>(78u,69u,88u,84u);code=chars[index];}
 default:{return 0;}
 }return hudGlyph(code,vec2f(fract(q.x)/.85,q.y));
}

fn decisionMark(uv:vec2f,aa:f32,contourDistance:f32,tread:f32)->vec4f{
 let age=p.decision.y;let duration=p.decision.z;let progress=clamp(age/duration,0,1);
 let seed=p.decisionInfo.y;let locked=p.decisionInfo.z>0;
 let blue=vec3f(.04,.66,1);let green=vec3f(.15,1,.43);let red=vec3f(1,.12,.18);
 let reveal=smoothstep(0,.15,age);
 var result=vec4f(0);
 // Larger, overlapping candidate inspections remain visible long enough to read.
 let candidateCount=2u+u32(seed*2);
 for(var i=0u;i<6u;i++){
  if(i>=candidateCount){continue;}
  // A rolling search: stagger launches across the whole window and vary
  // dwell times independently. Pending blue options are cancelled by a lock.
  let searchOnly=p.decisionInfo.w<0;
  let ending=p.decisionInfo.w< -1.;
  let endingAge=max(0.,-p.decisionInfo.w-1.);
  let redDuration=select(.32,.50,ending);
  var candidateAge=age;var spatialSeed=seed;var attempt=0u;
  let variation=fract(seed*13.71+f32(i)*.381966);
  var launch=select(.04+seed*.08+f32(i)*(.18+seed*.10),0.,searchOnly);
  let blueDuration=select(select(.15+variation*.22,.55+variation*.95,searchOnly),.20+variation*.33,ending);
  if(!searchOnly){
   if(launch>=duration){continue;}
   let period=blueDuration+redDuration+.05;
   attempt=u32(floor(max(0.,min(age,duration)-launch)/period));
   launch+=f32(attempt)*period;
   spatialSeed=fract(seed+f32(attempt)*.137);
  }
  if(searchOnly){
   let period=blueDuration+redDuration+.08+variation*select(.25,.10,ending);
   let phase=select(age+f32(i)*.71,endingAge+f32(i)*.17,ending);
   let cycle=floor(phase/period);
   if(ending&&i>0u&&cycle*period-f32(i)*.17>.35+f32(candidateCount-1u-i)*.32){continue;}
   candidateAge=fract(phase/period)*period;
   spatialSeed=fract(seed+floor(phase/period)*.137);
  }
  let rejectAt=launch+blueDuration;
  let finish=rejectAt+redDuration;
  if(candidateAge<launch||candidateAge>finish||(!searchOnly&&candidateAge>=duration+.20)){continue;}
  let sign=select(-1.,1.,i%2u==1u);
  // Alternate nearby checks with wider lateral and forward probes.
  let spread=array<vec2f,6>(vec2f(.55,-.18),vec2f(1.25,-.45),vec2f(.8,-1.),vec2f(1.65,-.7),vec2f(.3,-1.5),vec2f(1.05,-1.2));
  let offset=spread[(i+attempt)%6u];
  var shift=vec2f(sign*offset.x*(.85+spatialSeed*.3),offset.y*(.85+spatialSeed*.25));
  if(p.decisionInfo.w<0){
   let c=cos(p.style.x);let s=sin(p.style.x);
   let footprintExtent=vec2f(abs(c)*p.placement.z+abs(s)*p.placement.w,abs(s)*p.placement.z+abs(c)*p.placement.w)*.58;
   let lo=p.bounds.xy+footprintExtent;
   let hi=max(lo,vec2f(p.bounds.x+p.bounds.z-footprintExtent.x,min(p.bounds.y+p.bounds.w-footprintExtent.y,p.placement.y+p.placement.w*.2)));
   let center=mix(lo,hi,vec2f(fract(spatialSeed*11.7+f32(i)*.618034),fract(spatialSeed*5.3+f32(i)*.381966)))-p.placement.xy;
   shift=vec2f(c*center.x+s*center.y,-s*center.x+c*center.y)/p.placement.zw;
  }
  let angle=sign*(.12+seed*.14);let cs=cos(angle);let sn=sin(angle);
  let q=uv-.5-shift;let local=vec2f(cs*q.x+sn*q.y,-sn*q.x+cs*q.y)/vec2f(.91,1.)+.5;
  if(any(local<vec2f(-.08))||any(local>vec2f(1.08))){continue;}
  let d=hudContour(local);
  let rejected=candidateAge>=rejectAt&&(!locked||rejectAt<duration);
  let fade=1-smoothstep(mix(rejectAt,finish,.7),finish,candidateAge);
  let stagger=smoothstep(launch,launch+min(.08,blueDuration*.2),candidateAge);
  let cancelled=select(1.,1-smoothstep(duration,duration+.20,candidateAge),locked);
  let visibility=fade*stagger*cancelled;
  let ink=select(blue,red,rejected);
  let outline=hudStroke(d,.023,aa*1.5);
  let sweep=exp(-pow((local.y-fract((candidateAge-launch)/max(blueDuration*.45,.01)))/.07,2));
  let interior=select(0.,1.,d<0);
  let lug=1-smoothstep(.30,.36,abs(fract(local.y*9+abs(local.x-.5)*2.4)-.5));
  let fill=select(.12+sweep*.35+lug*.28,.23,rejected)*interior;
  let cross=hudStroke(min(abs(local.x-local.y),abs(local.x+local.y-1)),.038,aa)*select(0.,1.,d<-.025&&rejected);
  result=hudLayer(result,ink,max(max(outline,fill),cross)*visibility);

 }
 // The actual landing joins the blue search, then turns green in place.
 if(p.decisionInfo.w<0){return result;}
 let winnerLaunch=duration*(.06+fract(seed*5.17)*.28);
 let targetReveal=smoothstep(winnerLaunch,winnerLaunch+min(.12,duration*.2),age);
 let ink=select(blue,green,locked);
 let interior=1-smoothstep(-aa,aa,contourDistance);
 let outline=hudStroke(contourDistance,.009,aa*1.3);
 let sweepY=fract(age*(.85+seed*.2));
 let sweep=exp(-pow((uv.y-sweepY)/.025,2));
 let grid=min(abs(fract(uv.x*8)-.5),abs(fract(uv.y*12)-.5));
 let gridLine=1-smoothstep(.025,.06,grid);
 var main=max(outline*.85,interior*(.025+gridLine*.1+sweep*.45));
 if(locked){main=max(outline*.9,tread*.62);}
 // Clear a central plaque for the foot label and confidence readout.
 let plaque=1-smoothstep(-aa,aa,hudBox(uv,vec2f(.5,.47),vec2f(.28,.225)));
 result=hudLayer(result,vec3f(.015,.035,.05),plaque*interior*.72*reveal*targetReveal);
 main*=1-plaque*.9;
 let footCode=select(82u,76u,p.decision.w==1);
 // Compensate for the ground projection orientation when reading the foot initial.
 let letterUv=(uv-vec2f(p.origin.w,p.axisX.w)+vec2f(.18,.115))/vec2f(.36,.23);
 let letter=hudGlyph(footCode,vec2f(1-letterUv.x,letterUv.y));
 let confidence=select(.43+(p.decisionInfo.x-.43)*progress+sin(floor(age*11)+seed*9)*.012,p.decisionInfo.x,locked);
 main=max(main,letter*interior);
 main=max(main,hudScore(uv,confidence)*interior*.92);
 let barUv=(uv-vec2f(.18,.70))/vec2f(.64,.025);
 let bar=select(0.,1.,all(barUv>=vec2f(0))&&all(barUv<=vec2f(1)));
 main=max(main,bar*select(.16,.8,barUv.x<=confidence));
 // Corner brackets and an animated perimeter sweep act as a local search HUD.
 let rect=hudBox(uv,vec2f(.5,.47),vec2f(.60,.69));
 let corners=select(0.,1.,abs(uv.x-.5)>.42||abs(uv.y-.47)>.56);
 let bracket=hudStroke(rect,.006,aa)*corners;
 main=max(main,bracket*select(.5,.8,locked));
 if(!locked){
  let theta=atan2((uv.y-.47)*.8,uv.x-.5);
  let arc=pow(max(0,cos(theta-age*4-seed*6)),18);
  main=max(main,hudStroke(rect,.012,aa)*arc*.8);
 }
 main=max(main,hudWord(uv,locked)*.9);
 let lockPulse=select(0.,exp(-(age-duration)*5),locked);
 main=max(main,hudStroke(rect-.03*(age-duration),.008,aa)*lockPulse*.6);
 result=hudLayer(result,ink,main*reveal*targetReveal);
 return result;
}

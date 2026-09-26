(()=>{var r=window.HermesUI,na=r&&r.html;var fe="/api/plugins/jarvis-voice";function Et(){return window.__HERMES_PLUGIN_SDK__}function nn(){return window.__HERMES_SESSION_TOKEN__}function Ze(t){var e=window.HERMES_BASE_PATH||"";return new URL(e+"/dashboard-plugins/jarvis-voice/dist/"+t,window.location.origin).toString()}function Vn(t,e){var n=Et(),a=fe+t;if(n&&typeof n.authedFetch=="function")return n.authedFetch(a,e);var i=Object.assign({},e);i.headers=Object.assign({},i.headers);var s=nn();return s&&(i.headers["X-Hermes-Session-Token"]=s),i.credentials||(i.credentials="include"),fetch(a,i)}function et(t){var e=Et();return e&&typeof e.fetchJSON=="function"?e.fetchJSON(fe+t):Vn(t).then(function(n){if(!n.ok)throw new Error("HTTP "+n.status+" for "+t);return n.json()})}function rn(){var t=Et(),e=fe+"/ws";if(t&&typeof t.buildWsUrl=="function")try{var n=t.buildWsUrl(e);if(typeof t.buildWsAuthParam=="function"){var a=t.buildWsAuthParam();a&&(n+=(n.indexOf("?")===-1?"?":"&")+a)}return n}catch{}var i=window.location.protocol==="https:"?"wss:":"ws:",s=nn(),u=i+"//"+window.location.host+e;return s&&(u+="?token="+encodeURIComponent(s)),u}function an(t){var e=t,n=new Set;function a(){return e}function i(u){return e=Object.assign({},e,typeof u=="function"?u(e):u),n.forEach(function(f){f(e)}),e}function s(u){return n.add(u),function(){n.delete(u)}}return{get:a,set:i,subscribe:s}}function ee(t){var e=r.useState,n=r.useEffect,a=e(t.get()),i=a[0],s=a[1];return n(function(){return s(t.get()),t.subscribe(s)},[t]),i}function Ct(t,e,n){var a=t.concat([e]);return a.length>n&&(a=a.slice(a.length-n)),a}function on(t){var e=t||20,n={};function a(f,d){var c=(n[f]||[]).concat([d]);c.length>e&&(c=c.slice(c.length-e)),n[f]=c}function i(f){return n[f]||[]}function s(f,d){var c=n[f];if(!c||!c.length)return null;var h=c.slice().sort(function(S,L){return S-L}),b=Math.min(h.length-1,Math.floor(d*h.length));return Math.round(h[b])}function u(){var f={};return Object.keys(n).forEach(function(d){f[d]={p50:s(d,.5),p95:s(d,.95),n:n[d].length}}),f}return{record:a,summary:u,series:i}}var tt=1e3,Yn=1e4;function sn(t){var e=t&&t.onEvent||function(){},n=t&&t.onBinary||function(){},a=t&&t.onStatus||function(){},i=t&&t.onOpen||function(){},s=null,u=tt,f=null,d=!1,c=!1;function h(){d||(a("reconnecting"),clearTimeout(f),f=setTimeout(b,u),u=Math.min(u*2,Yn))}function b(){clearTimeout(f),d=!1,a(u>tt?"reconnecting":"connecting");var k;try{k=new WebSocket(rn())}catch{h();return}k.binaryType="arraybuffer",s=k,k.onopen=function(){clearTimeout(f),u=tt,c=!1,a("open"),i()},k.onmessage=function(w){if(typeof w.data=="string"){var F;try{F=JSON.parse(w.data)}catch{return}F&&F.t==="tts.chunk_hdr"&&(c=!0),e(F)}else c&&(c=!1,n(w.data))},k.onclose=function(){s===k&&(s=null,h())},k.onerror=function(){try{k.close()}catch{}}}function S(k){s&&s.readyState===WebSocket.OPEN&&s.send(JSON.stringify(k))}function L(k){s&&s.readyState===WebSocket.OPEN&&s.send(k)}function g(){if(u=tt,d=!1,s){try{s.close()}catch{}s=null}b()}function _(){if(d=!0,clearTimeout(f),s){try{s.close()}catch{}s=null}}return b(),{send:S,sendBinary:L,close:_,forceReconnect:g}}function ln(t){var e=t&&t.onChunk||function(){},n=t&&t.onLevel||function(){},a=t&&t.onError||function(){},i=null,s=null,u=null,f=null,d=!1,c=null,h=0;function b(){return!!((window.AudioContext||window.webkitAudioContext)&&window.AudioWorkletNode&&navigator.mediaDevices&&navigator.mediaDevices.getUserMedia)}function S(N){if(!window.isSecureContext)return"Mic unavailable: this page is not a secure context (needs https:// or localhost).";var C=N&&N.name||"";return C==="NotAllowedError"||C==="PermissionDeniedError"?"Microphone permission denied. Allow mic access for this site, then try again.":C==="NotFoundError"||C==="DevicesNotFoundError"?"No microphone found. Check your input device.":C==="NotReadableError"||C==="TrackStartError"?"Microphone is in use by another app, or a hardware error occurred.":C==="OverconstrainedError"?"No microphone matches the required audio constraints.":C==="AbortError"?"Microphone access was aborted.":N&&N.message||String(N)}function L(){if(!i){var N=window.AudioContext||window.webkitAudioContext;i=new N}return i}function g(){if(c)return c;if(!window.isSecureContext)return c=Promise.reject(new Error("insecure-context")),c;if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)return c=Promise.reject(new Error("getUserMedia is not available in this browser.")),c;var N=L(),C=N.sampleRate;return c=navigator.mediaDevices.getUserMedia({audio:{sampleRate:{ideal:16e3},echoCancellation:!0,noiseSuppression:!0,channelCount:1}}).then(function(D){return f=D,N.audioWorklet.addModule(Ze("mic-worklet.js")).catch(function(H){throw new Error("mic init failed: "+(H&&H.message?H.message:H))})}).then(function(){u=N.createMediaStreamSource(f),s=new AudioWorkletNode(N,"mic-worklet",{processorOptions:{targetSampleRate:16e3,sourceSampleRate:C}}),s.port.onmessage=function(D){var H=D.data;H.type==="chunk"?d&&(h++,e(H.buffer)):H.type==="level"&&n(H.rms)},u.connect(s)}).catch(function(D){throw c=null,D}),c}function _(){d=!0,h=0;var N=L();Promise.resolve().then(function(){return N.resume?N.resume():void 0}).catch(function(){}).then(function(){if(N.state!=="running")throw new Error("AudioContext did not enter 'running' state (state: "+N.state+").");return g()}).catch(function(C){d=!1,a(S(C))})}function k(){d=!1}function w(){if(d=!1,s)try{s.disconnect()}catch{}if(u)try{u.disconnect()}catch{}if(f&&(f.getTracks().forEach(function(N){N.stop()}),f=null),i){try{i.close()}catch{}i=null}c=null}function F(){return h}return{start:_,stop:k,teardown:w,isSupported:b(),getChunkCount:F}}function un(){var t=24e3,e=null,n=null,a=null,i=null,s=1,u=null,f=null,d=null,c=null,h=null,b={level:0,low:0,mid:0,high:0};function S(){if(i)return i;try{e=new(window.AudioContext||window.webkitAudioContext)({sampleRate:t})}catch{e=new(window.AudioContext||window.webkitAudioContext)}return i=e.audioWorklet.addModule(Ze("player-worklet.js")).then(function(){n=new AudioWorkletNode(e,"player-worklet",{outputChannelCount:[1]}),a=e.createGain(),a.gain.value=s;try{u=e.createAnalyser(),u.fftSize=2048,u.smoothingTimeConstant=.5,f=new Uint8Array(u.frequencyBinCount),typeof u.getFloatTimeDomainData=="function"?d=new Float32Array(u.fftSize):c=new Uint8Array(u.fftSize);var w=e.sampleRate/u.fftSize;h=[Math.round(250/w),Math.round(2e3/w),Math.min(u.frequencyBinCount,Math.round(6e3/w))],n.connect(a),a.connect(u),u.connect(e.destination)}catch{u=null,n.connect(a).connect(e.destination)}}).catch(function(w){throw i=null,w}),i}function L(){if(!u||!e||e.state!=="running")return null;var w,F=0;if(d){for(u.getFloatTimeDomainData(d),w=0;w<d.length;w++)F+=d[w]*d[w];F=Math.sqrt(F/d.length)}else{for(u.getByteTimeDomainData(c),w=0;w<c.length;w++){var N=(c[w]-128)/128;F+=N*N}F=Math.sqrt(F/c.length)}u.getByteFrequencyData(f);var C=[0,0,0],D=[0,0,0],H=0;for(w=0;w<h[2];w++){for(;H<2&&w>=h[H];)H++;C[H]+=f[w],D[H]++}return b.level=Math.min(1,F*4.5),b.low=D[0]?C[0]/(D[0]*255):0,b.mid=D[1]?C[1]/(D[1]*255):0,b.high=D[2]?C[2]/(D[2]*255):0,b}function g(w){S().then(function(){e.state==="suspended"&&e.resume();var F=w instanceof Int16Array?w:new Int16Array(w),N=Xn(F),C=e.sampleRate,D=C===t?N:Qn(N,t,C);n.port.postMessage({type:"push",samples:D},[D.buffer])}).catch(function(){})}function _(){n&&n.port.postMessage({type:"clear"})}function k(w){s=w,a&&(a.gain.value=w)}return{queueChunk:g,hardStop:_,setGain:k,getLevels:L}}function Xn(t){for(var e=new Float32Array(t.length),n=0;n<t.length;n++){var a=t[n];e[n]=a<0?a/32768:a/32767}return e}function Qn(t,e,n){for(var a=e/n,i=Math.max(1,Math.round(t.length/a)),s=new Float32Array(i),u=0;u<i;u++){var f=u*a,d=Math.floor(f),c=Math.min(d+1,t.length-1),h=f-d;s[u]=t[d]*(1-h)+t[c]*h}return s}var re={idle:{rad:1,spin:.05,noise:.1,glow:.55,mode:"calm",col:[79,227,224]},listening:{rad:1.09,spin:.09,noise:.16,glow:.88,mode:"open",col:[110,235,225]},transcribing:{rad:1.02,spin:.15,noise:.3,glow:.76,mode:"resolve",col:[130,226,236]},thinking:{rad:.93,spin:.24,noise:.13,glow:.7,mode:"orbit",col:[79,210,232]},memory:{rad:1,spin:.07,noise:.09,glow:.78,mode:"stars",col:[96,216,206]},capability:{rad:.97,spin:.12,noise:.09,glow:.72,mode:"radial",col:[122,222,216]},tool:{rad:.95,spin:.19,noise:.12,glow:.8,mode:"arc",col:[79,227,224]},delegating:{rad:1.03,spin:.1,noise:.14,glow:.84,mode:"transfer",col:[86,206,234]},worker_progress:{rad:.91,spin:.06,noise:.07,glow:.58,mode:"arc",col:[86,206,234]},speaking:{rad:1.05,spin:.07,noise:.1,glow:1,mode:"bands",col:[124,240,233]},interrupted:{rad:.87,spin:.03,noise:.05,glow:.34,mode:"calm",col:[150,170,176]},blocked:{rad:.95,spin:.03,noise:.06,glow:.62,mode:"calm",col:[242,179,92]},error:{rad:.9,spin:.02,noise:.36,glow:.66,mode:"calm",col:[255,107,107]},done:{rad:1.1,spin:.05,noise:.08,glow:.92,mode:"pulse",col:[104,234,208]},offline:{rad:.85,spin:.01,noise:.04,glow:.2,mode:"calm",col:[110,128,133]}},cn={idle:{label:"Idle",hint:"Awake \xB7 nothing in flight"},listening:{label:"Listening",hint:"mic open \xB7 webrtcvad endpointing"},transcribing:{label:"Transcribing",hint:"faster-whisper base.en int8"},thinking:{label:"Thinking",hint:"gpt-oss-20b \xB7 8k window"},memory:{label:"Recalling",hint:"Obsidian vault \xB7 FTS5 + vectors"},capability:{label:"Matching capability",hint:"tools \xB7 skills \xB7 quick actions"},tool:{label:"Running meta-tool",hint:"server-reported action"},delegating:{label:"Delegating",hint:"handing the goal to a worker"},worker_progress:{label:"Worker running",hint:"gpt-oss-20b worker session"},speaking:{label:"Speaking",hint:"kokoro-onnx \xB7 am_michael"},interrupted:{label:"Interrupted",hint:"playback stopped \xB7 mediator canceled"},blocked:{label:"Blocked",hint:"needs a decision from you"},error:{label:"Error",hint:"recoverable \xB7 see activity"},done:{label:"Done",hint:"turn complete"},offline:{label:"Offline",hint:"reconnecting to jarvisd"}},ma=Object.keys(re);function dn(t){var e=(re[t]||re.idle).col;return"rgb("+e[0]+","+e[1]+","+e[2]+")"}function fn(t){return cn[t]||cn.idle}var mn=2,Zn=95,er=2.399963229728653;function He(t){return Math.max(0,Math.min(1,t))}function vn(t){var e="idle",n=0,a=!1,i=[],s=null,u=!1,f=0,d=0,c=null,h=0,b=0,S=[],L=0,g=null,_=118,k=[],w=[],F=[];(function(){var E,m,x;for(E=0;E<_;E++){var R=1-E/(_-1)*2,A=Math.sqrt(Math.max(0,1-R*R)),o=E*er;k.push([Math.cos(o)*A,R,Math.sin(o)*A])}var v={};for(E=0;E<_;E++){var M=[];for(m=0;m<_;m++)if(E!==m){var I=k[E][0]-k[m][0],P=k[E][1]-k[m][1],K=k[E][2]-k[m][2];M.push([I*I+P*P+K*K,m])}for(M.sort(function(G,ie){return G[0]-ie[0]}),x=0;x<3;x++){m=M[x][1];var X=E<m?E+":"+m:m+":"+E;v[X]||(v[X]=!0,w.push([Math.min(E,m),Math.max(E,m)]))}}for(E=0;E<84;E++)F.push({x:Math.random(),y:Math.random(),z:.3+Math.random()*.7,s:.2+Math.random()*.8})})();var N=new Array(_),C=0,D=0;function H(l){l>26?(D++,D>90&&C<3&&(C++,D=0)):D>0&&D--}var J=128,_e=document.createElement("canvas"),we=document.createElement("canvas");_e.width=_e.height=J,we.width=we.height=J;var Ne="";function Ae(l,E,m){var x=l+","+E+","+m;if(x!==Ne){Ne=x;var R=J/2,A=_e.getContext("2d");A.clearRect(0,0,J,J);var o=A.createRadialGradient(R,R,J*.035,R,R,R);o.addColorStop(0,"rgba("+x+",0.09)"),o.addColorStop(.45,"rgba("+x+",0.035)"),o.addColorStop(1,"rgba("+x+",0)"),A.fillStyle=o,A.fillRect(0,0,J,J);var v=we.getContext("2d");v.clearRect(0,0,J,J);var M=v.createRadialGradient(R,R,0,R,R,R);M.addColorStop(0,"rgba("+x+",1)"),M.addColorStop(.28,"rgba("+x+",0.38)"),M.addColorStop(1,"rgba("+x+",0)"),v.fillStyle=M,v.fillRect(0,0,J,J)}}function ae(){if(t.clientWidth){var l=Math.min(mn,window.devicePixelRatio||1),E=Math.round(t.clientWidth*l),m=Math.round(t.clientHeight*l);(t.width!==E||t.height!==m)&&(t.width=E,t.height=m)}}var ve=0,p=0,y=(window.performance||Date).now();function $(l){if(ve=u?0:requestAnimationFrame($),!!t.clientWidth){t.width===0&&ae();var E=Math.min(64,l-(p||l));p=l;var m=(l-y)/1e3;H(E);var x=s?s():null;if(x){c=x;var R=He(x.level+(x.high||0)*.3);f+=(R-f)*.28}else c=null,f+=(d-f)*.28,d*=.88;h+=(b-h)*.2,b*=.9,h>.42&&m-L>.42&&(L=m,S.push({r:.34,a:.42}));var A=re[e]||re.idle;g||(g={rad:A.rad,spin:A.spin,noise:A.noise,glow:A.glow,mode:A.mode,col:A.col.slice()});var o=a?1:1-Math.exp(-E/Zn);g.rad+=(A.rad-g.rad)*o,g.spin+=(A.spin-g.spin)*o,g.noise+=(A.noise-g.noise)*o,g.glow+=(A.glow-g.glow)*o;for(var v=0;v<3;v++)g.col[v]+=(A.col[v]-g.col[v])*o;g.mode=A.mode,T(m,E)}}function T(l,E){var m=t.getContext("2d");if(m){var x=Math.min(mn,window.devicePixelRatio||1),R=t.width,A=t.height;m.setTransform(1,0,0,1,0,0),m.clearRect(0,0,R,A),m.scale(x,x);var o=R/x,v=A/x,M=o/2,I=v<300,P=I?v*.5:v/2-6,K=I?Math.min(o*.3,v*.4):Math.min(o,v)*.29,X=Math.round(g.col[0]),G=Math.round(g.col[1]),ie=Math.round(g.col[2]),oe=function(qn){return"rgba("+X+","+G+","+ie+","+qn+")"};Ae(X,G,ie);var se=a?.6:l,pe=K*2.9;if(m.globalAlpha=He(g.glow),m.drawImage(_e,M-pe,P-pe,pe*2,pe*2),m.globalAlpha=1,C<2){m.lineWidth=1;for(var ce=0;ce<3;ce++){var Be=K*(1.5+ce*.42),Ie=.19+ce*.02,$t=se*(.05+ce*.015)*(ce%2?-1:1);m.strokeStyle=oe(.05-ce*.011),m.beginPath(),m.ellipse(M,P,Be,Be*Ie,$t,0,Math.PI*2),m.stroke()}}if(!a&&C<1)for(var Se=0;Se<F.length;Se++){var le=F[Se];le.y-=12e-5*le.z*(E/16),le.y<-.05&&(le.y=1.05,le.x=Math.random());var gt=le.x*o+Math.sin(se*.2+le.z*9)*6,yt=le.y*v;m.fillStyle=oe(.05+le.s*.1),m.fillRect(gt,yt,1.1,1.1)}for(var he=se*g.spin*2.2,de=.42+Math.sin(se*.24)*.1,Te=Math.cos(he),Me=Math.sin(he),xe=Math.cos(de),Ee=Math.sin(de),$e=K*g.rad*(1+f*.14),ge=C>=3?2:1,Z=0;Z<_;Z+=ge){var Fe=k[Z],bt=a?0:Math.sin(Z*1.77+se*1.15)*.5+Math.sin(Z*4.13-se*.7)*.5,kt=1+bt*g.noise*.34+f*.1*Math.sin(Z*.7+se*6),Ft=Fe[0]*kt,jt=Fe[1]*kt,Ht=Fe[2]*kt,Hn=Ft*Te+Ht*Me,Ut=-Ft*Me+Ht*Te,Un=jt*xe-Ut*Ee,zt=jt*Ee+Ut*xe,wt=2.7/(2.7-zt);N[Z]=[M+Hn*$e*wt,P+Un*$e*wt,zt,wt]}m.lineWidth=1;for(var St=0;St<w.length;St+=ge){var qe=w[St];if(!(ge>1&&(qe[0]%2||qe[1]%2))){var Ve=N[qe[0]],Ye=N[qe[1]];if(!(!Ve||!Ye)){var zn=(Ve[2]+Ye[2])/2,Wn=(.06+Math.max(0,zn+.9)*.13)*(.55+g.glow*.6);m.strokeStyle=oe(Math.min(.5,Wn)),m.beginPath(),m.moveTo(Ve[0],Ve[1]),m.lineTo(Ye[0],Ye[1]),m.stroke()}}}for(var Tt=0;Tt<_;Tt+=ge){var Pe=N[Tt];if(!(!Pe||Pe[2]<-.25)){var Xe=.7+Pe[3]*.5;m.fillStyle=oe(.14+Math.max(0,Pe[2])*.4),m.fillRect(Pe[0]-Xe/2,Pe[1]-Xe/2,Xe,Xe)}}if(!a&&C<2){var Wt=-he*.62,Kt=Math.cos(Wt),Gt=Math.sin(Wt),Kn=[[0,1,2],[1,2,0],[2,0,1]];m.lineWidth=1,m.strokeStyle=oe(.05+g.glow*.06);for(var je=0;je<3;je++){var Jt=Kn[je],qt=$e*(1.02+je*.008);m.beginPath();for(var Mt=!1,xt=0;xt<=56;xt++){var Vt=xt/56*Math.PI*2+je*.7,ye=[0,0,0];ye[Jt[0]]=Math.cos(Vt),ye[Jt[1]]=Math.sin(Vt);var Gn=ye[0]*Kt+ye[2]*Gt,Yt=-ye[0]*Gt+ye[2]*Kt,Jn=ye[1]*xe-Yt*Ee,Xt=ye[1]*Ee+Yt*xe;if(Xt<-.55){Mt=!1;continue}var Qt=2.7/(2.7-Xt),Zt=M+Gn*qt*Qt,en=P+Jn*qt*Qt;Mt?m.lineTo(Zt,en):m.moveTo(Zt,en),Mt=!0}m.stroke()}}var tn=$e*(.3+f*.22+(g.mode==="pulse"?.12:0)),Qe=tn*2.4;if(m.globalAlpha=Math.min(.95,.5+g.glow*.4+f*.3),m.drawImage(we,M-Qe,P-Qe,Qe*2,Qe*2),m.globalAlpha=1,m.strokeStyle=oe(.42+f*.4),m.lineWidth=1.2,m.beginPath(),m.arc(M,P,tn*.72,0,Math.PI*2),m.stroke(),a){O(m,M,P,K,oe);return}W(m,g.mode,M,P,K,l,oe)}}function O(l,E,m,x,R){l.setLineDash([2,6]),l.lineWidth=1,l.strokeStyle=R(.3),l.beginPath(),l.arc(E,m,x*1.32,0,Math.PI*2),l.stroke(),l.setLineDash([])}function W(l,E,m,x,R,A,o){var v,M,I,P,K,X,G;if(E==="open"){for(v=S.length-1;v>=0;v--){var ie=S[v];if(ie.r+=.012,ie.a*=.965,ie.a<.01||ie.r>2.2){S.splice(v,1);continue}l.strokeStyle=o(ie.a),l.lineWidth=1,l.beginPath(),l.arc(m,x,R*ie.r,0,Math.PI*2),l.stroke()}var oe=.5+h*1.1;l.strokeStyle=o(.5),l.lineWidth=2,l.beginPath(),l.arc(m,x,R*1.36,-Math.PI/2-oe/2,-Math.PI/2+oe/2),l.stroke()}else if(E==="bands")for(G=34,v=0;v<G;v++){M=v/G*Math.PI*2-Math.PI/2;var se=Math.abs(Math.sin(v*1.7+A*6.1))*.5+Math.abs(Math.sin(v*.9+A*11.3))*.5;if(c){var pe=(Math.sin(M)+1)/2,ce=(c.low||0)*pe+(c.mid||0)*(1-Math.abs(pe-.5)*2)+(c.high||0)*(1-pe);se*=.4+1.1*He(ce)}var Be=R*(.16+f*se*.72),Ie=R*1.2;l.strokeStyle=o(.14+f*se*.5),l.lineWidth=1.6,l.beginPath(),l.moveTo(m+Math.cos(M)*Ie,x+Math.sin(M)*Ie),l.lineTo(m+Math.cos(M)*(Ie+Be),x+Math.sin(M)*(Ie+Be)),l.stroke()}else if(E==="orbit")for(v=0;v<3;v++){P=R*(1.18+v*.16);var $t=(v%2?-1:1)*(.5+v*.22);G=26-v*5;for(var Se=0;Se<G;Se++){M=Se/G*Math.PI*2+A*$t;var le=.35+.65*Math.pow(Math.max(0,Math.sin(M*2+A)),2);l.fillStyle=o(.1+le*.42),K=m+Math.cos(M)*P,X=x+Math.sin(M)*P*.34,l.beginPath(),l.arc(K,X,1.5,0,Math.PI*2),l.fill()}}else if(E==="resolve"){for(G=40,l.strokeStyle=o(.4),l.lineWidth=1.4,l.beginPath(),v=0;v<=G;v++){K=m-R*1.5+v/G*R*3;var gt=1-Math.abs(v/G-.5)*1.6;X=x+R*1.62+Math.sin(v*.9+A*9)*R*.16*Math.max(0,gt),v===0?l.moveTo(K,X):l.lineTo(K,X)}for(l.stroke(),v=0;v<16;v++)I=(A*.55+v/16)%1,M=v*2.4,P=R*(1.7-I*1.3),l.fillStyle=o(.5*(1-Math.abs(I-.5)*1.6)),l.beginPath(),l.arc(m+Math.cos(M)*P,x+Math.sin(M)*P*.7,1.4,0,Math.PI*2),l.fill()}else if(E==="stars"){var yt=i.length?i.slice(0,6):[0,1,2];for(v=0;v<yt.length;v++)M=-Math.PI*.72+v*.5+Math.sin(A*.3+v)*.05,I=(A*.4+v*.33)%1,P=R*(2.05-I*.72),K=m+Math.cos(M)*P,X=x+Math.sin(M)*P*.78,l.strokeStyle=o(.1+(1-I)*.18),l.lineWidth=1,l.beginPath(),l.moveTo(K,X),l.lineTo(m,x),l.stroke(),l.fillStyle=o(.35+(1-I)*.45),l.beginPath(),l.arc(K,X,2.6,0,Math.PI*2),l.fill(),l.strokeStyle=o(.18),l.beginPath(),l.arc(K,X,6+Math.sin(A*2+v)*1.2,0,Math.PI*2),l.stroke()}else if(E==="radial")for(G=12,v=0;v<G;v++){M=v/G*Math.PI*2+A*.12;var he=v%3===Math.floor(A*1.6)%3,de=R*1.24,Te=R*(he?.4:.2);l.strokeStyle=o(he?.5:.14),l.lineWidth=he?2:1,l.beginPath(),l.moveTo(m+Math.cos(M)*de,x+Math.sin(M)*de*.9),l.lineTo(m+Math.cos(M)*(de+Te),x+Math.sin(M)*(de+Te)*.9),l.stroke(),he&&(l.fillStyle=o(.6),l.beginPath(),l.arc(m+Math.cos(M)*(de+Te),x+Math.sin(M)*(de+Te)*.9,2,0,Math.PI*2),l.fill())}else if(E==="arc"){P=R*1.34,l.strokeStyle=o(.1),l.lineWidth=2,l.beginPath(),l.arc(m,x,P,0,Math.PI*2),l.stroke();var Me=A*.85%(Math.PI*2);l.strokeStyle=o(.62),l.lineWidth=2.4,l.beginPath(),l.arc(m,x,P,Me,Me+1.05),l.stroke(),l.fillStyle=o(.8),l.beginPath(),l.arc(m+Math.cos(Me+1.05)*P,x+Math.sin(Me+1.05)*P,2.4,0,Math.PI*2),l.fill()}else if(E==="transfer"){var xe=m,Ee=x,$e=m+R*1.85,ge=x+R*.9;for(l.strokeStyle=o(.14),l.lineWidth=1,l.beginPath(),l.moveTo(xe,Ee),l.quadraticCurveTo(m+R,x+R*1.2,$e,ge),l.stroke(),v=0;v<5;v++){I=(A*.65+v/5)%1;var Z=1-I,Fe=Z*Z*xe+2*Z*I*(m+R)+I*I*$e,bt=Z*Z*Ee+2*Z*I*(x+R*1.2)+I*I*ge;l.fillStyle=o(.7*(1-I*.7)),l.beginPath(),l.arc(Fe,bt,2.1,0,Math.PI*2),l.fill()}l.strokeStyle=o(.4),l.lineWidth=1.4,l.beginPath(),l.arc($e,ge,9+Math.sin(A*3)*1.4,0,Math.PI*2),l.stroke()}else E==="pulse"&&(I=(A-n)*.9,I>=0&&I<=1&&(l.strokeStyle=o(.5*(1-I)),l.lineWidth=2,l.beginPath(),l.arc(m,x,R*(1.1+I*.9),0,Math.PI*2),l.stroke()))}function j(){u||ve||a||document.hidden||(p=0,ve=requestAnimationFrame($))}function ne(){ve&&(cancelAnimationFrame(ve),ve=0)}function Y(){ae();var l=re[e]||re.idle;g={rad:l.rad,spin:l.spin,noise:l.noise,glow:l.glow,mode:l.mode,col:l.col.slice()};var E=((window.performance||Date).now()-y)/1e3;T(E,16)}function ue(){document.hidden?ne():a||j()}document.addEventListener("visibilitychange",ue);var Q=null;return window.ResizeObserver?(Q=new ResizeObserver(function(){ae(),a&&Y()}),Q.observe(t)):window.addEventListener("resize",ae),ae(),j(),{setState:function(l){l!==e&&(e=re[l]?l:"idle",n=((window.performance||Date).now()-y)/1e3,a&&Y())},setReducedMotion:function(l){a=!!l,a?(ne(),Y()):j()},setHits:function(l){i=Array.isArray(l)?l:[]},setAudioSource:function(l){s=typeof l=="function"?l:null},onAmp:function(l){d=He(typeof l=="number"?l:0)},onMicLevel:function(l){b=He(typeof l=="number"?l:0)},resize:function(){ae(),a&&Y()},destroy:function(){u=!0,ne(),document.removeEventListener("visibilitychange",ue),Q?Q.disconnect():window.removeEventListener("resize",ae)}}}function nt(t){var e=vn(t);return{setState:function(n,a){e.setState(n)},onAmp:function(n){e.onAmp(n)},onMicLevel:function(n){e.onMicLevel(n)},onMemoryHits:function(n){e.setHits(n)},setAudioSource:function(n){e.setAudioSource(n)},setReducedMotion:function(n){e.setReducedMotion(n)},resize:function(){e.resize()},destroy:function(){e.destroy()}}}var U=r.html;function De(t){return t.connection==="open"?t.fsmState:"offline"}var tr={listening:1,speaking:1,thinking:1,tool:1,worker_progress:1},nr=[["STT","stt"],["MED","mediator_first_token"],["TTS","tts_first_chunk"]];function rr(t){var e=[],n=0;nr.forEach(function(i){var s=t[i[1]];typeof s=="number"&&(e.push({label:i[0]+" "+Math.round(s)+"ms",value:s,tone:i[1]==="mediator_first_token"?"accent":"neutral"}),n+=s)});var a=t.e2e_first_audio;return typeof a=="number"&&a-n>0&&e.length&&e.push({label:"PLAY "+Math.round(a-n)+"ms",value:a-n,tone:"neutral"}),e}function ar(t){var e=ee(t.store),n=rr(e.turnLatency||{}),a=(e.turnLatency||{}).e2e_first_audio,i=typeof a=="number"?r.format.duration(a):e.latency.e2e_first_audio&&e.latency.e2e_first_audio.p50!=null?r.format.duration(e.latency.e2e_first_audio.p50):"\u2014",s=e.w>=1280;return U`
    <${r.Row} align="center" gap="md" style=${{padding:"10px 20px",borderBottom:"1px solid var(--hui-line)",flex:"none"}}>
      <span className="hui-t-micro" style=${{whiteSpace:"nowrap"}}>${"TURN "+(e.turnId!=null?"#"+e.turnId:"\u2014")}</span>
      <div style=${{flex:1,minWidth:0}}>
        <${r.SegmentBar} segments=${n.length?n:[{label:"idle",value:1,tone:"neutral"}]} legend=${s} label="Turn latency waterfall" />
      </div>
      ${s?null:U`<span className="hui-t-num hui-t-faint" style=${{whiteSpace:"nowrap"}}>${"e2e "+i}</span>`}
    <//>`}function Rt(t){var e=t.s,n=De(e),a=fn(n),i=dn(n),s=e.fsmDetail&&e.connection==="open"?a.hint+" \xB7 "+e.fsmDetail:a.hint;return U`
    <div style=${{display:"flex",flexDirection:"column",alignItems:"center",gap:7,pointerEvents:"none"}} aria-live="polite">
      <${r.Row} align="center" gap="sm">
        <span className=${tr[n]&&!e.reducedMotion?"hui-dot hui-dot--pulse":"hui-dot"}
          style=${{background:i,boxShadow:"0 0 10px 2px "+i.replace("rgb(","rgba(").replace(")",",.4)")}} aria-hidden="true" />
        <span className="hui-t-title" style=${{color:i,textShadow:"0 0 18px "+i.replace("rgb(","rgba(").replace(")",",.33)")}}>
          ${a.label}
        </span>
      <//>
      <div className=${t.mobile,"hui-t-sub"} style=${{textAlign:t.mobile?"center":"left"}}>${s}</div>
    </div>`}function _t(t){var e=t.s;return e.toolChip?U`
    <${r.Row} align="center" gap="sm" style=${{marginTop:3,padding:"5px 11px",borderRadius:6,border:"1px solid var(--hui-line-strong)",background:"var(--hui-surface-2)",pointerEvents:"none"}}>
      <${r.Icon} name="settings" size=${12} className="hui-t-accent" />
      <span className="hui-t-mono">${e.toolChip.name}</span>
      <span style=${{width:1,height:11,background:"var(--hui-line-strong)"}} />
      <span className="hui-t-num hui-t-accent"><${r.RelTime} at=${e.toolChip.start} granularity=${1e3} /></span>
    <//>`:null}function ir(t){var e=t.store,n=t.refs,a=ee(e),i=De(a),s=(re[i]||re.idle).mode.toUpperCase();return U`
    <div style=${{flex:"1.05 1 0%",minHeight:0,position:"relative",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <canvas ref=${n.canvasRef} aria-hidden="true" style=${{position:"absolute",inset:0,width:"100%",height:"100%",display:"block"}} />
      <div style=${{position:"absolute",left:0,right:0,bottom:14,display:"flex",flexDirection:"column",alignItems:"center",gap:7,pointerEvents:"none"}}>
        <${Rt} s=${a} />
        <${_t} s=${a} />
      </div>
      <div style=${{position:"absolute",left:20,top:16,display:"flex",flexDirection:"column",gap:5,pointerEvents:"none"}}>
        <div className="hui-t-micro">INTELLIGENCE CORE</div>
        <div className="hui-t-micro">${(a.reducedMotion?"STATIC \xB7 ":"LATTICE \xB7 ")+s}</div>
      </div>
    </div>`}function or(t){return t==="user"?"YOU":t==="jarvis"?"JARVIS":"SYSTEM"}function Nt(t){var e=t.turn;return U`
    <div style=${{display:"grid",gridTemplateColumns:"62px minmax(0,1fr)",gap:14,alignItems:"start"}}>
      <div style=${{display:"flex",flexDirection:"column",gap:3,paddingTop:2}}>
        <span className=${"hui-t-micro"+(e.role==="user"?" hui-t-accent":"")}>${or(e.role)}</span>
        <span className="hui-t-mono hui-t-micro">${e.time}</span>
      </div>
      <div style=${{minWidth:0}}>
        ${e.role==="system"?U`<div className=${"hui-t-mono"+(e.tone==="red"?" hui-t-danger":" hui-t-micro")}>${e.text}</div>`:e.role==="jarvis"?U`<div className=${e.dim?"hui-t-faint":"hui-t-body"} style=${{fontSize:16,lineHeight:1.55}}><${r.Markdown}>${e.text}<//></div>`:U`<div className=${e.dim?"hui-t-faint":"hui-t-body"} style=${{fontSize:16,lineHeight:1.55}}>${e.text}</div>`}
        ${e.meta&&e.meta.length?U`<${r.Row} gap="sm" style=${{marginTop:6}}>${e.meta.map(function(n,a){return U`<${r.Tag} key=${"m"+a} size="sm">${n}<//>`})}<//>`:null}
      </div>
    </div>`}function sr(t){var e=t.store,n=t.refs,a=ee(e);r.useEffect(function(){var u=n.logRef.current;u&&(u.scrollTop=u.scrollHeight)},[a.turns.length,a.mediatorText,a.sttPartial]);var i=a.turns.slice(-14),s=i.length===0&&!a.sttPartial&&!a.mediatorText;return U`
    <div ref=${n.logRef} role="log" aria-label="Conversation"
      style=${{flex:1,minHeight:132,overflowY:"auto",padding:"4px 22px 12px",display:"flex",flexDirection:"column",gap:14,borderTop:"1px solid var(--hui-line)"}}>
      ${s?U`<${r.EmptyState} compact icon="message" title="No turns yet" hint="Say something, or type a message below." />`:null}
      <${r.AnimatedList} items=${i} getKey=${function(u){return u.id}}>
        ${function(u){return U`<${Nt} turn=${u} />`}}
      <//>
      ${a.sttPartial?U`
          <div style=${{display:"grid",gridTemplateColumns:"62px minmax(0,1fr)",gap:14,alignItems:"start"}} aria-live="polite">
            <span className="hui-t-micro hui-t-accent">YOU</span>
            <div className="hui-t-faint" style=${{fontSize:16,fontStyle:"italic"}}>${a.sttPartial}</div>
          </div>`:null}
      ${a.mediatorText?U`
          <div style=${{display:"grid",gridTemplateColumns:"62px minmax(0,1fr)",gap:14,alignItems:"start"}} aria-live="polite">
            <span className="hui-t-micro">JARVIS</span>
            <div className="hui-t-body" style=${{fontSize:16,lineHeight:1.55}}>
              <${r.StreamText} text=${a.mediatorText} streaming=${a.ttsPlaying} speed=${40} />
            </div>
          </div>`:null}
    </div>`}function rt(t){return U`
    <${r.IconButton}
      icon=${t.active?"minimize":"maximize"}
      label="Toggle fullscreen"
      variant=${t.active?"secondary":"ghost"}
      size=${t.mobile?"md":"sm"}
      title=${t.pseudo?"Pseudo-fullscreen (Fullscreen API unavailable on this browser)":"Toggle fullscreen"}
      onClick=${t.onClick} />`}function At(t){var e=t.s,n=t.act,a=t.refs,i=t.mobile,s=i?64:52;return U`
    <div style=${{position:"relative",flex:"none",width:s,height:s}}>
      <div ref=${i?a.micRingMobileRef:a.micRingRef} aria-hidden="true"
        style=${{position:"absolute",inset:-6,borderRadius:"999px",border:"1px solid var(--hui-accent)",opacity:0,transform:"scale(.9)",pointerEvents:"none"}} />
      <button type="button" onClick=${n.onMicClick} aria-label=${e.micActive?"Stop microphone":"Start microphone"} aria-pressed=${e.micActive}
        style=${{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:"999px",cursor:"pointer",border:"1px solid "+(e.micActive?"var(--hui-accent)":"var(--hui-line-strong)"),background:e.micActive?"radial-gradient(circle at 50% 35%, var(--hui-accent-ground-strong), var(--hui-surface))":"radial-gradient(circle at 50% 35%, var(--hui-surface-2), var(--hui-surface))",color:e.micActive?"var(--hui-text)":"var(--hui-text-dim)"}}>
        <${r.Icon} name="mic" size=${i?24:19} />
      </button>
    </div>`}function It(t){var e=t.store,n=t.s;return!n.micError&&!n.micHint?null:U`
    <${r.Banner} tone=${n.micError?"danger":"warn"} variant="inline" dismissible
      onDismiss=${function(){e.set({micError:null,micHint:null})}}>
      ${n.micError||n.micHint}
    <//>`}function lr(t){var e=t.store,n=t.act,a=t.refs,i=ee(e),s=r.useState(""),u=s[0],f=s[1],d=i.fsmState==="speaking"&&i.connection==="open";function c(){var h=u.trim();h&&(n.submitText(h),f(""))}return U`
    <div style=${{flex:"none",padding:"12px 22px 16px",borderTop:"1px solid var(--hui-line)"}}>
      <${r.Row} align="end" gap="md" wrap=${!1}>
        <${At} s=${i} act=${n} refs=${a} />
        <div style=${{flex:1,minWidth:0,display:"flex",flexDirection:"column",gap:7}}>
          <${r.Row} align="end" gap="sm" wrap=${!1}>
            <div style=${{flex:1,minWidth:0}}>
              <${r.Textarea}
                value=${u}
                onChange=${f}
                minRows=${1}
                maxRows=${4}
                placeholder="Type to Jarvis, or hold Space to talk…"
                onKeyDown=${function(h){h.key==="Enter"&&!h.shiftKey&&(h.preventDefault(),c())}} />
            </div>
            <${r.Button} variant="primary" onClick=${c}>Send<//>
            <${r.Button} variant="secondary" disabled=${!d} onClick=${n.interrupt}>Interrupt<//>
          <//>
          <${r.Row} align="center" gap="md" wrap=${!1}>
            <${r.Segmented}
              options=${[{value:"ptt",label:"Push to talk"},{value:"vad",label:"VAD (experimental)"}]}
              value=${i.micMode}
              onChange=${n.setMicMode} />
            <div style=${{flex:1,height:3,borderRadius:2,background:"var(--hui-line)",overflow:"hidden"}}>
              <div ref=${a.levelRef} style=${{height:"100%",width:"0%",borderRadius:2,background:"var(--hui-accent)"}} />
            </div>
            ${i.w>1100?U`<span className="hui-t-mono hui-t-micro" style=${{whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:4}}>
                  SPACE hold · ESC interrupt · 1·2·3 panels · <${r.Kbd} combo="mod+k" /> focus
                </span>`:null}
          <//>
          <${It} store=${e} s=${i} />
          <${r.Presence} show=${!!i.noSpeechHint} variant="fade">
            <div className="hui-t-faint" style=${{fontStyle:"italic"}} role="status" aria-live="polite">${i.noSpeechHint}</div>
          <//>
        </div>
      <//>
    </div>`}function pn(t){return U`
    <div style=${{minHeight:0,display:"flex",flexDirection:"column",position:"relative",minWidth:0}}>
      <${ar} store=${t.store} />
      <${ir} store=${t.store} refs=${t.refs} />
      <${sr} store=${t.store} refs=${t.refs} />
      <${lr} store=${t.store} act=${t.act} refs=${t.refs} />
    </div>`}function be(t){if(t==null||t==="")return null;if(typeof t=="number")return t>1e12?t:t>1e9?t*1e3:null;var e=Date.parse(t);return isNaN(e)?null:e}var ur={running:"accent",queued:"neutral",paused:"neutral",done:"ok",needs_review:"warn",failed:"danger",canceled:"neutral"};function it(t){return{label:(t||"\u2014").replace(/_/g," "),tone:ur[t]||"neutral"}}function ot(t){return{label:(t||"").toUpperCase()||"\u2014",tone:t==="codex"?"info":"neutral"}}function hn(t){var e=String(t||"").toLowerCase();return e.indexOf("error")>=0||e.indexOf("fail")>=0?"danger":e.indexOf("review")>=0||e.indexOf("cancel")>=0||e.indexOf("warn")>=0||e.indexOf("restart")>=0?"warn":e.indexOf("progress")>=0||e.indexOf("log")>=0?"neutral":"accent"}var cr={done:1,failed:1,needs_review:1,canceled:1};function st(t){return!!cr[t]}var at={running:0,queued:1,paused:2,needs_review:3,done:4,failed:5,canceled:6};function dr(t){return Object.values(t||{}).sort(function(e,n){var a=at[e.status]!=null?at[e.status]:9,i=at[n.status]!=null?at[n.status]:9;return a!==i?a-i:(n.updated_ts||0)-(e.updated_ts||0)})}function lt(t){return Object.values(t||{}).filter(function(e){return e.status==="running"||e.status==="queued"||e.status==="paused"}).length}function $n(t,e){return Object.values(t||{}).filter(function(n){return gn(e,n.id)?!1:n.status==="running"||n.status==="queued"||n.status==="paused"||n.status==="needs_review"}).length}function gn(t,e){return!!(t&&Object.prototype.hasOwnProperty.call(t,e))}function Ue(t,e){return dr(t).filter(function(n){return!gn(e,n.id)})}var Oe=fe+"/tasks",Ce=fe+"/backends",ze=fe+"/credits";function yn(t){return fe+"/tasks/"+encodeURIComponent(t)}function fr(t,e){return fe+"/memory/search?q="+encodeURIComponent(t)+"&k="+(e||8)}function We(t){var e=Array.isArray(t)?t:t&&Array.isArray(t.tasks)?t.tasks:[],n={};return e.forEach(function(a){n[a.id]=a}),n}function ut(){var t=r.useEndpoint(Oe);return Object.assign({},t,{tasks:We(t.data)})}function bn(t){var e=null;return r.mutate(Oe,function(n){var a=We(n);return a[t.id]=e=Object.assign({},a[t.id]||{},t,{updated_ts:Date.now()}),{tasks:Object.values(a)}}),e}function ct(){return r.useAction(function(t,e){return r.postJSON(yn(t)+"/control",{action:e}).then(function(n){return n&&n.status&&r.mutate(Oe,function(a){var i=We(a);return i[t]&&(i[t]=Object.assign({},i[t],{status:n.status,updated_ts:Date.now()})),{tasks:Object.values(i)}}),n})},{onError:function(t){r.toast.error("Task action failed",{detail:r.errorMessage(t)})}})}function kn(t){return r.useEndpoint(t?yn(t):null)}function dt(){return r.useEndpoint(Ce)}function wn(){return r.useAction(function(t){var e=null;return r.mutate(Ce,function(n){return e=n&&n.active,Object.assign({},n,{active:t})}),r.postJSON(Ce,{backend:t}).then(function(n){return r.mutate(Ce,function(a){return Object.assign({},a,{active:n&&n.backend||t})}),n},function(n){throw r.mutate(Ce,function(a){return Object.assign({},a,{active:e})}),n})},{onError:function(t){r.toast.error("Couldn't set worker backend",{detail:r.errorMessage(t)})}})}function Le(){return r.useEndpoint(ze)}function Sn(){return r.useAction(function(){return r.fetchJSON(ze+"?refresh=true").then(function(t){return r.mutate(ze,t),t})},{onError:function(t){r.toast.error("Couldn't refresh credits",{detail:r.errorMessage(t)})}})}function Tn(t,e){var n=(t||"").trim();return r.useEndpoint(n?fr(n,e||8):null)}var te=r.html;function mr(t){if(t==null||t==="")return null;var e=be(t);return e==null?String(t):r.format.relTime(e)}function vr(t){var e=t.hit,n=!!e.conflict,a=typeof e.score=="number"?e.score:0,i=mr(e.updated);return te`
    <${r.Card} variant="default" padding="sm" tone=${n?"warn":void 0}>
      <${r.Row} justify="between" align="start" gap="sm">
        <span className="hui-t-body hui-t-clamp2" style=${{fontWeight:600}}>${e.title||e.path}</span>
        <span className="hui-t-num hui-t-accent">${a.toFixed(2)}</span>
      <//>
      ${e.path?te`<div className="hui-t-mono hui-t-faint hui-t-truncate">${e.path}</div>`:null}
      <${r.Meter} value=${a*100} max=${100} size="sm" tone=${n?"warn":"accent"} valueText="" />
      ${e.snippet?te`<div className="hui-t-sub" style=${{marginTop:6}}>${e.snippet}</div>`:null}
      <${r.Row} justify="between" align="center" gap="sm" style=${{marginTop:6}}>
        <span className="hui-t-micro">
          ${i?"updated "+i:""}
          ${typeof e.confidence=="number"?" \xB7 conf "+e.confidence.toFixed(2):""}
        </span>
        ${n?te`<${r.Badge} tone="warn" icon="alert-triangle" size="sm">CONFLICT<//>`:null}
      <//>
    <//>`}function ft(t){var e=t.store,n=ee(e),a=r.useState(n.memQuery||""),i=a[0],s=a[1],u=Tn(i),f=!!i.trim(),d=f?u.data&&u.data.hits||[]:n.memoryHits||[];return te`
    <${r.Stack} gap="sm" style=${t.fill?{flex:1,minHeight:0}:void 0}>
      <${r.SearchInput}
        value=${n.memQuery||""}
        onChange=${function(c){e.set({memQuery:c})}}
        onSearch=${s}
        debounceMs=${250}
        loading=${f&&u.loading}
        placeholder="Search vault…"
        aria-label="Search Obsidian memory" />
      <div className="hui-t-micro">${f?"SEARCH RESULTS":"RECALLED FOR THIS TURN"}</div>
      ${d.length===0?f?u.loading?te`<div className="hui-t-sub">Searching…</div>`:u.error?te`<${r.ErrorState} compact title="Search failed" error=${u.error} onRetry=${u.reload} />`:te`<div className="hui-t-sub">No matches in the vault.</div>`:te`<${r.EmptyState} compact icon="brain" title="No recall this turn"
              hint="Memory is queried only when the mediator calls memory_recall." />`:te`<${r.AnimatedList} items=${d} getKey=${function(c,h){return(c.path||"hit")+":"+h}}>
            ${function(c){return te`<${vr} hit=${c} />`}}
          <//>`}
    <//>`}function Mn(t){var e=ee(t.store),n=(e.memoryHits||[]).length;return te`
    <${r.Stack} gap="md" style=${{minHeight:0,padding:"16px"}}>
      <${r.Row} justify="between" align="center">
        <span className="hui-t-micro">MEMORY</span>
        <span className="hui-t-num hui-t-accent">${n?n+" HITS":"IDLE"}</span>
      <//>
      <${ft} store=${t.store} fill />
      <${r.Divider} />
      <${r.Row} justify="between">
        <span className="hui-t-micro">Obsidian vault · FTS5 + nomic-embed</span>
        <span className="hui-t-micro">read-only</span>
      <//>
    <//>`}function xn(t){return te`<${ft} store=${t.store} fill />`}var me=r.html,pr={error:"danger",attention:"warn",info:"info"};function hr(t,e){return!!(t&&Object.prototype.hasOwnProperty.call(t,e))}function mt(t){return(t.notices||[]).filter(function(e){return!hr(t.dismissedNotices,e.id)})}function Ke(t){var e=mt(t),n=!1,a=!1;return e.forEach(function(i){i.tone==="error"?n=!0:i.tone==="attention"&&(a=!0)}),{count:e.length,tone:n?"danger":a?"warn":null}}function vt(t){return t.tone?me`<${r.StatusDot} tone=${t.tone} pulse />`:null}function $r(t){var e=[],n={};return t.forEach(function(a){var i=(a.tone||"info")+"|"+(a.approve?"1":"0")+"|"+(a.title||""),s=n[i];s||(s={key:i,tone:a.tone,title:a.title,approve:!!a.approve,items:[]},n[i]=s,e.push(s)),s.items.push(a)}),e}function gr(t){var e=t.group,n=t.act,a=t.mobile,i=ct(),s=e.items.length===1,u=e.items[0];function f(S){S.taskId?i.run(S.taskId,"resume").then(function(){n.resolveNotice(S.id,!0)},function(){}):n.resolveNotice(S.id,!0)}function d(S){n.resolveNotice(S.id,!1)}function c(S){S.approve?d(S):n.dismissNotice(S.id)}var h=null;if(s&&u.approve)h=me`
      <${r.Row} gap="sm">
        <${r.Button} size="sm" variant="primary" loading=${i.pending} onClick=${function(){f(u)}}>Approve<//>
        <${r.Button} size="sm" variant="danger" onClick=${function(){d(u)}}>Decline<//>
      <//>`;else if(!s){var b=[];e.approve&&b.push(me`<${r.Button} key="aa" size="sm" variant="primary" loading=${i.pending}
        onClick=${function(){e.items.forEach(f)}}>Approve all<//>`),b.push(me`<${r.Button} key="da" size="sm" variant="secondary"
      onClick=${function(){e.items.forEach(c)}}>Dismiss all<//>`),h=me`<${r.Row} gap="sm">${b}<//>`}return me`
    <${r.NotificationCard}
      severity=${pr[e.tone]||"info"}
      title=${e.title}
      body=${s?u.body:void 0}
      time=${s&&!a?u.ts:void 0}
      count=${e.items.length}
      items=${s?void 0:e.items.map(function(S){var L=S.approve?me`
              <${r.Row} gap="xs">
                <${r.Button} size="sm" variant="primary" loading=${i.pending} onClick=${function(){f(S)}}>Approve<//>
                <${r.Button} size="sm" variant="danger" onClick=${function(){d(S)}}>Decline<//>
              <//>`:void 0;return{id:S.id,label:S.body||S.title,actions:L}})}
      actions=${h}
      onDismiss=${function(){e.items.forEach(c)}}
    />`}function pt(t){var e=t.s,n=t.act,a=t.mobile,i=mt(e);if(!i.length)return null;var s=$r(i);return me`
    <${r.Stack} gap="sm">
      ${s.map(function(u){return me`<${gr} key=${u.key} group=${u} act=${n} mobile=${a} />`})}
    <//>`}var B=r.html;function yr(t){var e=t.payload,n="";if(e!=null)if(typeof e=="string")n=e;else if(e.message)n=e.message;else if(e.note)n=e.note;else try{n=JSON.stringify(e)}catch{n=""}var a=t.type||t.kind||"event";return n?a+" \xB7 "+n:a}function br(t){var e=t&&(t.task||t)||{};return{events:t&&(t.events||t.task_events)||e.events||[],result_text:e.result_text||"",result_summary:e.result_summary||"",session_id:e.session_id||e.session||""}}function kr(t){var e=t.detail;return B`
    <${r.DataState} state=${e} emptyText="No task detail" compact>
      ${function(n){var a=br(n),i=a.events||[],s=a.result_text||a.result_summary||"";return B`
          <${r.Stack} gap="sm">
            <div className="hui-t-micro">EVENT TIMELINE</div>
            ${i.length===0?B`<div className="hui-t-sub">No events recorded for this task.</div>`:B`<${r.ActivityFeed} items=${i.map(function(u,f){return{id:f,at:be(u.ts)||Date.now(),title:yr(u),tone:hn(u.type)}})} />`}
            ${s?B`<${r.Stack} gap="sm"><div className="hui-t-micro">RESULT</div><${r.CodeBlock} maxHeight=${160}>${s}<//><//>`:null}
            <${r.KeyValue} label="Session" value=${a.session_id||"\u2014"} mono copyable=${!!a.session_id} />
          <//>`}}
    <//>`}function En(t){var e=t.task,n=t.act,a=t.mobile,i=it(e.status),s=ot(e.kind),u=e.status==="running",f=e.progress_note||e.result_summary||"",d=ct(),c=r.useState(!1),h=kn(!a&&c[0]?e.id:null),b=null;if(e.status==="done"){var S=be(e.started),L=be(e.finished);S&&L&&L>S&&(b="took "+r.format.duration(L-S))}else{var g=be(e.started)||be(e.created)||e.updated_ts;g&&(b=B`<${r.RelTime} at=${g} />`)}var _=[];return e.status==="running"&&_.push({label:"Pause",variant:"secondary",run:"pause"}),e.status==="paused"&&_.push({label:"Resume",variant:"primary",run:"resume"}),(e.status==="running"||e.status==="paused"||e.status==="queued")&&_.push({label:"Cancel",variant:"danger",run:"cancel"}),e.status==="needs_review"&&_.push({label:"Re-delegate",variant:"primary",run:"resume"}),st(e.status)&&_.push({label:"Dismiss",variant:"secondary",run:"dismiss"}),B`
    <${r.Card} padding="sm" tone=${e.status==="needs_review"?"warn":void 0}>
      <${r.Row} justify="between" align="center" gap="sm">
        <${r.Badge} tone=${i.tone}>${i.label}<//>
        <${r.Row} gap="sm" align="center">
          <${r.Badge} tone=${s.tone} variant="outline" size="sm">${s.label}<//>
          ${b?B`<span className="hui-t-num hui-t-micro">${b}</span>`:null}
        <//>
      <//>
      <div className="hui-t-body" style=${{marginTop:8,fontWeight:600}}>${e.title||e.goal||e.id}</div>
      ${u?B`<${r.Meter} indeterminate size="sm" style=${{marginTop:8}} />`:null}
      ${f?B`<div className="hui-t-sub" style=${{marginTop:8}}>${f}</div>`:null}
      <${r.Row} gap="sm" style=${{marginTop:10}}>
        ${_.map(function(k){var w=d.pending&&k.run!=="dismiss";return B`
            <${r.Button} key=${k.label} size=${a?"md":"sm"} variant=${k.variant} loading=${k.run!=="dismiss"&&w}
              onClick=${function(){k.run==="dismiss"?n.dismissTask(e.id):d.run(e.id,k.run)}}>${k.label}<//>`})}
      <//>
      ${a?null:B`
          <${r.Disclosure} title="Detail" open=${c[0]} onOpenChange=${c[1]} className="jv-task-detail">
            ${c[0]?B`<${kr} detail=${h} />`:null}
          <//>`}
    <//>`}function Cn(t){return B`<${En} task=${t.task} act=${t.act} mobile />`}function Pt(t){var e=t.items.slice().reverse();return B`
    <${r.ActivityFeed} items=${e.map(function(n){return{id:n.id,at:n.ts,title:n.label,tone:n.tone,body:t.verbose?n.detail:void 0}})} />`}function wr(t){var e=t.store,n=t.s;return B`
    <${r.Stack} gap="sm">
      <${r.Row} justify="between" align="center">
        <${r.Button} size="sm" variant=${n.verbose?"primary":"secondary"} aria-pressed=${n.verbose}
          onClick=${function(){e.set({verbose:!n.verbose})}}>
          ${n.verbose?"Trace detail: on":"Trace detail: off"}
        <//>
        <span className="hui-t-num hui-t-micro">${r.format.plural(n.timeline.length,"event")}</span>
      <//>
      ${n.timeline.length===0?B`<${r.EmptyState} compact icon="activity" title="Nothing yet this session" />`:B`<${Pt} items=${n.timeline} verbose=${n.verbose} />`}
    <//>`}var Sr=[["stt","stt final"],["mediator_first_token","mediator first token"],["tts_first_chunk","tts first chunk"],["e2e_first_audio","end-to-end first audio"]];function Tr(t){var e=t.s,n=t.act,a=e.health||{},i=a.components||{},s=Object.keys(i),u=a.models||{},f=a.ram||{},d=typeof f.free_gb=="number"?f.free_gb:null,c=typeof f.total_gb=="number"?f.total_gb:null;return B`
    <${r.Stack} gap="sm">
      <${r.Card} title="Component health" padding="sm">
        ${s.length===0?B`<${r.EmptyState} compact title="Waiting for /health…" />`:B`<${r.List} dense items=${s.map(function(h){var b=i[h]||{};return{id:h,leading:B`<${r.StatusDot} tone=${b.ok?"accent":"danger"} />`,title:h,description:b.detail||"",trailing:B`<${r.Badge} tone=${b.ok?"ok":"danger"} size="sm">${b.ok?"OK":"ERR"}<//>`}})} />`}
      <//>
      <${r.Card} title="Latency · last 20 turns" padding="sm">
        <${r.Stack} gap="md">
          ${Sr.map(function(h){var b=h[0],S=e.latency[b],L=n.getSeries(b);return B`
              <div key=${b}>
                <${r.Row} justify="between" align="baseline">
                  <span className="hui-t-sub" style=${{flex:1}}>${h[1]}</span>
                  <span className="hui-t-num">${S&&S.p50!=null?S.p50+" ms":"\u2014"}</span>
                  <span className="hui-t-num hui-t-faint">${S&&S.p95!=null?S.p95+" ms":"\u2014"}</span>
                <//>
                <${r.Sparkline} data=${L} height=${18} tone=${b==="e2e_first_audio"?"accent":!1} />
              </div>`})}
        <//>
      <//>
      <${r.Card} title="Residency & memory" padding="sm">
        <${r.Stack} gap="sm">
          <${r.KVList} items=${["mediator","worker"].map(function(h){var b=u[h]||{};return{label:h,value:(b.name||h+" \u2014")+(b.resident?" \xB7 resident":" \xB7 on demand")}})} />
          <${r.Meter}
            label="Unified memory"
            value=${d!=null&&c?c-d:0}
            max=${c||1}
            indeterminate=${d==null||!c}
            valueText=${d==null?"\u2014":d.toFixed(1)+" GB free"+(c?" / "+c+" GB":"")} />
        <//>
      <//>
      <${r.KpiRow} size="sm" items=${[{label:"Barge-ins",value:e.bargeIns,sub:"this session"},{label:"Errors",value:e.errCount,sub:"recoverable"}]} />
    <//>`}function Rn(t){var e=t.store,n=t.act,a=ee(e),i=ut(),s=t.showLeft,u=Ke(a),f=[{id:"work",label:B`<${r.Row} gap="sm" align="center"><${vt} tone=${u.tone} /><span>Work</span><//>`,badge:lt(i.tasks)||void 0},{id:"activity",label:"Activity",badge:a.timeline.length||void 0}];s||f.push({id:"memory",label:"Memory",badge:(a.memoryHits||[]).length||void 0}),f.push({id:"system",label:"System"});var d=s&&a.tab==="memory"?"work":a.tab,c=Ue(i.tasks,a.dismissedTasks);return B`
    <div style=${{minHeight:0,display:"flex",flexDirection:"column",borderLeft:"1px solid var(--hui-line)"}}>
      <${r.Tabs} className="jv-work-tabs" items=${f} value=${d} onChange=${function(h){e.set({tab:h})}}
        ariaLabel="Work panels" idPrefix="jv-work" />
      <${r.ScrollArea} style=${{flex:1,minHeight:0,padding:"10px 14px 14px"}}>
        <${r.TabPanel} when="work" value=${d} idPrefix="jv-work">
          <${r.ErrorBoundary}>
            <${r.Stack} gap="sm">
              <${xr} s=${a} act=${n} tasks=${c} />
              <${pt} s=${a} act=${n} />
              <${r.DataState} state=${i} empty=${function(){return c.length===0&&!u.count}}
                emptyText="No tasks yet. Delegate something.">
                ${function(){return B`<${r.AnimatedList} items=${c} getKey=${function(h){return h.id}}>
                  ${function(h){return B`<${En} task=${h} act=${n} />`}}
                <//>`}}
              <//>
            <//>
          <//>
        <//>
        <${r.TabPanel} when="activity" value=${d} idPrefix="jv-work">
          <${r.ErrorBoundary}><${wr} store=${e} s=${a} /><//>
        <//>
        ${s?null:B`<${r.TabPanel} when="memory" value=${d} idPrefix="jv-work"><${r.ErrorBoundary}><${ft} store=${e} fill /><//><//>`}
        <${r.TabPanel} when="system" value=${d} idPrefix="jv-work">
          <${r.ErrorBoundary}><${Tr} s=${a} act=${n} /><//>
        <//>
      <//>
    </div>`}var Mr={done:1,failed:1,error:1,cancelled:1,canceled:1,completed:1};function xr(t){var e=t.s,n=t.act,a=mt(e),i=(t.tasks||[]).filter(function(c){return Mr[c.status]});if(!a.length&&!i.length)return null;function s(c,h,b){var S=n.clearWork(c,h);r.toast.success("Cleared "+b,{action:{label:"Undo",onClick:S},duration:6e3})}var u=a.map(function(c){return c.id}),f=i.map(function(c){return c.id}),d=[];return i.length&&d.push({id:"fin",icon:"check",label:"Clear finished tasks ("+i.length+")",onSelect:function(){s([],f,r.format.plural(i.length,"finished task"))}}),a.length&&d.push({id:"not",icon:"bell",label:"Clear notifications ("+a.length+")",onSelect:function(){s(u,[],r.format.plural(a.length,"notification"))}}),a.length&&i.length&&(d.push({separator:!0}),d.push({id:"all",icon:"trash",danger:!0,label:"Clear all",onSelect:function(){s(u,f,"everything")}})),B`
    <${r.Row} gap="sm" align="center" justify="between" wrap=${!1}>
      <span className="hui-t-micro">
        ${[a.length?r.format.plural(a.length,"notification"):null,i.length?i.length+" finished":null].filter(Boolean).join(" \xB7 ")}
      </span>
      <${r.Row} gap="xs" align="center" wrap=${!1}>
        ${i.length?B`<${r.Button} size="sm" variant="secondary" icon="check"
          title="Hide every done, failed or cancelled task"
          onClick=${function(){s([],f,r.format.plural(i.length,"finished task"))}}>Clear finished (${i.length})<//>`:null}
        <${r.Menu} placement="bottom" align="end" items=${d}
          trigger=${B`<${r.IconButton} size="sm" variant="ghost" icon="more-horizontal" label="More clear options" />`} />
      <//>
    <//>`}var z=r.html,Ge={local:{name:"Local",caption:"\u22482\u20136 s \xB7 64k ctx \xB7 no spend",sub:"gpt-oss-20b \xB7 free \xB7 on-box",tier:"free"},cloud:{name:"Cloud",caption:"\u22481\u20133 s \xB7 $ per call \xB7 weekly cap",sub:"cloud \xB7 uses limit",tier:"limit"},codex:{name:"Codex",caption:"\u22484\u201320 s \xB7 coding agent \xB7 sub credits",sub:"codex \xB7 weekly credits",tier:"sub"},claude:{name:"Claude Code",caption:"\u22484\u201320 s \xB7 coding agent \xB7 weekly + session",sub:"claude \xB7 weekly + session",tier:"sub"}},Er=["local","cloud","codex","claude"],Cr="Selection applies to delegated tasks and tool calls. Mediator, transcription and speech always stay on-box.";function Dt(t){return Ge[t]||{name:t,caption:"",sub:"",tier:"sub"}}function Rr(t,e){var n=t&&Array.isArray(t.backends)?t.backends:Er;return n.filter(function(a){return Ge[a]||e&&e.backends&&e.backends[a]})}function Ot(t,e){return t&&t.backends&&t.backends[e]||null}function _r(t,e){return e?"refreshing":t.loading?"loading":t.error&&!t.data?"error":t.stale||t.data&&t.data.stale?"stale":"ok"}function Nr(t,e){if(e==="refreshing")return"checking\u2026";if(e==="loading")return"";if(e==="error")return"check failed";var n=t.data&&t.data.checked_epoch;return n?"checked "+r.format.relTime(n*1e3):e==="stale"?"stale":""}function Lt(t){return z`<${r.Badge} tone=${t==="free"?"ok":"warn"} size="sm">${(t||"sub").toUpperCase()}<//>`}function Ar(t){var e=t.note||"",n=e.split("\xB7").map(function(s){return s.trim()}),a=n[0]||(t.tier==="free"?"no spend":(t.tier||"").toUpperCase()),i=n.slice(1).join(" \xB7 ");return z`
    <div style=${{textAlign:"center",width:t.mobile?88:96,flex:"none"}}>
      <div className=${"hui-t-mono"+(t.tier==="free"?" hui-t-ok":" hui-t-dim")} style=${{fontSize:11}}>${a}</div>
      ${i?z`<div className="hui-t-mono hui-t-micro" style=${{fontSize:9}}>${i}</div>`:null}
    </div>`}function Ir(t){var e=t.id,n=t.backends,a=t.credits,i=t.phase,s=t.selectBackend,u=t.mobile,f=t.act,d=Dt(e),c=Ot(a,e),h=n.active===e||!n.active&&e==="local",b=!n.available||n.available[e]!==!1,S=c&&c.tier||d.tier,L=c&&c.note,g=c&&c.gauges||[],_=!!c&&c.available===!1,k;if(_)k=z`<${r.SpeedGauge} label=${d.name} value="unavailable" sub=${L} small=${u} />`;else if(g.length){var w=g.map(function(C,D){return z`<${r.SpeedGauge} key=${C.label||"g"+D} label=${C.label} remaining=${C.remaining_pct}
        value=${C.value_label} sub=${i==="stale"?"stale \xB7 refresh":r.format.untilTime(C.reset_epoch?C.reset_epoch*1e3:null)}
        loading=${i==="loading"||i==="refreshing"} small=${u} />`});k=w.length>1?z`<${r.Stack} gap="xs">${w}<//>`:w[0]}else!c&&(i==="loading"||i==="refreshing")?k=z`<${r.SpeedGauge} label=${d.name} loading small=${u} />`:k=z`<${Ar} note=${L} tier=${S} mobile=${u} />`;var F=d.caption+(L&&g.length?" \xB7 "+L:""),N=z`
    <${r.Row} gap="sm" align="center">
      <span style=${{fontWeight:600}}>${d.name}</span>
      ${Lt(S)}
    <//>`;return z`
    <${r.ListItem}
      leading=${z`<${r.StatusDot} tone=${h?"accent":b?"neutral":"danger"} />`}
      title=${N}
      description=${F}
      trailing=${k}
      selected=${h}
      style=${{opacity:b?1:.6,cursor:b?"pointer":"not-allowed",minHeight:u?44:void 0}}
      onClick=${b?function(){s.run(e),f.log("backend","Worker backend set to "+d.name+(d.sub?" \xB7 "+d.sub:""),null,e==="local"?"info":"warn"),t.onPicked&&t.onPicked()}:void 0} />`}function Pr(t){return z`
    <${r.Button} size=${t.mobile?"md":"sm"} variant="secondary" icon="refresh" loading=${t.refreshing} onClick=${t.onClick}>
      Refresh
    <//>`}function _n(t){var e=t.mobile,n=t.act,a=dt(),i=Le(),s=wn(),u=Sn(),f=a.data||{},d=i.data||{},c=_r(i,u.pending);return z`
    <${r.Stack} gap="sm">
      <${r.Row} justify="between" align="center">
        <span className="hui-t-micro">${e?"":"WORKER BACKEND"}</span>
        <${r.Row} gap="sm" align="center">
          <span className="hui-t-micro">${Nr(i,c)}</span>
          <${Pr} mobile=${e} refreshing=${c==="refreshing"}
            onClick=${function(){u.run(),n.log("credits","Checked subscription credits","manual refresh \xB7 not polled","info")}} />
        <//>
      <//>
      ${Rr(f,d).map(function(h){return z`<${Ir} key=${h} id=${h} backends=${f} credits=${d} phase=${c}
          selectBackend=${s} act=${n} mobile=${e} onPicked=${t.onPicked} />`})}
      <div className="hui-t-micro" style=${{lineHeight:1.5}}>${Cr}</div>
    <//>`}function Nn(t){var e=t.act,n=dt(),a=Le(),i=n.data||{},s=a.data||{},u=i.active||"local",f=Dt(u),d=Ot(s,u),c=d&&d.tier||f.tier,h=!i.available||i.available[u]!==!1;return z`
    <${r.Popover} placement="bottom" align="end" panelClassName="jv-backend-pop"
      trigger=${z`
        <button type="button" className="hui-btn hui-btn--secondary hui-btn--sm" aria-label="Choose worker backend">
          <${r.StatusDot} tone=${h?"accent":"danger"} />
          <span style=${{display:"flex",flexDirection:"column",alignItems:"flex-start",lineHeight:1.15}}>
            <span className="hui-t-micro">BACKEND</span>
            <span style=${{fontWeight:600}}>${f.name}</span>
          </span>
          ${Lt(c)}
        </button>`}>
      ${function(b){return z`<div style=${{width:320}}><${_n} act=${e} onPicked=${b.close} /></div>`}}
    <//>`}function An(t){var e=dt(),n=Le(),a=e.data||{},i=a.active||"local",s=Dt(i),u=Ot(n.data,i),f=u&&u.tier||s.tier;return z`
    <button type="button" onClick=${t.onClick} aria-label="Worker backend and credits"
      className="hui-btn hui-btn--secondary hui-btn--sm"
      style=${t.attention?{borderColor:"var(--hui-warn)"}:void 0}>
      <${r.StatusDot} tone="accent" />
      <span style=${{fontWeight:600}}>${s.name}</span>
      ${Lt(f)}
    </button>`}function In(t){return z`<${_n} act=${t.act} mobile />`}var q=r.html;function Dr(t){var e=t.s,n=Ue(t.tasks,e.dismissedTasks),a=n.filter(function(u){return u.status==="running"})[0]||n.filter(function(u){return u.status==="needs_review"})[0];if(!a)return null;var i=it(a.status),s=ot(a.kind);return q`
    <${r.Card} padding="sm" style=${{margin:"2px 12px 0"}}>
      <${r.Row} justify="between" align="center">
        <${r.Badge} tone=${i.tone}>${i.label}<//>
        <${r.Badge} tone=${s.tone} variant="outline" size="sm">${s.label}<//>
      <//>
      <div className="hui-t-body" style=${{marginTop:6,fontWeight:600}}>${a.title||a.goal||a.id}</div>
      ${a.progress_note||a.result_summary?q`<div className="hui-t-sub" style=${{marginTop:5}}>${a.progress_note||a.result_summary}<//>`:null}
    <//>`}function Or(t){var e=t.s,n=t.refs;r.useEffect(function(){var s=n.logRef.current;s&&(s.scrollTop=s.scrollHeight)},[e.turns.length,e.mediatorText,e.sttPartial]);var a=e.turns.slice(-10),i=a.length===0&&!e.sttPartial&&!e.mediatorText;return q`
    <div ref=${n.logRef} role="log" aria-label="Conversation"
      style=${{flex:1,minHeight:0,overflowY:"auto",padding:"12px 16px 8px",display:"flex",flexDirection:"column",gap:12}}>
      ${i?q`<${r.EmptyState} compact icon="message" title="No turns yet" hint="Say something, or type below." />`:null}
      ${a.map(function(s){return q`<${Nt} key=${s.id} turn=${s} />`})}
      ${e.sttPartial?q`
          <div aria-live="polite">
            <span className="hui-t-micro hui-t-accent">YOU</span>
            <div className="hui-t-faint" style=${{marginTop:4,fontSize:15,fontStyle:"italic"}}>${e.sttPartial}</div>
          </div>`:null}
      ${e.mediatorText?q`
          <div aria-live="polite">
            <span className="hui-t-micro">JARVIS</span>
            <div className="hui-t-body" style=${{marginTop:4,fontSize:15}}><${r.StreamText} text=${e.mediatorText} streaming=${e.ttsPlaying} /></div>
          </div>`:null}
    </div>`}function Lr(t){var e=t.s,n=t.act,a=t.store,i=Ue(t.tasks,e.dismissedTasks);return e.sheet==="tasks"?q`
      <${r.Stack} gap="sm">
        <${pt} s=${e} act=${n} mobile />
        ${i.length===0&&!Ke(e).count?q`<${r.EmptyState} compact title="No tasks yet" />`:i.map(function(s){return q`<${Cn} key=${s.id} task=${s} act=${n} />`})}
      <//>`:e.sheet==="backend"?q`<${In} act=${n} />`:e.sheet==="memory"?q`<${xn} store=${a} />`:e.sheet==="activity"?e.timeline.length===0?q`<${r.EmptyState} compact title="Nothing yet this session" />`:q`<${Pt} items=${e.timeline} verbose=${!1} />`:null}var Br={tasks:"Tasks & notifications",memory:"Memory",backend:"Worker backend",activity:"Activity"};function Pn(t){var e=t.store,n=t.act,a=t.refs,i=ee(e),s=ut(),u=r.useState(""),f=u[0],d=u[1],c=i.fsmState==="speaking"&&i.connection==="open",h=Ke(i);function b(){var g=f.trim();g&&(n.submitText(g),d(""))}function S(){e.set({sheet:null})}var L=[{id:"tasks",label:"Tasks",count:$n(s.tasks,i.dismissedTasks),tone:h.tone},{id:"memory",label:"Memory",count:(i.memoryHits||[]).length},{id:"activity",label:"Activity",count:i.timeline.length}];return q`
    <div style=${{position:"absolute",inset:0,display:"flex",flexDirection:"column",paddingTop:"var(--jv-fs-top-clear, 0px)"}}>
      <${r.Row} align="center" gap="sm" style=${{padding:"14px 16px 10px",flex:"none"}}>
        <span className="hui-dot hui-dot--accent" aria-hidden="true" />
        <span className="hui-t-title">JARVIS</span>
        <div style=${{flex:1}} />
        <${An} act=${n} attention=${!!h.tone} onClick=${function(){e.set({sheet:"backend"})}} />
        <${rt} active=${i.fullscreen||i.pseudoFullscreen} pseudo=${i.pseudoFullscreen} onClick=${n.toggleFullscreen} mobile />
        <${r.StatusDot} tone=${i.connection==="open"?"accent":i.connection==="closed"?"danger":"warn"} pulse=${i.connection!=="open"} label=${"Connection: "+i.connection} />
      <//>
      <div style=${{flex:"0 1 214px",minHeight:118,position:"relative"}}>
        <canvas ref=${a.canvasRef} aria-hidden="true" style=${{position:"absolute",inset:0,width:"100%",height:"100%",display:"block"}} />
      </div>
      <div style=${{flex:"none",display:"flex",flexDirection:"column",alignItems:"center",gap:4,padding:"2px 16px 8px",pointerEvents:"none"}}>
        <${Rt} s=${i} mobile />
        <${_t} s=${i} />
      <//>
      <${Dr} s=${i} tasks=${s.tasks} />
      <${Or} s=${i} refs=${a} />
      <div style=${{flex:"none",padding:"8px 12px calc(12px + env(safe-area-inset-bottom))",borderTop:"1px solid var(--hui-line)"}}>
        <${r.Row} gap="sm" wrap=${!1}>
          ${L.map(function(g){return q`
              <${r.Button} key=${g.id} variant="secondary" size="md" block onClick=${function(){e.set({sheet:g.id})}}>
                ${g.tone?q`<${vt} tone=${g.tone} />`:null} ${g.label}${g.count?" "+g.count:""}
              <//>`})}
        <//>
        <${r.Row} align="end" gap="sm" style=${{marginTop:10}} wrap=${!1}>
          <div style=${{flex:1,minWidth:0}}>
            <${r.Textarea} value=${f} onChange=${d} minRows=${1} maxRows=${3} placeholder="Message Jarvis…"
              onKeyDown=${function(g){g.key==="Enter"&&!g.shiftKey&&(g.preventDefault(),b())}} />
          </div>
          <${r.Button} variant="secondary" disabled=${!c} onClick=${n.interrupt}>Stop<//>
          <${At} s=${i} act=${n} refs=${a} mobile />
        <//>
        <${It} store=${e} s=${i} />
        <${r.Presence} show=${!!i.noSpeechHint} variant="fade">
          <div className="hui-t-faint" style=${{fontStyle:"italic",marginTop:6}} role="status" aria-live="polite">${i.noSpeechHint}</div>
        <//>
      </div>
      <${r.Sheet} open=${!!i.sheet} onClose=${S} title=${Br[i.sheet]||""} snapPoints=${[.62,.92]}>
        <${Lr} s=${i} act=${n} store=${e} tasks=${s.tasks} />
      <//>
    </div>`}var V=r.html,Fr=200,jr=40,Hr=15e3,Ur=860,zr=1280,Wr=20,ht="jarvis-voice:dismissedNotices",Dn=100,Kr={failed:{tone:"error",title:"Task failed"},needs_review:{tone:"attention",title:"Needs review"}};function On(t){var e=Kr[t.status];return e?{id:"task:"+t.id+":"+t.status,tone:e.tone,title:e.title+" \xB7 "+(t.title||t.goal||t.id),body:t.result_summary||t.progress_note||(t.status==="needs_review"?"Waiting for your review \u2014 approve to re-delegate, or decline.":""),ts:Date.now(),taskId:t.id,approve:t.status==="needs_review"}:null}function Gr(t,e){try{var n=window.localStorage.getItem(t);return n===null?e:n==="1"}catch{return e}}function Jr(t,e){try{window.localStorage.setItem(t,e?"1":"0")}catch{}}function qr(t,e){try{var n=window.localStorage.getItem(t);return n===null?e:parseFloat(n)}catch{return e}}var Je="jarvis-voice:dismissedTasks";function Ln(t,e){try{var n=window.localStorage.getItem(t);if(n===null)return e;var a=JSON.parse(n);return a&&typeof a=="object"?a:e}catch{return e}}function Re(t,e){try{window.localStorage.setItem(t,JSON.stringify(e))}catch{}}function Bn(t){if(!t)return!1;var e=t.tagName;return e==="INPUT"||e==="TEXTAREA"||t.isContentEditable}function Vr(t){return String(t).replace(/_/g," ").replace(/^./,function(e){return e.toUpperCase()})}function ke(t){if(t==null)return"";if(typeof t=="string")return t;try{return JSON.stringify(t,null,2)}catch{return String(t)}}function Yr(t){return Math.min(1e3*Math.pow(2,Math.max(0,t-1)),1e4)}function jn(){return!!(document.fullscreenElement||document.webkitFullscreenElement)}function Xr(t){return!!(t&&(t.requestFullscreen||t.webkitRequestFullscreen))}function Fn(t){var e=t&&t.get();if(jn()){document.exitFullscreen?document.exitFullscreen():document.webkitExitFullscreen&&document.webkitExitFullscreen();return}if(e&&e.pseudoFullscreen){t.set({pseudoFullscreen:!1});return}var n=document.getElementById("jarvis-voice-root");if(n){if(Xr(n)){var a=n.requestFullscreen?n.requestFullscreen():n.webkitRequestFullscreen();a&&typeof a.catch=="function"&&a.catch(function(){console.info("[jarvis-voice] requestFullscreen() was rejected \u2014 falling back to pseudo-fullscreen."),t&&t.set({pseudoFullscreen:!0})});return}console.info("[jarvis-voice] Fullscreen API unavailable on this browser (likely iOS Safari) \u2014 using pseudo-fullscreen instead."),t&&t.set({pseudoFullscreen:!0})}}var Qr={position:"fixed",inset:0,top:0,left:0,margin:0,width:"100vw",height:"100dvh",zIndex:2147483647},Zr="radial-gradient(120% 90% at 50% 0%, var(--hui-surface-2) 0%, var(--hui-bg) 55%, var(--hui-bg) 100%)";function Bt(){var t=r.useRef(null);t.current||(t.current=an({connection:"connecting",offline:!1,fsmState:"idle",fsmDetail:null,sttPartial:"",sttFinal:"",mediatorText:"",ttsPlaying:!1,micActive:!1,micMode:"ptt",reducedMotion:Gr("jarvis-voice:reducedMotion",!!(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches)),volume:qr("jarvis-voice:volume",1),timeline:[],dismissedTasks:Ln(Je,{}),memoryHits:[],health:null,latency:{},micError:null,micHint:null,notices:[],dismissedNotices:Ln(ht,{}),tab:"work",sheet:null,verbose:!1,w:typeof window<"u"?window.innerWidth:1440,turns:[],speakingText:"",toolChip:null,turnId:null,turnLatency:{},memQuery:"",bargeIns:0,errCount:0,retryAttempt:0,retryAt:0,lastEventTs:0,offlineDismissed:!1,fullscreen:typeof document<"u"&&!!(document.fullscreenElement||document.webkitFullscreenElement),pseudoFullscreen:!1,noSpeechHint:null}));var e=t.current,n=ee(e),a=r.useRef(null);a.current||(a.current={canvasRef:{current:null},logRef:{current:null},levelRef:{current:null},micRingRef:{current:null},micRingMobileRef:{current:null},composerInputRef:{current:null}});var i=a.current,s=r.useRef(null),u=r.useRef(null),f=r.useRef(null),d=r.useRef(null);d.current||(d.current=on(20));var c=r.useRef({start:function(){},stop:function(){}}),h=r.useRef([]),b=r.useRef(""),S=r.useRef(0),L=r.useRef(0),g=r.useRef(null);function _(p,y,$,T){e.set(function(O){return{timeline:Ct(O.timeline,{id:p+":"+Date.now()+":"+Math.random(),ts:Date.now(),type:p,label:y,detail:ke($),tone:T||"neutral"},Fr)}})}function k(p,y,$,T){e.set(function(O){return{turns:Ct(O.turns,{id:p+":"+Date.now()+":"+Math.random(),role:p,text:y,time:r.format.clockTime(Date.now()),meta:$||[],dim:!!(T&&T.dim),tone:T&&T.tone||null},jr)}})}function w(p){p&&e.set(function(y){if(y.dismissedNotices&&Object.prototype.hasOwnProperty.call(y.dismissedNotices,p.id))return{};var $=(y.notices||[]).filter(function(T){return T.id!==p.id});return{notices:[p].concat($).slice(0,Wr)}})}function F(p){e.set(function(y){var $=Object.assign({},y.dismissedNotices);$[p]=Date.now();var T=Object.keys($);return T.length>Dn&&T.sort(function(O,W){return $[O]-$[W]}).slice(0,T.length-Dn).forEach(function(O){delete $[O]}),Re(ht,$),{dismissedNotices:$,notices:(y.notices||[]).filter(function(O){return O.id!==p})}})}function N(p){var y=e.get(),$=(y.mediatorText||"").trim();if($){var T=h.current.slice();p==="interrupted"&&T.push("interrupted");var O=y.turnLatency&&y.turnLatency.e2e_first_audio;typeof O=="number"&&T.push("e2e "+(O/1e3).toFixed(2)+" s"),k("jarvis",$,T),h.current=[],e.set({mediatorText:"",speakingText:""})}}function C(){h.current=[],e.set({turnLatency:{}})}function D(p,y){typeof y=="number"&&(d.current.record(p,y),e.set(function($){var T=Object.assign({},$.turnLatency);return T[p]=y,{latency:d.current.summary(),turnLatency:T}}))}function H(p){if(p.length){var y=++S.current,$=b.current||p[0].title||p[0].path||"";$&&et("/memory/search?q="+encodeURIComponent($)+"&k="+Math.max(p.length,3)).then(function(T){if(y===S.current){var O={};(T&&T.hits||[]).forEach(function(j){j&&j.path&&(O[j.path]=j)});var W=p.map(function(j){return Object.assign({},O[j.path]||{},j)});e.set({memoryHits:W})}}).catch(function(){})}}function J(){clearTimeout(g.current),e.set({noSpeechHint:"Didn't catch that."}),g.current=setTimeout(function(){e.set({noSpeechHint:null})},3e3)}function _e(p){r.fetchJSON(Oe).then(function(y){r.mutate(Oe,y);var $=We(y);if(Object.values($).forEach(function(O){O.status==="needs_review"&&w(On(O))}),p){var T=lt($);k("system","Session resumed \xB7 "+T+" open task"+(T===1?"":"s")+" replayed from jarvis.db")}}).catch(function(){}),et("/health").then(function(y){e.set({health:y})}).catch(function(){}),r.invalidate(Ce),r.invalidate(ze)}r.useEffect(function(){var p=un();p.setGain(e.get().volume),f.current=p;var y=0,$=!1,T=null,O=0,W=ln({onChunk:function(o){var v=u.current;v&&v.sendBinary(o)},onLevel:function(o){var v=e.get().micActive,M=v?o:0;y=o,s.current&&s.current.onMicLevel(M),O+=(Math.min(1,M)-O)*.35,i.levelRef.current&&(i.levelRef.current.style.width=Math.round(Math.min(1,M)*100)+"%"),[i.micRingRef.current,i.micRingMobileRef.current].forEach(function(I){I&&(I.style.opacity=v?String(.25+O*.7):"0",I.style.transform="scale("+(v?1+O*.16:.9)+")")})},onError:function(o){e.set({micError:o}),_("error",o,null,"danger")}});function j(){clearTimeout(T),$=!1,e.set({micHint:null}),T=setTimeout(function(){e.get().micActive&&W.getChunkCount()>0&&y<.02&&!$&&e.set({micHint:"Mic level is silent \u2014 check input device/permissions."})},2e3)}var ne=setTimeout(function(){e.get().connection!=="open"&&e.set({offline:!0})},1500);function Y(o){if(!(!o||!o.t))switch(L.current=Date.now(),o.turn_id!=null&&o.turn_id!==e.get().turnId&&o.t!=="tts.amp"&&e.set({turnId:o.turn_id}),o.t){case"state":e.set({fsmState:o.value,fsmDetail:o.detail||null}),_("state",Vr(o.value)+(o.detail?" \u2014 "+o.detail:""),null,o.value==="error"?"danger":o.value==="blocked"?"warn":"neutral"),o.value==="listening"&&C(),(o.value==="done"||o.value==="idle")&&N(o.value),o.value==="interrupted"&&N("interrupted"),o.detail==="turn timed out"?(k("system","Turn failed: timed out waiting for a reply.",[],{tone:"red"}),h.current=[],e.set({mediatorText:"",speakingText:""})):o.detail==="no speech recognized"&&J(),o.value!=="idle"&&o.value!=="listening"&&($=!0);break;case"stt.partial":e.set({sttPartial:o.text||""}),$=!0,e.get().micHint&&e.set({micHint:null});break;case"stt.final":e.set({sttPartial:"",sttFinal:o.text||""}),b.current=o.text||"",o.text&&k("user",o.text),_("stt.final","Transcribed: \u201C"+(o.text||"")+"\u201D",typeof o.ms=="number"?"stt.final ms: "+o.ms:null,"neutral"),D("stt",o.ms),$=!0,e.get().micHint&&e.set({micHint:null});break;case"stt.ignored":o.text&&k("user",o.text,["ignored \u2014 "+(o.reason||"echo")],{dim:!0}),_("stt.ignored","Ignored: \u201C"+(o.text||"")+"\u201D ("+(o.reason||"echo")+")",ke(o),"warn"),$=!0;break;case"mediator.delta":e.set(function(I){return{mediatorText:I.mediatorText+(o.text||"")}});break;case"mediator.done":e.set({mediatorText:o.text||""}),_("mediator.done","Mediator replied \xB7 "+(o.text||"").split(/\s+/).length+" words",ke({ms_first_token:o.ms_first_token,ms_total:o.ms_total}),"neutral"),D("mediator_first_token",o.ms_first_token);break;case"meta_tool":o.phase==="start"?e.set({toolChip:{name:o.name,start:Date.now()}}):(e.set({toolChip:null}),h.current.push(o.name+(typeof o.ms=="number"?" \xB7 "+o.ms+" ms":""))),_("meta_tool",o.name+(o.phase==="end"?o.result_summary?" \u2192 "+o.result_summary:" finished":" started"),ke({args:o.args,ms:o.ms}),"accent");break;case"tts.start":e.get().ttsPlaying||_("tts.start","TTS started \xB7 kokoro-onnx",null,"neutral"),e.set({ttsPlaying:!0,speakingText:o.text||""});break;case"tts.chunk_hdr":break;case"tts.amp":s.current&&s.current.onAmp(typeof o.v=="number"?o.v:0);break;case"tts.end":e.set({ttsPlaying:!1,speakingText:""}),D("tts_first_chunk",o.ms_first_chunk);break;case"task.update":{var v=bn(o);e.set(function(I){var P=I.dismissedTasks;return o.status&&P&&Object.prototype.hasOwnProperty.call(P,o.id)&&P[o.id]!==o.status&&(P=Object.assign({},P),delete P[o.id],Re(Je,P)),{dismissedTasks:P}}),_("task.update",(o.title||o.id)+" \u2192 "+o.status,ke({progress_note:o.progress_note,result_summary:o.result_summary}),o.status==="failed"?"danger":o.status==="needs_review"?"warn":"accent"),st(o.status)&&w(On(v));break}case"memory.hits":{var M=o.items||[];e.set({memoryHits:M}),s.current&&s.current.onMemoryHits(M),h.current.push("memory_recall \xB7 "+M.length+" hit"+(M.length===1?"":"s")),_("memory.hits","memory_recall \u2192 "+M.length+" hits",ke(M),"accent"),H(M);break}case"latency":D(o.stage,o.ms);break;case"health":e.set({health:o}),_("health","Health changed",ke(o.components),"warn");break;case"error":e.set(function(I){return{errCount:I.errCount+1}}),_("error",o.message||"error",ke(o),"danger"),k("system",o.message||"Turn failed \u2014 no reply.",[],{tone:"red"}),h.current=[],e.set({mediatorText:"",speakingText:""}),w({id:"error:"+Date.now(),tone:"error",title:"Pipeline error",body:o.message||"Turn failed \u2014 see the activity stream.",ts:Date.now(),approve:!1});break;case"pong":break;default:_(o.t,o.t,null,"neutral")}}var ue=0,Q=sn({onEvent:Y,onBinary:function(o){p.queueChunk(o)},onStatus:function(o){if(e.set({connection:o}),o==="open")clearTimeout(ne),ue=0,e.set({offline:!1,offlineDismissed:!1,retryAttempt:0,retryAt:0}),_e(!0);else if(o==="reconnecting"){ue++;var v=Math.ceil(ue/2);e.set({offline:!0,retryAttempt:v,retryAt:ue%2===1?Date.now()+Yr(v):e.get().retryAt,lastEventTs:L.current})}},onOpen:function(){}});u.current=Q;function l(){e.get().micActive||(e.set({micActive:!0}),e.get().ttsPlaying&&(p.hardStop(),Q.send({t:"barge_in"}),e.set(function(o){return{bargeIns:o.bargeIns+1}})),Q.send({t:"mic.start"}),W.start(),j())}function E(){e.get().micActive&&(e.set({micActive:!1}),W.stop(),Q.send({t:"mic.stop"}),clearTimeout(T),e.set({micHint:null}))}c.current.start=l,c.current.stop=E;function m(){p.hardStop(),Q.send({t:"barge_in"}),e.set(function(o){return{bargeIns:o.bargeIns+1}})}c.current.interrupt=m;function x(o){if((o.metaKey||o.ctrlKey)&&String(o.key).toLowerCase()==="k"){o.preventDefault(),i.composerInputRef.current&&i.composerInputRef.current.focus();return}var v=Bn(document.activeElement);if(o.code==="Space"){if(!document.hasFocus()||v||o.repeat)return;o.preventDefault(),l();return}if(o.key==="Escape"){m();return}if(!v&&!o.metaKey&&!o.ctrlKey&&!o.altKey&&String(o.key).toLowerCase()==="f"){o.preventDefault(),Fn(e);return}!v&&["1","2","3"].indexOf(o.key)>=0&&e.set({tab:["work","activity","system"][+o.key-1]})}function R(o){o.code==="Space"&&(Bn(document.activeElement)||(o.preventDefault(),E()))}window.addEventListener("keydown",x),window.addEventListener("keyup",R);var A=setInterval(function(){et("/health").then(function(o){e.set({health:o})}).catch(function(){})},Hr);return function(){clearTimeout(ne),clearInterval(A),clearTimeout(T),window.removeEventListener("keydown",x),window.removeEventListener("keyup",R),Q.close(),W.teardown(),s.current&&(s.current.destroy(),s.current=null)}},[]),r.useEffect(function(){function p(){e.set({fullscreen:jn()})}return document.addEventListener("fullscreenchange",p),document.addEventListener("webkitfullscreenchange",p),function(){document.removeEventListener("fullscreenchange",p),document.removeEventListener("webkitfullscreenchange",p)}},[]),r.useEffect(function(){var p=document.getElementById("jarvis-voice-root");if(!p)return;if(!n.pseudoFullscreen){p.style.setProperty("--jv-fs-top-clear","0px");return}function y(){var $=0;document.querySelectorAll("header").forEach(function(T){if(!p.contains(T)){var O=window.getComputedStyle(T);if(!(O.position!=="fixed"&&O.position!=="sticky")){var W=T.getBoundingClientRect();W.top>4||W.bottom>$&&($=W.bottom)}}}),p.style.setProperty("--jv-fs-top-clear",($>0?$:0)+"px")}return y(),window.addEventListener("resize",y),function(){window.removeEventListener("resize",y)}},[n.pseudoFullscreen]),r.useEffect(function(){var p=document.getElementById("jarvis-voice-root");if(!p)return;function y(){var T=p.clientWidth||window.innerWidth;Math.abs(T-e.get().w)>4&&e.set({w:T})}y();var $=typeof ResizeObserver<"u"?new ResizeObserver(y):null;return $&&$.observe(p),window.addEventListener("resize",y),function(){$&&$.disconnect(),window.removeEventListener("resize",y)}},[]),r.useEffect(function(){var p=document.getElementById("jarvis-voice-root");if(!p)return;var y=!1;function $(){if(!y){y=!0;var Y=p.getBoundingClientRect().top,ue=Math.max(320,window.innerHeight-Y);p.style.height=ue+"px";var Q=document.documentElement.scrollHeight-window.innerHeight;Q>1&&(p.style.height=Math.max(320,ue-Q)+"px"),y=!1}}$(),window.addEventListener("resize",$);var T=typeof ResizeObserver<"u"?new ResizeObserver($):null;T&&T.observe(document.body);var O=setTimeout($,500),W=setTimeout($,1500),j=p.parentElement,ne=j?j.getAttribute("style"):null;return j&&(j.style.padding="0"),function(){window.removeEventListener("resize",$),T&&T.disconnect(),clearTimeout(O),clearTimeout(W),j&&(ne==null?j.removeAttribute("style"):j.setAttribute("style",ne))}},[]);var we=n.w<Ur;r.useEffect(function(){var p=i.canvasRef.current;if(p){var y=nt(p);return s.current=y,f.current&&y.setAudioSource(f.current.getLevels),y.setReducedMotion(e.get().reducedMotion),y.setState(De(e.get())),y.onMemoryHits(e.get().memoryHits),function(){y.destroy(),s.current===y&&(s.current=null)}}},[we]),r.useEffect(function(){s.current&&s.current.setState(De(n))},[n.fsmState,n.connection]),r.useEffect(function(){s.current&&s.current.setReducedMotion(n.reducedMotion),Jr("jarvis-voice:reducedMotion",n.reducedMotion),r.motion.set(n.reducedMotion?"off":"system")},[n.reducedMotion]),r.useEffect(function(){f.current&&f.current.setGain(n.volume)},[n.volume]);var Ne=r.useRef(null);Ne.current||(Ne.current={onMicClick:function(p){p&&p.preventDefault(),e.get().micActive?c.current.stop():c.current.start()},interrupt:function(){c.current.interrupt()},submitText:function(p){b.current=p,C(),k("user",p),u.current&&u.current.send({t:"turn.text",text:p}),_("turn.text","Typed turn: "+p,null,"neutral")},setMicMode:function(p){e.set({micMode:p}),u.current&&u.current.send({t:"mode.set",mode:p})},dismissTask:function(p){e.set(function(y){var $=Object.assign({},y.dismissedTasks);return $[p]=!0,Re(Je,$),{dismissedTasks:$}})},dismissNotice:F,clearWork:function(p,y){var $=null;return e.set(function(T){$={notices:T.notices,dismissedNotices:T.dismissedNotices,dismissedTasks:T.dismissedTasks};var O=Object.assign({},T.dismissedNotices),W=Date.now();(p||[]).forEach(function(Y){O[Y]=W});var j=Object.assign({},T.dismissedTasks);(y||[]).forEach(function(Y){j[Y]=!0}),Re(ht,O),Re(Je,j);var ne={};return(p||[]).forEach(function(Y){ne[Y]=!0}),{dismissedNotices:O,dismissedTasks:j,notices:(T.notices||[]).filter(function(Y){return!ne[Y.id]})}}),function(){$&&(Re(ht,$.dismissedNotices||{}),Re(Je,$.dismissedTasks||{}),e.set($))}},resolveNotice:function(p){F(p)},getSeries:function(p){return d.current.series(p)},toggleReduced:function(){e.set(function(p){return{reducedMotion:!p.reducedMotion}})},toggleFullscreen:function(){Fn(e)},log:_});var Ae=Ne.current,ae=n.w>=zr,ve=Object.assign({background:Zr},n.pseudoFullscreen?Qr:null);return V`
    <${r.Root} id="jarvis-voice-root" fill style=${ve}>
      ${we?V`<${Pn} store=${e} act=${Ae} refs=${i} />`:V`
          <div style=${{position:"absolute",inset:0,display:"flex",flexDirection:"column",paddingTop:"var(--jv-fs-top-clear, 0px)"}}>
            <${ea} s=${n} act=${Ae} />
            <div style=${{flex:"1 1 0%",minHeight:0,display:"grid",gridTemplateColumns:ae?"304px minmax(0,1fr) 372px":"minmax(0,1fr) 344px"}}>
              ${ae?V`<${Mn} store=${e} />`:null}
              <${pn} store=${e} act=${Ae} refs=${i} />
              <${Rn} store=${e} act=${Ae} showLeft=${ae} />
            </div>
          </div>`}
      <${ta} s=${n} store=${e} onRetry=${function(){u.current&&u.current.forceReconnect()}} />
    <//>`}function ea(t){var e=t.s,n=t.act,a=Le(),i=a.data||{},s=e.health&&e.health.models||{},u=e.connection==="open"?"connected":e.connection==="connecting"?"connecting":e.connection==="reconnecting"?"reconnecting":"disconnected",f=r.useRef(null),d=r.useElementWidth(f)||e.w||1200,c=d>=760,h=d>=900,b=d>=1100,S=d>=1560,L=e.latency.e2e_first_audio&&e.latency.e2e_first_audio.p50,g=e.health&&e.health.ram?e.health.ram.free_gb:void 0,_={flex:"none",minWidth:72},k=!!e.health,w=s.mediator&&s.mediator.name,F=s.worker&&s.worker.name,N=!w||!F||w===F;return V`
    <div ref=${f} style=${{flex:"none",minHeight:52,padding:"6px 18px",borderBottom:"1px solid var(--hui-line)",background:"var(--hui-surface)",display:"flex",alignItems:"center",gap:16,minWidth:0}}>
      <${r.Row} align="center" gap="sm" wrap=${!1} style=${{flex:"none"}}>
        <span className="hui-dot hui-dot--accent hui-dot--pulse" aria-hidden="true" />
        <span className="hui-t-title">JARVIS</span>
        ${d>=640?V`<${r.Badge} icon="lock" size="sm">Local only<//>`:null}
      <//>
      ${c?V`<${r.Divider} orientation="vertical" />`:null}
      <div style=${{display:"flex",alignItems:"center",gap:20,minWidth:0,flex:"1 1 auto",overflow:"hidden"}}>
        ${b?N?V`<${r.Stat} size="sm" variant="plain" label="Model" style=${_} value=${k?w||null:void 0} />`:V`
            <${r.Stat} size="sm" variant="plain" label="Mediator" style=${_} value=${k?w||null:void 0} />
            <${r.Stat} size="sm" variant="plain" label="Worker" style=${_} value=${k?F||null:void 0} />`:null}
        ${h?V`<${r.Stat} size="sm" variant="plain" label="E2E first audio" style=${_}
            value=${L??"none yet"} format=${function(C){return(C/1e3).toFixed(2)+" s"}} />`:null}
        ${c?V`<${r.Stat} size="sm" variant="plain" label="RAM free" style=${_} value=${k?g??null:void 0}
            format=${function(C){return C.toFixed(1)+" GB"}} />`:null}
        ${S&&i.backends?V`<div style=${{display:"flex",gap:14,marginLeft:"auto",flex:"none"}}>
              ${Object.keys(Ge).filter(function(C){var D=i.backends[C];return D&&D.tier!=="free"}).map(function(C){var D=i.backends[C],H=(D.gauges||[])[0],J=H&&typeof H.remaining_pct=="number"?H.remaining_pct*100:0;return V`<div key=${C} style=${{width:124,flex:"none"}}>
                    <${r.Meter} size="sm" label=${Ge[C].name} value=${J} max=${100} valueText=${Math.round(J)+"%"} />
                  </div>`})}
            </div>`:null}
      </div>
      <${r.Row} align="center" gap="sm" wrap=${!1} style=${{flex:"none"}}>
        <${Nn} act=${n} />
        <${r.ConnectionPill} state=${u} attempt=${e.retryAttempt} />
        <${rt} active=${e.fullscreen||e.pseudoFullscreen} pseudo=${e.pseudoFullscreen} onClick=${n.toggleFullscreen} />
        <${r.Switch} checked=${!e.reducedMotion} onChange=${function(){n.toggleReduced()}} label=${d>=980?"Motion":void 0} ariaLabel="Motion" />
      <//>
    </div>`}function ta(t){var e=t.s,n=t.store;r.useNow(1e3);var a=!!e.offline&&!e.offlineDismissed;return V`
    <div style=${{position:"absolute",insetInline:0,bottom:0,display:"flex",justifyContent:"center",paddingBottom:24,pointerEvents:a?"auto":"none",zIndex:40}}>
      <div style=${{width:"min(520px,86%)"}}>
        <${r.Banner} tone="warn" variant="inline" open=${a} title="jarvisd unreachable through the dashboard proxy"
          action=${V`
            <${r.Row} gap="sm">
              <${r.Button} size="sm" variant="primary" onClick=${t.onRetry}>Retry now<//>
              <${r.Button} size="sm" variant="secondary" onClick=${function(){n.set({offlineDismissed:!0})}}>Work offline<//>
            <//>`}>
          <${r.Stack} gap="sm">
            <span>
              Voice capture is paused. Task state is safe in <code className="hui-code">jarvis.db</code> and replays on reconnect. Retrying with backoff${e.retryAttempt?" \u2014 attempt "+e.retryAttempt:""}.
              ${e.retryAttempt&&e.retryAt?V` <${r.Countdown} to=${e.retryAt} fallback="" />`:null}
            </span>
            ${e.lastEventTs?V`<span className="hui-t-micro">last event <${r.RelTime} at=${e.lastEventTs} /></span>`:null}
          <//>
        <//>
      </div>
    </div>`}(function(){window.__JARVIS_VOICE_INTERNALS__={createVisualizer:nt,App:Bt},!(!window.__HERMES_PLUGIN_SDK__||!window.__HERMES_PLUGINS__)&&window.__HERMES_PLUGINS__.register("jarvis-voice",Bt)})();})();

(()=>{var r=window.HermesUI,Ta=r&&r.html;var fe="/api/plugins/jarvis-voice";function It(){return window.__HERMES_PLUGIN_SDK__}function sn(){return window.__HERMES_SESSION_TOKEN__}function at(t){var e=window.HERMES_BASE_PATH||"";return new URL(e+"/dashboard-plugins/jarvis-voice/dist/"+t,window.location.origin).toString()}function cr(t,e){var n=It(),a=fe+t;if(n&&typeof n.authedFetch=="function")return n.authedFetch(a,e);var i=Object.assign({},e);i.headers=Object.assign({},i.headers);var s=sn();return s&&(i.headers["X-Hermes-Session-Token"]=s),i.credentials||(i.credentials="include"),fetch(a,i)}function it(t){var e=It();return e&&typeof e.fetchJSON=="function"?e.fetchJSON(fe+t):cr(t).then(function(n){if(!n.ok)throw new Error("HTTP "+n.status+" for "+t);return n.json()})}function ln(){var t=It(),e=fe+"/ws";if(t&&typeof t.buildWsUrl=="function")try{var n=t.buildWsUrl(e);if(typeof t.buildWsAuthParam=="function"){var a=t.buildWsAuthParam();a&&(n+=(n.indexOf("?")===-1?"?":"&")+a)}return n}catch{}var i=window.location.protocol==="https:"?"wss:":"ws:",s=sn(),u=i+"//"+window.location.host+e;return s&&(u+="?token="+encodeURIComponent(s)),u}function un(t){var e=t,n=new Set;function a(){return e}function i(u){return e=Object.assign({},e,typeof u=="function"?u(e):u),n.forEach(function(d){d(e)}),e}function s(u){return n.add(u),function(){n.delete(u)}}return{get:a,set:i,subscribe:s}}function ne(t){var e=r.useState,n=r.useEffect,a=e(t.get()),i=a[0],s=a[1];return n(function(){return s(t.get()),t.subscribe(s)},[t]),i}function ot(t,e,n){var a=t.concat([e]);return a.length>n&&(a=a.slice(a.length-n)),a}function cn(t){var e=t||20,n={};function a(d,m){var f=(n[d]||[]).concat([m]);f.length>e&&(f=f.slice(f.length-e)),n[d]=f}function i(d){return n[d]||[]}function s(d,m){var f=n[d];if(!f||!f.length)return null;var h=f.slice().sort(function(w,_){return w-_}),E=Math.min(h.length-1,Math.floor(m*h.length));return Math.round(h[E])}function u(){var d={};return Object.keys(n).forEach(function(m){d[m]={p50:s(m,.5),p95:s(m,.95),n:n[m].length}}),d}return{record:a,summary:u,series:i}}var st=1e3,dr=1e4;function dn(t){var e=t&&t.onEvent||function(){},n=t&&t.onBinary||function(){},a=t&&t.onStatus||function(){},i=t&&t.onOpen||function(){},s=null,u=st,d=null,m=!1,f=!1;function h(){m||(a("reconnecting"),clearTimeout(d),d=setTimeout(E,u),u=Math.min(u*2,dr))}function E(){clearTimeout(d),m=!1,a(u>st?"reconnecting":"connecting");var b;try{b=new WebSocket(ln())}catch{h();return}b.binaryType="arraybuffer",s=b,b.onopen=function(){clearTimeout(d),u=st,f=!1,a("open"),i()},b.onmessage=function(H){if(typeof H.data=="string"){var W;try{W=JSON.parse(H.data)}catch{return}W&&W.t==="tts.chunk_hdr"&&(f=!0),e(W)}else f&&(f=!1,n(H.data))},b.onclose=function(){s===b&&(s=null,h())},b.onerror=function(){try{b.close()}catch{}}}function w(b){s&&s.readyState===WebSocket.OPEN&&s.send(JSON.stringify(b))}function _(b){s&&s.readyState===WebSocket.OPEN&&s.send(b)}function g(){if(u=st,m=!1,s){try{s.close()}catch{}s=null}E()}function F(){if(m=!0,clearTimeout(d),s){try{s.close()}catch{}s=null}}return E(),{send:w,sendBinary:_,close:F,forceReconnect:g}}function fn(t){var e=t&&t.onChunk||function(){},n=t&&t.onLevel||function(){},a=t&&t.onError||function(){},i=null,s=null,u=null,d=null,m=!1,f=null,h=0;function E(){return!!((window.AudioContext||window.webkitAudioContext)&&window.AudioWorkletNode&&navigator.mediaDevices&&navigator.mediaDevices.getUserMedia)}function w(R){if(!window.isSecureContext)return"Mic unavailable: this page is not a secure context (needs https:// or localhost).";var A=R&&R.name||"";return A==="NotAllowedError"||A==="PermissionDeniedError"?"Microphone permission denied. Allow mic access for this site, then try again.":A==="NotFoundError"||A==="DevicesNotFoundError"?"No microphone found. Check your input device.":A==="NotReadableError"||A==="TrackStartError"?"Microphone is in use by another app, or a hardware error occurred.":A==="OverconstrainedError"?"No microphone matches the required audio constraints.":A==="AbortError"?"Microphone access was aborted.":R&&R.message||String(R)}function _(){if(!i){var R=window.AudioContext||window.webkitAudioContext;i=new R}return i}function g(){if(f)return f;if(!window.isSecureContext)return f=Promise.reject(new Error("insecure-context")),f;if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)return f=Promise.reject(new Error("getUserMedia is not available in this browser.")),f;var R=_(),A=R.sampleRate;return f=navigator.mediaDevices.getUserMedia({audio:{sampleRate:{ideal:16e3},echoCancellation:!0,noiseSuppression:!0,channelCount:1}}).then(function(U){return d=U,R.audioWorklet.addModule(at("mic-worklet.js")).catch(function(B){throw new Error("mic init failed: "+(B&&B.message?B.message:B))})}).then(function(){u=R.createMediaStreamSource(d),s=new AudioWorkletNode(R,"mic-worklet",{processorOptions:{targetSampleRate:16e3,sourceSampleRate:A}}),s.port.onmessage=function(U){var B=U.data;B.type==="chunk"?m&&(h++,e(B.buffer)):B.type==="level"&&n(B.rms)},u.connect(s)}).catch(function(U){throw f=null,U}),f}function F(){m=!0,h=0;var R=_();Promise.resolve().then(function(){return R.resume?R.resume():void 0}).catch(function(){}).then(function(){if(R.state!=="running")throw new Error("AudioContext did not enter 'running' state (state: "+R.state+").");return g()}).catch(function(A){m=!1,a(w(A))})}function b(){m=!1}function H(){if(m=!1,s)try{s.disconnect()}catch{}if(u)try{u.disconnect()}catch{}if(d&&(d.getTracks().forEach(function(R){R.stop()}),d=null),i){try{i.close()}catch{}i=null}f=null}function W(){return h}return{start:F,stop:b,teardown:H,isSupported:E(),getChunkCount:W}}function mn(){var t=24e3,e=250,n=2e3,a=null,i=null,s=null,u=null,d=1,m=null,f=null,h=null,E=null,w=null,_={level:0,low:0,mid:0,high:0},g=!1,F=null,b=[];function H(){clearTimeout(F),F=setTimeout(function(){g=!1,b.slice().forEach(function(p){try{p()}catch{}})},e)}var W="pending",R=null,A=null,U=null,B=null;function z(){return A||(A=document.createElement("audio"),A.autoplay=!0,A.playsInline=!0,A.setAttribute("aria-hidden","true"),A.style.position="fixed",A.style.width="1px",A.style.height="1px",A.style.opacity="0",A.style.pointerEvents="none",(document.body||document.documentElement).appendChild(A),A)}function se(){var p=z();try{var O=p.play();O&&typeof O.catch=="function"&&O.catch(function(){})}catch{}}function re(p){W="direct",p.connect(a.destination)}function Ie(p){return new Promise(function(O,M){if(!window.RTCPeerConnection){M(new Error("RTCPeerConnection unsupported"));return}try{U=new RTCPeerConnection,B=new RTCPeerConnection}catch(c){M(c);return}var l=!1,y=setTimeout(function(){l||(l=!0,M(new Error("loopback negotiation timed out")))},n);U.onicecandidate=function(c){c.candidate&&B.addIceCandidate(c.candidate).catch(function(){})},B.onicecandidate=function(c){c.candidate&&U.addIceCandidate(c.candidate).catch(function(){})},B.ontrack=function(c){var C=z();C.srcObject=c.streams[0];try{var x=C.play();x&&typeof x.catch=="function"&&x.catch(function(){})}catch{}try{var N=c.receiver;N&&"playoutDelayHint"in N&&(N.playoutDelayHint=0)}catch{}l||(l=!0,clearTimeout(y),O())},p.stream.getTracks().forEach(function(c){U.addTrack(c,p.stream)}),U.createOffer().then(function(c){return U.setLocalDescription(c).then(function(){return c})}).then(function(c){return B.setRemoteDescription(c)}).then(function(){return B.createAnswer()}).then(function(c){return B.setLocalDescription(c).then(function(){return c})}).then(function(c){return U.setRemoteDescription(c)}).catch(function(c){l||(l=!0,clearTimeout(y),M(c))})})}function De(p){var O=z();O.srcObject=p.stream;var M;try{M=O.play()}catch(l){return Promise.reject(l)}return M&&typeof M.then=="function"?M:Promise.resolve()}function ae(p){if(typeof a.createMediaStreamDestination!="function")return R="createMediaStreamDestination unsupported on this browser",re(p),Promise.resolve();var O;try{O=a.createMediaStreamDestination()}catch(M){return R="createMediaStreamDestination failed: "+(M&&M.message?M.message:M),re(p),Promise.resolve()}return p.connect(O),Ie(O).then(function(){W="loopback",R=null}).catch(function(M){return De(O).then(function(){W="stream-element",R="loopback unavailable ("+(M&&M.message?M.message:M)+")"}).catch(function(l){try{O.disconnect()}catch{}re(p),R="no AEC-visible output route available (loopback: "+(M&&M.message?M.message:M)+"; element: "+(l&&l.message?l.message:l)+")"})})}function ie(){if(u)return u;try{a=new(window.AudioContext||window.webkitAudioContext)({sampleRate:t})}catch{a=new(window.AudioContext||window.webkitAudioContext)}return u=a.audioWorklet.addModule(at("player-worklet.js")).then(function(){i=new AudioWorkletNode(a,"player-worklet",{outputChannelCount:[1]}),i.port.onmessage=function(M){M.data&&M.data.type==="drained"&&H()},s=a.createGain(),s.gain.value=d,i.connect(s);var p=s;try{m=a.createAnalyser(),m.fftSize=2048,m.smoothingTimeConstant=.5,f=new Uint8Array(m.frequencyBinCount),typeof m.getFloatTimeDomainData=="function"?h=new Float32Array(m.fftSize):E=new Uint8Array(m.fftSize);var O=a.sampleRate/m.fftSize;w=[Math.round(250/O),Math.round(2e3/O),Math.min(m.frequencyBinCount,Math.round(6e3/O))],s.connect(m),p=m}catch{m=null}return ae(p)}).catch(function(p){throw u=null,p}),u}function me(){if(!m||!a||a.state!=="running")return null;var p,O=0;if(h){for(m.getFloatTimeDomainData(h),p=0;p<h.length;p++)O+=h[p]*h[p];O=Math.sqrt(O/h.length)}else{for(m.getByteTimeDomainData(E),p=0;p<E.length;p++){var M=(E[p]-128)/128;O+=M*M}O=Math.sqrt(O/E.length)}m.getByteFrequencyData(f);var l=[0,0,0],y=[0,0,0],c=0;for(p=0;p<w[2];p++){for(;c<2&&p>=w[c];)c++;l[c]+=f[p],y[c]++}return _.level=Math.min(1,O*4.5),_.low=y[0]?l[0]/(y[0]*255):0,_.mid=y[1]?l[1]/(y[1]*255):0,_.high=y[2]?l[2]/(y[2]*255):0,_}function Me(p){g=!0,clearTimeout(F),ie().then(function(){a.state==="suspended"&&a.resume().catch(function(){});var O=p instanceof Int16Array?p:new Int16Array(p),M=fr(O),l=a.sampleRate,y=l===t?M:mr(M,t,l);i.port.postMessage({type:"push",samples:y},[y.buffer])}).catch(function(){})}function v(){i&&i.port.postMessage({type:"clear"}),clearTimeout(F),g=!1}function T(p){d=p,s&&(s.gain.value=p)}function k(){return g}function S(p){return b.push(p),function(){b=b.filter(function(M){return M!==p})}}function D(){return{path:W,error:R}}function J(){clearTimeout(F),b=[];try{U&&U.close()}catch{}try{B&&B.close()}catch{}A&&A.parentNode&&A.parentNode.removeChild(A);try{a&&a.close()}catch{}}return{queueChunk:Me,hardStop:v,setGain:T,getLevels:me,isPlaying:k,onDrained:S,primeAutoplay:se,getDiagnostics:D,destroy:J}}function fr(t){for(var e=new Float32Array(t.length),n=0;n<t.length;n++){var a=t[n];e[n]=a<0?a/32768:a/32767}return e}function mr(t,e,n){for(var a=e/n,i=Math.max(1,Math.round(t.length/a)),s=new Float32Array(i),u=0;u<i;u++){var d=u*a,m=Math.floor(d),f=Math.min(m+1,t.length-1),h=d-m;s[u]=t[m]*(1-h)+t[f]*h}return s}var le={idle:{rad:1,spin:.05,noise:.1,glow:.55,mode:"calm",col:[79,227,224]},listening:{rad:1.09,spin:.09,noise:.16,glow:.88,mode:"open",col:[110,235,225]},transcribing:{rad:1.02,spin:.15,noise:.3,glow:.76,mode:"resolve",col:[130,226,236]},thinking:{rad:.93,spin:.24,noise:.13,glow:.7,mode:"orbit",col:[79,210,232]},memory:{rad:1,spin:.07,noise:.09,glow:.78,mode:"stars",col:[96,216,206]},capability:{rad:.97,spin:.12,noise:.09,glow:.72,mode:"radial",col:[122,222,216]},tool:{rad:.95,spin:.19,noise:.12,glow:.8,mode:"arc",col:[79,227,224]},delegating:{rad:1.03,spin:.1,noise:.14,glow:.84,mode:"transfer",col:[86,206,234]},worker_progress:{rad:.91,spin:.06,noise:.07,glow:.58,mode:"arc",col:[86,206,234]},speaking:{rad:1.05,spin:.07,noise:.1,glow:1,mode:"bands",col:[124,240,233]},interrupted:{rad:.87,spin:.03,noise:.05,glow:.34,mode:"calm",col:[150,170,176]},blocked:{rad:.95,spin:.03,noise:.06,glow:.62,mode:"calm",col:[242,179,92]},error:{rad:.9,spin:.02,noise:.36,glow:.66,mode:"calm",col:[255,107,107]},done:{rad:1.1,spin:.05,noise:.08,glow:.92,mode:"pulse",col:[104,234,208]},offline:{rad:.85,spin:.01,noise:.04,glow:.2,mode:"calm",col:[110,128,133]}},vn={idle:{label:"Idle",hint:"Awake \xB7 nothing in flight"},listening:{label:"Listening",hint:"mic open \xB7 webrtcvad endpointing"},transcribing:{label:"Transcribing",hint:"faster-whisper base.en int8"},thinking:{label:"Thinking",hint:"gpt-oss-20b \xB7 8k window"},memory:{label:"Recalling",hint:"Obsidian vault \xB7 FTS5 + vectors"},capability:{label:"Matching capability",hint:"tools \xB7 skills \xB7 quick actions"},tool:{label:"Running meta-tool",hint:"server-reported action"},delegating:{label:"Delegating",hint:"handing the goal to a worker"},worker_progress:{label:"Worker running",hint:"gpt-oss-20b worker session"},speaking:{label:"Speaking",hint:"kokoro-onnx \xB7 am_michael"},interrupted:{label:"Interrupted",hint:"playback stopped \xB7 mediator canceled"},blocked:{label:"Blocked",hint:"needs a decision from you"},error:{label:"Error",hint:"recoverable \xB7 see activity"},done:{label:"Done",hint:"turn complete"},offline:{label:"Offline",hint:"reconnecting to jarvisd"}},Pa=Object.keys(le);function pn(t){var e=(le[t]||le.idle).col;return"rgb("+e[0]+","+e[1]+","+e[2]+")"}function hn(t){return vn[t]||vn.idle}var $n=2,vr=95,pr=2.399963229728653;function We(t){return Math.max(0,Math.min(1,t))}function gn(t){var e="idle",n=0,a=!1,i=[],s=null,u=!1,d=0,m=0,f=null,h=0,E=0,w=[],_=0,g=null,F=118,b=[],H=[],W=[];(function(){var y,c,C;for(y=0;y<F;y++){var x=1-y/(F-1)*2,N=Math.sqrt(Math.max(0,1-x*x)),L=y*pr;b.push([Math.cos(L)*N,x,Math.sin(L)*N])}var $={};for(y=0;y<F;y++){var P=[];for(c=0;c<F;c++)if(y!==c){var o=b[y][0]-b[c][0],I=b[y][1]-b[c][1],G=b[y][2]-b[c][2];P.push([o*o+I*I+G*G,c])}for(P.sort(function(K,X){return K[0]-X[0]}),C=0;C<3;C++){c=P[C][1];var V=y<c?y+":"+c:c+":"+y;$[V]||($[V]=!0,H.push([Math.min(y,c),Math.max(y,c)]))}}for(y=0;y<84;y++)W.push({x:Math.random(),y:Math.random(),z:.3+Math.random()*.7,s:.2+Math.random()*.8})})();var R=new Array(F),A=0,U=0;function B(l){l>26?(U++,U>90&&A<3&&(A++,U=0)):U>0&&U--}var z=128,se=document.createElement("canvas"),re=document.createElement("canvas");se.width=se.height=z,re.width=re.height=z;var Ie="";function De(l,y,c){var C=l+","+y+","+c;if(C!==Ie){Ie=C;var x=z/2,N=se.getContext("2d");N.clearRect(0,0,z,z);var L=N.createRadialGradient(x,x,z*.035,x,x,x);L.addColorStop(0,"rgba("+C+",0.09)"),L.addColorStop(.45,"rgba("+C+",0.035)"),L.addColorStop(1,"rgba("+C+",0)"),N.fillStyle=L,N.fillRect(0,0,z,z);var $=re.getContext("2d");$.clearRect(0,0,z,z);var P=$.createRadialGradient(x,x,0,x,x,x);P.addColorStop(0,"rgba("+C+",1)"),P.addColorStop(.28,"rgba("+C+",0.38)"),P.addColorStop(1,"rgba("+C+",0)"),$.fillStyle=P,$.fillRect(0,0,z,z)}}function ae(){if(t.clientWidth){var l=Math.min($n,window.devicePixelRatio||1),y=Math.round(t.clientWidth*l),c=Math.round(t.clientHeight*l);(t.width!==y||t.height!==c)&&(t.width=y,t.height=c)}}var ie=0,me=0,Me=(window.performance||Date).now();function v(l){if(ie=u?0:requestAnimationFrame(v),!!t.clientWidth){t.width===0&&ae();var y=Math.min(64,l-(me||l));me=l;var c=(l-Me)/1e3;B(y);var C=s?s():null;if(C){f=C;var x=We(C.level+(C.high||0)*.3);d+=(x-d)*.28}else f=null,d+=(m-d)*.28,m*=.88;h+=(E-h)*.2,E*=.9,h>.42&&c-_>.42&&(_=c,w.push({r:.34,a:.42}));var N=le[e]||le.idle;g||(g={rad:N.rad,spin:N.spin,noise:N.noise,glow:N.glow,mode:N.mode,col:N.col.slice()});var L=a?1:1-Math.exp(-y/vr);g.rad+=(N.rad-g.rad)*L,g.spin+=(N.spin-g.spin)*L,g.noise+=(N.noise-g.noise)*L,g.glow+=(N.glow-g.glow)*L;for(var $=0;$<3;$++)g.col[$]+=(N.col[$]-g.col[$])*L;g.mode=N.mode,T(c,y)}}function T(l,y){var c=t.getContext("2d");if(c){var C=Math.min($n,window.devicePixelRatio||1),x=t.width,N=t.height;c.setTransform(1,0,0,1,0,0),c.clearRect(0,0,x,N),c.scale(C,C);var L=x/C,$=N/C,P=L/2,o=$<300,I=o?$*.5:$/2-6,G=o?Math.min(L*.3,$*.4):Math.min(L,$)*.29,V=Math.round(g.col[0]),K=Math.round(g.col[1]),X=Math.round(g.col[2]),Y=function(ur){return"rgba("+V+","+K+","+X+","+ur+")"};De(V,K,X);var ue=a?.6:l,$e=G*2.9;if(c.globalAlpha=We(g.glow),c.drawImage(se,P-$e,I-$e,$e*2,$e*2),c.globalAlpha=1,A<2){c.lineWidth=1;for(var ve=0;ve<3;ve++){var He=G*(1.5+ve*.42),Pe=.19+ve*.02,St=ue*(.05+ve*.015)*(ve%2?-1:1);c.strokeStyle=Y(.05-ve*.011),c.beginPath(),c.ellipse(P,I,He,He*Pe,St,0,Math.PI*2),c.stroke()}}if(!a&&A<1)for(var Ce=0;Ce<W.length;Ce++){var ce=W[Ce];ce.y-=12e-5*ce.z*(y/16),ce.y<-.05&&(ce.y=1.05,ce.x=Math.random());var Tt=ce.x*L+Math.sin(ue*.2+ce.z*9)*6,Mt=ce.y*$;c.fillStyle=Y(.05+ce.s*.1),c.fillRect(Tt,Mt,1.1,1.1)}for(var ge=ue*g.spin*2.2,pe=.42+Math.sin(ue*.24)*.1,xe=Math.cos(ge),Ee=Math.sin(ge),_e=Math.cos(pe),Re=Math.sin(pe),ye=G*g.rad*(1+d*.14),be=A>=3?2:1,te=0;te<F;te+=be){var Ue=b[te],Ct=a?0:Math.sin(te*1.77+ue*1.15)*.5+Math.sin(te*4.13-ue*.7)*.5,xt=1+Ct*g.noise*.34+d*.1*Math.sin(te*.7+ue*6),zt=Ue[0]*xt,Wt=Ue[1]*xt,Kt=Ue[2]*xt,nr=zt*xe+Kt*Ee,Gt=-zt*Ee+Kt*xe,rr=Wt*_e-Gt*Re,Jt=Wt*Re+Gt*_e,Et=2.7/(2.7-Jt);R[te]=[P+nr*ye*Et,I+rr*ye*Et,Jt,Et]}c.lineWidth=1;for(var _t=0;_t<H.length;_t+=be){var Ze=H[_t];if(!(be>1&&(Ze[0]%2||Ze[1]%2))){var et=R[Ze[0]],tt=R[Ze[1]];if(!(!et||!tt)){var ar=(et[2]+tt[2])/2,ir=(.06+Math.max(0,ar+.9)*.13)*(.55+g.glow*.6);c.strokeStyle=Y(Math.min(.5,ir)),c.beginPath(),c.moveTo(et[0],et[1]),c.lineTo(tt[0],tt[1]),c.stroke()}}}for(var Rt=0;Rt<F;Rt+=be){var Le=R[Rt];if(!(!Le||Le[2]<-.25)){var nt=.7+Le[3]*.5;c.fillStyle=Y(.14+Math.max(0,Le[2])*.4),c.fillRect(Le[0]-nt/2,Le[1]-nt/2,nt,nt)}}if(!a&&A<2){var qt=-ge*.62,Vt=Math.cos(qt),Yt=Math.sin(qt),or=[[0,1,2],[1,2,0],[2,0,1]];c.lineWidth=1,c.strokeStyle=Y(.05+g.glow*.06);for(var ze=0;ze<3;ze++){var Xt=or[ze],Qt=ye*(1.02+ze*.008);c.beginPath();for(var At=!1,Nt=0;Nt<=56;Nt++){var Zt=Nt/56*Math.PI*2+ze*.7,ke=[0,0,0];ke[Xt[0]]=Math.cos(Zt),ke[Xt[1]]=Math.sin(Zt);var sr=ke[0]*Vt+ke[2]*Yt,en=-ke[0]*Yt+ke[2]*Vt,lr=ke[1]*_e-en*Re,tn=ke[1]*Re+en*_e;if(tn<-.55){At=!1;continue}var nn=2.7/(2.7-tn),rn=P+sr*Qt*nn,an=I+lr*Qt*nn;At?c.lineTo(rn,an):c.moveTo(rn,an),At=!0}c.stroke()}}var on=ye*(.3+d*.22+(g.mode==="pulse"?.12:0)),rt=on*2.4;if(c.globalAlpha=Math.min(.95,.5+g.glow*.4+d*.3),c.drawImage(re,P-rt,I-rt,rt*2,rt*2),c.globalAlpha=1,c.strokeStyle=Y(.42+d*.4),c.lineWidth=1.2,c.beginPath(),c.arc(P,I,on*.72,0,Math.PI*2),c.stroke(),a){k(c,P,I,G,Y);return}S(c,g.mode,P,I,G,l,Y)}}function k(l,y,c,C,x){l.setLineDash([2,6]),l.lineWidth=1,l.strokeStyle=x(.3),l.beginPath(),l.arc(y,c,C*1.32,0,Math.PI*2),l.stroke(),l.setLineDash([])}function S(l,y,c,C,x,N,L){var $,P,o,I,G,V,K;if(y==="open"){for($=w.length-1;$>=0;$--){var X=w[$];if(X.r+=.012,X.a*=.965,X.a<.01||X.r>2.2){w.splice($,1);continue}l.strokeStyle=L(X.a),l.lineWidth=1,l.beginPath(),l.arc(c,C,x*X.r,0,Math.PI*2),l.stroke()}var Y=.5+h*1.1;l.strokeStyle=L(.5),l.lineWidth=2,l.beginPath(),l.arc(c,C,x*1.36,-Math.PI/2-Y/2,-Math.PI/2+Y/2),l.stroke()}else if(y==="bands")for(K=34,$=0;$<K;$++){P=$/K*Math.PI*2-Math.PI/2;var ue=Math.abs(Math.sin($*1.7+N*6.1))*.5+Math.abs(Math.sin($*.9+N*11.3))*.5;if(f){var $e=(Math.sin(P)+1)/2,ve=(f.low||0)*$e+(f.mid||0)*(1-Math.abs($e-.5)*2)+(f.high||0)*(1-$e);ue*=.4+1.1*We(ve)}var He=x*(.16+d*ue*.72),Pe=x*1.2;l.strokeStyle=L(.14+d*ue*.5),l.lineWidth=1.6,l.beginPath(),l.moveTo(c+Math.cos(P)*Pe,C+Math.sin(P)*Pe),l.lineTo(c+Math.cos(P)*(Pe+He),C+Math.sin(P)*(Pe+He)),l.stroke()}else if(y==="orbit")for($=0;$<3;$++){I=x*(1.18+$*.16);var St=($%2?-1:1)*(.5+$*.22);K=26-$*5;for(var Ce=0;Ce<K;Ce++){P=Ce/K*Math.PI*2+N*St;var ce=.35+.65*Math.pow(Math.max(0,Math.sin(P*2+N)),2);l.fillStyle=L(.1+ce*.42),G=c+Math.cos(P)*I,V=C+Math.sin(P)*I*.34,l.beginPath(),l.arc(G,V,1.5,0,Math.PI*2),l.fill()}}else if(y==="resolve"){for(K=40,l.strokeStyle=L(.4),l.lineWidth=1.4,l.beginPath(),$=0;$<=K;$++){G=c-x*1.5+$/K*x*3;var Tt=1-Math.abs($/K-.5)*1.6;V=C+x*1.62+Math.sin($*.9+N*9)*x*.16*Math.max(0,Tt),$===0?l.moveTo(G,V):l.lineTo(G,V)}for(l.stroke(),$=0;$<16;$++)o=(N*.55+$/16)%1,P=$*2.4,I=x*(1.7-o*1.3),l.fillStyle=L(.5*(1-Math.abs(o-.5)*1.6)),l.beginPath(),l.arc(c+Math.cos(P)*I,C+Math.sin(P)*I*.7,1.4,0,Math.PI*2),l.fill()}else if(y==="stars"){var Mt=i.length?i.slice(0,6):[0,1,2];for($=0;$<Mt.length;$++)P=-Math.PI*.72+$*.5+Math.sin(N*.3+$)*.05,o=(N*.4+$*.33)%1,I=x*(2.05-o*.72),G=c+Math.cos(P)*I,V=C+Math.sin(P)*I*.78,l.strokeStyle=L(.1+(1-o)*.18),l.lineWidth=1,l.beginPath(),l.moveTo(G,V),l.lineTo(c,C),l.stroke(),l.fillStyle=L(.35+(1-o)*.45),l.beginPath(),l.arc(G,V,2.6,0,Math.PI*2),l.fill(),l.strokeStyle=L(.18),l.beginPath(),l.arc(G,V,6+Math.sin(N*2+$)*1.2,0,Math.PI*2),l.stroke()}else if(y==="radial")for(K=12,$=0;$<K;$++){P=$/K*Math.PI*2+N*.12;var ge=$%3===Math.floor(N*1.6)%3,pe=x*1.24,xe=x*(ge?.4:.2);l.strokeStyle=L(ge?.5:.14),l.lineWidth=ge?2:1,l.beginPath(),l.moveTo(c+Math.cos(P)*pe,C+Math.sin(P)*pe*.9),l.lineTo(c+Math.cos(P)*(pe+xe),C+Math.sin(P)*(pe+xe)*.9),l.stroke(),ge&&(l.fillStyle=L(.6),l.beginPath(),l.arc(c+Math.cos(P)*(pe+xe),C+Math.sin(P)*(pe+xe)*.9,2,0,Math.PI*2),l.fill())}else if(y==="arc"){I=x*1.34,l.strokeStyle=L(.1),l.lineWidth=2,l.beginPath(),l.arc(c,C,I,0,Math.PI*2),l.stroke();var Ee=N*.85%(Math.PI*2);l.strokeStyle=L(.62),l.lineWidth=2.4,l.beginPath(),l.arc(c,C,I,Ee,Ee+1.05),l.stroke(),l.fillStyle=L(.8),l.beginPath(),l.arc(c+Math.cos(Ee+1.05)*I,C+Math.sin(Ee+1.05)*I,2.4,0,Math.PI*2),l.fill()}else if(y==="transfer"){var _e=c,Re=C,ye=c+x*1.85,be=C+x*.9;for(l.strokeStyle=L(.14),l.lineWidth=1,l.beginPath(),l.moveTo(_e,Re),l.quadraticCurveTo(c+x,C+x*1.2,ye,be),l.stroke(),$=0;$<5;$++){o=(N*.65+$/5)%1;var te=1-o,Ue=te*te*_e+2*te*o*(c+x)+o*o*ye,Ct=te*te*Re+2*te*o*(C+x*1.2)+o*o*be;l.fillStyle=L(.7*(1-o*.7)),l.beginPath(),l.arc(Ue,Ct,2.1,0,Math.PI*2),l.fill()}l.strokeStyle=L(.4),l.lineWidth=1.4,l.beginPath(),l.arc(ye,be,9+Math.sin(N*3)*1.4,0,Math.PI*2),l.stroke()}else y==="pulse"&&(o=(N-n)*.9,o>=0&&o<=1&&(l.strokeStyle=L(.5*(1-o)),l.lineWidth=2,l.beginPath(),l.arc(c,C,x*(1.1+o*.9),0,Math.PI*2),l.stroke()))}function D(){u||ie||a||document.hidden||(me=0,ie=requestAnimationFrame(v))}function J(){ie&&(cancelAnimationFrame(ie),ie=0)}function p(){ae();var l=le[e]||le.idle;g={rad:l.rad,spin:l.spin,noise:l.noise,glow:l.glow,mode:l.mode,col:l.col.slice()};var y=((window.performance||Date).now()-Me)/1e3;T(y,16)}function O(){document.hidden?J():a||D()}document.addEventListener("visibilitychange",O);var M=null;return window.ResizeObserver?(M=new ResizeObserver(function(){ae(),a&&p()}),M.observe(t)):window.addEventListener("resize",ae),ae(),D(),{setState:function(l){l!==e&&(e=le[l]?l:"idle",n=((window.performance||Date).now()-Me)/1e3,a&&p())},setReducedMotion:function(l){a=!!l,a?(J(),p()):D()},setHits:function(l){i=Array.isArray(l)?l:[]},setAudioSource:function(l){s=typeof l=="function"?l:null},onAmp:function(l){m=We(typeof l=="number"?l:0)},onMicLevel:function(l){E=We(typeof l=="number"?l:0)},resize:function(){ae(),a&&p()},destroy:function(){u=!0,J(),document.removeEventListener("visibilitychange",O),M?M.disconnect():window.removeEventListener("resize",ae)}}}function lt(t){var e=gn(t);return{setState:function(n,a){e.setState(n)},onAmp:function(n){e.onAmp(n)},onMicLevel:function(n){e.onMicLevel(n)},onMemoryHits:function(n){e.setHits(n)},setAudioSource:function(n){e.setAudioSource(n)},setReducedMotion:function(n){e.setReducedMotion(n)},resize:function(){e.resize()},destroy:function(){e.destroy()}}}var q=r.html;function Oe(t){return t.connection==="open"?t.fsmState:"offline"}var hr={listening:1,speaking:1,thinking:1,tool:1,worker_progress:1},$r=[["STT","stt"],["MED","mediator_first_token"],["TTS","tts_first_chunk"]];function gr(t){var e=[],n=0;$r.forEach(function(i){var s=t[i[1]];typeof s=="number"&&(e.push({label:i[0]+" "+Math.round(s)+"ms",value:s,tone:i[1]==="mediator_first_token"?"accent":"neutral"}),n+=s)});var a=t.e2e_first_audio;return typeof a=="number"&&a-n>0&&e.length&&e.push({label:"PLAY "+Math.round(a-n)+"ms",value:a-n,tone:"neutral"}),e}function yr(t){var e=ne(t.store),n=gr(e.turnLatency||{}),a=(e.turnLatency||{}).e2e_first_audio,i=typeof a=="number"?r.format.duration(a):e.latency.e2e_first_audio&&e.latency.e2e_first_audio.p50!=null?r.format.duration(e.latency.e2e_first_audio.p50):"-",s=e.w>=1280;return q`
    <${r.Row} align="center" gap="md" style=${{padding:"10px 20px",borderBottom:"1px solid var(--hui-line)",flex:"none"}}>
      <span className="hui-t-micro" style=${{whiteSpace:"nowrap"}}>${"TURN "+(e.turnId!=null?"#"+e.turnId:"-")}</span>
      <div style=${{flex:1,minWidth:0}}>
        <${r.SegmentBar} segments=${n.length?n:[{label:"idle",value:1,tone:"neutral"}]} legend=${s} label="Turn latency waterfall" />
      </div>
      ${s?null:q`<span className="hui-t-num hui-t-faint" style=${{whiteSpace:"nowrap"}}>${"e2e "+i}</span>`}
    <//>`}function Dt(t){var e=t.s,n=Oe(e),a=hn(n),i=pn(n),s=e.fsmDetail&&e.connection==="open"?a.hint+" \xB7 "+e.fsmDetail:a.hint;return e.turnPending&&(s=s+" \xB7 listening, go on"),q`
    <div style=${{display:"flex",flexDirection:"column",alignItems:"center",gap:7,pointerEvents:"none"}} aria-live="polite">
      <${r.Row} align="center" gap="sm">
        <span className=${hr[n]&&!e.reducedMotion?"hui-dot hui-dot--pulse":"hui-dot"}
          style=${{background:i,boxShadow:"0 0 10px 2px "+i.replace("rgb(","rgba(").replace(")",",.4)")}} aria-hidden="true" />
        <span className="hui-t-title" style=${{color:i,textShadow:"0 0 18px "+i.replace("rgb(","rgba(").replace(")",",.33)")}}>
          ${a.label}
        </span>
      <//>
      <div className=${t.mobile,"hui-t-sub"} style=${{textAlign:t.mobile?"center":"left"}}>${s}</div>
    </div>`}function Pt(t){var e=t.s;return e.toolChip?q`
    <${r.Row} align="center" gap="sm" style=${{marginTop:3,padding:"5px 11px",borderRadius:6,border:"1px solid var(--hui-line-strong)",background:"var(--hui-surface-2)",pointerEvents:"none"}}>
      <${r.Icon} name="settings" size=${12} className="hui-t-accent" />
      <span className="hui-t-mono">${e.toolChip.name}</span>
      <span style=${{width:1,height:11,background:"var(--hui-line-strong)"}} />
      <span className="hui-t-num hui-t-accent"><${r.RelTime} at=${e.toolChip.start} granularity=${1e3} /></span>
    <//>`:null}function br(t){var e=t.store,n=t.refs,a=ne(e),i=Oe(a),s=(le[i]||le.idle).mode.toUpperCase();return q`
    <div style=${{flex:"1.05 1 0%",minHeight:0,position:"relative",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <canvas ref=${n.canvasRef} aria-hidden="true" style=${{position:"absolute",inset:0,width:"100%",height:"100%",display:"block"}} />
      <div style=${{position:"absolute",left:0,right:0,bottom:14,display:"flex",flexDirection:"column",alignItems:"center",gap:7,pointerEvents:"none"}}>
        <${Dt} s=${a} />
        <${Pt} s=${a} />
      </div>
      <div style=${{position:"absolute",left:20,top:16,display:"flex",flexDirection:"column",gap:5,pointerEvents:"none"}}>
        <div className="hui-t-micro">INTELLIGENCE CORE</div>
        <div className="hui-t-micro">${(a.reducedMotion?"STATIC \xB7 ":"LATTICE \xB7 ")+s}</div>
      </div>
    </div>`}function kr(t){return t==="user"?"YOU":t==="jarvis"?"JARVIS":"SYSTEM"}function Lt(t){var e=t.turn;return q`
    <div style=${{display:"grid",gridTemplateColumns:"62px minmax(0,1fr)",gap:14,alignItems:"start"}}>
      <div style=${{display:"flex",flexDirection:"column",gap:3,paddingTop:2}}>
        <span className=${"hui-t-micro"+(e.role==="user"?" hui-t-accent":"")}>${kr(e.role)}</span>
        <span className="hui-t-mono hui-t-micro">${e.time}</span>
      </div>
      <div style=${{minWidth:0}}>
        ${e.role==="system"?q`<div className=${"hui-t-mono"+(e.tone==="red"?" hui-t-danger":" hui-t-micro")}>${e.text}</div>`:e.role==="jarvis"?q`<div className=${e.dim?"hui-t-faint":"hui-t-body"} style=${{fontSize:16,lineHeight:1.55}}><${r.Markdown}>${e.text}<//></div>`:q`<div className=${e.dim?"hui-t-faint":"hui-t-body"} style=${{fontSize:16,lineHeight:1.55}}>${e.text}</div>`}
        ${e.meta&&e.meta.length?q`<${r.Row} gap="sm" style=${{marginTop:6}}>${e.meta.map(function(n,a){return q`<${r.Tag} key=${"m"+a} size="sm">${n}<//>`})}<//>`:null}
      </div>
    </div>`}function wr(t){var e=t.store,n=t.refs,a=ne(e);r.useEffect(function(){var u=n.logRef.current;u&&(u.scrollTop=u.scrollHeight)},[a.turns.length,a.mediatorText,a.sttPartial]);var i=a.turns.slice(-14),s=i.length===0&&!a.sttPartial&&!a.mediatorText;return q`
    <div ref=${n.logRef} role="log" aria-label="Conversation"
      style=${{flex:1,minHeight:132,overflowY:"auto",padding:"4px 22px 12px",display:"flex",flexDirection:"column",gap:14,borderTop:"1px solid var(--hui-line)"}}>
      ${s?q`<${r.EmptyState} compact icon="message" title="No turns yet" hint="Say something, or type a message below." />`:null}
      <${r.AnimatedList} items=${i} getKey=${function(u){return u.id}}>
        ${function(u){return q`<${Lt} turn=${u} />`}}
      <//>
      ${a.sttPartial?q`
          <div style=${{display:"grid",gridTemplateColumns:"62px minmax(0,1fr)",gap:14,alignItems:"start"}} aria-live="polite">
            <span className="hui-t-micro hui-t-accent">YOU</span>
            <div className="hui-t-faint" style=${{fontSize:16,fontStyle:"italic"}}>${a.sttPartial}</div>
          </div>`:null}
      ${a.mediatorText?q`
          <div style=${{display:"grid",gridTemplateColumns:"62px minmax(0,1fr)",gap:14,alignItems:"start"}} aria-live="polite">
            <span className="hui-t-micro">JARVIS</span>
            <div className="hui-t-body" style=${{fontSize:16,lineHeight:1.55}}>
              <${r.StreamText} text=${a.mediatorText} streaming=${a.ttsPlaying} speed=${40} />
            </div>
          </div>`:null}
    </div>`}function ut(t){return q`
    <${r.IconButton}
      icon=${t.active?"minimize":"maximize"}
      label="Toggle fullscreen"
      variant=${t.active?"secondary":"ghost"}
      size=${t.mobile?"md":"sm"}
      title=${t.pseudo?"Pseudo-fullscreen (Fullscreen API unavailable on this browser)":"Toggle fullscreen"}
      onClick=${t.onClick} />`}function Ot(t){var e=t.s,n=t.act,a=t.refs,i=t.mobile,s=i?64:52;return q`
    <div style=${{position:"relative",flex:"none",width:s,height:s}}>
      <div ref=${i?a.micRingMobileRef:a.micRingRef} aria-hidden="true"
        style=${{position:"absolute",inset:-6,borderRadius:"999px",border:"1px solid var(--hui-accent)",opacity:0,transform:"scale(.9)",pointerEvents:"none"}} />
      <button type="button" onClick=${n.onMicClick} aria-label=${e.micActive?"Stop microphone":"Start microphone"} aria-pressed=${e.micActive}
        style=${{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:"999px",cursor:"pointer",border:"1px solid "+(e.micActive?"var(--hui-accent)":"var(--hui-line-strong)"),background:e.micActive?"radial-gradient(circle at 50% 35%, var(--hui-accent-ground-strong), var(--hui-surface))":"radial-gradient(circle at 50% 35%, var(--hui-surface-2), var(--hui-surface))",color:e.micActive?"var(--hui-text)":"var(--hui-text-dim)"}}>
        <${r.Icon} name="mic" size=${i?24:19} />
      </button>
    </div>`}function Bt(t){var e=t.store,n=t.s;return!n.micError&&!n.micHint?null:q`
    <${r.Banner} tone=${n.micError?"danger":"warn"} variant="inline" dismissible
      onDismiss=${function(){e.set({micError:null,micHint:null})}}>
      ${n.micError||n.micHint}
    <//>`}function Sr(t){var e=t.store,n=t.act,a=t.refs,i=ne(e),s=r.useState(""),u=s[0],d=s[1],m=i.fsmState==="speaking"&&i.connection==="open";function f(){var h=u.trim();h&&(n.submitText(h),d(""))}return q`
    <div style=${{flex:"none",padding:"12px 22px 16px",borderTop:"1px solid var(--hui-line)"}}>
      <${r.Row} align="end" gap="md" wrap=${!1}>
        <${Ot} s=${i} act=${n} refs=${a} />
        <div style=${{flex:1,minWidth:0,display:"flex",flexDirection:"column",gap:7}}>
          <${r.Row} align="end" gap="sm" wrap=${!1}>
            <div style=${{flex:1,minWidth:0}}>
              <${r.Textarea}
                value=${u}
                onChange=${d}
                minRows=${1}
                maxRows=${4}
                placeholder="Type to Jarvis, or hold Space to talk"
                onKeyDown=${function(h){h.key==="Enter"&&!h.shiftKey&&(h.preventDefault(),f())}} />
            </div>
            <${r.Button} variant="primary" onClick=${f}>Send<//>
            <${r.Button} variant="secondary" disabled=${!m} onClick=${n.interrupt}>Interrupt<//>
          <//>
          <${r.Row} align="center" gap="md" wrap=${!1}>
            <${r.Segmented}
              options=${[{value:"ptt",label:"Push to talk"},{value:"vad",label:"Hands-free"}]}
              value=${i.micMode}
              onChange=${n.setMicMode} />
            <div style=${{flex:1,height:3,borderRadius:2,background:"var(--hui-line)",overflow:"hidden"}}>
              <div ref=${a.levelRef} style=${{height:"100%",width:"0%",borderRadius:2,background:"var(--hui-accent)"}} />
            </div>
            ${i.w>1100?q`<span className="hui-t-mono hui-t-micro" style=${{whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:4}}>
                  SPACE hold · ESC interrupt · 1·2·3 panels · <${r.Kbd} combo="mod+k" /> focus
                </span>`:null}
          <//>
          <${Bt} store=${e} s=${i} />
          <${r.Presence} show=${!!i.noSpeechHint} variant="fade">
            <div className="hui-t-faint" style=${{fontStyle:"italic"}} role="status" aria-live="polite">${i.noSpeechHint}</div>
          <//>
        </div>
      <//>
    </div>`}function yn(t){return q`
    <div style=${{minHeight:0,display:"flex",flexDirection:"column",position:"relative",minWidth:0}}>
      <${yr} store=${t.store} />
      <${br} store=${t.store} refs=${t.refs} />
      <${wr} store=${t.store} refs=${t.refs} />
      <${Sr} store=${t.store} act=${t.act} refs=${t.refs} />
    </div>`}function we(t){if(t==null||t==="")return null;if(typeof t=="number")return t>1e12?t:t>1e9?t*1e3:null;var e=Date.parse(t);return isNaN(e)?null:e}var Tr={running:"accent",queued:"neutral",paused:"neutral",done:"ok",needs_review:"warn",failed:"danger",canceled:"neutral"};function dt(t){return{label:(t||"-").replace(/_/g," "),tone:Tr[t]||"neutral"}}function ft(t){return{label:(t||"").toUpperCase()||"-",tone:t==="codex"?"info":"neutral"}}function bn(t){var e=String(t||"").toLowerCase();return e.indexOf("error")>=0||e.indexOf("fail")>=0?"danger":e.indexOf("review")>=0||e.indexOf("cancel")>=0||e.indexOf("warn")>=0||e.indexOf("restart")>=0?"warn":e.indexOf("progress")>=0||e.indexOf("log")>=0?"neutral":"accent"}var Mr={done:1,failed:1,needs_review:1,canceled:1};function mt(t){return!!Mr[t]}var ct={running:0,queued:1,paused:2,needs_review:3,done:4,failed:5,canceled:6};function Cr(t){return Object.values(t||{}).sort(function(e,n){var a=ct[e.status]!=null?ct[e.status]:9,i=ct[n.status]!=null?ct[n.status]:9;return a!==i?a-i:(n.updated_ts||0)-(e.updated_ts||0)})}function vt(t){return Object.values(t||{}).filter(function(e){return e.status==="running"||e.status==="queued"||e.status==="paused"}).length}function kn(t,e){return Object.values(t||{}).filter(function(n){return wn(e,n.id)?!1:n.status==="running"||n.status==="queued"||n.status==="paused"||n.status==="needs_review"}).length}function wn(t,e){return!!(t&&Object.prototype.hasOwnProperty.call(t,e))}function Ke(t,e){return Cr(t).filter(function(n){return!wn(e,n.id)})}var Be=fe+"/tasks",Ae=fe+"/backends",Ge=fe+"/credits",Se=fe+"/brains";function Sn(t){return fe+"/tasks/"+encodeURIComponent(t)}function xr(t,e){return fe+"/memory/search?q="+encodeURIComponent(t)+"&k="+(e||8)}function Je(t){var e=Array.isArray(t)?t:t&&Array.isArray(t.tasks)?t.tasks:[],n={};return e.forEach(function(a){n[a.id]=a}),n}function pt(){var t=r.useEndpoint(Be);return Object.assign({},t,{tasks:Je(t.data)})}function Tn(t){var e=null;return r.mutate(Be,function(n){var a=Je(n);return a[t.id]=e=Object.assign({},a[t.id]||{},t,{updated_ts:Date.now()}),{tasks:Object.values(a)}}),e}function ht(){return r.useAction(function(t,e){return r.postJSON(Sn(t)+"/control",{action:e}).then(function(n){return n&&n.status&&r.mutate(Be,function(a){var i=Je(a);return i[t]&&(i[t]=Object.assign({},i[t],{status:n.status,updated_ts:Date.now()})),{tasks:Object.values(i)}}),n})},{onError:function(t){r.toast.error("Task action failed",{detail:r.errorMessage(t)})}})}function Mn(t){return r.useEndpoint(t?Sn(t):null)}function Fe(){return r.useEndpoint(Ae)}function Cn(){return r.useAction(function(t){var e=null;return r.mutate(Ae,function(n){return e=n&&n.active,Object.assign({},n,{active:t})}),r.postJSON(Ae,{backend:t}).then(function(n){return r.mutate(Ae,function(a){return Object.assign({},a,{active:n&&n.backend||t})}),n},function(n){throw r.mutate(Ae,function(a){return Object.assign({},a,{active:e})}),n})},{onError:function(t){r.toast.error("Couldn't set worker backend",{detail:r.errorMessage(t)})}})}function je(){return r.useEndpoint(Ge)}function xn(){return r.useAction(function(){return r.fetchJSON(Ge+"?refresh=true").then(function(t){return r.mutate(Ge,t),t})},{onError:function(t){r.toast.error("Couldn't refresh credits",{detail:r.errorMessage(t)})}})}function En(t,e){var n=(t||"").trim();return r.useEndpoint(n?xr(n,e||8):null)}function $t(){return r.useEndpoint(Se)}function _n(t){r.mutate(Se,function(e){return Object.assign({},e,{active:t.brain})})}function Rn(){return r.useAction(function(t){var e=null;return r.mutate(Se,function(n){return e=n&&n.active,Object.assign({},n,{active:t})}),r.postJSON(Se,{brain:t}).then(function(n){return r.mutate(Se,function(a){return Object.assign({},a,{active:n&&n.brain||t})}),n},function(n){throw r.mutate(Se,function(a){return Object.assign({},a,{active:e})}),n})},{onError:function(t){r.toast.error("Couldn't switch brain",{detail:r.errorMessage(t)})}})}var oe=r.html;function Er(t){if(t==null||t==="")return null;var e=we(t);return e==null?String(t):r.format.relTime(e)}function _r(t){var e=t.hit,n=!!e.conflict,a=typeof e.score=="number"?e.score:0,i=Er(e.updated);return oe`
    <${r.Card} variant="default" padding="sm" tone=${n?"warn":void 0}>
      <${r.Row} justify="between" align="start" gap="sm">
        <span className="hui-t-body hui-t-clamp2" style=${{fontWeight:600}}>${e.title||e.path}</span>
        <span className="hui-t-num hui-t-accent">${a.toFixed(2)}</span>
      <//>
      ${e.path?oe`<div className="hui-t-mono hui-t-faint hui-t-truncate">${e.path}</div>`:null}
      <${r.Meter} value=${a*100} max=${100} size="sm" tone=${n?"warn":"accent"} valueText="" />
      ${e.snippet?oe`<div className="hui-t-sub" style=${{marginTop:6}}>${e.snippet}</div>`:null}
      <${r.Row} justify="between" align="center" gap="sm" style=${{marginTop:6}}>
        <span className="hui-t-micro">
          ${i?"updated "+i:""}
          ${typeof e.confidence=="number"?" \xB7 conf "+e.confidence.toFixed(2):""}
        </span>
        ${n?oe`<${r.Badge} tone="warn" icon="alert-triangle" size="sm">CONFLICT<//>`:null}
      <//>
    <//>`}function gt(t){var e=t.store,n=ne(e),a=r.useState(n.memQuery||""),i=a[0],s=a[1],u=En(i),d=!!i.trim(),m=d?u.data&&u.data.hits||[]:n.memoryHits||[];return oe`
    <${r.Stack} gap="sm" style=${t.fill?{flex:1,minHeight:0}:void 0}>
      <${r.SearchInput}
        value=${n.memQuery||""}
        onChange=${function(f){e.set({memQuery:f})}}
        onSearch=${s}
        debounceMs=${250}
        loading=${d&&u.loading}
        placeholder="Search vault"
        aria-label="Search Obsidian memory" />
      <div className="hui-t-micro">${d?"SEARCH RESULTS":"RECALLED FOR THIS TURN"}</div>
      ${m.length===0?d?u.loading?oe`<div className="hui-t-sub">Searching</div>`:u.error?oe`<${r.ErrorState} compact title="Search failed" error=${u.error} onRetry=${u.reload} />`:oe`<div className="hui-t-sub">No matches in the vault.</div>`:oe`<${r.EmptyState} compact icon="brain" title="No recall this turn"
              hint="Memory is queried only when the mediator calls memory_recall." />`:oe`<${r.AnimatedList} items=${m} getKey=${function(f,h){return(f.path||"hit")+":"+h}}>
            ${function(f){return oe`<${_r} hit=${f} />`}}
          <//>`}
    <//>`}function An(t){var e=ne(t.store),n=(e.memoryHits||[]).length;return oe`
    <${r.Stack} gap="md" style=${{minHeight:0,padding:"16px"}}>
      <${r.Row} justify="between" align="center">
        <span className="hui-t-micro">MEMORY</span>
        <span className="hui-t-num hui-t-accent">${n?n+" HITS":"IDLE"}</span>
      <//>
      <${gt} store=${t.store} fill />
      <${r.Divider} />
      <${r.Row} justify="between">
        <span className="hui-t-micro">Obsidian vault · FTS5 + nomic-embed</span>
        <span className="hui-t-micro">read-only</span>
      <//>
    <//>`}function Nn(t){return oe`<${gt} store=${t.store} fill />`}var he=r.html,Rr={error:"danger",attention:"warn",info:"info"};function Ar(t,e){return!!(t&&Object.prototype.hasOwnProperty.call(t,e))}function yt(t){return(t.notices||[]).filter(function(e){return!Ar(t.dismissedNotices,e.id)})}function qe(t){var e=yt(t),n=!1,a=!1;return e.forEach(function(i){i.tone==="error"?n=!0:i.tone==="attention"&&(a=!0)}),{count:e.length,tone:n?"danger":a?"warn":null}}function bt(t){return t.tone?he`<${r.StatusDot} tone=${t.tone} pulse />`:null}function Nr(t){var e=[],n={};return t.forEach(function(a){var i=(a.tone||"info")+"|"+(a.approve?"1":"0")+"|"+(a.title||""),s=n[i];s||(s={key:i,tone:a.tone,title:a.title,approve:!!a.approve,items:[]},n[i]=s,e.push(s)),s.items.push(a)}),e}function Ir(t){var e=t.group,n=t.act,a=t.mobile,i=ht(),s=e.items.length===1,u=e.items[0];function d(w){w.taskId?i.run(w.taskId,"resume").then(function(){n.resolveNotice(w.id,!0)},function(){}):n.resolveNotice(w.id,!0)}function m(w){n.resolveNotice(w.id,!1)}function f(w){w.approve?m(w):n.dismissNotice(w.id)}var h=null;if(s&&u.approve)h=he`
      <${r.Row} gap="sm">
        <${r.Button} size="sm" variant="primary" loading=${i.pending} onClick=${function(){d(u)}}>Approve<//>
        <${r.Button} size="sm" variant="danger" onClick=${function(){m(u)}}>Decline<//>
      <//>`;else if(!s){var E=[];e.approve&&E.push(he`<${r.Button} key="aa" size="sm" variant="primary" loading=${i.pending}
        onClick=${function(){e.items.forEach(d)}}>Approve all<//>`),E.push(he`<${r.Button} key="da" size="sm" variant="secondary"
      onClick=${function(){e.items.forEach(f)}}>Dismiss all<//>`),h=he`<${r.Row} gap="sm">${E}<//>`}return he`
    <${r.NotificationCard}
      severity=${Rr[e.tone]||"info"}
      title=${e.title}
      body=${s?u.body:void 0}
      time=${s&&!a?u.ts:void 0}
      count=${e.items.length}
      items=${s?void 0:e.items.map(function(w){var _=w.approve?he`
              <${r.Row} gap="xs">
                <${r.Button} size="sm" variant="primary" loading=${i.pending} onClick=${function(){d(w)}}>Approve<//>
                <${r.Button} size="sm" variant="danger" onClick=${function(){m(w)}}>Decline<//>
              <//>`:void 0;return{id:w.id,label:w.body||w.title,actions:_}})}
      actions=${h}
      onDismiss=${function(){e.items.forEach(f)}}
    />`}function kt(t){var e=t.s,n=t.act,a=t.mobile,i=yt(e);if(!i.length)return null;var s=Nr(i);return he`
    <${r.Stack} gap="sm">
      ${s.map(function(u){return he`<${Ir} key=${u.key} group=${u} act=${n} mobile=${a} />`})}
    <//>`}var j=r.html;function Dr(t){var e=t.payload,n="";if(e!=null)if(typeof e=="string")n=e;else if(e.message)n=e.message;else if(e.note)n=e.note;else try{n=JSON.stringify(e)}catch{n=""}var a=t.type||t.kind||"event";return n?a+" \xB7 "+n:a}function Pr(t){var e=t&&(t.task||t)||{};return{events:t&&(t.events||t.task_events)||e.events||[],result_text:e.result_text||"",result_summary:e.result_summary||"",session_id:e.session_id||e.session||""}}function Lr(t){var e=t.detail;return j`
    <${r.DataState} state=${e} emptyText="No task detail" compact>
      ${function(n){var a=Pr(n),i=a.events||[],s=a.result_text||a.result_summary||"";return j`
          <${r.Stack} gap="sm">
            <div className="hui-t-micro">EVENT TIMELINE</div>
            ${i.length===0?j`<div className="hui-t-sub">No events recorded for this task.</div>`:j`<${r.ActivityFeed} items=${i.map(function(u,d){return{id:d,at:we(u.ts)||Date.now(),title:Dr(u),tone:bn(u.type)}})} />`}
            ${s?j`<${r.Stack} gap="sm"><div className="hui-t-micro">RESULT</div><${r.CodeBlock} maxHeight=${160}>${s}<//><//>`:null}
            <${r.KeyValue} label="Session" value=${a.session_id||"-"} mono copyable=${!!a.session_id} />
          <//>`}}
    <//>`}function In(t){var e=t.task,n=t.act,a=t.mobile,i=dt(e.status),s=ft(e.kind),u=e.status==="running",d=e.progress_note||e.result_summary||"",m=ht(),f=r.useState(!1),h=Mn(!a&&f[0]?e.id:null),E=null;if(e.status==="done"){var w=we(e.started),_=we(e.finished);w&&_&&_>w&&(E="took "+r.format.duration(_-w))}else{var g=we(e.started)||we(e.created)||e.updated_ts;g&&(E=j`<${r.RelTime} at=${g} />`)}var F=[];return e.status==="running"&&F.push({label:"Pause",variant:"secondary",run:"pause"}),e.status==="paused"&&F.push({label:"Resume",variant:"primary",run:"resume"}),(e.status==="running"||e.status==="paused"||e.status==="queued")&&F.push({label:"Cancel",variant:"danger",run:"cancel"}),e.status==="needs_review"&&F.push({label:"Re-delegate",variant:"primary",run:"resume"}),mt(e.status)&&F.push({label:"Dismiss",variant:"secondary",run:"dismiss"}),j`
    <${r.Card} padding="sm" tone=${e.status==="needs_review"?"warn":void 0}>
      <${r.Row} justify="between" align="center" gap="sm">
        <${r.Badge} tone=${i.tone}>${i.label}<//>
        <${r.Row} gap="sm" align="center">
          <${r.Badge} tone=${s.tone} variant="outline" size="sm">${s.label}<//>
          ${E?j`<span className="hui-t-num hui-t-micro">${E}</span>`:null}
        <//>
      <//>
      <div className="hui-t-body" style=${{marginTop:8,fontWeight:600}}>${e.title||e.goal||e.id}</div>
      ${u?j`<${r.Meter} indeterminate size="sm" style=${{marginTop:8}} />`:null}
      ${d?j`<div className="hui-t-sub" style=${{marginTop:8}}>${d}</div>`:null}
      <${r.Row} gap="sm" style=${{marginTop:10}}>
        ${F.map(function(b){var H=m.pending&&b.run!=="dismiss";return j`
            <${r.Button} key=${b.label} size=${a?"md":"sm"} variant=${b.variant} loading=${b.run!=="dismiss"&&H}
              onClick=${function(){b.run==="dismiss"?n.dismissTask(e.id):m.run(e.id,b.run)}}>${b.label}<//>`})}
      <//>
      ${a?null:j`
          <${r.Disclosure} title="Detail" open=${f[0]} onOpenChange=${f[1]} className="jv-task-detail">
            ${f[0]?j`<${Lr} detail=${h} />`:null}
          <//>`}
    <//>`}function Dn(t){return j`<${In} task=${t.task} act=${t.act} mobile />`}function Ft(t){var e=t.items.slice().reverse();return j`
    <${r.ActivityFeed} items=${e.map(function(n){return{id:n.id,at:n.ts,title:n.label,tone:n.tone,body:t.verbose?n.detail:void 0}})} />`}function Or(t){var e=t.store,n=t.s;return j`
    <${r.Stack} gap="sm">
      <${r.Row} justify="between" align="center">
        <${r.Button} size="sm" variant=${n.verbose?"primary":"secondary"} aria-pressed=${n.verbose}
          onClick=${function(){e.set({verbose:!n.verbose})}}>
          ${n.verbose?"Trace detail: on":"Trace detail: off"}
        <//>
        <span className="hui-t-num hui-t-micro">${r.format.plural(n.timeline.length,"event")}</span>
      <//>
      ${n.timeline.length===0?j`<${r.EmptyState} compact icon="activity" title="Nothing yet this session" />`:j`<${Ft} items=${n.timeline} verbose=${n.verbose} />`}
    <//>`}var Br=[["stt","stt final"],["mediator_first_token","mediator first token"],["tts_first_chunk","tts first chunk"],["e2e_first_audio","end-to-end first audio"]];function Fr(t){if(!t||t.path==="pending")return null;var e=t.path==="loopback"?"Loopback RTCPeerConnection: full AEC reference":t.path==="stream-element"?"Direct <audio> element: AEC reference, no jitter tuning":"Direct to speakers: no echo-cancellation reference",n=t.path==="loopback"||t.path==="stream-element";return{id:"echo-cancellation",leading:j`<${r.StatusDot} tone=${n?"accent":"danger"} />`,title:"Echo cancellation",description:e+(t.error?" \xB7 "+t.error:""),trailing:j`<${r.Badge} tone=${n?"ok":"danger"} size="sm">${(t.path||"?").toUpperCase()}<//>`}}function jr(t){var e=t.s,n=t.act,a=e.health||{},i=a.components||{},s=Object.keys(i),u=a.models||{},d=a.ram||{},m=typeof d.free_gb=="number"?d.free_gb:null,f=typeof d.total_gb=="number"?d.total_gb:null,h=Fr(e.audioDiag),E=s.map(function(w){var _=i[w]||{};return{id:w,leading:j`<${r.StatusDot} tone=${_.ok?"accent":"danger"} />`,title:w,description:_.detail||"",trailing:j`<${r.Badge} tone=${_.ok?"ok":"danger"} size="sm">${_.ok?"OK":"ERR"}<//>`}}).concat(h?[h]:[]);return j`
    <${r.Stack} gap="sm">
      <${r.Card} title="Component health" padding="sm">
        ${E.length===0?j`<${r.EmptyState} compact title="Waiting for /health" />`:j`<${r.List} dense items=${E} />`}
      <//>
      <${r.Card} title="Latency · last 20 turns" padding="sm">
        <${r.Stack} gap="md">
          ${Br.map(function(w){var _=w[0],g=e.latency[_],F=n.getSeries(_);return j`
              <div key=${_}>
                <${r.Row} justify="between" align="baseline">
                  <span className="hui-t-sub" style=${{flex:1}}>${w[1]}</span>
                  <span className="hui-t-num">${g&&g.p50!=null?g.p50+" ms":"-"}</span>
                  <span className="hui-t-num hui-t-faint">${g&&g.p95!=null?g.p95+" ms":"-"}</span>
                <//>
                <${r.Sparkline} data=${F} height=${18} tone=${_==="e2e_first_audio"?"accent":!1} />
              </div>`})}
        <//>
      <//>
      <${r.Card} title="Residency & memory" padding="sm">
        <${r.Stack} gap="sm">
          <${r.KVList} items=${["mediator","worker"].map(function(w){var _=u[w]||{};return{label:w,value:(_.name||w+" -")+(_.resident?" \xB7 resident":" \xB7 on demand")}})} />
          <${r.Meter}
            label="Unified memory"
            value=${m!=null&&f?f-m:0}
            max=${f||1}
            indeterminate=${m==null||!f}
            valueText=${m==null?"-":m.toFixed(1)+" GB free"+(f?" / "+f+" GB":"")} />
        <//>
      <//>
      <${r.KpiRow} size="sm" items=${[{label:"Barge-ins",value:e.bargeIns,sub:"this session"},{label:"Errors",value:e.errCount,sub:"recoverable"}]} />
    <//>`}function Pn(t){var e=t.store,n=t.act,a=ne(e),i=pt(),s=t.showLeft,u=qe(a),d=[{id:"work",label:j`<${r.Row} gap="sm" align="center"><${bt} tone=${u.tone} /><span>Work</span><//>`,badge:vt(i.tasks)||void 0},{id:"activity",label:"Activity",badge:a.timeline.length||void 0}];s||d.push({id:"memory",label:"Memory",badge:(a.memoryHits||[]).length||void 0}),d.push({id:"system",label:"System"});var m=s&&a.tab==="memory"?"work":a.tab,f=Ke(i.tasks,a.dismissedTasks);return j`
    <div style=${{minHeight:0,display:"flex",flexDirection:"column",borderLeft:"1px solid var(--hui-line)"}}>
      <${r.Tabs} className="jv-work-tabs" items=${d} value=${m} onChange=${function(h){e.set({tab:h})}}
        ariaLabel="Work panels" idPrefix="jv-work" />
      <${r.ScrollArea} style=${{flex:1,minHeight:0,padding:"10px 14px 14px"}}>
        <${r.TabPanel} when="work" value=${m} idPrefix="jv-work">
          <${r.ErrorBoundary}>
            <${r.Stack} gap="sm">
              <${Ur} s=${a} act=${n} tasks=${f} />
              <${kt} s=${a} act=${n} />
              <${r.DataState} state=${i} empty=${function(){return f.length===0&&!u.count}}
                emptyText="No tasks yet. Delegate something.">
                ${function(){return j`<${r.AnimatedList} items=${f} getKey=${function(h){return h.id}}>
                  ${function(h){return j`<${In} task=${h} act=${n} />`}}
                <//>`}}
              <//>
            <//>
          <//>
        <//>
        <${r.TabPanel} when="activity" value=${m} idPrefix="jv-work">
          <${r.ErrorBoundary}><${Or} store=${e} s=${a} /><//>
        <//>
        ${s?null:j`<${r.TabPanel} when="memory" value=${m} idPrefix="jv-work"><${r.ErrorBoundary}><${gt} store=${e} fill /><//><//>`}
        <${r.TabPanel} when="system" value=${m} idPrefix="jv-work">
          <${r.ErrorBoundary}><${jr} s=${a} act=${n} /><//>
        <//>
      <//>
    </div>`}var Hr={done:1,failed:1,error:1,cancelled:1,canceled:1,completed:1};function Ur(t){var e=t.s,n=t.act,a=yt(e),i=(t.tasks||[]).filter(function(f){return Hr[f.status]});if(!a.length&&!i.length)return null;function s(f,h,E){var w=n.clearWork(f,h);r.toast.success("Cleared "+E,{action:{label:"Undo",onClick:w},duration:6e3})}var u=a.map(function(f){return f.id}),d=i.map(function(f){return f.id}),m=[];return i.length&&m.push({id:"fin",icon:"check",label:"Clear finished tasks ("+i.length+")",onSelect:function(){s([],d,r.format.plural(i.length,"finished task"))}}),a.length&&m.push({id:"not",icon:"bell",label:"Clear notifications ("+a.length+")",onSelect:function(){s(u,[],r.format.plural(a.length,"notification"))}}),a.length&&i.length&&(m.push({separator:!0}),m.push({id:"all",icon:"trash",danger:!0,label:"Clear all",onSelect:function(){s(u,d,"everything")}})),j`
    <${r.Row} gap="sm" align="center" justify="between" wrap=${!1}>
      <span className="hui-t-micro">
        ${[a.length?r.format.plural(a.length,"notification"):null,i.length?i.length+" finished":null].filter(Boolean).join(" \xB7 ")}
      </span>
      <${r.Row} gap="xs" align="center" wrap=${!1}>
        ${i.length?j`<${r.Button} size="sm" variant="secondary" icon="check"
          title="Hide every done, failed or cancelled task"
          onClick=${function(){s([],d,r.format.plural(i.length,"finished task"))}}>Clear finished (${i.length})<//>`:null}
        <${r.Menu} placement="bottom" align="end" items=${m}
          trigger=${j`<${r.IconButton} size="sm" variant="ghost" icon="more-horizontal" label="More clear options" />`} />
      <//>
    <//>`}var Q=r.html,Ve={local:{name:"Local",caption:"\u224830-60 s \xB7 offline fallback \xB7 no spend",sub:"gpt-oss-20b \xB7 free \xB7 on-box",tier:"free"},cloud:{name:"codecloud",caption:"\u22485-30 s \xB7 full Hermes agent \xB7 OpenCode Go + Jev",sub:"codecloud \xB7 subscription",tier:"sub"},codex:{name:"Codex",caption:"\u22484-20 s \xB7 coding agent \xB7 sub credits",sub:"codex \xB7 weekly credits",tier:"sub"},claude:{name:"Claude Code",caption:"\u22484-20 s \xB7 coding agent \xB7 weekly + session",sub:"claude \xB7 weekly + session",tier:"sub"}},zr=["local","cloud","codex","claude"],Wr="Applies to delegated tasks. Speech recognition and the voice always stay on this Mac; the brain is picked separately.";function Ye(t){return Ve[t]||{name:t,caption:"",sub:"",tier:"sub"}}function jt(t,e){return t&&t.labels&&t.labels[e]||Ye(e).name}function Ln(t){var e=Ye(t).name,n=e.indexOf(" ");return n===-1?e:e.slice(0,n)}function Kr(t,e){var n=t&&Array.isArray(t.backends)?t.backends:zr;return n.filter(function(a){return Ve[a]||e&&e.backends&&e.backends[a]})}function Ht(t,e){return t&&t.backends&&t.backends[e]||null}function Gr(t,e){return e?"refreshing":t.loading?"loading":t.error&&!t.data?"error":t.stale||t.data&&t.data.stale?"stale":"ok"}function Jr(t,e){if(e==="refreshing")return"checking";if(e==="loading")return"";if(e==="error")return"check failed";var n=t.data&&t.data.checked_epoch;return n?"checked "+r.format.relTime(n*1e3):e==="stale"?"stale":""}function qr(t){return Q`<${r.Badge} tone=${t==="free"?"ok":"warn"} size="sm">${(t||"sub").toUpperCase()}<//>`}function Vr(t){var e=t.note||"",n=e.split("\xB7")[0].trim()||(t.tier==="free"?"no spend":(t.tier||"").toUpperCase());return Q`<span className=${"hui-t-mono hui-t-micro"+(t.tier==="free"?" hui-t-ok":" hui-t-dim")} style=${{whiteSpace:"nowrap"}}>${n}</span>`}function Yr(t){var e=t.gauge,n=typeof e.remaining_pct=="number"?e.remaining_pct*100:0,a=typeof e.remaining_pct!="number"?"neutral":n<15?"danger":n<35?"warn":"accent";return Q`
    <div style=${{width:t.mobile?100:116}}>
      <${r.Meter} size="sm" value=${n} max=${100} tone=${a}
        label=${e.label||null} valueText=${e.value_label||null} indeterminate=${t.loading} />
    </div>`}function Xr(t){var e=t.id,n=t.backends,a=t.credits,i=t.phase,s=t.selectBackend,u=t.mobile,d=t.act,m=Ye(e),f=Ht(a,e),h=n.active===e||!n.active&&e==="local",E=!n.available||n.available[e]!==!1,w=f&&f.tier||m.tier,_=f&&f.note,g=f&&f.gauges||[],F=!!f&&f.available===!1,b;if(F)b=Q`<span className="hui-t-micro hui-t-dim" style=${{whiteSpace:"nowrap"}}>unavailable</span>`;else if(g.length){var H=g.map(function(B,z){return Q`<${Yr} key=${B.label||"g"+z} gauge=${B} mobile=${u} loading=${i==="loading"||i==="refreshing"} />`});b=H.length>1?Q`<${r.Stack} gap="2">${H}<//>`:H[0]}else!f&&(i==="loading"||i==="refreshing")?b=Q`<${r.Spinner} size=${12} />`:b=Q`<${Vr} note=${_} tier=${w} mobile=${u} />`;var W=jt(n,e),R=m.caption.split("\xB7")[0].trim(),A=W+(m.caption?": "+m.caption:"")+(_?" \xB7 "+_:""),U=Q`
    <${r.Row} gap="xs" align="center" wrap=${!1}>
      <span style=${{fontWeight:600}} title=${A}>${W}<//>
      ${qr(w)}
    <//>`;return Q`
    <${r.ListItem}
      dense
      leading=${Q`<${r.StatusDot} tone=${h?"accent":E?"neutral":"danger"} />`}
      title=${U}
      description=${R}
      trailing=${b}
      selected=${h}
      style=${{opacity:E?1:.6,cursor:E?"pointer":"not-allowed",minHeight:u?44:void 0}}
      onClick=${E?function(){s.run(e),d.log("backend","Worker backend set to "+W+(m.sub?" \xB7 "+m.sub:""),null,e==="local"?"info":"warn"),t.onPicked&&t.onPicked()}:void 0} />`}function Qr(t){return Q`
    <${r.Button} size=${t.mobile?"md":"sm"} variant="secondary" icon="refresh" loading=${t.refreshing} onClick=${t.onClick}>
      Refresh
    <//>`}function On(t){var e=t.mobile,n=t.act,a=Fe(),i=je(),s=Cn(),u=xn(),d=a.data||{},m=i.data||{},f=Gr(i,u.pending);return Q`
    <${r.Stack} gap="sm">
      <${r.Row} justify="between" align="center">
        <span className="hui-t-micro">${e?"":"WORKER BACKEND"}</span>
        <${r.Row} gap="sm" align="center">
          <span className="hui-t-micro">${Jr(i,f)}</span>
          <${Qr} mobile=${e} refreshing=${f==="refreshing"}
            onClick=${function(){u.run(),n.log("credits","Checked subscription credits","manual refresh \xB7 not polled","info")}} />
        <//>
      <//>
      ${Kr(d,m).map(function(h){return Q`<${Xr} key=${h} id=${h} backends=${d} credits=${m} phase=${f}
          selectBackend=${s} act=${n} mobile=${e} onPicked=${t.onPicked} />`})}
      <div className="hui-t-micro" style=${{lineHeight:1.5}}>${Wr}</div>
    <//>`}function Bn(t){var e=t.act,n=Fe(),a=je(),i=n.data||{},s=a.data||{},u=i.active||"local",d=Ye(u),m=Ht(s,u),f=m&&m.tier||d.tier,h=!i.available||i.available[u]!==!1,E=jt(i,u),w="Worker backend: "+E+(d.sub?" \xB7 "+d.sub:"");return Q`
    <${r.Popover} placement="bottom" align="end" panelClassName="jv-backend-pop"
      trigger=${Q`
        <button type="button" className="hui-btn hui-btn--secondary hui-btn--sm" aria-label=${w} title=${w}>
          <${r.StatusDot} tone=${h?"accent":"danger"} />
          <span className="hui-btn__lead"><${r.Icon} name="cpu" size=${13} /></span>
          <span className="hui-btn__label">${Ln(u)}</span>
        </button>`}>
      ${function(_){return Q`<div style=${{width:260}}><${On} act=${e} onPicked=${_.close} /></div>`}}
    <//>`}function Fn(t){var e=Fe(),n=je(),a=e.data||{},i=a.active||"local",s=Ye(i),u=Ht(n.data,i),d=u&&u.tier||s.tier,m=jt(a,i),f="Worker backend: "+m+(s.sub?" \xB7 "+s.sub:"")+" \xB7 "+(d||"").toUpperCase();return Q`
    <button type="button" onClick=${t.onClick} aria-label=${f} title=${f}
      className="hui-btn hui-btn--secondary hui-btn--sm"
      style=${t.attention?{borderColor:"var(--hui-warn)"}:void 0}>
      <${r.StatusDot} tone="accent" />
      <span className="hui-btn__lead"><${r.Icon} name="cpu" size=${13} /></span>
      <span className="hui-btn__label">${Ln(i)}</span>
    </button>`}function jn(t){return Q`<${On} act=${t.act} mobile />`}var de=r.html,Zr={fast:"Fast \xB7 local",smart:"Smart \xB7 cloud",local:"Fast \xB7 local",cloud:"Smart \xB7 cloud"},Hn={fast:"Local",smart:"Cloud",local:"Local",cloud:"Cloud"};function Xe(t){return t&&t.label||t&&Zr[t.id]||t&&t.id||"?"}function Un(t){var e=((t&&t.label||"")+" "+(t&&t.detail||"")).toLowerCase();if(/\blocal\b|on-box|on box/.test(e))return"Local";if(/\bcloud\b|opencode/.test(e))return"Cloud";if(t&&Hn[t.id])return Hn[t.id];var n=Xe(t);return n.split(/[·\s]+/)[0]||n}function zn(t){var e=t.act,n=$t(),a=Rn(),i=n.data||{},s=Array.isArray(i.brains)?i.brains:[];return de`
    <${r.Stack} gap="sm">
      <span className="hui-t-micro">${t.mobile?"":"BRAIN"}</span>
      <${r.DataState} state=${n} emptyText="jarvisd didn't report any brains.">
        ${function(){return s.length?de`<${r.Stack} gap="xs">
            ${s.map(function(u){var d=i.active===u.id,m=u.available!==!1,f=Xe(u);return de`
                <${r.ListItem} key=${u.id}
                  dense
                  leading=${de`<${r.StatusDot} tone=${d?"accent":m?"neutral":"danger"} />`}
                  title=${de`<span title=${f+(u.detail?": "+u.detail:"")}>${f}<//>`}
                  description=${u.detail||""}
                  selected=${d}
                  style=${{opacity:m?1:.6,cursor:m?"pointer":"not-allowed",minHeight:t.mobile?44:void 0}}
                  onClick=${m?function(){a.run(u.id),e&&e.log("brain","Brain set to "+Xe(u),u.detail||null,"info"),t.onPicked&&t.onPicked()}:void 0} />`})}
          <//>`:de`<${r.EmptyState} compact title="No brains reported" />`}}
      <//>
    <//>`}function Wn(t){var e=t.act,n=$t(),a=n.data||{},i=Array.isArray(a.brains)?a.brains:[],s=i.filter(function(d){return d.id===a.active})[0],u=s?"Brain: "+Xe(s)+(s.detail?": "+s.detail:""):"Brain: "+(a.active||"?");return de`
    <${r.Popover} placement="bottom" align="end" panelClassName="jv-brain-pop"
      trigger=${de`
        <button type="button" className="hui-btn hui-btn--secondary hui-btn--sm" aria-label=${u} title=${u}>
          <${r.StatusDot} tone="accent" />
          <span className="hui-btn__lead"><${r.Icon} name="brain" size=${13} /></span>
          <span className="hui-btn__label">${s?Un(s):"Brain"}</span>
        </button>`}>
      ${function(d){return de`<div style=${{width:240}}><${zn} act=${e} onPicked=${d.close} /></div>`}}
    <//>`}function Kn(t){var e=$t(),n=e.data||{},a=Array.isArray(n.brains)?n.brains:[],i=a.filter(function(u){return u.id===n.active})[0],s=i?"Brain: "+Xe(i)+(i.detail?": "+i.detail:""):"Brain: "+(n.active||"?");return de`
    <button type="button" onClick=${t.onClick} aria-label=${s} title=${s} className="hui-btn hui-btn--secondary hui-btn--sm">
      <${r.StatusDot} tone="accent" />
      <span className="hui-btn__lead"><${r.Icon} name="brain" size=${13} /></span>
      <span className="hui-btn__label">${i?Un(i):"Brain"}</span>
    </button>`}function Gn(t){return de`<${zn} act=${t.act} mobile />`}var Z=r.html;function ea(t){var e=t.s,n=Ke(t.tasks,e.dismissedTasks),a=n.filter(function(u){return u.status==="running"})[0]||n.filter(function(u){return u.status==="needs_review"})[0];if(!a)return null;var i=dt(a.status),s=ft(a.kind);return Z`
    <${r.Card} padding="sm" style=${{margin:"2px 12px 0"}}>
      <${r.Row} justify="between" align="center">
        <${r.Badge} tone=${i.tone}>${i.label}<//>
        <${r.Badge} tone=${s.tone} variant="outline" size="sm">${s.label}<//>
      <//>
      <div className="hui-t-body" style=${{marginTop:6,fontWeight:600}}>${a.title||a.goal||a.id}</div>
      ${a.progress_note||a.result_summary?Z`<div className="hui-t-sub" style=${{marginTop:5}}>${a.progress_note||a.result_summary}<//>`:null}
    <//>`}function ta(t){var e=t.s,n=t.refs;r.useEffect(function(){var s=n.logRef.current;s&&(s.scrollTop=s.scrollHeight)},[e.turns.length,e.mediatorText,e.sttPartial]);var a=e.turns.slice(-10),i=a.length===0&&!e.sttPartial&&!e.mediatorText;return Z`
    <div ref=${n.logRef} role="log" aria-label="Conversation"
      style=${{flex:1,minHeight:0,overflowY:"auto",padding:"12px 16px 8px",display:"flex",flexDirection:"column",gap:12}}>
      ${i?Z`<${r.EmptyState} compact icon="message" title="No turns yet" hint="Say something, or type below." />`:null}
      ${a.map(function(s){return Z`<${Lt} key=${s.id} turn=${s} />`})}
      ${e.sttPartial?Z`
          <div aria-live="polite">
            <span className="hui-t-micro hui-t-accent">YOU</span>
            <div className="hui-t-faint" style=${{marginTop:4,fontSize:15,fontStyle:"italic"}}>${e.sttPartial}</div>
          </div>`:null}
      ${e.mediatorText?Z`
          <div aria-live="polite">
            <span className="hui-t-micro">JARVIS</span>
            <div className="hui-t-body" style=${{marginTop:4,fontSize:15}}><${r.StreamText} text=${e.mediatorText} streaming=${e.ttsPlaying} /></div>
          </div>`:null}
    </div>`}function na(t){var e=t.s,n=t.act,a=t.store,i=Ke(t.tasks,e.dismissedTasks);return e.sheet==="tasks"?Z`
      <${r.Stack} gap="sm">
        <${kt} s=${e} act=${n} mobile />
        ${i.length===0&&!qe(e).count?Z`<${r.EmptyState} compact title="No tasks yet" />`:i.map(function(s){return Z`<${Dn} key=${s.id} task=${s} act=${n} />`})}
      <//>`:e.sheet==="backend"?Z`<${jn} act=${n} />`:e.sheet==="brain"?Z`<${Gn} act=${n} />`:e.sheet==="memory"?Z`<${Nn} store=${a} />`:e.sheet==="activity"?e.timeline.length===0?Z`<${r.EmptyState} compact title="Nothing yet this session" />`:Z`<${Ft} items=${e.timeline} verbose=${!1} />`:null}var ra={tasks:"Tasks & notifications",memory:"Memory",backend:"Worker backend",brain:"Brain",activity:"Activity"};function Jn(t){var e=t.store,n=t.act,a=t.refs,i=ne(e),s=pt(),u=r.useState(""),d=u[0],m=u[1],f=i.fsmState==="speaking"&&i.connection==="open",h=qe(i);function E(){var g=d.trim();g&&(n.submitText(g),m(""))}function w(){e.set({sheet:null})}var _=[{id:"tasks",label:"Tasks",count:kn(s.tasks,i.dismissedTasks),tone:h.tone},{id:"memory",label:"Memory",count:(i.memoryHits||[]).length},{id:"activity",label:"Activity",count:i.timeline.length}];return Z`
    <div style=${{position:"absolute",inset:0,display:"flex",flexDirection:"column",paddingTop:"var(--jv-fs-top-clear, 0px)"}}>
      <${r.Row} align="center" gap="sm" style=${{padding:"14px 16px 10px",flex:"none"}}>
        <span className="hui-dot hui-dot--accent" aria-hidden="true" />
        <span className="hui-t-title">JARVIS</span>
        <div style=${{flex:1}} />
        <${Kn} act=${n} onClick=${function(){e.set({sheet:"brain"})}} />
        <${Fn} act=${n} attention=${!!h.tone} onClick=${function(){e.set({sheet:"backend"})}} />
        <${ut} active=${i.fullscreen||i.pseudoFullscreen} pseudo=${i.pseudoFullscreen} onClick=${n.toggleFullscreen} mobile />
        <${r.StatusDot} tone=${i.connection==="open"?"accent":i.connection==="closed"?"danger":"warn"} pulse=${i.connection!=="open"} label=${"Connection: "+i.connection} />
      <//>
      <div style=${{flex:"0 1 214px",minHeight:118,position:"relative"}}>
        <canvas ref=${a.canvasRef} aria-hidden="true" style=${{position:"absolute",inset:0,width:"100%",height:"100%",display:"block"}} />
      </div>
      <div style=${{flex:"none",display:"flex",flexDirection:"column",alignItems:"center",gap:4,padding:"2px 16px 8px",pointerEvents:"none"}}>
        <${Dt} s=${i} mobile />
        <${Pt} s=${i} />
      <//>
      <${ea} s=${i} tasks=${s.tasks} />
      <${ta} s=${i} refs=${a} />
      <div style=${{flex:"none",padding:"8px 12px calc(12px + env(safe-area-inset-bottom))",borderTop:"1px solid var(--hui-line)"}}>
        <${r.Row} gap="sm" wrap=${!1}>
          ${_.map(function(g){return Z`
              <${r.Button} key=${g.id} variant="secondary" size="md" block onClick=${function(){e.set({sheet:g.id})}}>
                ${g.tone?Z`<${bt} tone=${g.tone} />`:null} ${g.label}${g.count?" "+g.count:""}
              <//>`})}
        <//>
        <${r.Row} align="end" gap="sm" style=${{marginTop:10}} wrap=${!1}>
          <div style=${{flex:1,minWidth:0}}>
            <${r.Textarea} value=${d} onChange=${m} minRows=${1} maxRows=${3} placeholder="Message Jarvis"
              onKeyDown=${function(g){g.key==="Enter"&&!g.shiftKey&&(g.preventDefault(),E())}} />
          </div>
          <${r.Button} variant="secondary" disabled=${!f} onClick=${n.interrupt}>Stop<//>
          <${Ot} s=${i} act=${n} refs=${a} mobile />
        <//>
        <${Bt} store=${e} s=${i} />
        <${r.Presence} show=${!!i.noSpeechHint} variant="fade">
          <div className="hui-t-faint" style=${{fontStyle:"italic",marginTop:6}} role="status" aria-live="polite">${i.noSpeechHint}</div>
        <//>
      </div>
      <${r.Sheet} open=${!!i.sheet} onClose=${w} title=${ra[i.sheet]||""} snapPoints=${[.62,.92]}>
        <${na} s=${i} act=${n} store=${e} tasks=${s.tasks} />
      <//>
    </div>`}var ee=r.html,aa=200,qn=40,ia=15e3,oa=860,sa=1280,la=20,wt="jarvis-voice:dismissedNotices",Vn=100,ua={failed:{tone:"error",title:"Task failed"},needs_review:{tone:"attention",title:"Needs review"}};function Yn(t){var e=ua[t.status];return e?{id:"task:"+t.id+":"+t.status,tone:e.tone,title:e.title+" \xB7 "+(t.title||t.goal||t.id),body:t.result_summary||t.progress_note||(t.status==="needs_review"?"Waiting for your review: approve to re-delegate, or decline.":""),ts:t.finished||t.created?(t.finished||t.created)*1e3:Date.now(),taskId:t.id,approve:t.status==="needs_review"}:null}function ca(t,e){try{var n=window.localStorage.getItem(t);return n===null?e:n==="1"}catch{return e}}function da(t,e){try{window.localStorage.setItem(t,e?"1":"0")}catch{}}function fa(t,e){try{var n=window.localStorage.getItem(t);return n===null?e:parseFloat(n)}catch{return e}}function ma(t,e){try{var n=window.localStorage.getItem(t);return n===null?e:n}catch{return e}}function va(t,e){try{window.localStorage.setItem(t,e)}catch{}}var Xn=50;function pa(t,e){var n=t.current;n.push(e),n.length>Xn&&n.splice(0,n.length-Xn)}function ha(t,e){return t.current.indexOf(e)!==-1}var Qe="jarvis-voice:dismissedTasks";function Qn(t,e){try{var n=window.localStorage.getItem(t);if(n===null)return e;var a=JSON.parse(n);return a&&typeof a=="object"?a:e}catch{return e}}function Ne(t,e){try{window.localStorage.setItem(t,JSON.stringify(e))}catch{}}function Zn(t){if(!t)return!1;var e=t.tagName;return e==="INPUT"||e==="TEXTAREA"||t.isContentEditable}function $a(t){return String(t).replace(/_/g," ").replace(/^./,function(e){return e.toUpperCase()})}function Te(t){if(t==null)return"";if(typeof t=="string")return t;try{return JSON.stringify(t,null,2)}catch{return String(t)}}function ga(t){return Math.min(1e3*Math.pow(2,Math.max(0,t-1)),1e4)}function tr(){return!!(document.fullscreenElement||document.webkitFullscreenElement)}function ya(t){return!!(t&&(t.requestFullscreen||t.webkitRequestFullscreen))}function er(t){var e=t&&t.get();if(tr()){document.exitFullscreen?document.exitFullscreen():document.webkitExitFullscreen&&document.webkitExitFullscreen();return}if(e&&e.pseudoFullscreen){t.set({pseudoFullscreen:!1});return}var n=document.getElementById("jarvis-voice-root");if(n){if(ya(n)){var a=n.requestFullscreen?n.requestFullscreen():n.webkitRequestFullscreen();a&&typeof a.catch=="function"&&a.catch(function(){console.info("[jarvis-voice] requestFullscreen() was rejected: falling back to pseudo-fullscreen."),t&&t.set({pseudoFullscreen:!0})});return}console.info("[jarvis-voice] Fullscreen API unavailable on this browser (likely iOS Safari): using pseudo-fullscreen instead."),t&&t.set({pseudoFullscreen:!0})}}var ba={position:"fixed",inset:0,top:0,left:0,margin:0,width:"100vw",height:"100dvh",zIndex:2147483647},ka="radial-gradient(120% 90% at 50% 0%, var(--hui-surface-2) 0%, var(--hui-bg) 55%, var(--hui-bg) 100%)";function Ut(){var t=r.useRef(null);t.current||(t.current=un({connection:"connecting",offline:!1,fsmState:"idle",fsmDetail:null,sttPartial:"",sttPartialUttId:null,sttFinal:"",mediatorText:"",ttsPlaying:!1,micActive:!1,micMode:ma("jarvis-voice:micMode","ptt"),turnPending:!1,vadActive:!1,audioDiag:null,reducedMotion:ca("jarvis-voice:reducedMotion",!!(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches)),volume:fa("jarvis-voice:volume",1),timeline:[],dismissedTasks:Qn(Qe,{}),memoryHits:[],health:null,latency:{},micError:null,micHint:null,notices:[],dismissedNotices:Qn(wt,{}),tab:"work",sheet:null,verbose:!1,w:typeof window<"u"?window.innerWidth:1440,turns:[],speakingText:"",toolChip:null,turnId:null,turnLatency:{},memQuery:"",bargeIns:0,errCount:0,retryAttempt:0,retryAt:0,lastEventTs:0,offlineDismissed:!1,fullscreen:typeof document<"u"&&!!(document.fullscreenElement||document.webkitFullscreenElement),pseudoFullscreen:!1,noSpeechHint:null}));var e=t.current,n=ne(e),a=r.useRef(null);a.current||(a.current={canvasRef:{current:null},logRef:{current:null},levelRef:{current:null},micRingRef:{current:null},micRingMobileRef:{current:null},composerInputRef:{current:null}});var i=a.current,s=r.useRef(null),u=r.useRef(null),d=r.useRef(null),m=r.useRef(null);m.current||(m.current=cn(20));var f=r.useRef({start:function(){},stop:function(){}}),h=r.useRef([]),E=r.useRef(""),w=r.useRef(0),_=r.useRef(0),g=r.useRef(null),F=r.useRef([]);function b(v,T,k,S){e.set(function(D){return{timeline:ot(D.timeline,{id:v+":"+Date.now()+":"+Math.random(),ts:Date.now(),type:v,label:T,detail:Te(k),tone:S||"neutral"},aa)}})}function H(v,T,k,S){e.set(function(D){return{turns:ot(D.turns,{id:v+":"+Date.now()+":"+Math.random(),role:v,text:T,time:r.format.clockTime(Date.now()),meta:k||[],dim:!!(S&&S.dim),tone:S&&S.tone||null},qn)}})}function W(v){e.set(function(T){for(var k=T.turns,S=k.length-1;S>=0;S--)if(k[S].role==="user"){var D=k.slice();return D[S]=Object.assign({},k[S],{text:v,time:r.format.clockTime(Date.now())}),{turns:D}}return{turns:ot(k,{id:"user:"+Date.now()+":"+Math.random(),role:"user",text:v,time:r.format.clockTime(Date.now()),meta:[],dim:!1,tone:null},qn)}})}function R(v){v&&e.set(function(T){if(T.dismissedNotices&&Object.prototype.hasOwnProperty.call(T.dismissedNotices,v.id))return{};var k=(T.notices||[]).filter(function(S){return S.id!==v.id});return{notices:[v].concat(k).slice(0,la)}})}function A(v){e.set(function(T){var k=Object.assign({},T.dismissedNotices);k[v]=Date.now();var S=Object.keys(k);return S.length>Vn&&S.sort(function(D,J){return k[D]-k[J]}).slice(0,S.length-Vn).forEach(function(D){delete k[D]}),Ne(wt,k),{dismissedNotices:k,notices:(T.notices||[]).filter(function(D){return D.id!==v})}})}function U(v){var T=e.get(),k=(T.mediatorText||"").trim();if(k){var S=h.current.slice();v==="interrupted"&&S.push("interrupted");var D=T.turnLatency&&T.turnLatency.e2e_first_audio;typeof D=="number"&&S.push("e2e "+(D/1e3).toFixed(2)+" s"),H("jarvis",k,S),h.current=[],e.set({mediatorText:"",speakingText:""})}}function B(){h.current=[],e.set({turnLatency:{}})}function z(v,T){typeof T=="number"&&(m.current.record(v,T),e.set(function(k){var S=Object.assign({},k.turnLatency);return S[v]=T,{latency:m.current.summary(),turnLatency:S}}))}function se(v){if(v.length){var T=++w.current,k=E.current||v[0].title||v[0].path||"";k&&it("/memory/search?q="+encodeURIComponent(k)+"&k="+Math.max(v.length,3)).then(function(S){if(T===w.current){var D={};(S&&S.hits||[]).forEach(function(p){p&&p.path&&(D[p.path]=p)});var J=v.map(function(p){return Object.assign({},D[p.path]||{},p)});e.set({memoryHits:J})}}).catch(function(){})}}function re(){clearTimeout(g.current),e.set({noSpeechHint:"Didn't catch that."}),g.current=setTimeout(function(){e.set({noSpeechHint:null})},3e3)}function Ie(v){r.fetchJSON(Be).then(function(T){r.mutate(Be,T);var k=Je(T);if(Object.values(k).forEach(function(D){D.status==="needs_review"&&(!D.finished||Date.now()/1e3-D.finished<86400)&&R(Yn(D))}),v){var S=vt(k);H("system","Session resumed \xB7 "+S+" open task"+(S===1?"":"s")+" replayed from jarvis.db")}}).catch(function(){}),it("/health").then(function(T){e.set({health:T})}).catch(function(){}),r.invalidate(Ae),r.invalidate(Ge),r.invalidate(Se)}r.useEffect(function(){var v=mn();v.setGain(e.get().volume),d.current=v;var T=v.onDrained(function(){var o=u.current;o&&o.send({t:"playback.end",turn_id:e.get().turnId}),b("playback.end","Playback drained: echo guard released",null,"neutral")}),k=0,S=!1,D=null,J=0,p=fn({onChunk:function(o){var I=u.current;I&&I.sendBinary(o)},onLevel:function(o){var I=e.get().micActive,G=I?Math.max(o,e.get().vadActive?.4:0):0;k=o,s.current&&s.current.onMicLevel(G),J+=(Math.min(1,G)-J)*.35,i.levelRef.current&&(i.levelRef.current.style.width=Math.round(Math.min(1,G)*100)+"%"),[i.micRingRef.current,i.micRingMobileRef.current].forEach(function(V){V&&(V.style.opacity=I?String(.25+J*.7):"0",V.style.transform="scale("+(I?1+J*.16:.9)+")")})},onError:function(o){e.set({micError:o}),b("error",o,null,"danger")}});function O(){clearTimeout(D),S=!1,e.set({micHint:null}),D=setTimeout(function(){e.get().micActive&&p.getChunkCount()>0&&k<.02&&!S&&e.set({micHint:"Mic level is silent: check input device/permissions."})},2e3)}var M=setTimeout(function(){e.get().connection!=="open"&&e.set({offline:!0})},1500);function l(o){if(!(!o||!o.t))switch(_.current=Date.now(),o.turn_id!=null&&o.turn_id!==e.get().turnId&&o.t!=="tts.amp"&&e.set({turnId:o.turn_id}),o.t){case"state":e.set({fsmState:o.value,fsmDetail:o.detail||null}),b("state",$a(o.value)+(o.detail?": "+o.detail:""),null,o.value==="error"?"danger":o.value==="blocked"?"warn":"neutral"),o.value==="listening"&&B(),(o.value==="done"||o.value==="idle")&&U(o.value),o.value==="interrupted"&&U("interrupted"),o.detail==="turn timed out"?(H("system","Turn failed: timed out waiting for a reply.",[],{tone:"red"}),h.current=[],e.set({mediatorText:"",speakingText:""})):o.detail==="no speech recognized"&&re(),o.value!=="idle"&&o.value!=="listening"&&(S=!0);break;case"stt.partial":{var I=o.utt_id!=null?o.utt_id:null;if(I!=null&&ha(F,I))break;e.set({sttPartial:o.text||"",sttPartialUttId:I}),S=!0,e.get().micHint&&e.set({micHint:null});break}case"stt.final":{var G=o.utt_id!=null?o.utt_id:null;G!=null&&pa(F,G),e.set({sttPartial:"",sttPartialUttId:null,sttFinal:o.text||"",turnPending:!1}),E.current=o.text||"",o.text&&(o.merged?W(o.text):H("user",o.text)),b("stt.final",(o.merged?"Merged into previous utterance: ":"Transcribed: ")+"\u201C"+(o.text||"")+"\u201D",typeof o.ms=="number"?"stt.final ms: "+o.ms:null,"neutral"),z("stt",o.ms),S=!0,e.get().micHint&&e.set({micHint:null});break}case"turn.pending":e.set({turnPending:!0});break;case"vad.speech":e.set({vadActive:!!o.active,turnPending:!1});break;case"stt.ignored":o.text&&H("user",o.text,["ignored: "+(o.reason||"echo")],{dim:!0}),b("stt.ignored","Ignored: \u201C"+(o.text||"")+"\u201D ("+(o.reason||"echo")+")",Te(o),"warn"),S=!0;break;case"mediator.delta":e.set(function(X){return{mediatorText:X.mediatorText+(o.text||"")}});break;case"mediator.done":e.set({mediatorText:o.text||""}),b("mediator.done","Mediator replied \xB7 "+(o.text||"").split(/\s+/).length+" words",Te({ms_first_token:o.ms_first_token,ms_total:o.ms_total}),"neutral"),z("mediator_first_token",o.ms_first_token);break;case"meta_tool":o.phase==="start"?e.set({toolChip:{name:o.name,start:Date.now()}}):(e.set({toolChip:null}),h.current.push(o.name+(typeof o.ms=="number"?" \xB7 "+o.ms+" ms":""))),b("meta_tool",o.name+(o.phase==="end"?o.result_summary?": "+o.result_summary:" finished":" started"),Te({args:o.args,ms:o.ms}),"accent");break;case"tts.start":e.get().ttsPlaying||b("tts.start",o.engine?"TTS started \xB7 "+o.engine:"TTS started",null,"neutral"),e.set({ttsPlaying:!0,speakingText:o.text||""});break;case"tts.chunk_hdr":break;case"tts.amp":s.current&&s.current.onAmp(typeof o.v=="number"?o.v:0);break;case"tts.end":e.set({ttsPlaying:!1,speakingText:""}),z("tts_first_chunk",o.ms_first_chunk),d.current&&e.set({audioDiag:d.current.getDiagnostics()}),o.interrupted&&(d.current&&d.current.hardStop(),e.set(function(X){return{bargeIns:X.bargeIns+1}}),b("tts.end","Server detected barge-in: playback stopped",null,"warn"));break;case"task.update":{var V=Tn(o);e.set(function(X){var Y=X.dismissedTasks;return o.status&&Y&&Object.prototype.hasOwnProperty.call(Y,o.id)&&Y[o.id]!==o.status&&(Y=Object.assign({},Y),delete Y[o.id],Ne(Qe,Y)),{dismissedTasks:Y}}),b("task.update",(o.title||o.id)+": "+o.status,Te({progress_note:o.progress_note,result_summary:o.result_summary}),o.status==="failed"?"danger":o.status==="needs_review"?"warn":"accent"),mt(o.status)&&R(Yn(V));break}case"memory.hits":{var K=o.items||[];e.set({memoryHits:K}),s.current&&s.current.onMemoryHits(K),h.current.push("memory_recall \xB7 "+K.length+" hit"+(K.length===1?"":"s")),b("memory.hits","memory_recall: "+K.length+" hits",Te(K),"accent"),se(K);break}case"latency":z(o.stage,o.ms);break;case"health":e.set({health:o}),b("health","Health changed",Te(o.components),"warn");break;case"brain.changed":_n(o),b("brain.changed","Brain switched to "+(o.brain||"?"),null,"accent");break;case"error":e.set(function(X){return{errCount:X.errCount+1}}),b("error",o.message||"error",Te(o),"danger"),H("system",o.message||"Turn failed: no reply.",[],{tone:"red"}),h.current=[],e.set({mediatorText:"",speakingText:""}),R({id:"error:"+Date.now(),tone:"error",title:"Pipeline error",body:o.message||"Turn failed: see the activity stream.",ts:Date.now(),approve:!1});break;case"pong":break;default:b(o.t,o.t,null,"neutral")}}var y=0,c=dn({onEvent:l,onBinary:function(o){v.queueChunk(o)},onStatus:function(o){if(e.set({connection:o}),o==="open")clearTimeout(M),y=0,e.set({offline:!1,offlineDismissed:!1,retryAttempt:0,retryAt:0}),Ie(!0);else if(o==="reconnecting"){y++;var I=Math.ceil(y/2);e.set({offline:!0,retryAttempt:I,retryAt:y%2===1?Date.now()+ga(I):e.get().retryAt,lastEventTs:_.current})}},onOpen:function(){}});u.current=c;function C(){e.get().micActive||(v.primeAutoplay(),e.set({micActive:!0}),e.get().ttsPlaying&&(v.hardStop(),c.send({t:"barge_in"}),e.set(function(o){return{bargeIns:o.bargeIns+1}})),c.send({t:"mic.start"}),p.start(),O())}function x(){e.get().micActive&&(e.set({micActive:!1}),p.stop(),c.send({t:"mic.stop"}),clearTimeout(D),e.set({micHint:null}))}f.current.start=C,f.current.stop=x;function N(){v.hardStop(),c.send({t:"barge_in"}),e.set(function(o){return{bargeIns:o.bargeIns+1}})}f.current.interrupt=N;function L(o){if((o.metaKey||o.ctrlKey)&&String(o.key).toLowerCase()==="k"){o.preventDefault(),i.composerInputRef.current&&i.composerInputRef.current.focus();return}var I=Zn(document.activeElement);if(o.code==="Space"){if(!document.hasFocus()||I||o.repeat)return;o.preventDefault(),C();return}if(o.key==="Escape"){N();return}if(!I&&!o.metaKey&&!o.ctrlKey&&!o.altKey&&String(o.key).toLowerCase()==="f"){o.preventDefault(),er(e);return}!I&&["1","2","3"].indexOf(o.key)>=0&&e.set({tab:["work","activity","system"][+o.key-1]})}function $(o){o.code==="Space"&&(Zn(document.activeElement)||(o.preventDefault(),x()))}window.addEventListener("keydown",L),window.addEventListener("keyup",$);var P=setInterval(function(){it("/health").then(function(o){e.set({health:o})}).catch(function(){})},ia);return function(){clearTimeout(M),clearInterval(P),clearTimeout(D),window.removeEventListener("keydown",L),window.removeEventListener("keyup",$),T(),c.close(),p.teardown(),v.destroy(),s.current&&(s.current.destroy(),s.current=null)}},[]),r.useEffect(function(){function v(){e.set({fullscreen:tr()})}return document.addEventListener("fullscreenchange",v),document.addEventListener("webkitfullscreenchange",v),function(){document.removeEventListener("fullscreenchange",v),document.removeEventListener("webkitfullscreenchange",v)}},[]),r.useEffect(function(){var v=document.getElementById("jarvis-voice-root");if(!v)return;if(!n.pseudoFullscreen){v.style.setProperty("--jv-fs-top-clear","0px");return}function T(){var k=0;document.querySelectorAll("header").forEach(function(S){if(!v.contains(S)){var D=window.getComputedStyle(S);if(!(D.position!=="fixed"&&D.position!=="sticky")){var J=S.getBoundingClientRect();J.top>4||J.bottom>k&&(k=J.bottom)}}}),v.style.setProperty("--jv-fs-top-clear",(k>0?k:0)+"px")}return T(),window.addEventListener("resize",T),function(){window.removeEventListener("resize",T)}},[n.pseudoFullscreen]),r.useEffect(function(){var v=document.getElementById("jarvis-voice-root");if(!v)return;function T(){var S=v.clientWidth||window.innerWidth;Math.abs(S-e.get().w)>4&&e.set({w:S})}T();var k=typeof ResizeObserver<"u"?new ResizeObserver(T):null;return k&&k.observe(v),window.addEventListener("resize",T),function(){k&&k.disconnect(),window.removeEventListener("resize",T)}},[]),r.useEffect(function(){var v=document.getElementById("jarvis-voice-root");if(!v)return;var T=!1;function k(){if(!T){T=!0;var M=v.getBoundingClientRect().top,l=Math.max(320,window.innerHeight-M);v.style.height=l+"px";var y=document.documentElement.scrollHeight-window.innerHeight;y>1&&(v.style.height=Math.max(320,l-y)+"px"),T=!1}}k(),window.addEventListener("resize",k);var S=typeof ResizeObserver<"u"?new ResizeObserver(k):null;S&&S.observe(document.body);var D=setTimeout(k,500),J=setTimeout(k,1500),p=v.parentElement,O=p?p.getAttribute("style"):null;return p&&(p.style.padding="0"),function(){window.removeEventListener("resize",k),S&&S.disconnect(),clearTimeout(D),clearTimeout(J),p&&(O==null?p.removeAttribute("style"):p.setAttribute("style",O))}},[]);var De=n.w<oa;r.useEffect(function(){var v=i.canvasRef.current;if(v){var T=lt(v);return s.current=T,d.current&&T.setAudioSource(d.current.getLevels),T.setReducedMotion(e.get().reducedMotion),T.setState(Oe(e.get())),T.onMemoryHits(e.get().memoryHits),function(){T.destroy(),s.current===T&&(s.current=null)}}},[De]),r.useEffect(function(){s.current&&s.current.setState(Oe(n))},[n.fsmState,n.connection]),r.useEffect(function(){s.current&&s.current.setReducedMotion(n.reducedMotion),da("jarvis-voice:reducedMotion",n.reducedMotion),r.motion.set(n.reducedMotion?"off":"system")},[n.reducedMotion]),r.useEffect(function(){d.current&&d.current.setGain(n.volume)},[n.volume]);var ae=r.useRef(null);ae.current||(ae.current={onMicClick:function(v){v&&v.preventDefault(),e.get().micActive?f.current.stop():f.current.start()},interrupt:function(){f.current.interrupt()},submitText:function(v){E.current=v,B(),H("user",v),u.current&&u.current.send({t:"turn.text",text:v}),b("turn.text","Typed turn: "+v,null,"neutral")},setMicMode:function(v){e.set({micMode:v}),va("jarvis-voice:micMode",v),u.current&&u.current.send({t:"mode.set",mode:v})},dismissTask:function(v){e.set(function(T){var k=Object.assign({},T.dismissedTasks);return k[v]=!0,Ne(Qe,k),{dismissedTasks:k}})},dismissNotice:A,clearWork:function(v,T){var k=null;return e.set(function(S){k={notices:S.notices,dismissedNotices:S.dismissedNotices,dismissedTasks:S.dismissedTasks};var D=Object.assign({},S.dismissedNotices),J=Date.now();(v||[]).forEach(function(M){D[M]=J});var p=Object.assign({},S.dismissedTasks);(T||[]).forEach(function(M){p[M]=!0}),Ne(wt,D),Ne(Qe,p);var O={};return(v||[]).forEach(function(M){O[M]=!0}),{dismissedNotices:D,dismissedTasks:p,notices:(S.notices||[]).filter(function(M){return!O[M.id]})}}),function(){k&&(Ne(wt,k.dismissedNotices||{}),Ne(Qe,k.dismissedTasks||{}),e.set(k))}},resolveNotice:function(v){A(v)},getSeries:function(v){return m.current.series(v)},toggleReduced:function(){e.set(function(v){return{reducedMotion:!v.reducedMotion}})},toggleFullscreen:function(){er(e)},log:b});var ie=ae.current,me=n.w>=sa,Me=Object.assign({background:ka},n.pseudoFullscreen?ba:null);return ee`
    <${r.Root} id="jarvis-voice-root" fill style=${Me}>
      ${De?ee`<${Jn} store=${e} act=${ie} refs=${i} />`:ee`
          <div style=${{position:"absolute",inset:0,display:"flex",flexDirection:"column",paddingTop:"var(--jv-fs-top-clear, 0px)"}}>
            <${wa} s=${n} act=${ie} />
            <div style=${{flex:"1 1 0%",minHeight:0,display:"grid",gridTemplateColumns:me?"304px minmax(0,1fr) 372px":"minmax(0,1fr) 344px"}}>
              ${me?ee`<${An} store=${e} />`:null}
              <${yn} store=${e} act=${ie} refs=${i} />
              <${Pn} store=${e} act=${ie} showLeft=${me} />
            </div>
          </div>`}
      <${Sa} s=${n} store=${e} onRetry=${function(){u.current&&u.current.forceReconnect()}} />
    <//>`}function wa(t){var e=t.s,n=t.act,a=je(),i=a.data||{},s=Fe(),u=s.data&&s.data.labels||{},d=e.health&&e.health.models||{},m=e.connection==="open"?"connected":e.connection==="connecting"?"connecting":e.connection==="reconnecting"?"reconnecting":"disconnected",f=r.useRef(null),h=r.useElementWidth(f)||e.w||1200,E=h>=760,w=h>=900,_=h>=1100,g=h>=1560,F=e.latency.e2e_first_audio&&e.latency.e2e_first_audio.p50,b=e.health&&e.health.ram?e.health.ram.free_gb:void 0,H={flex:"none",minWidth:72},W=!!e.health,R=d.mediator&&d.mediator.name,A=d.worker&&d.worker.name,U=!R||!A||R===A;return ee`
    <div ref=${f} style=${{flex:"none",minHeight:52,padding:"6px 18px",borderBottom:"1px solid var(--hui-line)",background:"var(--hui-surface)",display:"flex",alignItems:"center",gap:16,minWidth:0}}>
      <${r.Row} align="center" gap="sm" wrap=${!1} style=${{flex:"none"}}>
        <span className="hui-dot hui-dot--accent hui-dot--pulse" aria-hidden="true" />
        <span className="hui-t-title">JARVIS</span>
        ${h>=640?ee`<${r.Badge} icon="lock" size="sm" title="Speech recognition and the voice run on this Mac">Voice on-box<//>`:null}
      <//>
      ${E?ee`<${r.Divider} orientation="vertical" />`:null}
      <div style=${{display:"flex",alignItems:"center",gap:20,minWidth:0,flex:"1 1 auto",overflow:"hidden"}}>
        ${_?U?ee`<${r.Stat} size="sm" variant="plain" label="Model" style=${H} value=${W?R||null:void 0} />`:ee`
            <${r.Stat} size="sm" variant="plain" label="Mediator" style=${H} value=${W?R||null:void 0} />
            <${r.Stat} size="sm" variant="plain" label="Worker" style=${H} value=${W?A||null:void 0} />`:null}
        ${w?ee`<${r.Stat} size="sm" variant="plain" label="E2E first audio" style=${H}
            value=${F??"none yet"} format=${function(B){return(B/1e3).toFixed(2)+" s"}} />`:null}
        ${E?ee`<${r.Stat} size="sm" variant="plain" label="RAM free" style=${H} value=${W?b??null:void 0}
            format=${function(B){return B.toFixed(1)+" GB"}} />`:null}
        ${g&&i.backends?ee`<div style=${{display:"flex",gap:14,marginLeft:"auto",flex:"none"}}>
              ${Object.keys(Ve).filter(function(B){var z=i.backends[B];return z&&z.tier!=="free"}).map(function(B){var z=i.backends[B],se=(z.gauges||[])[0],re=se&&typeof se.remaining_pct=="number"?se.remaining_pct*100:0;return ee`<div key=${B} style=${{width:124,flex:"none"}}>
                    <${r.Meter} size="sm" label=${u[B]||Ve[B].name} value=${re} max=${100} valueText=${Math.round(re)+"%"} />
                  </div>`})}
            </div>`:null}
      </div>
      <${r.Row} align="center" gap="sm" wrap=${!1} style=${{flex:"none"}}>
        <${Wn} act=${n} />
        <${Bn} act=${n} />
        <${r.ConnectionPill} state=${m} attempt=${e.retryAttempt} />
        <${ut} active=${e.fullscreen||e.pseudoFullscreen} pseudo=${e.pseudoFullscreen} onClick=${n.toggleFullscreen} />
        <${r.Switch} checked=${!e.reducedMotion} onChange=${function(){n.toggleReduced()}} label=${h>=980?"Motion":void 0} ariaLabel="Motion" />
      <//>
    </div>`}function Sa(t){var e=t.s,n=t.store;r.useNow(1e3);var a=!!e.offline&&!e.offlineDismissed;return ee`
    <div style=${{position:"absolute",insetInline:0,bottom:0,display:"flex",justifyContent:"center",paddingBottom:24,pointerEvents:a?"auto":"none",zIndex:40}}>
      <div style=${{width:"min(520px,86%)"}}>
        <${r.Banner} tone="warn" variant="inline" open=${a} title="jarvisd unreachable through the dashboard proxy"
          action=${ee`
            <${r.Row} gap="sm">
              <${r.Button} size="sm" variant="primary" onClick=${t.onRetry}>Retry now<//>
              <${r.Button} size="sm" variant="secondary" onClick=${function(){n.set({offlineDismissed:!0})}}>Work offline<//>
            <//>`}>
          <${r.Stack} gap="sm">
            <span>
              Voice capture is paused. Task state is safe in <code className="hui-code">jarvis.db</code> and replays on reconnect. Retrying with backoff${e.retryAttempt?": attempt "+e.retryAttempt:""}.
              ${e.retryAttempt&&e.retryAt?ee` <${r.Countdown} to=${e.retryAt} fallback="" />`:null}
            </span>
            ${e.lastEventTs?ee`<span className="hui-t-micro">last event <${r.RelTime} at=${e.lastEventTs} /></span>`:null}
          <//>
        <//>
      </div>
    </div>`}(function(){window.__JARVIS_VOICE_INTERNALS__={createVisualizer:lt,App:Ut},!(!window.__HERMES_PLUGIN_SDK__||!window.__HERMES_PLUGINS__)&&window.__HERMES_PLUGINS__.register("jarvis-voice",Ut)})();})();

(()=>{var r=window.HermesUI,ea=r&&r.html;var de="/api/plugins/jarvis-voice";function St(){return window.__HERMES_PLUGIN_SDK__}function en(){return window.__HERMES_SESSION_TOKEN__}function Xe(t){var e=window.HERMES_BASE_PATH||"";return new URL(e+"/dashboard-plugins/jarvis-voice/dist/"+t,window.location.origin).toString()}function Vn(t,e){var n=St(),a=de+t;if(n&&typeof n.authedFetch=="function")return n.authedFetch(a,e);var i=Object.assign({},e);i.headers=Object.assign({},i.headers);var s=en();return s&&(i.headers["X-Hermes-Session-Token"]=s),i.credentials||(i.credentials="include"),fetch(a,i)}function Qe(t){var e=St();return e&&typeof e.fetchJSON=="function"?e.fetchJSON(de+t):Vn(t).then(function(n){if(!n.ok)throw new Error("HTTP "+n.status+" for "+t);return n.json()})}function tn(){var t=St(),e=de+"/ws";if(t&&typeof t.buildWsUrl=="function")try{var n=t.buildWsUrl(e);if(typeof t.buildWsAuthParam=="function"){var a=t.buildWsAuthParam();a&&(n+=(n.indexOf("?")===-1?"?":"&")+a)}return n}catch{}var i=window.location.protocol==="https:"?"wss:":"ws:",s=en(),u=i+"//"+window.location.host+e;return s&&(u+="?token="+encodeURIComponent(s)),u}function nn(t){var e=t,n=new Set;function a(){return e}function i(u){return e=Object.assign({},e,typeof u=="function"?u(e):u),n.forEach(function(c){c(e)}),e}function s(u){return n.add(u),function(){n.delete(u)}}return{get:a,set:i,subscribe:s}}function Q(t){var e=r.useState,n=r.useEffect,a=e(t.get()),i=a[0],s=a[1];return n(function(){return s(t.get()),t.subscribe(s)},[t]),i}function Tt(t,e,n){var a=t.concat([e]);return a.length>n&&(a=a.slice(a.length-n)),a}function rn(t){var e=t||20,n={};function a(c,f){var d=(n[c]||[]).concat([f]);d.length>e&&(d=d.slice(d.length-e)),n[c]=d}function i(c){return n[c]||[]}function s(c,f){var d=n[c];if(!d||!d.length)return null;var h=d.slice().sort(function(T,O){return T-O}),k=Math.min(h.length-1,Math.floor(f*h.length));return Math.round(h[k])}function u(){var c={};return Object.keys(n).forEach(function(f){c[f]={p50:s(f,.5),p95:s(f,.95),n:n[f].length}}),c}return{record:a,summary:u,series:i}}var Ze=1e3,Yn=1e4;function an(t){var e=t&&t.onEvent||function(){},n=t&&t.onBinary||function(){},a=t&&t.onStatus||function(){},i=t&&t.onOpen||function(){},s=null,u=Ze,c=null,f=!1,d=!1;function h(){f||(a("reconnecting"),clearTimeout(c),c=setTimeout(k,u),u=Math.min(u*2,Yn))}function k(){clearTimeout(c),f=!1,a(u>Ze?"reconnecting":"connecting");var w;try{w=new WebSocket(tn())}catch{h();return}w.binaryType="arraybuffer",s=w,w.onopen=function(){clearTimeout(c),u=Ze,d=!1,a("open"),i()},w.onmessage=function(S){if(typeof S.data=="string"){var F;try{F=JSON.parse(S.data)}catch{return}F&&F.t==="tts.chunk_hdr"&&(d=!0),e(F)}else d&&(d=!1,n(S.data))},w.onclose=function(){s===w&&(s=null,h())},w.onerror=function(){try{w.close()}catch{}}}function T(w){s&&s.readyState===WebSocket.OPEN&&s.send(JSON.stringify(w))}function O(w){s&&s.readyState===WebSocket.OPEN&&s.send(w)}function $(){if(u=Ze,f=!1,s){try{s.close()}catch{}s=null}k()}function A(){if(f=!0,clearTimeout(c),s){try{s.close()}catch{}s=null}}return k(),{send:T,sendBinary:O,close:A,forceReconnect:$}}function on(t){var e=t&&t.onChunk||function(){},n=t&&t.onLevel||function(){},a=t&&t.onError||function(){},i=null,s=null,u=null,c=null,f=!1,d=null,h=0;function k(){return!!((window.AudioContext||window.webkitAudioContext)&&window.AudioWorkletNode&&navigator.mediaDevices&&navigator.mediaDevices.getUserMedia)}function T(_){if(!window.isSecureContext)return"Mic unavailable: this page is not a secure context (needs https:// or localhost).";var N=_&&_.name||"";return N==="NotAllowedError"||N==="PermissionDeniedError"?"Microphone permission denied. Allow mic access for this site, then try again.":N==="NotFoundError"||N==="DevicesNotFoundError"?"No microphone found. Check your input device.":N==="NotReadableError"||N==="TrackStartError"?"Microphone is in use by another app, or a hardware error occurred.":N==="OverconstrainedError"?"No microphone matches the required audio constraints.":N==="AbortError"?"Microphone access was aborted.":_&&_.message||String(_)}function O(){if(!i){var _=window.AudioContext||window.webkitAudioContext;i=new _}return i}function $(){if(d)return d;if(!window.isSecureContext)return d=Promise.reject(new Error("insecure-context")),d;if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)return d=Promise.reject(new Error("getUserMedia is not available in this browser.")),d;var _=O(),N=_.sampleRate;return d=navigator.mediaDevices.getUserMedia({audio:{sampleRate:{ideal:16e3},echoCancellation:!0,noiseSuppression:!0,channelCount:1}}).then(function(L){return c=L,_.audioWorklet.addModule(Xe("mic-worklet.js")).catch(function(U){throw new Error("mic init failed: "+(U&&U.message?U.message:U))})}).then(function(){u=_.createMediaStreamSource(c),s=new AudioWorkletNode(_,"mic-worklet",{processorOptions:{targetSampleRate:16e3,sourceSampleRate:N}}),s.port.onmessage=function(L){var U=L.data;U.type==="chunk"?f&&(h++,e(U.buffer)):U.type==="level"&&n(U.rms)},u.connect(s)}).catch(function(L){throw d=null,L}),d}function A(){f=!0,h=0;var _=O();Promise.resolve().then(function(){return _.resume?_.resume():void 0}).catch(function(){}).then(function(){if(_.state!=="running")throw new Error("AudioContext did not enter 'running' state (state: "+_.state+").");return $()}).catch(function(N){f=!1,a(T(N))})}function w(){f=!1}function S(){if(f=!1,s)try{s.disconnect()}catch{}if(u)try{u.disconnect()}catch{}if(c&&(c.getTracks().forEach(function(_){_.stop()}),c=null),i){try{i.close()}catch{}i=null}d=null}function F(){return h}return{start:A,stop:w,teardown:S,isSupported:k(),getChunkCount:F}}function sn(){var t=24e3,e=null,n=null,a=null,i=null,s=1,u=null,c=null,f=null,d=null,h=null,k={level:0,low:0,mid:0,high:0};function T(){if(i)return i;try{e=new(window.AudioContext||window.webkitAudioContext)({sampleRate:t})}catch{e=new(window.AudioContext||window.webkitAudioContext)}return i=e.audioWorklet.addModule(Xe("player-worklet.js")).then(function(){n=new AudioWorkletNode(e,"player-worklet",{outputChannelCount:[1]}),a=e.createGain(),a.gain.value=s;try{u=e.createAnalyser(),u.fftSize=2048,u.smoothingTimeConstant=.5,c=new Uint8Array(u.frequencyBinCount),typeof u.getFloatTimeDomainData=="function"?f=new Float32Array(u.fftSize):d=new Uint8Array(u.fftSize);var S=e.sampleRate/u.fftSize;h=[Math.round(250/S),Math.round(2e3/S),Math.min(u.frequencyBinCount,Math.round(6e3/S))],n.connect(a),a.connect(u),u.connect(e.destination)}catch{u=null,n.connect(a).connect(e.destination)}}).catch(function(S){throw i=null,S}),i}function O(){if(!u||!e||e.state!=="running")return null;var S,F=0;if(f){for(u.getFloatTimeDomainData(f),S=0;S<f.length;S++)F+=f[S]*f[S];F=Math.sqrt(F/f.length)}else{for(u.getByteTimeDomainData(d),S=0;S<d.length;S++){var _=(d[S]-128)/128;F+=_*_}F=Math.sqrt(F/d.length)}u.getByteFrequencyData(c);var N=[0,0,0],L=[0,0,0],U=0;for(S=0;S<h[2];S++){for(;U<2&&S>=h[U];)U++;N[U]+=c[S],L[U]++}return k.level=Math.min(1,F*4.5),k.low=L[0]?N[0]/(L[0]*255):0,k.mid=L[1]?N[1]/(L[1]*255):0,k.high=L[2]?N[2]/(L[2]*255):0,k}function $(S){T().then(function(){e.state==="suspended"&&e.resume();var F=S instanceof Int16Array?S:new Int16Array(S),_=Xn(F),N=e.sampleRate,L=N===t?_:Qn(_,t,N);n.port.postMessage({type:"push",samples:L},[L.buffer])}).catch(function(){})}function A(){n&&n.port.postMessage({type:"clear"})}function w(S){s=S,a&&(a.gain.value=S)}return{queueChunk:$,hardStop:A,setGain:w,getLevels:O}}function Xn(t){for(var e=new Float32Array(t.length),n=0;n<t.length;n++){var a=t[n];e[n]=a<0?a/32768:a/32767}return e}function Qn(t,e,n){for(var a=e/n,i=Math.max(1,Math.round(t.length/a)),s=new Float32Array(i),u=0;u<i;u++){var c=u*a,f=Math.floor(c),d=Math.min(f+1,t.length-1),h=c-f;s[u]=t[f]*(1-h)+t[d]*h}return s}var te={idle:{rad:1,spin:.05,noise:.1,glow:.55,mode:"calm",col:[79,227,224]},listening:{rad:1.09,spin:.09,noise:.16,glow:.88,mode:"open",col:[110,235,225]},transcribing:{rad:1.02,spin:.15,noise:.3,glow:.76,mode:"resolve",col:[130,226,236]},thinking:{rad:.93,spin:.24,noise:.13,glow:.7,mode:"orbit",col:[79,210,232]},memory:{rad:1,spin:.07,noise:.09,glow:.78,mode:"stars",col:[96,216,206]},capability:{rad:.97,spin:.12,noise:.09,glow:.72,mode:"radial",col:[122,222,216]},tool:{rad:.95,spin:.19,noise:.12,glow:.8,mode:"arc",col:[79,227,224]},delegating:{rad:1.03,spin:.1,noise:.14,glow:.84,mode:"transfer",col:[86,206,234]},worker_progress:{rad:.91,spin:.06,noise:.07,glow:.58,mode:"arc",col:[86,206,234]},speaking:{rad:1.05,spin:.07,noise:.1,glow:1,mode:"bands",col:[124,240,233]},interrupted:{rad:.87,spin:.03,noise:.05,glow:.34,mode:"calm",col:[150,170,176]},blocked:{rad:.95,spin:.03,noise:.06,glow:.62,mode:"calm",col:[242,179,92]},error:{rad:.9,spin:.02,noise:.36,glow:.66,mode:"calm",col:[255,107,107]},done:{rad:1.1,spin:.05,noise:.08,glow:.92,mode:"pulse",col:[104,234,208]},offline:{rad:.85,spin:.01,noise:.04,glow:.2,mode:"calm",col:[110,128,133]}},ln={idle:{label:"Idle",hint:"Awake \xB7 nothing in flight"},listening:{label:"Listening",hint:"mic open \xB7 webrtcvad endpointing"},transcribing:{label:"Transcribing",hint:"faster-whisper base.en int8"},thinking:{label:"Thinking",hint:"gpt-oss-20b \xB7 8k window"},memory:{label:"Recalling",hint:"Obsidian vault \xB7 FTS5 + vectors"},capability:{label:"Matching capability",hint:"tools \xB7 skills \xB7 quick actions"},tool:{label:"Running meta-tool",hint:"server-reported action"},delegating:{label:"Delegating",hint:"handing the goal to a worker"},worker_progress:{label:"Worker running",hint:"gpt-oss-20b worker session"},speaking:{label:"Speaking",hint:"kokoro-onnx \xB7 am_michael"},interrupted:{label:"Interrupted",hint:"playback stopped \xB7 mediator canceled"},blocked:{label:"Blocked",hint:"needs a decision from you"},error:{label:"Error",hint:"recoverable \xB7 see activity"},done:{label:"Done",hint:"turn complete"},offline:{label:"Offline",hint:"reconnecting to jarvisd"}},da=Object.keys(te);function un(t){var e=(te[t]||te.idle).col;return"rgb("+e[0]+","+e[1]+","+e[2]+")"}function cn(t){return ln[t]||ln.idle}var dn=2,Zn=95,er=2.399963229728653;function je(t){return Math.max(0,Math.min(1,t))}function fn(t){var e="idle",n=0,a=!1,i=[],s=null,u=!1,c=0,f=0,d=null,h=0,k=0,T=[],O=0,$=null,A=118,w=[],S=[],F=[];(function(){var x,m,M;for(x=0;x<A;x++){var E=1-x/(A-1)*2,R=Math.sqrt(Math.max(0,1-E*E)),o=x*er;w.push([Math.cos(o)*R,E,Math.sin(o)*R])}var v={};for(x=0;x<A;x++){var b=[];for(m=0;m<A;m++)if(x!==m){var I=w[x][0]-w[m][0],P=w[x][1]-w[m][1],z=w[x][2]-w[m][2];b.push([I*I+P*P+z*z,m])}for(b.sort(function(K,re){return K[0]-re[0]}),M=0;M<3;M++){m=b[M][1];var q=x<m?x+":"+m:m+":"+x;v[q]||(v[q]=!0,S.push([Math.min(x,m),Math.max(x,m)]))}}for(x=0;x<84;x++)F.push({x:Math.random(),y:Math.random(),z:.3+Math.random()*.7,s:.2+Math.random()*.8})})();var _=new Array(A),N=0,L=0;function U(l){l>26?(L++,L>90&&N<3&&(N++,L=0)):L>0&&L--}var V=128,Re=document.createElement("canvas"),we=document.createElement("canvas");Re.width=Re.height=V,we.width=we.height=V;var _e="";function Ae(l,x,m){var M=l+","+x+","+m;if(M!==_e){_e=M;var E=V/2,R=Re.getContext("2d");R.clearRect(0,0,V,V);var o=R.createRadialGradient(E,E,V*.035,E,E,E);o.addColorStop(0,"rgba("+M+",0.09)"),o.addColorStop(.45,"rgba("+M+",0.035)"),o.addColorStop(1,"rgba("+M+",0)"),R.fillStyle=o,R.fillRect(0,0,V,V);var v=we.getContext("2d");v.clearRect(0,0,V,V);var b=v.createRadialGradient(E,E,0,E,E,E);b.addColorStop(0,"rgba("+M+",1)"),b.addColorStop(.28,"rgba("+M+",0.38)"),b.addColorStop(1,"rgba("+M+",0)"),v.fillStyle=b,v.fillRect(0,0,V,V)}}function ne(){if(t.clientWidth){var l=Math.min(dn,window.devicePixelRatio||1),x=Math.round(t.clientWidth*l),m=Math.round(t.clientHeight*l);(t.width!==x||t.height!==m)&&(t.width=x,t.height=m)}}var me=0,p=0,g=(window.performance||Date).now();function y(l){if(me=u?0:requestAnimationFrame(y),!!t.clientWidth){t.width===0&&ne();var x=Math.min(64,l-(p||l));p=l;var m=(l-g)/1e3;U(x);var M=s?s():null;if(M){d=M;var E=je(M.level+(M.high||0)*.3);c+=(E-c)*.28}else d=null,c+=(f-c)*.28,f*=.88;h+=(k-h)*.2,k*=.9,h>.42&&m-O>.42&&(O=m,T.push({r:.34,a:.42}));var R=te[e]||te.idle;$||($={rad:R.rad,spin:R.spin,noise:R.noise,glow:R.glow,mode:R.mode,col:R.col.slice()});var o=a?1:1-Math.exp(-x/Zn);$.rad+=(R.rad-$.rad)*o,$.spin+=(R.spin-$.spin)*o,$.noise+=(R.noise-$.noise)*o,$.glow+=(R.glow-$.glow)*o;for(var v=0;v<3;v++)$.col[v]+=(R.col[v]-$.col[v])*o;$.mode=R.mode,C(m,x)}}function C(l,x){var m=t.getContext("2d");if(m){var M=Math.min(dn,window.devicePixelRatio||1),E=t.width,R=t.height;m.setTransform(1,0,0,1,0,0),m.clearRect(0,0,E,R),m.scale(M,M);var o=E/M,v=R/M,b=o/2,I=v<300,P=I?v*.5:v/2-6,z=I?Math.min(o*.3,v*.4):Math.min(o,v)*.29,q=Math.round($.col[0]),K=Math.round($.col[1]),re=Math.round($.col[2]),ae=function(qn){return"rgba("+q+","+K+","+re+","+qn+")"};Ae(q,K,re);var ie=a?.6:l,pe=z*2.9;if(m.globalAlpha=je($.glow),m.drawImage(Re,b-pe,P-pe,pe*2,pe*2),m.globalAlpha=1,N<2){m.lineWidth=1;for(var ue=0;ue<3;ue++){var Le=z*(1.5+ue*.42),Ne=.19+ue*.02,mt=ie*(.05+ue*.015)*(ue%2?-1:1);m.strokeStyle=ae(.05-ue*.011),m.beginPath(),m.ellipse(b,P,Le,Le*Ne,mt,0,Math.PI*2),m.stroke()}}if(!a&&N<1)for(var Se=0;Se<F.length;Se++){var oe=F[Se];oe.y-=12e-5*oe.z*(x/16),oe.y<-.05&&(oe.y=1.05,oe.x=Math.random());var vt=oe.x*o+Math.sin(ie*.2+oe.z*9)*6,pt=oe.y*v;m.fillStyle=ae(.05+oe.s*.1),m.fillRect(vt,pt,1.1,1.1)}for(var he=ie*$.spin*2.2,ce=.42+Math.sin(ie*.24)*.1,Te=Math.cos(he),Me=Math.sin(he),xe=Math.cos(ce),Ee=Math.sin(ce),$e=z*$.rad*(1+c*.14),ge=N>=3?2:1,X=0;X<A;X+=ge){var Be=w[X],ht=a?0:Math.sin(X*1.77+ie*1.15)*.5+Math.sin(X*4.13-ie*.7)*.5,$t=1+ht*$.noise*.34+c*.1*Math.sin(X*.7+ie*6),Lt=Be[0]*$t,Bt=Be[1]*$t,Ft=Be[2]*$t,Hn=Lt*Te+Ft*Me,jt=-Lt*Me+Ft*Te,Un=Bt*xe-jt*Ee,Ht=Bt*Ee+jt*xe,gt=2.7/(2.7-Ht);_[X]=[b+Hn*$e*gt,P+Un*$e*gt,Ht,gt]}m.lineWidth=1;for(var yt=0;yt<S.length;yt+=ge){var Ge=S[yt];if(!(ge>1&&(Ge[0]%2||Ge[1]%2))){var Je=_[Ge[0]],qe=_[Ge[1]];if(!(!Je||!qe)){var Wn=(Je[2]+qe[2])/2,zn=(.06+Math.max(0,Wn+.9)*.13)*(.55+$.glow*.6);m.strokeStyle=ae(Math.min(.5,zn)),m.beginPath(),m.moveTo(Je[0],Je[1]),m.lineTo(qe[0],qe[1]),m.stroke()}}}for(var bt=0;bt<A;bt+=ge){var Ie=_[bt];if(!(!Ie||Ie[2]<-.25)){var Ve=.7+Ie[3]*.5;m.fillStyle=ae(.14+Math.max(0,Ie[2])*.4),m.fillRect(Ie[0]-Ve/2,Ie[1]-Ve/2,Ve,Ve)}}if(!a&&N<2){var Ut=-he*.62,Wt=Math.cos(Ut),zt=Math.sin(Ut),Kn=[[0,1,2],[1,2,0],[2,0,1]];m.lineWidth=1,m.strokeStyle=ae(.05+$.glow*.06);for(var Fe=0;Fe<3;Fe++){var Kt=Kn[Fe],Gt=$e*(1.02+Fe*.008);m.beginPath();for(var kt=!1,wt=0;wt<=56;wt++){var Jt=wt/56*Math.PI*2+Fe*.7,ye=[0,0,0];ye[Kt[0]]=Math.cos(Jt),ye[Kt[1]]=Math.sin(Jt);var Gn=ye[0]*Wt+ye[2]*zt,qt=-ye[0]*zt+ye[2]*Wt,Jn=ye[1]*xe-qt*Ee,Vt=ye[1]*Ee+qt*xe;if(Vt<-.55){kt=!1;continue}var Yt=2.7/(2.7-Vt),Xt=b+Gn*Gt*Yt,Qt=P+Jn*Gt*Yt;kt?m.lineTo(Xt,Qt):m.moveTo(Xt,Qt),kt=!0}m.stroke()}}var Zt=$e*(.3+c*.22+($.mode==="pulse"?.12:0)),Ye=Zt*2.4;if(m.globalAlpha=Math.min(.95,.5+$.glow*.4+c*.3),m.drawImage(we,b-Ye,P-Ye,Ye*2,Ye*2),m.globalAlpha=1,m.strokeStyle=ae(.42+c*.4),m.lineWidth=1.2,m.beginPath(),m.arc(b,P,Zt*.72,0,Math.PI*2),m.stroke(),a){D(m,b,P,z,ae);return}J(m,$.mode,b,P,z,l,ae)}}function D(l,x,m,M,E){l.setLineDash([2,6]),l.lineWidth=1,l.strokeStyle=E(.3),l.beginPath(),l.arc(x,m,M*1.32,0,Math.PI*2),l.stroke(),l.setLineDash([])}function J(l,x,m,M,E,R,o){var v,b,I,P,z,q,K;if(x==="open"){for(v=T.length-1;v>=0;v--){var re=T[v];if(re.r+=.012,re.a*=.965,re.a<.01||re.r>2.2){T.splice(v,1);continue}l.strokeStyle=o(re.a),l.lineWidth=1,l.beginPath(),l.arc(m,M,E*re.r,0,Math.PI*2),l.stroke()}var ae=.5+h*1.1;l.strokeStyle=o(.5),l.lineWidth=2,l.beginPath(),l.arc(m,M,E*1.36,-Math.PI/2-ae/2,-Math.PI/2+ae/2),l.stroke()}else if(x==="bands")for(K=34,v=0;v<K;v++){b=v/K*Math.PI*2-Math.PI/2;var ie=Math.abs(Math.sin(v*1.7+R*6.1))*.5+Math.abs(Math.sin(v*.9+R*11.3))*.5;if(d){var pe=(Math.sin(b)+1)/2,ue=(d.low||0)*pe+(d.mid||0)*(1-Math.abs(pe-.5)*2)+(d.high||0)*(1-pe);ie*=.4+1.1*je(ue)}var Le=E*(.16+c*ie*.72),Ne=E*1.2;l.strokeStyle=o(.14+c*ie*.5),l.lineWidth=1.6,l.beginPath(),l.moveTo(m+Math.cos(b)*Ne,M+Math.sin(b)*Ne),l.lineTo(m+Math.cos(b)*(Ne+Le),M+Math.sin(b)*(Ne+Le)),l.stroke()}else if(x==="orbit")for(v=0;v<3;v++){P=E*(1.18+v*.16);var mt=(v%2?-1:1)*(.5+v*.22);K=26-v*5;for(var Se=0;Se<K;Se++){b=Se/K*Math.PI*2+R*mt;var oe=.35+.65*Math.pow(Math.max(0,Math.sin(b*2+R)),2);l.fillStyle=o(.1+oe*.42),z=m+Math.cos(b)*P,q=M+Math.sin(b)*P*.34,l.beginPath(),l.arc(z,q,1.5,0,Math.PI*2),l.fill()}}else if(x==="resolve"){for(K=40,l.strokeStyle=o(.4),l.lineWidth=1.4,l.beginPath(),v=0;v<=K;v++){z=m-E*1.5+v/K*E*3;var vt=1-Math.abs(v/K-.5)*1.6;q=M+E*1.62+Math.sin(v*.9+R*9)*E*.16*Math.max(0,vt),v===0?l.moveTo(z,q):l.lineTo(z,q)}for(l.stroke(),v=0;v<16;v++)I=(R*.55+v/16)%1,b=v*2.4,P=E*(1.7-I*1.3),l.fillStyle=o(.5*(1-Math.abs(I-.5)*1.6)),l.beginPath(),l.arc(m+Math.cos(b)*P,M+Math.sin(b)*P*.7,1.4,0,Math.PI*2),l.fill()}else if(x==="stars"){var pt=i.length?i.slice(0,6):[0,1,2];for(v=0;v<pt.length;v++)b=-Math.PI*.72+v*.5+Math.sin(R*.3+v)*.05,I=(R*.4+v*.33)%1,P=E*(2.05-I*.72),z=m+Math.cos(b)*P,q=M+Math.sin(b)*P*.78,l.strokeStyle=o(.1+(1-I)*.18),l.lineWidth=1,l.beginPath(),l.moveTo(z,q),l.lineTo(m,M),l.stroke(),l.fillStyle=o(.35+(1-I)*.45),l.beginPath(),l.arc(z,q,2.6,0,Math.PI*2),l.fill(),l.strokeStyle=o(.18),l.beginPath(),l.arc(z,q,6+Math.sin(R*2+v)*1.2,0,Math.PI*2),l.stroke()}else if(x==="radial")for(K=12,v=0;v<K;v++){b=v/K*Math.PI*2+R*.12;var he=v%3===Math.floor(R*1.6)%3,ce=E*1.24,Te=E*(he?.4:.2);l.strokeStyle=o(he?.5:.14),l.lineWidth=he?2:1,l.beginPath(),l.moveTo(m+Math.cos(b)*ce,M+Math.sin(b)*ce*.9),l.lineTo(m+Math.cos(b)*(ce+Te),M+Math.sin(b)*(ce+Te)*.9),l.stroke(),he&&(l.fillStyle=o(.6),l.beginPath(),l.arc(m+Math.cos(b)*(ce+Te),M+Math.sin(b)*(ce+Te)*.9,2,0,Math.PI*2),l.fill())}else if(x==="arc"){P=E*1.34,l.strokeStyle=o(.1),l.lineWidth=2,l.beginPath(),l.arc(m,M,P,0,Math.PI*2),l.stroke();var Me=R*.85%(Math.PI*2);l.strokeStyle=o(.62),l.lineWidth=2.4,l.beginPath(),l.arc(m,M,P,Me,Me+1.05),l.stroke(),l.fillStyle=o(.8),l.beginPath(),l.arc(m+Math.cos(Me+1.05)*P,M+Math.sin(Me+1.05)*P,2.4,0,Math.PI*2),l.fill()}else if(x==="transfer"){var xe=m,Ee=M,$e=m+E*1.85,ge=M+E*.9;for(l.strokeStyle=o(.14),l.lineWidth=1,l.beginPath(),l.moveTo(xe,Ee),l.quadraticCurveTo(m+E,M+E*1.2,$e,ge),l.stroke(),v=0;v<5;v++){I=(R*.65+v/5)%1;var X=1-I,Be=X*X*xe+2*X*I*(m+E)+I*I*$e,ht=X*X*Ee+2*X*I*(M+E*1.2)+I*I*ge;l.fillStyle=o(.7*(1-I*.7)),l.beginPath(),l.arc(Be,ht,2.1,0,Math.PI*2),l.fill()}l.strokeStyle=o(.4),l.lineWidth=1.4,l.beginPath(),l.arc($e,ge,9+Math.sin(R*3)*1.4,0,Math.PI*2),l.stroke()}else x==="pulse"&&(I=(R-n)*.9,I>=0&&I<=1&&(l.strokeStyle=o(.5*(1-I)),l.lineWidth=2,l.beginPath(),l.arc(m,M,E*(1.1+I*.9),0,Math.PI*2),l.stroke()))}function H(){u||me||a||document.hidden||(p=0,me=requestAnimationFrame(y))}function le(){me&&(cancelAnimationFrame(me),me=0)}function ve(){ne();var l=te[e]||te.idle;$={rad:l.rad,spin:l.spin,noise:l.noise,glow:l.glow,mode:l.mode,col:l.col.slice()};var x=((window.performance||Date).now()-g)/1e3;C(x,16)}function se(){document.hidden?le():a||H()}document.addEventListener("visibilitychange",se);var Y=null;return window.ResizeObserver?(Y=new ResizeObserver(function(){ne(),a&&ve()}),Y.observe(t)):window.addEventListener("resize",ne),ne(),H(),{setState:function(l){l!==e&&(e=te[l]?l:"idle",n=((window.performance||Date).now()-g)/1e3,a&&ve())},setReducedMotion:function(l){a=!!l,a?(le(),ve()):H()},setHits:function(l){i=Array.isArray(l)?l:[]},setAudioSource:function(l){s=typeof l=="function"?l:null},onAmp:function(l){f=je(typeof l=="number"?l:0)},onMicLevel:function(l){k=je(typeof l=="number"?l:0)},resize:function(){ne(),a&&ve()},destroy:function(){u=!0,le(),document.removeEventListener("visibilitychange",se),Y?Y.disconnect():window.removeEventListener("resize",ne)}}}function et(t){var e=fn(t);return{setState:function(n,a){e.setState(n)},onAmp:function(n){e.onAmp(n)},onMicLevel:function(n){e.onMicLevel(n)},onMemoryHits:function(n){e.setHits(n)},setAudioSource:function(n){e.setAudioSource(n)},setReducedMotion:function(n){e.setReducedMotion(n)},resize:function(){e.resize()},destroy:function(){e.destroy()}}}var j=r.html;function Pe(t){return t.connection==="open"?t.fsmState:"offline"}var tr={listening:1,speaking:1,thinking:1,tool:1,worker_progress:1},nr=[["STT","stt"],["MED","mediator_first_token"],["TTS","tts_first_chunk"]];function rr(t){var e=[],n=0;nr.forEach(function(i){var s=t[i[1]];typeof s=="number"&&(e.push({label:i[0]+" "+Math.round(s)+"ms",value:s,tone:i[1]==="mediator_first_token"?"accent":"neutral"}),n+=s)});var a=t.e2e_first_audio;return typeof a=="number"&&a-n>0&&e.length&&e.push({label:"PLAY "+Math.round(a-n)+"ms",value:a-n,tone:"neutral"}),e}function ar(t){var e=Q(t.store),n=rr(e.turnLatency||{}),a=(e.turnLatency||{}).e2e_first_audio,i=typeof a=="number"?r.format.duration(a):e.latency.e2e_first_audio&&e.latency.e2e_first_audio.p50!=null?r.format.duration(e.latency.e2e_first_audio.p50):"\u2014",s=e.w>=1280;return j`
    <${r.Row} align="center" gap="md" style=${{padding:"10px 20px",borderBottom:"1px solid var(--hui-line)",flex:"none"}}>
      <span className="hui-t-micro" style=${{whiteSpace:"nowrap"}}>${"TURN "+(e.turnId!=null?"#"+e.turnId:"\u2014")}</span>
      <div style=${{flex:1,minWidth:0}}>
        <${r.SegmentBar} segments=${n.length?n:[{label:"idle",value:1,tone:"neutral"}]} legend=${s} label="Turn latency waterfall" />
      </div>
      ${s?null:j`<span className="hui-t-num hui-t-faint" style=${{whiteSpace:"nowrap"}}>${"e2e "+i}</span>`}
    <//>`}function Mt(t){var e=t.s,n=Pe(e),a=cn(n),i=un(n),s=e.fsmDetail&&e.connection==="open"?a.hint+" \xB7 "+e.fsmDetail:a.hint;return j`
    <div style=${{display:"flex",flexDirection:"column",alignItems:"center",gap:7,pointerEvents:"none"}} aria-live="polite">
      <${r.Row} align="center" gap="sm">
        <span className=${tr[n]&&!e.reducedMotion?"hui-dot hui-dot--pulse":"hui-dot"}
          style=${{background:i,boxShadow:"0 0 10px 2px "+i.replace("rgb(","rgba(").replace(")",",.4)")}} aria-hidden="true" />
        <span className="hui-t-title" style=${{color:i,textShadow:"0 0 18px "+i.replace("rgb(","rgba(").replace(")",",.33)")}}>
          ${a.label}
        </span>
      <//>
      <div className=${t.mobile,"hui-t-sub"} style=${{textAlign:t.mobile?"center":"left"}}>${s}</div>
    </div>`}function xt(t){var e=t.s;return e.toolChip?j`
    <${r.Row} align="center" gap="sm" style=${{marginTop:3,padding:"5px 11px",borderRadius:6,border:"1px solid var(--hui-line-strong)",background:"var(--hui-surface-2)",pointerEvents:"none"}}>
      <${r.Icon} name="settings" size=${12} className="hui-t-accent" />
      <span className="hui-t-mono">${e.toolChip.name}</span>
      <span style=${{width:1,height:11,background:"var(--hui-line-strong)"}} />
      <span className="hui-t-num hui-t-accent"><${r.RelTime} at=${e.toolChip.start} granularity=${1e3} /></span>
    <//>`:null}function ir(t){var e=t.store,n=t.refs,a=Q(e),i=Pe(a),s=(te[i]||te.idle).mode.toUpperCase();return j`
    <div style=${{flex:"1.05 1 0%",minHeight:0,position:"relative",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <canvas ref=${n.canvasRef} aria-hidden="true" style=${{position:"absolute",inset:0,width:"100%",height:"100%",display:"block"}} />
      <div style=${{position:"absolute",left:0,right:0,bottom:14,display:"flex",flexDirection:"column",alignItems:"center",gap:7,pointerEvents:"none"}}>
        <${Mt} s=${a} />
        <${xt} s=${a} />
      </div>
      <div style=${{position:"absolute",left:20,top:16,display:"flex",flexDirection:"column",gap:5,pointerEvents:"none"}}>
        <div className="hui-t-micro">INTELLIGENCE CORE</div>
        <div className="hui-t-micro">${(a.reducedMotion?"STATIC \xB7 ":"LATTICE \xB7 ")+s}</div>
      </div>
    </div>`}function or(t){return t==="user"?"YOU":t==="jarvis"?"JARVIS":"SYSTEM"}function Et(t){var e=t.turn;return j`
    <div style=${{display:"grid",gridTemplateColumns:"62px minmax(0,1fr)",gap:14,alignItems:"start"}}>
      <div style=${{display:"flex",flexDirection:"column",gap:3,paddingTop:2}}>
        <span className=${"hui-t-micro"+(e.role==="user"?" hui-t-accent":"")}>${or(e.role)}</span>
        <span className="hui-t-mono hui-t-micro">${e.time}</span>
      </div>
      <div style=${{minWidth:0}}>
        ${e.role==="system"?j`<div className=${"hui-t-mono"+(e.tone==="red"?" hui-t-danger":" hui-t-micro")}>${e.text}</div>`:e.role==="jarvis"?j`<div className=${e.dim?"hui-t-faint":"hui-t-body"} style=${{fontSize:16,lineHeight:1.55}}><${r.Markdown}>${e.text}<//></div>`:j`<div className=${e.dim?"hui-t-faint":"hui-t-body"} style=${{fontSize:16,lineHeight:1.55}}>${e.text}</div>`}
        ${e.meta&&e.meta.length?j`<${r.Row} gap="sm" style=${{marginTop:6}}>${e.meta.map(function(n,a){return j`<${r.Tag} key=${"m"+a} size="sm">${n}<//>`})}<//>`:null}
      </div>
    </div>`}function sr(t){var e=t.store,n=t.refs,a=Q(e);r.useEffect(function(){var u=n.logRef.current;u&&(u.scrollTop=u.scrollHeight)},[a.turns.length,a.mediatorText,a.sttPartial]);var i=a.turns.slice(-14),s=i.length===0&&!a.sttPartial&&!a.mediatorText;return j`
    <div ref=${n.logRef} role="log" aria-label="Conversation"
      style=${{flex:1,minHeight:132,overflowY:"auto",padding:"4px 22px 12px",display:"flex",flexDirection:"column",gap:14,borderTop:"1px solid var(--hui-line)"}}>
      ${s?j`<${r.EmptyState} compact icon="message" title="No turns yet" hint="Say something, or type a message below." />`:null}
      <${r.AnimatedList} items=${i} getKey=${function(u){return u.id}}>
        ${function(u){return j`<${Et} turn=${u} />`}}
      <//>
      ${a.sttPartial?j`
          <div style=${{display:"grid",gridTemplateColumns:"62px minmax(0,1fr)",gap:14,alignItems:"start"}} aria-live="polite">
            <span className="hui-t-micro hui-t-accent">YOU</span>
            <div className="hui-t-faint" style=${{fontSize:16,fontStyle:"italic"}}>${a.sttPartial}</div>
          </div>`:null}
      ${a.mediatorText?j`
          <div style=${{display:"grid",gridTemplateColumns:"62px minmax(0,1fr)",gap:14,alignItems:"start"}} aria-live="polite">
            <span className="hui-t-micro">JARVIS</span>
            <div className="hui-t-body" style=${{fontSize:16,lineHeight:1.55}}>
              <${r.StreamText} text=${a.mediatorText} streaming=${a.ttsPlaying} speed=${40} />
            </div>
          </div>`:null}
    </div>`}function tt(t){return j`
    <${r.IconButton}
      icon=${t.active?"minimize":"maximize"}
      label="Toggle fullscreen"
      variant=${t.active?"secondary":"ghost"}
      size=${t.mobile?"md":"sm"}
      title=${t.pseudo?"Pseudo-fullscreen (Fullscreen API unavailable on this browser)":"Toggle fullscreen"}
      onClick=${t.onClick} />`}function Ct(t){var e=t.s,n=t.act,a=t.refs,i=t.mobile,s=i?64:52;return j`
    <div style=${{position:"relative",flex:"none",width:s,height:s}}>
      <div ref=${i?a.micRingMobileRef:a.micRingRef} aria-hidden="true"
        style=${{position:"absolute",inset:-6,borderRadius:"999px",border:"1px solid var(--hui-accent)",opacity:0,transform:"scale(.9)",pointerEvents:"none"}} />
      <button type="button" onClick=${n.onMicClick} aria-label=${e.micActive?"Stop microphone":"Start microphone"} aria-pressed=${e.micActive}
        style=${{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:"999px",cursor:"pointer",border:"1px solid "+(e.micActive?"var(--hui-accent)":"var(--hui-line-strong)"),background:e.micActive?"radial-gradient(circle at 50% 35%, var(--hui-accent-ground-strong), var(--hui-surface))":"radial-gradient(circle at 50% 35%, var(--hui-surface-2), var(--hui-surface))",color:e.micActive?"var(--hui-text)":"var(--hui-text-dim)"}}>
        <${r.Icon} name="mic" size=${i?24:19} />
      </button>
    </div>`}function Rt(t){var e=t.store,n=t.s;return!n.micError&&!n.micHint?null:j`
    <${r.Banner} tone=${n.micError?"danger":"warn"} variant="inline" dismissible
      onDismiss=${function(){e.set({micError:null,micHint:null})}}>
      ${n.micError||n.micHint}
    <//>`}function lr(t){var e=t.store,n=t.act,a=t.refs,i=Q(e),s=r.useState(""),u=s[0],c=s[1],f=i.fsmState==="speaking"&&i.connection==="open";function d(){var h=u.trim();h&&(n.submitText(h),c(""))}return j`
    <div style=${{flex:"none",padding:"12px 22px 16px",borderTop:"1px solid var(--hui-line)"}}>
      <${r.Row} align="end" gap="md" wrap=${!1}>
        <${Ct} s=${i} act=${n} refs=${a} />
        <div style=${{flex:1,minWidth:0,display:"flex",flexDirection:"column",gap:7}}>
          <${r.Row} align="end" gap="sm" wrap=${!1}>
            <div style=${{flex:1,minWidth:0}}>
              <${r.Textarea}
                value=${u}
                onChange=${c}
                minRows=${1}
                maxRows=${4}
                placeholder="Type to Jarvis, or hold Space to talk…"
                onKeyDown=${function(h){h.key==="Enter"&&!h.shiftKey&&(h.preventDefault(),d())}} />
            </div>
            <${r.Button} variant="primary" onClick=${d}>Send<//>
            <${r.Button} variant="secondary" disabled=${!f} onClick=${n.interrupt}>Interrupt<//>
          <//>
          <${r.Row} align="center" gap="md" wrap=${!1}>
            <${r.Segmented}
              options=${[{value:"ptt",label:"Push to talk"},{value:"vad",label:"VAD (experimental)"}]}
              value=${i.micMode}
              onChange=${n.setMicMode} />
            <div style=${{flex:1,height:3,borderRadius:2,background:"var(--hui-line)",overflow:"hidden"}}>
              <div ref=${a.levelRef} style=${{height:"100%",width:"0%",borderRadius:2,background:"var(--hui-accent)"}} />
            </div>
            ${i.w>1100?j`<span className="hui-t-mono hui-t-micro" style=${{whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:4}}>
                  SPACE hold · ESC interrupt · 1·2·3 panels · <${r.Kbd} combo="mod+k" /> focus
                </span>`:null}
          <//>
          <${Rt} store=${e} s=${i} />
          <${r.Presence} show=${!!i.noSpeechHint} variant="fade">
            <div className="hui-t-faint" style=${{fontStyle:"italic"}} role="status" aria-live="polite">${i.noSpeechHint}</div>
          <//>
        </div>
      <//>
    </div>`}function mn(t){return j`
    <div style=${{minHeight:0,display:"flex",flexDirection:"column",position:"relative",minWidth:0}}>
      <${ar} store=${t.store} />
      <${ir} store=${t.store} refs=${t.refs} />
      <${sr} store=${t.store} refs=${t.refs} />
      <${lr} store=${t.store} act=${t.act} refs=${t.refs} />
    </div>`}function be(t){if(t==null||t==="")return null;if(typeof t=="number")return t>1e12?t:t>1e9?t*1e3:null;var e=Date.parse(t);return isNaN(e)?null:e}var ur={running:"accent",queued:"neutral",paused:"neutral",done:"ok",needs_review:"warn",failed:"danger",canceled:"neutral"};function rt(t){return{label:(t||"\u2014").replace(/_/g," "),tone:ur[t]||"neutral"}}function at(t){return{label:(t||"").toUpperCase()||"\u2014",tone:t==="codex"?"info":"neutral"}}function vn(t){var e=String(t||"").toLowerCase();return e.indexOf("error")>=0||e.indexOf("fail")>=0?"danger":e.indexOf("review")>=0||e.indexOf("cancel")>=0||e.indexOf("warn")>=0||e.indexOf("restart")>=0?"warn":e.indexOf("progress")>=0||e.indexOf("log")>=0?"neutral":"accent"}var cr={done:1,failed:1,needs_review:1,canceled:1};function it(t){return!!cr[t]}var nt={running:0,queued:1,paused:2,needs_review:3,done:4,failed:5,canceled:6};function dr(t){return Object.values(t||{}).sort(function(e,n){var a=nt[e.status]!=null?nt[e.status]:9,i=nt[n.status]!=null?nt[n.status]:9;return a!==i?a-i:(n.updated_ts||0)-(e.updated_ts||0)})}function ot(t){return Object.values(t||{}).filter(function(e){return e.status==="running"||e.status==="queued"||e.status==="paused"}).length}function pn(t,e){return Object.values(t||{}).filter(function(n){return hn(e,n.id)?!1:n.status==="running"||n.status==="queued"||n.status==="paused"||n.status==="needs_review"}).length}function hn(t,e){return!!(t&&Object.prototype.hasOwnProperty.call(t,e))}function He(t,e){return dr(t).filter(function(n){return!hn(e,n.id)})}var De=de+"/tasks",Ce=de+"/backends",Ue=de+"/credits";function $n(t){return de+"/tasks/"+encodeURIComponent(t)}function fr(t,e){return de+"/memory/search?q="+encodeURIComponent(t)+"&k="+(e||8)}function We(t){var e=Array.isArray(t)?t:t&&Array.isArray(t.tasks)?t.tasks:[],n={};return e.forEach(function(a){n[a.id]=a}),n}function st(){var t=r.useEndpoint(De);return Object.assign({},t,{tasks:We(t.data)})}function gn(t){var e=null;return r.mutate(De,function(n){var a=We(n);return a[t.id]=e=Object.assign({},a[t.id]||{},t,{updated_ts:Date.now()}),{tasks:Object.values(a)}}),e}function lt(){return r.useAction(function(t,e){return r.postJSON($n(t)+"/control",{action:e}).then(function(n){return n&&n.status&&r.mutate(De,function(a){var i=We(a);return i[t]&&(i[t]=Object.assign({},i[t],{status:n.status,updated_ts:Date.now()})),{tasks:Object.values(i)}}),n})},{onError:function(t){r.toast.error("Task action failed",{detail:r.errorMessage(t)})}})}function yn(t){return r.useEndpoint(t?$n(t):null)}function ut(){return r.useEndpoint(Ce)}function bn(){return r.useAction(function(t){var e=null;return r.mutate(Ce,function(n){return e=n&&n.active,Object.assign({},n,{active:t})}),r.postJSON(Ce,{backend:t}).then(function(n){return r.mutate(Ce,function(a){return Object.assign({},a,{active:n&&n.backend||t})}),n},function(n){throw r.mutate(Ce,function(a){return Object.assign({},a,{active:e})}),n})},{onError:function(t){r.toast.error("Couldn't set worker backend",{detail:r.errorMessage(t)})}})}function Oe(){return r.useEndpoint(Ue)}function kn(){return r.useAction(function(){return r.fetchJSON(Ue+"?refresh=true").then(function(t){return r.mutate(Ue,t),t})},{onError:function(t){r.toast.error("Couldn't refresh credits",{detail:r.errorMessage(t)})}})}function wn(t,e){var n=(t||"").trim();return r.useEndpoint(n?fr(n,e||8):null)}var ee=r.html;function mr(t){if(t==null||t==="")return null;var e=be(t);return e==null?String(t):r.format.relTime(e)}function vr(t){var e=t.hit,n=!!e.conflict,a=typeof e.score=="number"?e.score:0,i=mr(e.updated);return ee`
    <${r.Card} variant="default" padding="sm" tone=${n?"warn":void 0}>
      <${r.Row} justify="between" align="start" gap="sm">
        <span className="hui-t-body hui-t-clamp2" style=${{fontWeight:600}}>${e.title||e.path}</span>
        <span className="hui-t-num hui-t-accent">${a.toFixed(2)}</span>
      <//>
      ${e.path?ee`<div className="hui-t-mono hui-t-faint hui-t-truncate">${e.path}</div>`:null}
      <${r.Meter} value=${a*100} max=${100} size="sm" tone=${n?"warn":"accent"} valueText="" />
      ${e.snippet?ee`<div className="hui-t-sub" style=${{marginTop:6}}>${e.snippet}</div>`:null}
      <${r.Row} justify="between" align="center" gap="sm" style=${{marginTop:6}}>
        <span className="hui-t-micro">
          ${i?"updated "+i:""}
          ${typeof e.confidence=="number"?" \xB7 conf "+e.confidence.toFixed(2):""}
        </span>
        ${n?ee`<${r.Badge} tone="warn" icon="alert-triangle" size="sm">CONFLICT<//>`:null}
      <//>
    <//>`}function ct(t){var e=t.store,n=Q(e),a=r.useState(n.memQuery||""),i=a[0],s=a[1],u=wn(i),c=!!i.trim(),f=c?u.data&&u.data.hits||[]:n.memoryHits||[];return ee`
    <${r.Stack} gap="sm" style=${t.fill?{flex:1,minHeight:0}:void 0}>
      <${r.SearchInput}
        value=${n.memQuery||""}
        onChange=${function(d){e.set({memQuery:d})}}
        onSearch=${s}
        debounceMs=${250}
        loading=${c&&u.loading}
        placeholder="Search vault…"
        aria-label="Search Obsidian memory" />
      <div className="hui-t-micro">${c?"SEARCH RESULTS":"RECALLED FOR THIS TURN"}</div>
      ${f.length===0?c?u.loading?ee`<div className="hui-t-sub">Searching…</div>`:u.error?ee`<${r.ErrorState} compact title="Search failed" error=${u.error} onRetry=${u.reload} />`:ee`<div className="hui-t-sub">No matches in the vault.</div>`:ee`<${r.EmptyState} compact icon="brain" title="No recall this turn"
              hint="Memory is queried only when the mediator calls memory_recall." />`:ee`<${r.AnimatedList} items=${f} getKey=${function(d,h){return(d.path||"hit")+":"+h}}>
            ${function(d){return ee`<${vr} hit=${d} />`}}
          <//>`}
    <//>`}function Sn(t){var e=Q(t.store),n=(e.memoryHits||[]).length;return ee`
    <${r.Stack} gap="md" style=${{minHeight:0,padding:"16px"}}>
      <${r.Row} justify="between" align="center">
        <span className="hui-t-micro">MEMORY</span>
        <span className="hui-t-num hui-t-accent">${n?n+" HITS":"IDLE"}</span>
      <//>
      <${ct} store=${t.store} fill />
      <${r.Divider} />
      <${r.Row} justify="between">
        <span className="hui-t-micro">Obsidian vault · FTS5 + nomic-embed</span>
        <span className="hui-t-micro">read-only</span>
      <//>
    <//>`}function Tn(t){return ee`<${ct} store=${t.store} fill />`}var fe=r.html,pr={error:"danger",attention:"warn",info:"info"};function hr(t,e){return!!(t&&Object.prototype.hasOwnProperty.call(t,e))}function Mn(t){return(t.notices||[]).filter(function(e){return!hr(t.dismissedNotices,e.id)})}function ze(t){var e=Mn(t),n=!1,a=!1;return e.forEach(function(i){i.tone==="error"?n=!0:i.tone==="attention"&&(a=!0)}),{count:e.length,tone:n?"danger":a?"warn":null}}function dt(t){return t.tone?fe`<${r.StatusDot} tone=${t.tone} pulse />`:null}function $r(t){var e=[],n={};return t.forEach(function(a){var i=(a.tone||"info")+"|"+(a.approve?"1":"0")+"|"+(a.title||""),s=n[i];s||(s={key:i,tone:a.tone,title:a.title,approve:!!a.approve,items:[]},n[i]=s,e.push(s)),s.items.push(a)}),e}function gr(t){var e=t.group,n=t.act,a=t.mobile,i=lt(),s=e.items.length===1,u=e.items[0];function c(T){T.taskId?i.run(T.taskId,"resume").then(function(){n.resolveNotice(T.id,!0)},function(){}):n.resolveNotice(T.id,!0)}function f(T){n.resolveNotice(T.id,!1)}function d(T){T.approve?f(T):n.dismissNotice(T.id)}var h=null;if(s&&u.approve)h=fe`
      <${r.Row} gap="sm">
        <${r.Button} size="sm" variant="primary" loading=${i.pending} onClick=${function(){c(u)}}>Approve<//>
        <${r.Button} size="sm" variant="danger" onClick=${function(){f(u)}}>Decline<//>
      <//>`;else if(!s){var k=[];e.approve&&k.push(fe`<${r.Button} key="aa" size="sm" variant="primary" loading=${i.pending}
        onClick=${function(){e.items.forEach(c)}}>Approve all<//>`),k.push(fe`<${r.Button} key="da" size="sm" variant="secondary"
      onClick=${function(){e.items.forEach(d)}}>Dismiss all<//>`),h=fe`<${r.Row} gap="sm">${k}<//>`}return fe`
    <${r.NotificationCard}
      severity=${pr[e.tone]||"info"}
      title=${e.title}
      body=${s?u.body:void 0}
      time=${s&&!a?u.ts:void 0}
      count=${e.items.length}
      items=${s?void 0:e.items.map(function(T){var O=T.approve?fe`
              <${r.Row} gap="xs">
                <${r.Button} size="sm" variant="primary" loading=${i.pending} onClick=${function(){c(T)}}>Approve<//>
                <${r.Button} size="sm" variant="danger" onClick=${function(){f(T)}}>Decline<//>
              <//>`:void 0;return{id:T.id,label:T.body||T.title,actions:O}})}
      actions=${h}
      onDismiss=${function(){e.items.forEach(d)}}
    />`}function ft(t){var e=t.s,n=t.act,a=t.mobile,i=Mn(e);if(!i.length)return null;var s=$r(i);return fe`
    <${r.Stack} gap="sm">
      <div className="hui-t-micro">
        ${r.format.plural(i.length,"notification")}${s.length<i.length?" \xB7 "+r.format.plural(s.length,"group"):""}
      </div>
      ${s.map(function(u){return fe`<${gr} key=${u.key} group=${u} act=${n} mobile=${a} />`})}
    <//>`}var B=r.html;function yr(t){var e=t.payload,n="";if(e!=null)if(typeof e=="string")n=e;else if(e.message)n=e.message;else if(e.note)n=e.note;else try{n=JSON.stringify(e)}catch{n=""}var a=t.type||t.kind||"event";return n?a+" \xB7 "+n:a}function br(t){var e=t&&(t.task||t)||{};return{events:t&&(t.events||t.task_events)||e.events||[],result_text:e.result_text||"",result_summary:e.result_summary||"",session_id:e.session_id||e.session||""}}function kr(t){var e=t.detail;return B`
    <${r.DataState} state=${e} emptyText="No task detail" compact>
      ${function(n){var a=br(n),i=a.events||[],s=a.result_text||a.result_summary||"";return B`
          <${r.Stack} gap="sm">
            <div className="hui-t-micro">EVENT TIMELINE</div>
            ${i.length===0?B`<div className="hui-t-sub">No events recorded for this task.</div>`:B`<${r.ActivityFeed} items=${i.map(function(u,c){return{id:c,at:be(u.ts)||Date.now(),title:yr(u),tone:vn(u.type)}})} />`}
            ${s?B`<${r.Stack} gap="sm"><div className="hui-t-micro">RESULT</div><${r.CodeBlock} maxHeight=${160}>${s}<//><//>`:null}
            <${r.KeyValue} label="Session" value=${a.session_id||"\u2014"} mono copyable=${!!a.session_id} />
          <//>`}}
    <//>`}function xn(t){var e=t.task,n=t.act,a=t.mobile,i=rt(e.status),s=at(e.kind),u=e.status==="running",c=e.progress_note||e.result_summary||"",f=lt(),d=r.useState(!1),h=yn(!a&&d[0]?e.id:null),k=null;if(e.status==="done"){var T=be(e.started),O=be(e.finished);T&&O&&O>T&&(k="took "+r.format.duration(O-T))}else{var $=be(e.started)||be(e.created)||e.updated_ts;$&&(k=B`<${r.RelTime} at=${$} />`)}var A=[];return e.status==="running"&&A.push({label:"Pause",variant:"secondary",run:"pause"}),e.status==="paused"&&A.push({label:"Resume",variant:"primary",run:"resume"}),(e.status==="running"||e.status==="paused"||e.status==="queued")&&A.push({label:"Cancel",variant:"danger",run:"cancel"}),e.status==="needs_review"&&A.push({label:"Re-delegate",variant:"primary",run:"resume"}),it(e.status)&&A.push({label:"Dismiss",variant:"secondary",run:"dismiss"}),B`
    <${r.Card} padding="sm" tone=${e.status==="needs_review"?"warn":void 0}>
      <${r.Row} justify="between" align="center" gap="sm">
        <${r.Badge} tone=${i.tone}>${i.label}<//>
        <${r.Row} gap="sm" align="center">
          <${r.Badge} tone=${s.tone} variant="outline" size="sm">${s.label}<//>
          ${k?B`<span className="hui-t-num hui-t-micro">${k}</span>`:null}
        <//>
      <//>
      <div className="hui-t-body" style=${{marginTop:8,fontWeight:600}}>${e.title||e.goal||e.id}</div>
      ${u?B`<${r.Meter} indeterminate size="sm" style=${{marginTop:8}} />`:null}
      ${c?B`<div className="hui-t-sub" style=${{marginTop:8}}>${c}</div>`:null}
      <${r.Row} gap="sm" style=${{marginTop:10}}>
        ${A.map(function(w){var S=f.pending&&w.run!=="dismiss";return B`
            <${r.Button} key=${w.label} size=${a?"md":"sm"} variant=${w.variant} loading=${w.run!=="dismiss"&&S}
              onClick=${function(){w.run==="dismiss"?n.dismissTask(e.id):f.run(e.id,w.run)}}>${w.label}<//>`})}
      <//>
      ${a?null:B`
          <${r.Disclosure} title="Detail" open=${d[0]} onOpenChange=${d[1]} className="jv-task-detail">
            ${d[0]?B`<${kr} detail=${h} />`:null}
          <//>`}
    <//>`}function En(t){return B`<${xn} task=${t.task} act=${t.act} mobile />`}function _t(t){var e=t.items.slice().reverse();return B`
    <${r.ActivityFeed} items=${e.map(function(n){return{id:n.id,at:n.ts,title:n.label,tone:n.tone,body:t.verbose?n.detail:void 0}})} />`}function wr(t){var e=t.store,n=t.s;return B`
    <${r.Stack} gap="sm">
      <${r.Row} justify="between" align="center">
        <${r.Button} size="sm" variant=${n.verbose?"primary":"secondary"} aria-pressed=${n.verbose}
          onClick=${function(){e.set({verbose:!n.verbose})}}>
          ${n.verbose?"Trace detail: on":"Trace detail: off"}
        <//>
        <span className="hui-t-num hui-t-micro">${r.format.plural(n.timeline.length,"event")}</span>
      <//>
      ${n.timeline.length===0?B`<${r.EmptyState} compact icon="activity" title="Nothing yet this session" />`:B`<${_t} items=${n.timeline} verbose=${n.verbose} />`}
    <//>`}var Sr=[["stt","stt final"],["mediator_first_token","mediator first token"],["tts_first_chunk","tts first chunk"],["e2e_first_audio","end-to-end first audio"]];function Tr(t){var e=t.s,n=t.act,a=e.health||{},i=a.components||{},s=Object.keys(i),u=a.models||{},c=a.ram||{},f=typeof c.free_gb=="number"?c.free_gb:null,d=typeof c.total_gb=="number"?c.total_gb:null;return B`
    <${r.Stack} gap="sm">
      <${r.Card} title="Component health" padding="sm">
        ${s.length===0?B`<${r.EmptyState} compact title="Waiting for /health…" />`:B`<${r.List} dense items=${s.map(function(h){var k=i[h]||{};return{id:h,leading:B`<${r.StatusDot} tone=${k.ok?"accent":"danger"} />`,title:h,description:k.detail||"",trailing:B`<${r.Badge} tone=${k.ok?"ok":"danger"} size="sm">${k.ok?"OK":"ERR"}<//>`}})} />`}
      <//>
      <${r.Card} title="Latency · last 20 turns" padding="sm">
        <${r.Stack} gap="md">
          ${Sr.map(function(h){var k=h[0],T=e.latency[k],O=n.getSeries(k);return B`
              <div key=${k}>
                <${r.Row} justify="between" align="baseline">
                  <span className="hui-t-sub" style=${{flex:1}}>${h[1]}</span>
                  <span className="hui-t-num">${T&&T.p50!=null?T.p50+" ms":"\u2014"}</span>
                  <span className="hui-t-num hui-t-faint">${T&&T.p95!=null?T.p95+" ms":"\u2014"}</span>
                <//>
                <${r.Sparkline} data=${O} height=${18} tone=${k==="e2e_first_audio"?"accent":!1} />
              </div>`})}
        <//>
      <//>
      <${r.Card} title="Residency & memory" padding="sm">
        <${r.Stack} gap="sm">
          <${r.KVList} items=${["mediator","worker"].map(function(h){var k=u[h]||{};return{label:h,value:(k.name||h+" \u2014")+(k.resident?" \xB7 resident":" \xB7 on demand")}})} />
          <${r.Meter}
            label="Unified memory"
            value=${f!=null&&d?d-f:0}
            max=${d||1}
            indeterminate=${f==null||!d}
            valueText=${f==null?"\u2014":f.toFixed(1)+" GB free"+(d?" / "+d+" GB":"")} />
        <//>
      <//>
      <${r.KpiRow} size="sm" items=${[{label:"Barge-ins",value:e.bargeIns,sub:"this session"},{label:"Errors",value:e.errCount,sub:"recoverable"}]} />
    <//>`}function Cn(t){var e=t.store,n=t.act,a=Q(e),i=st(),s=t.showLeft,u=ze(a),c=[{id:"work",label:B`<${r.Row} gap="sm" align="center"><${dt} tone=${u.tone} /><span>Work</span><//>`,badge:ot(i.tasks)||void 0},{id:"activity",label:"Activity",badge:a.timeline.length||void 0}];s||c.push({id:"memory",label:"Memory",badge:(a.memoryHits||[]).length||void 0}),c.push({id:"system",label:"System"});var f=s&&a.tab==="memory"?"work":a.tab,d=He(i.tasks,a.dismissedTasks);return B`
    <div style=${{minHeight:0,display:"flex",flexDirection:"column",borderLeft:"1px solid var(--hui-line)"}}>
      <${r.Tabs} className="jv-work-tabs" items=${c} value=${f} onChange=${function(h){e.set({tab:h})}}
        ariaLabel="Work panels" idPrefix="jv-work" />
      <${r.ScrollArea} style=${{flex:1,minHeight:0,padding:"10px 14px 14px"}}>
        <${r.TabPanel} when="work" value=${f} idPrefix="jv-work">
          <${r.ErrorBoundary}>
            <${r.Stack} gap="sm">
              <${ft} s=${a} act=${n} />
              <${r.DataState} state=${i} empty=${function(){return d.length===0&&!u.count}}
                emptyText="No tasks yet. Delegate something.">
                ${function(){return B`<${r.AnimatedList} items=${d} getKey=${function(h){return h.id}}>
                  ${function(h){return B`<${xn} task=${h} act=${n} />`}}
                <//>`}}
              <//>
            <//>
          <//>
        <//>
        <${r.TabPanel} when="activity" value=${f} idPrefix="jv-work">
          <${r.ErrorBoundary}><${wr} store=${e} s=${a} /><//>
        <//>
        ${s?null:B`<${r.TabPanel} when="memory" value=${f} idPrefix="jv-work"><${r.ErrorBoundary}><${ct} store=${e} fill /><//><//>`}
        <${r.TabPanel} when="system" value=${f} idPrefix="jv-work">
          <${r.ErrorBoundary}><${Tr} s=${a} act=${n} /><//>
        <//>
      <//>
    </div>`}var W=r.html,Ke={local:{name:"Local",caption:"\u22482\u20136 s \xB7 64k ctx \xB7 no spend",sub:"gpt-oss-20b \xB7 free \xB7 on-box",tier:"free"},cloud:{name:"Cloud",caption:"\u22481\u20133 s \xB7 $ per call \xB7 weekly cap",sub:"cloud \xB7 uses limit",tier:"limit"},codex:{name:"Codex",caption:"\u22484\u201320 s \xB7 coding agent \xB7 sub credits",sub:"codex \xB7 weekly credits",tier:"sub"},claude:{name:"Claude Code",caption:"\u22484\u201320 s \xB7 coding agent \xB7 weekly + session",sub:"claude \xB7 weekly + session",tier:"sub"}},Mr=["local","cloud","codex","claude"],xr="Selection applies to delegated tasks and tool calls. Mediator, transcription and speech always stay on-box.";function At(t){return Ke[t]||{name:t,caption:"",sub:"",tier:"sub"}}function Er(t,e){var n=t&&Array.isArray(t.backends)?t.backends:Mr;return n.filter(function(a){return Ke[a]||e&&e.backends&&e.backends[a]})}function Nt(t,e){return t&&t.backends&&t.backends[e]||null}function Cr(t,e){return e?"refreshing":t.loading?"loading":t.error&&!t.data?"error":t.stale||t.data&&t.data.stale?"stale":"ok"}function Rr(t,e){if(e==="refreshing")return"checking\u2026";if(e==="loading")return"";if(e==="error")return"check failed";var n=t.data&&t.data.checked_epoch;return n?"checked "+r.format.relTime(n*1e3):e==="stale"?"stale":""}function It(t){return W`<${r.Badge} tone=${t==="free"?"ok":"warn"} size="sm">${(t||"sub").toUpperCase()}<//>`}function _r(t){var e=t.note||"",n=e.split("\xB7").map(function(s){return s.trim()}),a=n[0]||(t.tier==="free"?"no spend":(t.tier||"").toUpperCase()),i=n.slice(1).join(" \xB7 ");return W`
    <div style=${{textAlign:"center",width:t.mobile?88:96,flex:"none"}}>
      <div className=${"hui-t-mono"+(t.tier==="free"?" hui-t-ok":" hui-t-dim")} style=${{fontSize:11}}>${a}</div>
      ${i?W`<div className="hui-t-mono hui-t-micro" style=${{fontSize:9}}>${i}</div>`:null}
    </div>`}function Ar(t){var e=t.id,n=t.backends,a=t.credits,i=t.phase,s=t.selectBackend,u=t.mobile,c=t.act,f=At(e),d=Nt(a,e),h=n.active===e||!n.active&&e==="local",k=!n.available||n.available[e]!==!1,T=d&&d.tier||f.tier,O=d&&d.note,$=d&&d.gauges||[],A=!!d&&d.available===!1,w;if(A)w=W`<${r.SpeedGauge} label=${f.name} value="unavailable" sub=${O} small=${u} />`;else if($.length){var S=$.map(function(N,L){return W`<${r.SpeedGauge} key=${N.label||"g"+L} label=${N.label} remaining=${N.remaining_pct}
        value=${N.value_label} sub=${i==="stale"?"stale \xB7 refresh":r.format.untilTime(N.reset_epoch?N.reset_epoch*1e3:null)}
        loading=${i==="loading"||i==="refreshing"} small=${u} />`});w=S.length>1?W`<${r.Stack} gap="xs">${S}<//>`:S[0]}else!d&&(i==="loading"||i==="refreshing")?w=W`<${r.SpeedGauge} label=${f.name} loading small=${u} />`:w=W`<${_r} note=${O} tier=${T} mobile=${u} />`;var F=f.caption+(O&&$.length?" \xB7 "+O:""),_=W`
    <${r.Row} gap="sm" align="center">
      <span style=${{fontWeight:600}}>${f.name}</span>
      ${It(T)}
    <//>`;return W`
    <${r.ListItem}
      leading=${W`<${r.StatusDot} tone=${h?"accent":k?"neutral":"danger"} />`}
      title=${_}
      description=${F}
      trailing=${w}
      selected=${h}
      style=${{opacity:k?1:.6,cursor:k?"pointer":"not-allowed",minHeight:u?44:void 0}}
      onClick=${k?function(){s.run(e),c.log("backend","Worker backend set to "+f.name+(f.sub?" \xB7 "+f.sub:""),null,e==="local"?"info":"warn"),t.onPicked&&t.onPicked()}:void 0} />`}function Nr(t){return W`
    <${r.Button} size=${t.mobile?"md":"sm"} variant="secondary" icon="refresh" loading=${t.refreshing} onClick=${t.onClick}>
      Refresh
    <//>`}function Rn(t){var e=t.mobile,n=t.act,a=ut(),i=Oe(),s=bn(),u=kn(),c=a.data||{},f=i.data||{},d=Cr(i,u.pending);return W`
    <${r.Stack} gap="sm">
      <${r.Row} justify="between" align="center">
        <span className="hui-t-micro">${e?"":"WORKER BACKEND"}</span>
        <${r.Row} gap="sm" align="center">
          <span className="hui-t-micro">${Rr(i,d)}</span>
          <${Nr} mobile=${e} refreshing=${d==="refreshing"}
            onClick=${function(){u.run(),n.log("credits","Checked subscription credits","manual refresh \xB7 not polled","info")}} />
        <//>
      <//>
      ${Er(c,f).map(function(h){return W`<${Ar} key=${h} id=${h} backends=${c} credits=${f} phase=${d}
          selectBackend=${s} act=${n} mobile=${e} onPicked=${t.onPicked} />`})}
      <div className="hui-t-micro" style=${{lineHeight:1.5}}>${xr}</div>
    <//>`}function _n(t){var e=t.act,n=ut(),a=Oe(),i=n.data||{},s=a.data||{},u=i.active||"local",c=At(u),f=Nt(s,u),d=f&&f.tier||c.tier,h=!i.available||i.available[u]!==!1;return W`
    <${r.Popover} placement="bottom" align="end" panelClassName="jv-backend-pop"
      trigger=${W`
        <button type="button" className="hui-btn hui-btn--secondary hui-btn--sm" aria-label="Choose worker backend">
          <${r.StatusDot} tone=${h?"accent":"danger"} />
          <span style=${{display:"flex",flexDirection:"column",alignItems:"flex-start",lineHeight:1.15}}>
            <span className="hui-t-micro">BACKEND</span>
            <span style=${{fontWeight:600}}>${c.name}</span>
          </span>
          ${It(d)}
        </button>`}>
      ${function(k){return W`<div style=${{width:320}}><${Rn} act=${e} onPicked=${k.close} /></div>`}}
    <//>`}function An(t){var e=ut(),n=Oe(),a=e.data||{},i=a.active||"local",s=At(i),u=Nt(n.data,i),c=u&&u.tier||s.tier;return W`
    <button type="button" onClick=${t.onClick} aria-label="Worker backend and credits"
      className="hui-btn hui-btn--secondary hui-btn--sm"
      style=${t.attention?{borderColor:"var(--hui-warn)"}:void 0}>
      <${r.StatusDot} tone="accent" />
      <span style=${{fontWeight:600}}>${s.name}</span>
      ${It(c)}
    </button>`}function Nn(t){return W`<${Rn} act=${t.act} mobile />`}var G=r.html;function Ir(t){var e=t.s,n=He(t.tasks,e.dismissedTasks),a=n.filter(function(u){return u.status==="running"})[0]||n.filter(function(u){return u.status==="needs_review"})[0];if(!a)return null;var i=rt(a.status),s=at(a.kind);return G`
    <${r.Card} padding="sm" style=${{margin:"2px 12px 0"}}>
      <${r.Row} justify="between" align="center">
        <${r.Badge} tone=${i.tone}>${i.label}<//>
        <${r.Badge} tone=${s.tone} variant="outline" size="sm">${s.label}<//>
      <//>
      <div className="hui-t-body" style=${{marginTop:6,fontWeight:600}}>${a.title||a.goal||a.id}</div>
      ${a.progress_note||a.result_summary?G`<div className="hui-t-sub" style=${{marginTop:5}}>${a.progress_note||a.result_summary}<//>`:null}
    <//>`}function Pr(t){var e=t.s,n=t.refs;r.useEffect(function(){var s=n.logRef.current;s&&(s.scrollTop=s.scrollHeight)},[e.turns.length,e.mediatorText,e.sttPartial]);var a=e.turns.slice(-10),i=a.length===0&&!e.sttPartial&&!e.mediatorText;return G`
    <div ref=${n.logRef} role="log" aria-label="Conversation"
      style=${{flex:1,minHeight:0,overflowY:"auto",padding:"12px 16px 8px",display:"flex",flexDirection:"column",gap:12}}>
      ${i?G`<${r.EmptyState} compact icon="message" title="No turns yet" hint="Say something, or type below." />`:null}
      ${a.map(function(s){return G`<${Et} key=${s.id} turn=${s} />`})}
      ${e.sttPartial?G`
          <div aria-live="polite">
            <span className="hui-t-micro hui-t-accent">YOU</span>
            <div className="hui-t-faint" style=${{marginTop:4,fontSize:15,fontStyle:"italic"}}>${e.sttPartial}</div>
          </div>`:null}
      ${e.mediatorText?G`
          <div aria-live="polite">
            <span className="hui-t-micro">JARVIS</span>
            <div className="hui-t-body" style=${{marginTop:4,fontSize:15}}><${r.StreamText} text=${e.mediatorText} streaming=${e.ttsPlaying} /></div>
          </div>`:null}
    </div>`}function Dr(t){var e=t.s,n=t.act,a=t.store,i=He(t.tasks,e.dismissedTasks);return e.sheet==="tasks"?G`
      <${r.Stack} gap="sm">
        <${ft} s=${e} act=${n} mobile />
        ${i.length===0&&!ze(e).count?G`<${r.EmptyState} compact title="No tasks yet" />`:i.map(function(s){return G`<${En} key=${s.id} task=${s} act=${n} />`})}
      <//>`:e.sheet==="backend"?G`<${Nn} act=${n} />`:e.sheet==="memory"?G`<${Tn} store=${a} />`:e.sheet==="activity"?e.timeline.length===0?G`<${r.EmptyState} compact title="Nothing yet this session" />`:G`<${_t} items=${e.timeline} verbose=${!1} />`:null}var Or={tasks:"Tasks & notifications",memory:"Memory",backend:"Worker backend",activity:"Activity"};function In(t){var e=t.store,n=t.act,a=t.refs,i=Q(e),s=st(),u=r.useState(""),c=u[0],f=u[1],d=i.fsmState==="speaking"&&i.connection==="open",h=ze(i);function k(){var $=c.trim();$&&(n.submitText($),f(""))}function T(){e.set({sheet:null})}var O=[{id:"tasks",label:"Tasks",count:pn(s.tasks,i.dismissedTasks),tone:h.tone},{id:"memory",label:"Memory",count:(i.memoryHits||[]).length},{id:"activity",label:"Activity",count:i.timeline.length}];return G`
    <div style=${{position:"absolute",inset:0,display:"flex",flexDirection:"column",paddingTop:"var(--jv-fs-top-clear, 0px)"}}>
      <${r.Row} align="center" gap="sm" style=${{padding:"14px 16px 10px",flex:"none"}}>
        <span className="hui-dot hui-dot--accent" aria-hidden="true" />
        <span className="hui-t-title">JARVIS</span>
        <div style=${{flex:1}} />
        <${An} act=${n} attention=${!!h.tone} onClick=${function(){e.set({sheet:"backend"})}} />
        <${tt} active=${i.fullscreen||i.pseudoFullscreen} pseudo=${i.pseudoFullscreen} onClick=${n.toggleFullscreen} mobile />
        <${r.StatusDot} tone=${i.connection==="open"?"accent":i.connection==="closed"?"danger":"warn"} pulse=${i.connection!=="open"} label=${"Connection: "+i.connection} />
      <//>
      <div style=${{flex:"0 1 214px",minHeight:118,position:"relative"}}>
        <canvas ref=${a.canvasRef} aria-hidden="true" style=${{position:"absolute",inset:0,width:"100%",height:"100%",display:"block"}} />
      </div>
      <div style=${{flex:"none",display:"flex",flexDirection:"column",alignItems:"center",gap:4,padding:"2px 16px 8px",pointerEvents:"none"}}>
        <${Mt} s=${i} mobile />
        <${xt} s=${i} />
      <//>
      <${Ir} s=${i} tasks=${s.tasks} />
      <${Pr} s=${i} refs=${a} />
      <div style=${{flex:"none",padding:"8px 12px calc(12px + env(safe-area-inset-bottom))",borderTop:"1px solid var(--hui-line)"}}>
        <${r.Row} gap="sm" wrap=${!1}>
          ${O.map(function($){return G`
              <${r.Button} key=${$.id} variant="secondary" size="md" block onClick=${function(){e.set({sheet:$.id})}}>
                ${$.tone?G`<${dt} tone=${$.tone} />`:null} ${$.label}${$.count?" "+$.count:""}
              <//>`})}
        <//>
        <${r.Row} align="end" gap="sm" style=${{marginTop:10}} wrap=${!1}>
          <div style=${{flex:1,minWidth:0}}>
            <${r.Textarea} value=${c} onChange=${f} minRows=${1} maxRows=${3} placeholder="Message Jarvis…"
              onKeyDown=${function($){$.key==="Enter"&&!$.shiftKey&&($.preventDefault(),k())}} />
          </div>
          <${r.Button} variant="secondary" disabled=${!d} onClick=${n.interrupt}>Stop<//>
          <${Ct} s=${i} act=${n} refs=${a} mobile />
        <//>
        <${Rt} store=${e} s=${i} />
        <${r.Presence} show=${!!i.noSpeechHint} variant="fade">
          <div className="hui-t-faint" style=${{fontStyle:"italic",marginTop:6}} role="status" aria-live="polite">${i.noSpeechHint}</div>
        <//>
      </div>
      <${r.Sheet} open=${!!i.sheet} onClose=${T} title=${Or[i.sheet]||""} snapPoints=${[.62,.92]}>
        <${Dr} s=${i} act=${n} store=${e} tasks=${s.tasks} />
      <//>
    </div>`}var Z=r.html,Lr=200,Br=40,Fr=15e3,jr=860,Hr=1280,Ur=20,Pn="jarvis-voice:dismissedNotices",Dn=100,Wr={failed:{tone:"error",title:"Task failed"},needs_review:{tone:"attention",title:"Needs review"}};function On(t){var e=Wr[t.status];return e?{id:"task:"+t.id+":"+t.status,tone:e.tone,title:e.title+" \xB7 "+(t.title||t.goal||t.id),body:t.result_summary||t.progress_note||(t.status==="needs_review"?"Waiting for your review \u2014 approve to re-delegate, or decline.":""),ts:Date.now(),taskId:t.id,approve:t.status==="needs_review"}:null}function zr(t,e){try{var n=window.localStorage.getItem(t);return n===null?e:n==="1"}catch{return e}}function Kr(t,e){try{window.localStorage.setItem(t,e?"1":"0")}catch{}}function Gr(t,e){try{var n=window.localStorage.getItem(t);return n===null?e:parseFloat(n)}catch{return e}}var Pt="jarvis-voice:dismissedTasks";function Ln(t,e){try{var n=window.localStorage.getItem(t);if(n===null)return e;var a=JSON.parse(n);return a&&typeof a=="object"?a:e}catch{return e}}function Dt(t,e){try{window.localStorage.setItem(t,JSON.stringify(e))}catch{}}function Bn(t){if(!t)return!1;var e=t.tagName;return e==="INPUT"||e==="TEXTAREA"||t.isContentEditable}function Jr(t){return String(t).replace(/_/g," ").replace(/^./,function(e){return e.toUpperCase()})}function ke(t){if(t==null)return"";if(typeof t=="string")return t;try{return JSON.stringify(t,null,2)}catch{return String(t)}}function qr(t){return Math.min(1e3*Math.pow(2,Math.max(0,t-1)),1e4)}function jn(){return!!(document.fullscreenElement||document.webkitFullscreenElement)}function Vr(t){return!!(t&&(t.requestFullscreen||t.webkitRequestFullscreen))}function Fn(t){var e=t&&t.get();if(jn()){document.exitFullscreen?document.exitFullscreen():document.webkitExitFullscreen&&document.webkitExitFullscreen();return}if(e&&e.pseudoFullscreen){t.set({pseudoFullscreen:!1});return}var n=document.getElementById("jarvis-voice-root");if(n){if(Vr(n)){var a=n.requestFullscreen?n.requestFullscreen():n.webkitRequestFullscreen();a&&typeof a.catch=="function"&&a.catch(function(){console.info("[jarvis-voice] requestFullscreen() was rejected \u2014 falling back to pseudo-fullscreen."),t&&t.set({pseudoFullscreen:!0})});return}console.info("[jarvis-voice] Fullscreen API unavailable on this browser (likely iOS Safari) \u2014 using pseudo-fullscreen instead."),t&&t.set({pseudoFullscreen:!0})}}var Yr={position:"fixed",inset:0,top:0,left:0,margin:0,width:"100vw",height:"100dvh",zIndex:2147483647},Xr="radial-gradient(120% 90% at 50% 0%, var(--hui-surface-2) 0%, var(--hui-bg) 55%, var(--hui-bg) 100%)";function Ot(){var t=r.useRef(null);t.current||(t.current=nn({connection:"connecting",offline:!1,fsmState:"idle",fsmDetail:null,sttPartial:"",sttFinal:"",mediatorText:"",ttsPlaying:!1,micActive:!1,micMode:"ptt",reducedMotion:zr("jarvis-voice:reducedMotion",!!(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches)),volume:Gr("jarvis-voice:volume",1),timeline:[],dismissedTasks:Ln(Pt,{}),memoryHits:[],health:null,latency:{},micError:null,micHint:null,notices:[],dismissedNotices:Ln(Pn,{}),tab:"work",sheet:null,verbose:!1,w:typeof window<"u"?window.innerWidth:1440,turns:[],speakingText:"",toolChip:null,turnId:null,turnLatency:{},memQuery:"",bargeIns:0,errCount:0,retryAttempt:0,retryAt:0,lastEventTs:0,offlineDismissed:!1,fullscreen:typeof document<"u"&&!!(document.fullscreenElement||document.webkitFullscreenElement),pseudoFullscreen:!1,noSpeechHint:null}));var e=t.current,n=Q(e),a=r.useRef(null);a.current||(a.current={canvasRef:{current:null},logRef:{current:null},levelRef:{current:null},micRingRef:{current:null},micRingMobileRef:{current:null},composerInputRef:{current:null}});var i=a.current,s=r.useRef(null),u=r.useRef(null),c=r.useRef(null),f=r.useRef(null);f.current||(f.current=rn(20));var d=r.useRef({start:function(){},stop:function(){}}),h=r.useRef([]),k=r.useRef(""),T=r.useRef(0),O=r.useRef(0),$=r.useRef(null);function A(p,g,y,C){e.set(function(D){return{timeline:Tt(D.timeline,{id:p+":"+Date.now()+":"+Math.random(),ts:Date.now(),type:p,label:g,detail:ke(y),tone:C||"neutral"},Lr)}})}function w(p,g,y,C){e.set(function(D){return{turns:Tt(D.turns,{id:p+":"+Date.now()+":"+Math.random(),role:p,text:g,time:r.format.clockTime(Date.now()),meta:y||[],dim:!!(C&&C.dim),tone:C&&C.tone||null},Br)}})}function S(p){p&&e.set(function(g){if(g.dismissedNotices&&Object.prototype.hasOwnProperty.call(g.dismissedNotices,p.id))return{};var y=(g.notices||[]).filter(function(C){return C.id!==p.id});return{notices:[p].concat(y).slice(0,Ur)}})}function F(p){e.set(function(g){var y=Object.assign({},g.dismissedNotices);y[p]=Date.now();var C=Object.keys(y);return C.length>Dn&&C.sort(function(D,J){return y[D]-y[J]}).slice(0,C.length-Dn).forEach(function(D){delete y[D]}),Dt(Pn,y),{dismissedNotices:y,notices:(g.notices||[]).filter(function(D){return D.id!==p})}})}function _(p){var g=e.get(),y=(g.mediatorText||"").trim();if(y){var C=h.current.slice();p==="interrupted"&&C.push("interrupted");var D=g.turnLatency&&g.turnLatency.e2e_first_audio;typeof D=="number"&&C.push("e2e "+(D/1e3).toFixed(2)+" s"),w("jarvis",y,C),h.current=[],e.set({mediatorText:"",speakingText:""})}}function N(){h.current=[],e.set({turnLatency:{}})}function L(p,g){typeof g=="number"&&(f.current.record(p,g),e.set(function(y){var C=Object.assign({},y.turnLatency);return C[p]=g,{latency:f.current.summary(),turnLatency:C}}))}function U(p){if(p.length){var g=++T.current,y=k.current||p[0].title||p[0].path||"";y&&Qe("/memory/search?q="+encodeURIComponent(y)+"&k="+Math.max(p.length,3)).then(function(C){if(g===T.current){var D={};(C&&C.hits||[]).forEach(function(H){H&&H.path&&(D[H.path]=H)});var J=p.map(function(H){return Object.assign({},D[H.path]||{},H)});e.set({memoryHits:J})}}).catch(function(){})}}function V(){clearTimeout($.current),e.set({noSpeechHint:"Didn't catch that."}),$.current=setTimeout(function(){e.set({noSpeechHint:null})},3e3)}function Re(p){r.fetchJSON(De).then(function(g){r.mutate(De,g);var y=We(g);if(Object.values(y).forEach(function(D){D.status==="needs_review"&&S(On(D))}),p){var C=ot(y);w("system","Session resumed \xB7 "+C+" open task"+(C===1?"":"s")+" replayed from jarvis.db")}}).catch(function(){}),Qe("/health").then(function(g){e.set({health:g})}).catch(function(){}),r.invalidate(Ce),r.invalidate(Ue)}r.useEffect(function(){var p=sn();p.setGain(e.get().volume),c.current=p;var g=0,y=!1,C=null,D=0,J=on({onChunk:function(o){var v=u.current;v&&v.sendBinary(o)},onLevel:function(o){var v=e.get().micActive,b=v?o:0;g=o,s.current&&s.current.onMicLevel(b),D+=(Math.min(1,b)-D)*.35,i.levelRef.current&&(i.levelRef.current.style.width=Math.round(Math.min(1,b)*100)+"%"),[i.micRingRef.current,i.micRingMobileRef.current].forEach(function(I){I&&(I.style.opacity=v?String(.25+D*.7):"0",I.style.transform="scale("+(v?1+D*.16:.9)+")")})},onError:function(o){e.set({micError:o}),A("error",o,null,"danger")}});function H(){clearTimeout(C),y=!1,e.set({micHint:null}),C=setTimeout(function(){e.get().micActive&&J.getChunkCount()>0&&g<.02&&!y&&e.set({micHint:"Mic level is silent \u2014 check input device/permissions."})},2e3)}var le=setTimeout(function(){e.get().connection!=="open"&&e.set({offline:!0})},1500);function ve(o){if(!(!o||!o.t))switch(O.current=Date.now(),o.turn_id!=null&&o.turn_id!==e.get().turnId&&o.t!=="tts.amp"&&e.set({turnId:o.turn_id}),o.t){case"state":e.set({fsmState:o.value,fsmDetail:o.detail||null}),A("state",Jr(o.value)+(o.detail?" \u2014 "+o.detail:""),null,o.value==="error"?"danger":o.value==="blocked"?"warn":"neutral"),o.value==="listening"&&N(),(o.value==="done"||o.value==="idle")&&_(o.value),o.value==="interrupted"&&_("interrupted"),o.detail==="turn timed out"?(w("system","Turn failed: timed out waiting for a reply.",[],{tone:"red"}),h.current=[],e.set({mediatorText:"",speakingText:""})):o.detail==="no speech recognized"&&V(),o.value!=="idle"&&o.value!=="listening"&&(y=!0);break;case"stt.partial":e.set({sttPartial:o.text||""}),y=!0,e.get().micHint&&e.set({micHint:null});break;case"stt.final":e.set({sttPartial:"",sttFinal:o.text||""}),k.current=o.text||"",o.text&&w("user",o.text),A("stt.final","Transcribed: \u201C"+(o.text||"")+"\u201D",typeof o.ms=="number"?"stt.final ms: "+o.ms:null,"neutral"),L("stt",o.ms),y=!0,e.get().micHint&&e.set({micHint:null});break;case"stt.ignored":o.text&&w("user",o.text,["ignored \u2014 "+(o.reason||"echo")],{dim:!0}),A("stt.ignored","Ignored: \u201C"+(o.text||"")+"\u201D ("+(o.reason||"echo")+")",ke(o),"warn"),y=!0;break;case"mediator.delta":e.set(function(I){return{mediatorText:I.mediatorText+(o.text||"")}});break;case"mediator.done":e.set({mediatorText:o.text||""}),A("mediator.done","Mediator replied \xB7 "+(o.text||"").split(/\s+/).length+" words",ke({ms_first_token:o.ms_first_token,ms_total:o.ms_total}),"neutral"),L("mediator_first_token",o.ms_first_token);break;case"meta_tool":o.phase==="start"?e.set({toolChip:{name:o.name,start:Date.now()}}):(e.set({toolChip:null}),h.current.push(o.name+(typeof o.ms=="number"?" \xB7 "+o.ms+" ms":""))),A("meta_tool",o.name+(o.phase==="end"?o.result_summary?" \u2192 "+o.result_summary:" finished":" started"),ke({args:o.args,ms:o.ms}),"accent");break;case"tts.start":e.get().ttsPlaying||A("tts.start","TTS started \xB7 kokoro-onnx",null,"neutral"),e.set({ttsPlaying:!0,speakingText:o.text||""});break;case"tts.chunk_hdr":break;case"tts.amp":s.current&&s.current.onAmp(typeof o.v=="number"?o.v:0);break;case"tts.end":e.set({ttsPlaying:!1,speakingText:""}),L("tts_first_chunk",o.ms_first_chunk);break;case"task.update":{var v=gn(o);e.set(function(I){var P=I.dismissedTasks;return o.status&&P&&Object.prototype.hasOwnProperty.call(P,o.id)&&P[o.id]!==o.status&&(P=Object.assign({},P),delete P[o.id],Dt(Pt,P)),{dismissedTasks:P}}),A("task.update",(o.title||o.id)+" \u2192 "+o.status,ke({progress_note:o.progress_note,result_summary:o.result_summary}),o.status==="failed"?"danger":o.status==="needs_review"?"warn":"accent"),it(o.status)&&S(On(v));break}case"memory.hits":{var b=o.items||[];e.set({memoryHits:b}),s.current&&s.current.onMemoryHits(b),h.current.push("memory_recall \xB7 "+b.length+" hit"+(b.length===1?"":"s")),A("memory.hits","memory_recall \u2192 "+b.length+" hits",ke(b),"accent"),U(b);break}case"latency":L(o.stage,o.ms);break;case"health":e.set({health:o}),A("health","Health changed",ke(o.components),"warn");break;case"error":e.set(function(I){return{errCount:I.errCount+1}}),A("error",o.message||"error",ke(o),"danger"),w("system",o.message||"Turn failed \u2014 no reply.",[],{tone:"red"}),h.current=[],e.set({mediatorText:"",speakingText:""}),S({id:"error:"+Date.now(),tone:"error",title:"Pipeline error",body:o.message||"Turn failed \u2014 see the activity stream.",ts:Date.now(),approve:!1});break;case"pong":break;default:A(o.t,o.t,null,"neutral")}}var se=0,Y=an({onEvent:ve,onBinary:function(o){p.queueChunk(o)},onStatus:function(o){if(e.set({connection:o}),o==="open")clearTimeout(le),se=0,e.set({offline:!1,offlineDismissed:!1,retryAttempt:0,retryAt:0}),Re(!0);else if(o==="reconnecting"){se++;var v=Math.ceil(se/2);e.set({offline:!0,retryAttempt:v,retryAt:se%2===1?Date.now()+qr(v):e.get().retryAt,lastEventTs:O.current})}},onOpen:function(){}});u.current=Y;function l(){e.get().micActive||(e.set({micActive:!0}),e.get().ttsPlaying&&(p.hardStop(),Y.send({t:"barge_in"}),e.set(function(o){return{bargeIns:o.bargeIns+1}})),Y.send({t:"mic.start"}),J.start(),H())}function x(){e.get().micActive&&(e.set({micActive:!1}),J.stop(),Y.send({t:"mic.stop"}),clearTimeout(C),e.set({micHint:null}))}d.current.start=l,d.current.stop=x;function m(){p.hardStop(),Y.send({t:"barge_in"}),e.set(function(o){return{bargeIns:o.bargeIns+1}})}d.current.interrupt=m;function M(o){if((o.metaKey||o.ctrlKey)&&String(o.key).toLowerCase()==="k"){o.preventDefault(),i.composerInputRef.current&&i.composerInputRef.current.focus();return}var v=Bn(document.activeElement);if(o.code==="Space"){if(!document.hasFocus()||v||o.repeat)return;o.preventDefault(),l();return}if(o.key==="Escape"){m();return}if(!v&&!o.metaKey&&!o.ctrlKey&&!o.altKey&&String(o.key).toLowerCase()==="f"){o.preventDefault(),Fn(e);return}!v&&["1","2","3"].indexOf(o.key)>=0&&e.set({tab:["work","activity","system"][+o.key-1]})}function E(o){o.code==="Space"&&(Bn(document.activeElement)||(o.preventDefault(),x()))}window.addEventListener("keydown",M),window.addEventListener("keyup",E);var R=setInterval(function(){Qe("/health").then(function(o){e.set({health:o})}).catch(function(){})},Fr);return function(){clearTimeout(le),clearInterval(R),clearTimeout(C),window.removeEventListener("keydown",M),window.removeEventListener("keyup",E),Y.close(),J.teardown(),s.current&&(s.current.destroy(),s.current=null)}},[]),r.useEffect(function(){function p(){e.set({fullscreen:jn()})}return document.addEventListener("fullscreenchange",p),document.addEventListener("webkitfullscreenchange",p),function(){document.removeEventListener("fullscreenchange",p),document.removeEventListener("webkitfullscreenchange",p)}},[]),r.useEffect(function(){var p=document.getElementById("jarvis-voice-root");if(!p)return;if(!n.pseudoFullscreen){p.style.setProperty("--jv-fs-top-clear","0px");return}function g(){var y=0;document.querySelectorAll("header").forEach(function(C){if(!p.contains(C)){var D=window.getComputedStyle(C);if(!(D.position!=="fixed"&&D.position!=="sticky")){var J=C.getBoundingClientRect();J.top>4||J.bottom>y&&(y=J.bottom)}}}),p.style.setProperty("--jv-fs-top-clear",(y>0?y:0)+"px")}return g(),window.addEventListener("resize",g),function(){window.removeEventListener("resize",g)}},[n.pseudoFullscreen]),r.useEffect(function(){var p=document.getElementById("jarvis-voice-root");if(!p)return;function g(){var C=p.clientWidth||window.innerWidth;Math.abs(C-e.get().w)>4&&e.set({w:C})}g();var y=typeof ResizeObserver<"u"?new ResizeObserver(g):null;return y&&y.observe(p),window.addEventListener("resize",g),function(){y&&y.disconnect(),window.removeEventListener("resize",g)}},[]),r.useEffect(function(){var p=document.getElementById("jarvis-voice-root");if(!p)return;var g=!1;function y(){if(!g){g=!0;var ve=p.getBoundingClientRect().top,se=Math.max(320,window.innerHeight-ve);p.style.height=se+"px";var Y=document.documentElement.scrollHeight-window.innerHeight;Y>1&&(p.style.height=Math.max(320,se-Y)+"px"),g=!1}}y(),window.addEventListener("resize",y);var C=typeof ResizeObserver<"u"?new ResizeObserver(y):null;C&&C.observe(document.body);var D=setTimeout(y,500),J=setTimeout(y,1500),H=p.parentElement,le=H?H.getAttribute("style"):null;return H&&(H.style.padding="0"),function(){window.removeEventListener("resize",y),C&&C.disconnect(),clearTimeout(D),clearTimeout(J),H&&(le==null?H.removeAttribute("style"):H.setAttribute("style",le))}},[]);var we=n.w<jr;r.useEffect(function(){var p=i.canvasRef.current;if(p){var g=et(p);return s.current=g,c.current&&g.setAudioSource(c.current.getLevels),g.setReducedMotion(e.get().reducedMotion),g.setState(Pe(e.get())),g.onMemoryHits(e.get().memoryHits),function(){g.destroy(),s.current===g&&(s.current=null)}}},[we]),r.useEffect(function(){s.current&&s.current.setState(Pe(n))},[n.fsmState,n.connection]),r.useEffect(function(){s.current&&s.current.setReducedMotion(n.reducedMotion),Kr("jarvis-voice:reducedMotion",n.reducedMotion),r.motion.set(n.reducedMotion?"off":"system")},[n.reducedMotion]),r.useEffect(function(){c.current&&c.current.setGain(n.volume)},[n.volume]);var _e=r.useRef(null);_e.current||(_e.current={onMicClick:function(p){p&&p.preventDefault(),e.get().micActive?d.current.stop():d.current.start()},interrupt:function(){d.current.interrupt()},submitText:function(p){k.current=p,N(),w("user",p),u.current&&u.current.send({t:"turn.text",text:p}),A("turn.text","Typed turn: "+p,null,"neutral")},setMicMode:function(p){e.set({micMode:p}),u.current&&u.current.send({t:"mode.set",mode:p})},dismissTask:function(p){e.set(function(g){var y=Object.assign({},g.dismissedTasks);return y[p]=!0,Dt(Pt,y),{dismissedTasks:y}})},dismissNotice:F,resolveNotice:function(p){F(p)},getSeries:function(p){return f.current.series(p)},toggleReduced:function(){e.set(function(p){return{reducedMotion:!p.reducedMotion}})},toggleFullscreen:function(){Fn(e)},log:A});var Ae=_e.current,ne=n.w>=Hr,me=Object.assign({background:Xr},n.pseudoFullscreen?Yr:null);return Z`
    <${r.Root} id="jarvis-voice-root" fill style=${me}>
      ${we?Z`<${In} store=${e} act=${Ae} refs=${i} />`:Z`
          <div style=${{position:"absolute",inset:0,display:"flex",flexDirection:"column",paddingTop:"var(--jv-fs-top-clear, 0px)"}}>
            <${Qr} s=${n} act=${Ae} />
            <div style=${{flex:"1 1 0%",minHeight:0,display:"grid",gridTemplateColumns:ne?"304px minmax(0,1fr) 372px":"minmax(0,1fr) 344px"}}>
              ${ne?Z`<${Sn} store=${e} />`:null}
              <${mn} store=${e} act=${Ae} refs=${i} />
              <${Cn} store=${e} act=${Ae} showLeft=${ne} />
            </div>
          </div>`}
      <${Zr} s=${n} store=${e} onRetry=${function(){u.current&&u.current.forceReconnect()}} />
    <//>`}function Qr(t){var e=t.s,n=t.act,a=Oe(),i=a.data||{},s=e.health&&e.health.models||{},u=e.connection==="open"?"connected":e.connection==="connecting"?"connecting":e.connection==="reconnecting"?"reconnecting":"disconnected";return Z`
    <${r.Row} align="center" gap="lg" style=${{flex:"none",height:52,padding:"0 18px",borderBottom:"1px solid var(--hui-line)",background:"var(--hui-surface)"}} wrap=${!1}>
      <${r.Row} align="center" gap="sm" wrap=${!1}>
        <span className="hui-dot hui-dot--accent hui-dot--pulse" aria-hidden="true" />
        <span className="hui-t-title">JARVIS</span>
      <//>
      <${r.Badge} icon="lock" size="sm">LOCAL ONLY<//>
      <${r.Divider} orientation="vertical" />
      <${r.Row} align="center" gap="lg" wrap=${!1} style=${{minWidth:0,overflow:"hidden"}}>
        ${e.w>=1280?Z`<${r.Stat} size="sm" variant="plain" label="Mediator" style=${{minWidth:64,flex:"none"}} value=${s.mediator&&s.mediator.name||"\u2014"} />`:null}
        ${e.w>=1280?Z`<${r.Stat} size="sm" variant="plain" label="Worker" style=${{minWidth:64,flex:"none"}} value=${s.worker&&s.worker.name||"\u2014"} />`:null}
        ${e.w>=1024?Z`<${r.Stat} size="sm" variant="plain" label="E2E first audio" style=${{minWidth:64,flex:"none"}}
              value=${e.latency.e2e_first_audio&&e.latency.e2e_first_audio.p50}
              format=${function(c){return(c/1e3).toFixed(2)+" s"}} />`:null}
        <${r.Stat} size="sm" variant="plain" label="RAM free" style=${{minWidth:64,flex:"none"}} value=${e.health&&e.health.ram&&e.health.ram.free_gb}
          format=${function(c){return c.toFixed(1)+" GB"}} />
      <//>
      <div style=${{flex:1}} />
      ${e.w>=1180&&i.backends?Z`
          <${r.Row} gap="sm" wrap=${!1}>
            ${Object.keys(Ke).filter(function(c){var f=i.backends[c];return f&&f.tier!=="free"}).map(function(c){var f=i.backends[c],d=(f.gauges||[])[0],h=d&&typeof d.remaining_pct=="number"?d.remaining_pct*100:0;return Z`<div key=${c} style=${{width:108,flex:"none"}}>
                  <${r.Meter} size="sm" label=${Ke[c].name} value=${h} max=${100} valueText=${Math.round(h)+"%"} />
                </div>`})}
          <//>`:null}
      <${_n} act=${n} />
      <${r.ConnectionPill} state=${u} attempt=${e.retryAttempt} />
      <${tt} active=${e.fullscreen||e.pseudoFullscreen} pseudo=${e.pseudoFullscreen} onClick=${n.toggleFullscreen} />
      <${r.Switch} checked=${!e.reducedMotion} onChange=${function(){n.toggleReduced()}} label="Motion" />
    <//>`}function Zr(t){var e=t.s,n=t.store;r.useNow(1e3);var a=!!e.offline&&!e.offlineDismissed;return Z`
    <div style=${{position:"absolute",insetInline:0,bottom:0,display:"flex",justifyContent:"center",paddingBottom:24,pointerEvents:a?"auto":"none",zIndex:40}}>
      <div style=${{width:"min(520px,86%)"}}>
        <${r.Banner} tone="warn" variant="inline" open=${a} title="jarvisd unreachable through the dashboard proxy"
          action=${Z`
            <${r.Row} gap="sm">
              <${r.Button} size="sm" variant="primary" onClick=${t.onRetry}>Retry now<//>
              <${r.Button} size="sm" variant="secondary" onClick=${function(){n.set({offlineDismissed:!0})}}>Work offline<//>
            <//>`}>
          <${r.Stack} gap="sm">
            <span>
              Voice capture is paused. Task state is safe in <code className="hui-code">jarvis.db</code> and replays on reconnect. Retrying with backoff${e.retryAttempt?" \u2014 attempt "+e.retryAttempt:""}.
              ${e.retryAttempt&&e.retryAt?Z` <${r.Countdown} to=${e.retryAt} fallback="" />`:null}
            </span>
            ${e.lastEventTs?Z`<span className="hui-t-micro">last event <${r.RelTime} at=${e.lastEventTs} /></span>`:null}
          <//>
        <//>
      </div>
    </div>`}(function(){window.__JARVIS_VOICE_INTERNALS__={createVisualizer:et,App:Ot},!(!window.__HERMES_PLUGIN_SDK__||!window.__HERMES_PLUGINS__)&&window.__HERMES_PLUGINS__.register("jarvis-voice",Ot)})();})();

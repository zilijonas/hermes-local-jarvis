(()=>{var r=window.HermesUI,ea=r&&r.html;var de="/api/plugins/jarvis-voice";function St(){return window.__HERMES_PLUGIN_SDK__}function en(){return window.__HERMES_SESSION_TOKEN__}function Xe(t){var e=window.HERMES_BASE_PATH||"";return new URL(e+"/dashboard-plugins/jarvis-voice/dist/"+t,window.location.origin).toString()}function Vn(t,e){var n=St(),a=de+t;if(n&&typeof n.authedFetch=="function")return n.authedFetch(a,e);var i=Object.assign({},e);i.headers=Object.assign({},i.headers);var s=en();return s&&(i.headers["X-Hermes-Session-Token"]=s),i.credentials||(i.credentials="include"),fetch(a,i)}function Qe(t){var e=St();return e&&typeof e.fetchJSON=="function"?e.fetchJSON(de+t):Vn(t).then(function(n){if(!n.ok)throw new Error("HTTP "+n.status+" for "+t);return n.json()})}function tn(){var t=St(),e=de+"/ws";if(t&&typeof t.buildWsUrl=="function")try{var n=t.buildWsUrl(e);if(typeof t.buildWsAuthParam=="function"){var a=t.buildWsAuthParam();a&&(n+=(n.indexOf("?")===-1?"?":"&")+a)}return n}catch{}var i=window.location.protocol==="https:"?"wss:":"ws:",s=en(),u=i+"//"+window.location.host+e;return s&&(u+="?token="+encodeURIComponent(s)),u}function nn(t){var e=t,n=new Set;function a(){return e}function i(u){return e=Object.assign({},e,typeof u=="function"?u(e):u),n.forEach(function(c){c(e)}),e}function s(u){return n.add(u),function(){n.delete(u)}}return{get:a,set:i,subscribe:s}}function Q(t){var e=r.useState,n=r.useEffect,a=e(t.get()),i=a[0],s=a[1];return n(function(){return s(t.get()),t.subscribe(s)},[t]),i}function Tt(t,e,n){var a=t.concat([e]);return a.length>n&&(a=a.slice(a.length-n)),a}function rn(t){var e=t||20,n={};function a(c,v){var d=(n[c]||[]).concat([v]);d.length>e&&(d=d.slice(d.length-e)),n[c]=d}function i(c){return n[c]||[]}function s(c,v){var d=n[c];if(!d||!d.length)return null;var h=d.slice().sort(function(E,L){return E-L}),k=Math.min(h.length-1,Math.floor(v*h.length));return Math.round(h[k])}function u(){var c={};return Object.keys(n).forEach(function(v){c[v]={p50:s(v,.5),p95:s(v,.95),n:n[v].length}}),c}return{record:a,summary:u,series:i}}var Ze=1e3,Yn=1e4;function an(t){var e=t&&t.onEvent||function(){},n=t&&t.onBinary||function(){},a=t&&t.onStatus||function(){},i=t&&t.onOpen||function(){},s=null,u=Ze,c=null,v=!1,d=!1;function h(){v||(a("reconnecting"),clearTimeout(c),c=setTimeout(k,u),u=Math.min(u*2,Yn))}function k(){clearTimeout(c),v=!1,a(u>Ze?"reconnecting":"connecting");var w;try{w=new WebSocket(tn())}catch{h();return}w.binaryType="arraybuffer",s=w,w.onopen=function(){clearTimeout(c),u=Ze,d=!1,a("open"),i()},w.onmessage=function(T){if(typeof T.data=="string"){var F;try{F=JSON.parse(T.data)}catch{return}F&&F.t==="tts.chunk_hdr"&&(d=!0),e(F)}else d&&(d=!1,n(T.data))},w.onclose=function(){s===w&&(s=null,h())},w.onerror=function(){try{w.close()}catch{}}}function E(w){s&&s.readyState===WebSocket.OPEN&&s.send(JSON.stringify(w))}function L(w){s&&s.readyState===WebSocket.OPEN&&s.send(w)}function $(){if(u=Ze,v=!1,s){try{s.close()}catch{}s=null}k()}function A(){if(v=!0,clearTimeout(c),s){try{s.close()}catch{}s=null}}return k(),{send:E,sendBinary:L,close:A,forceReconnect:$}}function on(t){var e=t&&t.onChunk||function(){},n=t&&t.onLevel||function(){},a=t&&t.onError||function(){},i=null,s=null,u=null,c=null,v=!1,d=null,h=0;function k(){return!!((window.AudioContext||window.webkitAudioContext)&&window.AudioWorkletNode&&navigator.mediaDevices&&navigator.mediaDevices.getUserMedia)}function E(R){if(!window.isSecureContext)return"Mic unavailable: this page is not a secure context (needs https:// or localhost).";var P=R&&R.name||"";return P==="NotAllowedError"||P==="PermissionDeniedError"?"Microphone permission denied. Allow mic access for this site, then try again.":P==="NotFoundError"||P==="DevicesNotFoundError"?"No microphone found. Check your input device.":P==="NotReadableError"||P==="TrackStartError"?"Microphone is in use by another app, or a hardware error occurred.":P==="OverconstrainedError"?"No microphone matches the required audio constraints.":P==="AbortError"?"Microphone access was aborted.":R&&R.message||String(R)}function L(){if(!i){var R=window.AudioContext||window.webkitAudioContext;i=new R}return i}function $(){if(d)return d;if(!window.isSecureContext)return d=Promise.reject(new Error("insecure-context")),d;if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)return d=Promise.reject(new Error("getUserMedia is not available in this browser.")),d;var R=L(),P=R.sampleRate;return d=navigator.mediaDevices.getUserMedia({audio:{sampleRate:{ideal:16e3},echoCancellation:!0,noiseSuppression:!0,channelCount:1}}).then(function(B){return c=B,R.audioWorklet.addModule(Xe("mic-worklet.js")).catch(function(U){throw new Error("mic init failed: "+(U&&U.message?U.message:U))})}).then(function(){u=R.createMediaStreamSource(c),s=new AudioWorkletNode(R,"mic-worklet",{processorOptions:{targetSampleRate:16e3,sourceSampleRate:P}}),s.port.onmessage=function(B){var U=B.data;U.type==="chunk"?v&&(h++,e(U.buffer)):U.type==="level"&&n(U.rms)},u.connect(s)}).catch(function(B){throw d=null,B}),d}function A(){v=!0,h=0;var R=L();Promise.resolve().then(function(){return R.resume?R.resume():void 0}).catch(function(){}).then(function(){if(R.state!=="running")throw new Error("AudioContext did not enter 'running' state (state: "+R.state+").");return $()}).catch(function(P){v=!1,a(E(P))})}function w(){v=!1}function T(){if(v=!1,s)try{s.disconnect()}catch{}if(u)try{u.disconnect()}catch{}if(c&&(c.getTracks().forEach(function(R){R.stop()}),c=null),i){try{i.close()}catch{}i=null}d=null}function F(){return h}return{start:A,stop:w,teardown:T,isSupported:k(),getChunkCount:F}}function sn(){var t=24e3,e=null,n=null,a=null,i=null,s=1,u=null,c=null,v=null,d=null,h=null,k={level:0,low:0,mid:0,high:0};function E(){if(i)return i;try{e=new(window.AudioContext||window.webkitAudioContext)({sampleRate:t})}catch{e=new(window.AudioContext||window.webkitAudioContext)}return i=e.audioWorklet.addModule(Xe("player-worklet.js")).then(function(){n=new AudioWorkletNode(e,"player-worklet",{outputChannelCount:[1]}),a=e.createGain(),a.gain.value=s;try{u=e.createAnalyser(),u.fftSize=2048,u.smoothingTimeConstant=.5,c=new Uint8Array(u.frequencyBinCount),typeof u.getFloatTimeDomainData=="function"?v=new Float32Array(u.fftSize):d=new Uint8Array(u.fftSize);var T=e.sampleRate/u.fftSize;h=[Math.round(250/T),Math.round(2e3/T),Math.min(u.frequencyBinCount,Math.round(6e3/T))],n.connect(a),a.connect(u),u.connect(e.destination)}catch{u=null,n.connect(a).connect(e.destination)}}).catch(function(T){throw i=null,T}),i}function L(){if(!u||!e||e.state!=="running")return null;var T,F=0;if(v){for(u.getFloatTimeDomainData(v),T=0;T<v.length;T++)F+=v[T]*v[T];F=Math.sqrt(F/v.length)}else{for(u.getByteTimeDomainData(d),T=0;T<d.length;T++){var R=(d[T]-128)/128;F+=R*R}F=Math.sqrt(F/d.length)}u.getByteFrequencyData(c);var P=[0,0,0],B=[0,0,0],U=0;for(T=0;T<h[2];T++){for(;U<2&&T>=h[U];)U++;P[U]+=c[T],B[U]++}return k.level=Math.min(1,F*4.5),k.low=B[0]?P[0]/(B[0]*255):0,k.mid=B[1]?P[1]/(B[1]*255):0,k.high=B[2]?P[2]/(B[2]*255):0,k}function $(T){E().then(function(){e.state==="suspended"&&e.resume();var F=T instanceof Int16Array?T:new Int16Array(T),R=Xn(F),P=e.sampleRate,B=P===t?R:Qn(R,t,P);n.port.postMessage({type:"push",samples:B},[B.buffer])}).catch(function(){})}function A(){n&&n.port.postMessage({type:"clear"})}function w(T){s=T,a&&(a.gain.value=T)}return{queueChunk:$,hardStop:A,setGain:w,getLevels:L}}function Xn(t){for(var e=new Float32Array(t.length),n=0;n<t.length;n++){var a=t[n];e[n]=a<0?a/32768:a/32767}return e}function Qn(t,e,n){for(var a=e/n,i=Math.max(1,Math.round(t.length/a)),s=new Float32Array(i),u=0;u<i;u++){var c=u*a,v=Math.floor(c),d=Math.min(v+1,t.length-1),h=c-v;s[u]=t[v]*(1-h)+t[d]*h}return s}var te={idle:{rad:1,spin:.05,noise:.1,glow:.55,mode:"calm",col:[79,227,224]},listening:{rad:1.09,spin:.09,noise:.16,glow:.88,mode:"open",col:[110,235,225]},transcribing:{rad:1.02,spin:.15,noise:.3,glow:.76,mode:"resolve",col:[130,226,236]},thinking:{rad:.93,spin:.24,noise:.13,glow:.7,mode:"orbit",col:[79,210,232]},memory:{rad:1,spin:.07,noise:.09,glow:.78,mode:"stars",col:[96,216,206]},capability:{rad:.97,spin:.12,noise:.09,glow:.72,mode:"radial",col:[122,222,216]},tool:{rad:.95,spin:.19,noise:.12,glow:.8,mode:"arc",col:[79,227,224]},delegating:{rad:1.03,spin:.1,noise:.14,glow:.84,mode:"transfer",col:[86,206,234]},worker_progress:{rad:.91,spin:.06,noise:.07,glow:.58,mode:"arc",col:[86,206,234]},speaking:{rad:1.05,spin:.07,noise:.1,glow:1,mode:"bands",col:[124,240,233]},interrupted:{rad:.87,spin:.03,noise:.05,glow:.34,mode:"calm",col:[150,170,176]},blocked:{rad:.95,spin:.03,noise:.06,glow:.62,mode:"calm",col:[242,179,92]},error:{rad:.9,spin:.02,noise:.36,glow:.66,mode:"calm",col:[255,107,107]},done:{rad:1.1,spin:.05,noise:.08,glow:.92,mode:"pulse",col:[104,234,208]},offline:{rad:.85,spin:.01,noise:.04,glow:.2,mode:"calm",col:[110,128,133]}},ln={idle:{label:"Idle",hint:"Awake \xB7 nothing in flight"},listening:{label:"Listening",hint:"mic open \xB7 webrtcvad endpointing"},transcribing:{label:"Transcribing",hint:"faster-whisper base.en int8"},thinking:{label:"Thinking",hint:"gpt-oss-20b \xB7 8k window"},memory:{label:"Recalling",hint:"Obsidian vault \xB7 FTS5 + vectors"},capability:{label:"Matching capability",hint:"tools \xB7 skills \xB7 quick actions"},tool:{label:"Running meta-tool",hint:"server-reported action"},delegating:{label:"Delegating",hint:"handing the goal to a worker"},worker_progress:{label:"Worker running",hint:"gpt-oss-20b worker session"},speaking:{label:"Speaking",hint:"kokoro-onnx \xB7 am_michael"},interrupted:{label:"Interrupted",hint:"playback stopped \xB7 mediator canceled"},blocked:{label:"Blocked",hint:"needs a decision from you"},error:{label:"Error",hint:"recoverable \xB7 see activity"},done:{label:"Done",hint:"turn complete"},offline:{label:"Offline",hint:"reconnecting to jarvisd"}},da=Object.keys(te);function un(t){var e=(te[t]||te.idle).col;return"rgb("+e[0]+","+e[1]+","+e[2]+")"}function cn(t){return ln[t]||ln.idle}var dn=2,Zn=95,er=2.399963229728653;function je(t){return Math.max(0,Math.min(1,t))}function fn(t){var e="idle",n=0,a=!1,i=[],s=null,u=!1,c=0,v=0,d=null,h=0,k=0,E=[],L=0,$=null,A=118,w=[],T=[],F=[];(function(){var M,f,S;for(M=0;M<A;M++){var x=1-M/(A-1)*2,_=Math.sqrt(Math.max(0,1-x*x)),o=M*er;w.push([Math.cos(o)*_,x,Math.sin(o)*_])}var m={};for(M=0;M<A;M++){var b=[];for(f=0;f<A;f++)if(M!==f){var N=w[M][0]-w[f][0],I=w[M][1]-w[f][1],z=w[M][2]-w[f][2];b.push([N*N+I*I+z*z,f])}for(b.sort(function(W,re){return W[0]-re[0]}),S=0;S<3;S++){f=b[S][1];var q=M<f?M+":"+f:f+":"+M;m[q]||(m[q]=!0,T.push([Math.min(M,f),Math.max(M,f)]))}}for(M=0;M<84;M++)F.push({x:Math.random(),y:Math.random(),z:.3+Math.random()*.7,s:.2+Math.random()*.8})})();var R=new Array(A),P=0,B=0;function U(l){l>26?(B++,B>90&&P<3&&(P++,B=0)):B>0&&B--}var V=128,Re=document.createElement("canvas"),we=document.createElement("canvas");Re.width=Re.height=V,we.width=we.height=V;var _e="";function Ae(l,M,f){var S=l+","+M+","+f;if(S!==_e){_e=S;var x=V/2,_=Re.getContext("2d");_.clearRect(0,0,V,V);var o=_.createRadialGradient(x,x,V*.035,x,x,x);o.addColorStop(0,"rgba("+S+",0.09)"),o.addColorStop(.45,"rgba("+S+",0.035)"),o.addColorStop(1,"rgba("+S+",0)"),_.fillStyle=o,_.fillRect(0,0,V,V);var m=we.getContext("2d");m.clearRect(0,0,V,V);var b=m.createRadialGradient(x,x,0,x,x,x);b.addColorStop(0,"rgba("+S+",1)"),b.addColorStop(.28,"rgba("+S+",0.38)"),b.addColorStop(1,"rgba("+S+",0)"),m.fillStyle=b,m.fillRect(0,0,V,V)}}function ne(){if(t.clientWidth){var l=Math.min(dn,window.devicePixelRatio||1),M=Math.round(t.clientWidth*l),f=Math.round(t.clientHeight*l);(t.width!==M||t.height!==f)&&(t.width=M,t.height=f)}}var fe=0,p=0,g=(window.performance||Date).now();function y(l){if(fe=u?0:requestAnimationFrame(y),!!t.clientWidth){t.width===0&&ne();var M=Math.min(64,l-(p||l));p=l;var f=(l-g)/1e3;U(M);var S=s?s():null;if(S){d=S;var x=je(S.level+(S.high||0)*.3);c+=(x-c)*.28}else d=null,c+=(v-c)*.28,v*=.88;h+=(k-h)*.2,k*=.9,h>.42&&f-L>.42&&(L=f,E.push({r:.34,a:.42}));var _=te[e]||te.idle;$||($={rad:_.rad,spin:_.spin,noise:_.noise,glow:_.glow,mode:_.mode,col:_.col.slice()});var o=a?1:1-Math.exp(-M/Zn);$.rad+=(_.rad-$.rad)*o,$.spin+=(_.spin-$.spin)*o,$.noise+=(_.noise-$.noise)*o,$.glow+=(_.glow-$.glow)*o;for(var m=0;m<3;m++)$.col[m]+=(_.col[m]-$.col[m])*o;$.mode=_.mode,C(f,M)}}function C(l,M){var f=t.getContext("2d");if(f){var S=Math.min(dn,window.devicePixelRatio||1),x=t.width,_=t.height;f.setTransform(1,0,0,1,0,0),f.clearRect(0,0,x,_),f.scale(S,S);var o=x/S,m=_/S,b=o/2,N=m<300,I=N?m*.5:m/2-6,z=N?Math.min(o*.3,m*.4):Math.min(o,m)*.29,q=Math.round($.col[0]),W=Math.round($.col[1]),re=Math.round($.col[2]),ae=function(qn){return"rgba("+q+","+W+","+re+","+qn+")"};Ae(q,W,re);var ie=a?.6:l,me=z*2.9;if(f.globalAlpha=je($.glow),f.drawImage(Re,b-me,I-me,me*2,me*2),f.globalAlpha=1,P<2){f.lineWidth=1;for(var ue=0;ue<3;ue++){var Le=z*(1.5+ue*.42),Ne=.19+ue*.02,vt=ie*(.05+ue*.015)*(ue%2?-1:1);f.strokeStyle=ae(.05-ue*.011),f.beginPath(),f.ellipse(b,I,Le,Le*Ne,vt,0,Math.PI*2),f.stroke()}}if(!a&&P<1)for(var Se=0;Se<F.length;Se++){var oe=F[Se];oe.y-=12e-5*oe.z*(M/16),oe.y<-.05&&(oe.y=1.05,oe.x=Math.random());var mt=oe.x*o+Math.sin(ie*.2+oe.z*9)*6,pt=oe.y*m;f.fillStyle=ae(.05+oe.s*.1),f.fillRect(mt,pt,1.1,1.1)}for(var pe=ie*$.spin*2.2,ce=.42+Math.sin(ie*.24)*.1,Te=Math.cos(pe),Me=Math.sin(pe),Ee=Math.cos(ce),xe=Math.sin(ce),he=z*$.rad*(1+c*.14),$e=P>=3?2:1,X=0;X<A;X+=$e){var Be=w[X],ht=a?0:Math.sin(X*1.77+ie*1.15)*.5+Math.sin(X*4.13-ie*.7)*.5,$t=1+ht*$.noise*.34+c*.1*Math.sin(X*.7+ie*6),Lt=Be[0]*$t,Bt=Be[1]*$t,Ft=Be[2]*$t,Hn=Lt*Te+Ft*Me,jt=-Lt*Me+Ft*Te,Un=Bt*Ee-jt*xe,Ht=Bt*xe+jt*Ee,gt=2.7/(2.7-Ht);R[X]=[b+Hn*he*gt,I+Un*he*gt,Ht,gt]}f.lineWidth=1;for(var yt=0;yt<T.length;yt+=$e){var Ge=T[yt];if(!($e>1&&(Ge[0]%2||Ge[1]%2))){var Je=R[Ge[0]],qe=R[Ge[1]];if(!(!Je||!qe)){var zn=(Je[2]+qe[2])/2,Wn=(.06+Math.max(0,zn+.9)*.13)*(.55+$.glow*.6);f.strokeStyle=ae(Math.min(.5,Wn)),f.beginPath(),f.moveTo(Je[0],Je[1]),f.lineTo(qe[0],qe[1]),f.stroke()}}}for(var bt=0;bt<A;bt+=$e){var Ie=R[bt];if(!(!Ie||Ie[2]<-.25)){var Ve=.7+Ie[3]*.5;f.fillStyle=ae(.14+Math.max(0,Ie[2])*.4),f.fillRect(Ie[0]-Ve/2,Ie[1]-Ve/2,Ve,Ve)}}if(!a&&P<2){var Ut=-pe*.62,zt=Math.cos(Ut),Wt=Math.sin(Ut),Kn=[[0,1,2],[1,2,0],[2,0,1]];f.lineWidth=1,f.strokeStyle=ae(.05+$.glow*.06);for(var Fe=0;Fe<3;Fe++){var Kt=Kn[Fe],Gt=he*(1.02+Fe*.008);f.beginPath();for(var kt=!1,wt=0;wt<=56;wt++){var Jt=wt/56*Math.PI*2+Fe*.7,ge=[0,0,0];ge[Kt[0]]=Math.cos(Jt),ge[Kt[1]]=Math.sin(Jt);var Gn=ge[0]*zt+ge[2]*Wt,qt=-ge[0]*Wt+ge[2]*zt,Jn=ge[1]*Ee-qt*xe,Vt=ge[1]*xe+qt*Ee;if(Vt<-.55){kt=!1;continue}var Yt=2.7/(2.7-Vt),Xt=b+Gn*Gt*Yt,Qt=I+Jn*Gt*Yt;kt?f.lineTo(Xt,Qt):f.moveTo(Xt,Qt),kt=!0}f.stroke()}}var Zt=he*(.3+c*.22+($.mode==="pulse"?.12:0)),Ye=Zt*2.4;if(f.globalAlpha=Math.min(.95,.5+$.glow*.4+c*.3),f.drawImage(we,b-Ye,I-Ye,Ye*2,Ye*2),f.globalAlpha=1,f.strokeStyle=ae(.42+c*.4),f.lineWidth=1.2,f.beginPath(),f.arc(b,I,Zt*.72,0,Math.PI*2),f.stroke(),a){D(f,b,I,z,ae);return}J(f,$.mode,b,I,z,l,ae)}}function D(l,M,f,S,x){l.setLineDash([2,6]),l.lineWidth=1,l.strokeStyle=x(.3),l.beginPath(),l.arc(M,f,S*1.32,0,Math.PI*2),l.stroke(),l.setLineDash([])}function J(l,M,f,S,x,_,o){var m,b,N,I,z,q,W;if(M==="open"){for(m=E.length-1;m>=0;m--){var re=E[m];if(re.r+=.012,re.a*=.965,re.a<.01||re.r>2.2){E.splice(m,1);continue}l.strokeStyle=o(re.a),l.lineWidth=1,l.beginPath(),l.arc(f,S,x*re.r,0,Math.PI*2),l.stroke()}var ae=.5+h*1.1;l.strokeStyle=o(.5),l.lineWidth=2,l.beginPath(),l.arc(f,S,x*1.36,-Math.PI/2-ae/2,-Math.PI/2+ae/2),l.stroke()}else if(M==="bands")for(W=34,m=0;m<W;m++){b=m/W*Math.PI*2-Math.PI/2;var ie=Math.abs(Math.sin(m*1.7+_*6.1))*.5+Math.abs(Math.sin(m*.9+_*11.3))*.5;if(d){var me=(Math.sin(b)+1)/2,ue=(d.low||0)*me+(d.mid||0)*(1-Math.abs(me-.5)*2)+(d.high||0)*(1-me);ie*=.4+1.1*je(ue)}var Le=x*(.16+c*ie*.72),Ne=x*1.2;l.strokeStyle=o(.14+c*ie*.5),l.lineWidth=1.6,l.beginPath(),l.moveTo(f+Math.cos(b)*Ne,S+Math.sin(b)*Ne),l.lineTo(f+Math.cos(b)*(Ne+Le),S+Math.sin(b)*(Ne+Le)),l.stroke()}else if(M==="orbit")for(m=0;m<3;m++){I=x*(1.18+m*.16);var vt=(m%2?-1:1)*(.5+m*.22);W=26-m*5;for(var Se=0;Se<W;Se++){b=Se/W*Math.PI*2+_*vt;var oe=.35+.65*Math.pow(Math.max(0,Math.sin(b*2+_)),2);l.fillStyle=o(.1+oe*.42),z=f+Math.cos(b)*I,q=S+Math.sin(b)*I*.34,l.beginPath(),l.arc(z,q,1.5,0,Math.PI*2),l.fill()}}else if(M==="resolve"){for(W=40,l.strokeStyle=o(.4),l.lineWidth=1.4,l.beginPath(),m=0;m<=W;m++){z=f-x*1.5+m/W*x*3;var mt=1-Math.abs(m/W-.5)*1.6;q=S+x*1.62+Math.sin(m*.9+_*9)*x*.16*Math.max(0,mt),m===0?l.moveTo(z,q):l.lineTo(z,q)}for(l.stroke(),m=0;m<16;m++)N=(_*.55+m/16)%1,b=m*2.4,I=x*(1.7-N*1.3),l.fillStyle=o(.5*(1-Math.abs(N-.5)*1.6)),l.beginPath(),l.arc(f+Math.cos(b)*I,S+Math.sin(b)*I*.7,1.4,0,Math.PI*2),l.fill()}else if(M==="stars"){var pt=i.length?i.slice(0,6):[0,1,2];for(m=0;m<pt.length;m++)b=-Math.PI*.72+m*.5+Math.sin(_*.3+m)*.05,N=(_*.4+m*.33)%1,I=x*(2.05-N*.72),z=f+Math.cos(b)*I,q=S+Math.sin(b)*I*.78,l.strokeStyle=o(.1+(1-N)*.18),l.lineWidth=1,l.beginPath(),l.moveTo(z,q),l.lineTo(f,S),l.stroke(),l.fillStyle=o(.35+(1-N)*.45),l.beginPath(),l.arc(z,q,2.6,0,Math.PI*2),l.fill(),l.strokeStyle=o(.18),l.beginPath(),l.arc(z,q,6+Math.sin(_*2+m)*1.2,0,Math.PI*2),l.stroke()}else if(M==="radial")for(W=12,m=0;m<W;m++){b=m/W*Math.PI*2+_*.12;var pe=m%3===Math.floor(_*1.6)%3,ce=x*1.24,Te=x*(pe?.4:.2);l.strokeStyle=o(pe?.5:.14),l.lineWidth=pe?2:1,l.beginPath(),l.moveTo(f+Math.cos(b)*ce,S+Math.sin(b)*ce*.9),l.lineTo(f+Math.cos(b)*(ce+Te),S+Math.sin(b)*(ce+Te)*.9),l.stroke(),pe&&(l.fillStyle=o(.6),l.beginPath(),l.arc(f+Math.cos(b)*(ce+Te),S+Math.sin(b)*(ce+Te)*.9,2,0,Math.PI*2),l.fill())}else if(M==="arc"){I=x*1.34,l.strokeStyle=o(.1),l.lineWidth=2,l.beginPath(),l.arc(f,S,I,0,Math.PI*2),l.stroke();var Me=_*.85%(Math.PI*2);l.strokeStyle=o(.62),l.lineWidth=2.4,l.beginPath(),l.arc(f,S,I,Me,Me+1.05),l.stroke(),l.fillStyle=o(.8),l.beginPath(),l.arc(f+Math.cos(Me+1.05)*I,S+Math.sin(Me+1.05)*I,2.4,0,Math.PI*2),l.fill()}else if(M==="transfer"){var Ee=f,xe=S,he=f+x*1.85,$e=S+x*.9;for(l.strokeStyle=o(.14),l.lineWidth=1,l.beginPath(),l.moveTo(Ee,xe),l.quadraticCurveTo(f+x,S+x*1.2,he,$e),l.stroke(),m=0;m<5;m++){N=(_*.65+m/5)%1;var X=1-N,Be=X*X*Ee+2*X*N*(f+x)+N*N*he,ht=X*X*xe+2*X*N*(S+x*1.2)+N*N*$e;l.fillStyle=o(.7*(1-N*.7)),l.beginPath(),l.arc(Be,ht,2.1,0,Math.PI*2),l.fill()}l.strokeStyle=o(.4),l.lineWidth=1.4,l.beginPath(),l.arc(he,$e,9+Math.sin(_*3)*1.4,0,Math.PI*2),l.stroke()}else M==="pulse"&&(N=(_-n)*.9,N>=0&&N<=1&&(l.strokeStyle=o(.5*(1-N)),l.lineWidth=2,l.beginPath(),l.arc(f,S,x*(1.1+N*.9),0,Math.PI*2),l.stroke()))}function H(){u||fe||a||document.hidden||(p=0,fe=requestAnimationFrame(y))}function le(){fe&&(cancelAnimationFrame(fe),fe=0)}function ve(){ne();var l=te[e]||te.idle;$={rad:l.rad,spin:l.spin,noise:l.noise,glow:l.glow,mode:l.mode,col:l.col.slice()};var M=((window.performance||Date).now()-g)/1e3;C(M,16)}function se(){document.hidden?le():a||H()}document.addEventListener("visibilitychange",se);var Y=null;return window.ResizeObserver?(Y=new ResizeObserver(function(){ne(),a&&ve()}),Y.observe(t)):window.addEventListener("resize",ne),ne(),H(),{setState:function(l){l!==e&&(e=te[l]?l:"idle",n=((window.performance||Date).now()-g)/1e3,a&&ve())},setReducedMotion:function(l){a=!!l,a?(le(),ve()):H()},setHits:function(l){i=Array.isArray(l)?l:[]},setAudioSource:function(l){s=typeof l=="function"?l:null},onAmp:function(l){v=je(typeof l=="number"?l:0)},onMicLevel:function(l){k=je(typeof l=="number"?l:0)},resize:function(){ne(),a&&ve()},destroy:function(){u=!0,le(),document.removeEventListener("visibilitychange",se),Y?Y.disconnect():window.removeEventListener("resize",ne)}}}function et(t){var e=fn(t);return{setState:function(n,a){e.setState(n)},onAmp:function(n){e.onAmp(n)},onMicLevel:function(n){e.onMicLevel(n)},onMemoryHits:function(n){e.setHits(n)},setAudioSource:function(n){e.setAudioSource(n)},setReducedMotion:function(n){e.setReducedMotion(n)},resize:function(){e.resize()},destroy:function(){e.destroy()}}}var j=r.html;function Pe(t){return t.connection==="open"?t.fsmState:"offline"}var tr={listening:1,speaking:1,thinking:1,tool:1,worker_progress:1},nr=[["STT","stt"],["MED","mediator_first_token"],["TTS","tts_first_chunk"]];function rr(t){var e=[],n=0;nr.forEach(function(i){var s=t[i[1]];typeof s=="number"&&(e.push({label:i[0]+" "+Math.round(s)+"ms",value:s,tone:i[1]==="mediator_first_token"?"accent":"neutral"}),n+=s)});var a=t.e2e_first_audio;return typeof a=="number"&&a-n>0&&e.length&&e.push({label:"PLAY "+Math.round(a-n)+"ms",value:a-n,tone:"neutral"}),e}function ar(t){var e=Q(t.store),n=rr(e.turnLatency||{}),a=(e.turnLatency||{}).e2e_first_audio,i=typeof a=="number"?r.format.duration(a):e.latency.e2e_first_audio&&e.latency.e2e_first_audio.p50!=null?r.format.duration(e.latency.e2e_first_audio.p50):"\u2014",s=e.w>=1280;return j`
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
    </div>`}function Et(t){var e=t.s;return e.toolChip?j`
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
        <${Et} s=${a} />
      </div>
      <div style=${{position:"absolute",left:20,top:16,display:"flex",flexDirection:"column",gap:5,pointerEvents:"none"}}>
        <div className="hui-t-micro">INTELLIGENCE CORE</div>
        <div className="hui-t-micro">${(a.reducedMotion?"STATIC \xB7 ":"LATTICE \xB7 ")+s}</div>
      </div>
    </div>`}function or(t){return t==="user"?"YOU":t==="jarvis"?"JARVIS":"SYSTEM"}function xt(t){var e=t.turn;return j`
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
        ${function(u){return j`<${xt} turn=${u} />`}}
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
    <//>`}function lr(t){var e=t.store,n=t.act,a=t.refs,i=Q(e),s=r.useState(""),u=s[0],c=s[1],v=i.fsmState==="speaking"&&i.connection==="open";function d(){var h=u.trim();h&&(n.submitText(h),c(""))}return j`
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
            <${r.Button} variant="secondary" disabled=${!v} onClick=${n.interrupt}>Interrupt<//>
          <//>
          <${r.Row} align="center" gap="md" wrap=${!1}>
            <${r.Segmented}
              options=${[{value:"ptt",label:"Push to talk"},{value:"vad",label:"VAD (experimental)"}]}
              value=${i.micMode}
              onChange=${n.setMicMode} />
            <div style=${{flex:1,height:3,borderRadius:2,background:"var(--hui-line)",overflow:"hidden"}}>
              <div ref=${a.levelRef} style=${{height:"100%",width:"0%",borderRadius:2,background:"var(--hui-accent)"}} />
            </div>
            ${i.w>1100?j`<span className="hui-t-mono hui-t-micro" style=${{whiteSpace:"nowrap"}}>SPACE hold · ESC interrupt · 1·2·3 panels</span>`:null}
          <//>
          <${Rt} store=${e} s=${i} />
          <${r.Presence} show=${!!i.noSpeechHint} variant="fade">
            <div className="hui-t-faint" style=${{fontStyle:"italic"}} role="status" aria-live="polite">${i.noSpeechHint}</div>
          <//>
        </div>
      <//>
    </div>`}function vn(t){return j`
    <div style=${{minHeight:0,display:"flex",flexDirection:"column",position:"relative",minWidth:0}}>
      <${ar} store=${t.store} />
      <${ir} store=${t.store} refs=${t.refs} />
      <${sr} store=${t.store} refs=${t.refs} />
      <${lr} store=${t.store} act=${t.act} refs=${t.refs} />
    </div>`}function ye(t){if(t==null||t==="")return null;if(typeof t=="number")return t>1e12?t:t>1e9?t*1e3:null;var e=Date.parse(t);return isNaN(e)?null:e}var ur={running:"accent",queued:"neutral",paused:"neutral",done:"ok",needs_review:"warn",failed:"danger",canceled:"neutral"};function rt(t){return{label:(t||"\u2014").replace(/_/g," "),tone:ur[t]||"neutral"}}function at(t){return{label:(t||"").toUpperCase()||"\u2014",tone:t==="codex"?"info":"neutral"}}function mn(t){var e=String(t||"").toLowerCase();return e.indexOf("error")>=0||e.indexOf("fail")>=0?"danger":e.indexOf("review")>=0||e.indexOf("cancel")>=0||e.indexOf("warn")>=0||e.indexOf("restart")>=0?"warn":e.indexOf("progress")>=0||e.indexOf("log")>=0?"neutral":"accent"}var cr={done:1,failed:1,needs_review:1,canceled:1};function it(t){return!!cr[t]}var nt={running:0,queued:1,paused:2,needs_review:3,done:4,failed:5,canceled:6};function dr(t){return Object.values(t||{}).sort(function(e,n){var a=nt[e.status]!=null?nt[e.status]:9,i=nt[n.status]!=null?nt[n.status]:9;return a!==i?a-i:(n.updated_ts||0)-(e.updated_ts||0)})}function ot(t){return Object.values(t||{}).filter(function(e){return e.status==="running"||e.status==="queued"||e.status==="paused"}).length}function pn(t,e){return Object.values(t||{}).filter(function(n){return hn(e,n.id)?!1:n.status==="running"||n.status==="queued"||n.status==="paused"||n.status==="needs_review"}).length}function hn(t,e){return!!(t&&Object.prototype.hasOwnProperty.call(t,e))}function He(t,e){return dr(t).filter(function(n){return!hn(e,n.id)})}var De=de+"/tasks",Ce=de+"/backends",Ue=de+"/credits";function $n(t){return de+"/tasks/"+encodeURIComponent(t)}function fr(t,e){return de+"/memory/search?q="+encodeURIComponent(t)+"&k="+(e||8)}function ze(t){var e=Array.isArray(t)?t:t&&Array.isArray(t.tasks)?t.tasks:[],n={};return e.forEach(function(a){n[a.id]=a}),n}function st(){var t=r.useEndpoint(De);return Object.assign({},t,{tasks:ze(t.data)})}function gn(t){var e=null;return r.mutate(De,function(n){var a=ze(n);return a[t.id]=e=Object.assign({},a[t.id]||{},t,{updated_ts:Date.now()}),{tasks:Object.values(a)}}),e}function lt(){return r.useAction(function(t,e){return r.postJSON($n(t)+"/control",{action:e}).then(function(n){return n&&n.status&&r.mutate(De,function(a){var i=ze(a);return i[t]&&(i[t]=Object.assign({},i[t],{status:n.status,updated_ts:Date.now()})),{tasks:Object.values(i)}}),n})},{onError:function(t){r.toast.error("Task action failed",{detail:r.errorMessage(t)})}})}function yn(t){return r.useEndpoint(t?$n(t):null)}function ut(){return r.useEndpoint(Ce)}function bn(){return r.useAction(function(t){var e=null;return r.mutate(Ce,function(n){return e=n&&n.active,Object.assign({},n,{active:t})}),r.postJSON(Ce,{backend:t}).then(function(n){return r.mutate(Ce,function(a){return Object.assign({},a,{active:n&&n.backend||t})}),n},function(n){throw r.mutate(Ce,function(a){return Object.assign({},a,{active:e})}),n})},{onError:function(t){r.toast.error("Couldn't set worker backend",{detail:r.errorMessage(t)})}})}function Oe(){return r.useEndpoint(Ue)}function kn(){return r.useAction(function(){return r.fetchJSON(Ue+"?refresh=true").then(function(t){return r.mutate(Ue,t),t})},{onError:function(t){r.toast.error("Couldn't refresh credits",{detail:r.errorMessage(t)})}})}function wn(t,e){var n=(t||"").trim();return r.useEndpoint(n?fr(n,e||8):null)}var ee=r.html;function vr(t){if(t==null||t==="")return null;var e=ye(t);return e==null?String(t):r.format.relTime(e)}function mr(t){var e=t.hit,n=!!e.conflict,a=typeof e.score=="number"?e.score:0,i=vr(e.updated);return ee`
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
    <//>`}function ct(t){var e=t.store,n=Q(e),a=r.useState(n.memQuery||""),i=a[0],s=a[1],u=wn(i),c=!!i.trim(),v=c?u.data&&u.data.hits||[]:n.memoryHits||[];return ee`
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
      ${v.length===0?c?u.loading?ee`<div className="hui-t-sub">Searching…</div>`:u.error?ee`<${r.ErrorState} compact title="Search failed" error=${u.error} onRetry=${u.reload} />`:ee`<div className="hui-t-sub">No matches in the vault.</div>`:ee`<${r.EmptyState} compact icon="brain" title="No recall this turn"
              hint="Memory is queried only when the mediator calls memory_recall." />`:ee`<${r.AnimatedList} items=${v} getKey=${function(d,h){return(d.path||"hit")+":"+h}}>
            ${function(d){return ee`<${mr} hit=${d} />`}}
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
    <//>`}function Tn(t){return ee`<${ct} store=${t.store} fill />`}var be=r.html,pr={error:"danger",attention:"warn",info:"info"};function hr(t,e){return!!(t&&Object.prototype.hasOwnProperty.call(t,e))}function Mn(t){return(t.notices||[]).filter(function(e){return!hr(t.dismissedNotices,e.id)})}function We(t){var e=Mn(t),n=!1,a=!1;return e.forEach(function(i){i.tone==="error"?n=!0:i.tone==="attention"&&(a=!0)}),{count:e.length,tone:n?"danger":a?"warn":null}}function dt(t){return t.tone?be`<${r.StatusDot} tone=${t.tone} pulse />`:null}function $r(t){var e=[],n={};return t.forEach(function(a){var i=(a.tone||"info")+"|"+(a.approve?"1":"0")+"|"+(a.title||""),s=n[i];s||(s={key:i,tone:a.tone,title:a.title,approve:!!a.approve,items:[]},n[i]=s,e.push(s)),s.items.push(a)}),e}function gr(t){var e=t.group,n=t.act,a=t.mobile,i=lt(),s=e.items.length===1,u=e.items[0];function c(E){E.taskId?i.run(E.taskId,"resume").then(function(){n.resolveNotice(E.id,!0)},function(){}):n.resolveNotice(E.id,!0)}function v(E){n.resolveNotice(E.id,!1)}function d(E){E.approve?v(E):n.dismissNotice(E.id)}var h=null;if(s&&u.approve)h=be`
      <${r.Row} gap="sm">
        <${r.Button} size="sm" variant="primary" loading=${i.pending} onClick=${function(){c(u)}}>Approve<//>
        <${r.Button} size="sm" variant="danger" onClick=${function(){v(u)}}>Decline<//>
      <//>`;else if(!s){var k=[];e.approve&&k.push(be`<${r.Button} key="aa" size="sm" variant="primary" loading=${i.pending}
        onClick=${function(){e.items.forEach(c)}}>Approve all<//>`),k.push(be`<${r.Button} key="da" size="sm" variant="secondary"
      onClick=${function(){e.items.forEach(d)}}>Dismiss all<//>`),h=be`<${r.Row} gap="sm">${k}<//>`}return be`
    <${r.NotificationCard}
      severity=${pr[e.tone]||"info"}
      title=${e.title}
      body=${s?u.body:void 0}
      time=${s&&!a?u.ts:void 0}
      count=${e.items.length}
      items=${s?void 0:e.items.map(function(E){return{id:E.id,label:E.body||E.title}})}
      actions=${h}
      onDismiss=${function(){e.items.forEach(d)}}
    />`}function ft(t){var e=t.s,n=t.act,a=t.mobile,i=Mn(e);if(!i.length)return null;var s=$r(i);return be`
    <${r.Stack} gap="sm">
      <div className="hui-t-micro">
        ${r.format.plural(i.length,"notification")}${s.length<i.length?" \xB7 "+r.format.plural(s.length,"group"):""}
      </div>
      ${s.map(function(u){return be`<${gr} key=${u.key} group=${u} act=${n} mobile=${a} />`})}
    <//>`}var O=r.html;function yr(t){var e=t.payload,n="";if(e!=null)if(typeof e=="string")n=e;else if(e.message)n=e.message;else if(e.note)n=e.note;else try{n=JSON.stringify(e)}catch{n=""}var a=t.type||t.kind||"event";return n?a+" \xB7 "+n:a}function br(t){var e=t&&(t.task||t)||{};return{events:t&&(t.events||t.task_events)||e.events||[],result_text:e.result_text||"",result_summary:e.result_summary||"",session_id:e.session_id||e.session||""}}function kr(t){var e=t.detail;return O`
    <${r.DataState} state=${e} emptyText="No task detail" compact>
      ${function(n){var a=br(n),i=a.events||[],s=a.result_text||a.result_summary||"";return O`
          <${r.Stack} gap="sm">
            <div className="hui-t-micro">EVENT TIMELINE</div>
            ${i.length===0?O`<div className="hui-t-sub">No events recorded for this task.</div>`:O`<${r.ActivityFeed} items=${i.map(function(u,c){return{id:c,at:ye(u.ts)||Date.now(),title:yr(u),tone:mn(u.type)}})} />`}
            ${s?O`<${r.Stack} gap="sm"><div className="hui-t-micro">RESULT</div><${r.CodeBlock} maxHeight=${160}>${s}<//><//>`:null}
            <${r.KeyValue} label="Session" value=${a.session_id||"\u2014"} mono copyable=${!!a.session_id} />
          <//>`}}
    <//>`}function En(t){var e=t.task,n=t.act,a=t.mobile,i=rt(e.status),s=at(e.kind),u=e.status==="running",c=e.progress_note||e.result_summary||"",v=lt(),d=r.useState(!1),h=yn(!a&&d[0]?e.id:null),k=null;if(e.status==="done"){var E=ye(e.started),L=ye(e.finished);E&&L&&L>E&&(k="took "+r.format.duration(L-E))}else{var $=ye(e.started)||ye(e.created)||e.updated_ts;$&&(k=O`<${r.RelTime} at=${$} />`)}var A=[];return e.status==="running"&&A.push({label:"Pause",variant:"secondary",run:"pause"}),e.status==="paused"&&A.push({label:"Resume",variant:"primary",run:"resume"}),(e.status==="running"||e.status==="paused"||e.status==="queued")&&A.push({label:"Cancel",variant:"danger",run:"cancel"}),e.status==="needs_review"&&A.push({label:"Re-delegate",variant:"primary",run:"resume"}),it(e.status)&&A.push({label:"Dismiss",variant:"secondary",run:"dismiss"}),O`
    <${r.Card} padding="sm" tone=${e.status==="needs_review"?"warn":void 0}>
      <${r.Row} justify="between" align="center" gap="sm">
        <${r.Badge} tone=${i.tone}>${i.label}<//>
        <${r.Row} gap="sm" align="center">
          <${r.Badge} tone=${s.tone} variant="outline" size="sm">${s.label}<//>
          ${k?O`<span className="hui-t-num hui-t-micro">${k}</span>`:null}
        <//>
      <//>
      <div className="hui-t-body" style=${{marginTop:8,fontWeight:600}}>${e.title||e.goal||e.id}</div>
      ${u?O`<${r.Meter} indeterminate size="sm" style=${{marginTop:8}} />`:null}
      ${c?O`<div className="hui-t-sub" style=${{marginTop:8}}>${c}</div>`:null}
      <${r.Row} gap="sm" style=${{marginTop:10}}>
        ${A.map(function(w){var T=v.pending&&w.run!=="dismiss";return O`
            <${r.Button} key=${w.label} size=${a?"md":"sm"} variant=${w.variant} loading=${w.run!=="dismiss"&&T}
              onClick=${function(){w.run==="dismiss"?n.dismissTask(e.id):v.run(e.id,w.run)}}>${w.label}<//>`})}
      <//>
      ${a?null:O`
          <${r.Disclosure} title="Detail" open=${d[0]} onOpenChange=${d[1]} className="jv-task-detail">
            ${d[0]?O`<${kr} detail=${h} />`:null}
          <//>`}
    <//>`}function xn(t){return O`<${En} task=${t.task} act=${t.act} mobile />`}function _t(t){var e=t.items.slice().reverse();return O`
    <${r.ActivityFeed} items=${e.map(function(n){return{id:n.id,at:n.ts,title:n.label,tone:n.tone,body:t.verbose?n.detail:void 0}})} />`}function wr(t){var e=t.store,n=t.s;return O`
    <${r.Stack} gap="sm">
      <${r.Row} justify="between" align="center">
        <${r.Button} size="sm" variant=${n.verbose?"primary":"secondary"} aria-pressed=${n.verbose}
          onClick=${function(){e.set({verbose:!n.verbose})}}>
          ${n.verbose?"Trace detail: on":"Trace detail: off"}
        <//>
        <span className="hui-t-num hui-t-micro">${r.format.plural(n.timeline.length,"event")}</span>
      <//>
      ${n.timeline.length===0?O`<${r.EmptyState} compact icon="activity" title="Nothing yet this session" />`:O`<${_t} items=${n.timeline} verbose=${n.verbose} />`}
    <//>`}var Sr=[["stt","stt final"],["mediator_first_token","mediator first token"],["tts_first_chunk","tts first chunk"],["e2e_first_audio","end-to-end first audio"]];function Tr(t){var e=t.s,n=t.act,a=e.health||{},i=a.components||{},s=Object.keys(i),u=a.models||{},c=a.ram||{},v=typeof c.free_gb=="number"?c.free_gb:null,d=typeof c.total_gb=="number"?c.total_gb:null;return O`
    <${r.Stack} gap="sm">
      <${r.Card} title="Component health" padding="sm">
        ${s.length===0?O`<${r.EmptyState} compact title="Waiting for /health…" />`:O`<${r.List} dense items=${s.map(function(h){var k=i[h]||{};return{id:h,leading:O`<${r.StatusDot} tone=${k.ok?"accent":"danger"} />`,title:h,description:k.detail||"",trailing:O`<${r.Badge} tone=${k.ok?"ok":"danger"} size="sm">${k.ok?"OK":"ERR"}<//>`}})} />`}
      <//>
      <${r.Card} title="Latency · last 20 turns" padding="sm">
        <${r.Stack} gap="md">
          ${Sr.map(function(h){var k=h[0],E=e.latency[k],L=n.getSeries(k);return O`
              <div key=${k}>
                <${r.Row} justify="between" align="baseline">
                  <span className="hui-t-sub" style=${{flex:1}}>${h[1]}</span>
                  <span className="hui-t-num">${E&&E.p50!=null?E.p50+" ms":"\u2014"}</span>
                  <span className="hui-t-num hui-t-faint">${E&&E.p95!=null?E.p95+" ms":"\u2014"}</span>
                <//>
                <${r.Sparkline} data=${L} height=${18} tone=${k==="e2e_first_audio"?"accent":!1} />
              </div>`})}
        <//>
      <//>
      <${r.Card} title="Residency & memory" padding="sm">
        <${r.Stack} gap="sm">
          <${r.KVList} items=${["mediator","worker"].map(function(h){var k=u[h]||{};return{label:h,value:(k.name||h+" \u2014")+(k.resident?" \xB7 resident":" \xB7 on demand")}})} />
          <${r.Meter}
            label="Unified memory"
            value=${v!=null&&d?d-v:0}
            max=${d||1}
            indeterminate=${v==null||!d}
            valueText=${v==null?"\u2014":v.toFixed(1)+" GB free"+(d?" / "+d+" GB":"")} />
        <//>
      <//>
      <${r.KpiRow} size="sm" items=${[{label:"Barge-ins",value:e.bargeIns,sub:"this session"},{label:"Errors",value:e.errCount,sub:"recoverable"}]} />
    <//>`}function Cn(t){var e=t.store,n=t.act,a=Q(e),i=st(),s=t.showLeft,u=We(a),c=[{id:"work",label:O`<${r.Row} gap="sm" align="center"><${dt} tone=${u.tone} /><span>Work</span><//>`,badge:ot(i.tasks)||void 0},{id:"activity",label:"Activity",badge:a.timeline.length||void 0}];s||c.push({id:"memory",label:"Memory",badge:(a.memoryHits||[]).length||void 0}),c.push({id:"system",label:"System"});var v=s&&a.tab==="memory"?"work":a.tab,d=He(i.tasks,a.dismissedTasks);return O`
    <div style=${{minHeight:0,display:"flex",flexDirection:"column",borderLeft:"1px solid var(--hui-line)"}}>
      <${r.Tabs} className="jv-work-tabs" items=${c} value=${v} onChange=${function(h){e.set({tab:h})}}
        ariaLabel="Work panels" idPrefix="jv-work" />
      <${r.ScrollArea} style=${{flex:1,minHeight:0,padding:"10px 14px 14px"}}>
        <${r.TabPanel} when="work" value=${v} idPrefix="jv-work">
          <${r.ErrorBoundary}>
            <${r.Stack} gap="sm">
              <${ft} s=${a} act=${n} />
              <${r.DataState} state=${i} empty=${function(){return d.length===0&&!u.count}}
                emptyText="No tasks yet. Delegate something.">
                ${function(){return O`<${r.AnimatedList} items=${d} getKey=${function(h){return h.id}}>
                  ${function(h){return O`<${En} task=${h} act=${n} />`}}
                <//>`}}
              <//>
            <//>
          <//>
        <//>
        <${r.TabPanel} when="activity" value=${v} idPrefix="jv-work">
          <${r.ErrorBoundary}><${wr} store=${e} s=${a} /><//>
        <//>
        ${s?null:O`<${r.TabPanel} when="memory" value=${v} idPrefix="jv-work"><${r.ErrorBoundary}><${ct} store=${e} fill /><//><//>`}
        <${r.TabPanel} when="system" value=${v} idPrefix="jv-work">
          <${r.ErrorBoundary}><${Tr} s=${a} act=${n} /><//>
        <//>
      <//>
    </div>`}var K=r.html,Ke={local:{name:"Local",caption:"\u22482\u20136 s \xB7 64k ctx \xB7 no spend",sub:"gpt-oss-20b \xB7 free \xB7 on-box",tier:"free"},cloud:{name:"Cloud",caption:"\u22481\u20133 s \xB7 $ per call \xB7 weekly cap",sub:"cloud \xB7 uses limit",tier:"limit"},codex:{name:"Codex",caption:"\u22484\u201320 s \xB7 coding agent \xB7 sub credits",sub:"codex \xB7 weekly credits",tier:"sub"},claude:{name:"Claude Code",caption:"\u22484\u201320 s \xB7 coding agent \xB7 weekly + session",sub:"claude \xB7 weekly + session",tier:"sub"}},Mr=["local","cloud","codex","claude"],Er="Selection applies to delegated tasks and tool calls. Mediator, transcription and speech always stay on-box.";function At(t){return Ke[t]||{name:t,caption:"",sub:"",tier:"sub"}}function xr(t,e){var n=t&&Array.isArray(t.backends)?t.backends:Mr;return n.filter(function(a){return Ke[a]||e&&e.backends&&e.backends[a]})}function Nt(t,e){return t&&t.backends&&t.backends[e]||null}function Cr(t,e){return e?"refreshing":t.loading?"loading":t.error&&!t.data?"error":t.stale||t.data&&t.data.stale?"stale":"ok"}function Rr(t,e){if(e==="refreshing")return"checking\u2026";if(e==="loading")return"";if(e==="error")return"check failed";var n=t.data&&t.data.checked_epoch;return n?"checked "+r.format.relTime(n*1e3):e==="stale"?"stale":""}function It(t){return K`<${r.Badge} tone=${t==="free"?"ok":"warn"} size="sm">${(t||"sub").toUpperCase()}<//>`}function _r(t){var e=t.note||"",n=e.split("\xB7").map(function(s){return s.trim()}),a=n[0]||(t.tier==="free"?"no spend":(t.tier||"").toUpperCase()),i=n.slice(1).join(" \xB7 ");return K`
    <div style=${{textAlign:"center",width:t.mobile?88:96,flex:"none"}}>
      <div className=${"hui-t-mono"+(t.tier==="free"?" hui-t-ok":" hui-t-dim")} style=${{fontSize:11}}>${a}</div>
      ${i?K`<div className="hui-t-mono hui-t-micro" style=${{fontSize:9}}>${i}</div>`:null}
    </div>`}function Ar(t){var e=t.id,n=t.backends,a=t.credits,i=t.phase,s=t.selectBackend,u=t.mobile,c=t.act,v=At(e),d=Nt(a,e),h=n.active===e||!n.active&&e==="local",k=!n.available||n.available[e]!==!1,E=d&&d.tier||v.tier,L=d&&d.note,$=d&&d.gauges||[],A=!!d&&d.available===!1,w;A?w=K`<${r.SpeedGauge} label=${v.name} value="unavailable" sub=${L} small=${u} />`:$.length?w=$.map(function(R,P){return K`<${r.SpeedGauge} key=${R.label||"g"+P} label=${R.label} remaining=${R.remaining_pct}
        value=${R.value_label} sub=${i==="stale"?"stale \xB7 refresh":r.format.untilTime(R.reset_epoch?R.reset_epoch*1e3:null)}
        loading=${i==="loading"||i==="refreshing"} small=${u} />`}):!d&&(i==="loading"||i==="refreshing")?w=K`<${r.SpeedGauge} label=${v.name} loading small=${u} />`:w=K`<${_r} note=${L} tier=${E} mobile=${u} />`;var T=v.caption+(L&&$.length?" \xB7 "+L:""),F=K`
    <${r.Row} gap="sm" align="center">
      <span style=${{fontWeight:600}}>${v.name}</span>
      ${It(E)}
    <//>`;return K`
    <${r.ListItem}
      leading=${K`<${r.StatusDot} tone=${h?"accent":k?"neutral":"danger"} />`}
      title=${F}
      description=${T}
      trailing=${w}
      selected=${h}
      style=${{opacity:k?1:.6,cursor:k?"pointer":"not-allowed",minHeight:u?44:void 0}}
      onClick=${k?function(){s.run(e),c.log("backend","Worker backend set to "+v.name+(v.sub?" \xB7 "+v.sub:""),null,e==="local"?"info":"warn"),t.onPicked&&t.onPicked()}:void 0} />`}function Nr(t){return K`
    <${r.Button} size=${t.mobile?"md":"sm"} variant="secondary" icon="refresh" loading=${t.refreshing} onClick=${t.onClick}>
      Refresh
    <//>`}function Rn(t){var e=t.mobile,n=t.act,a=ut(),i=Oe(),s=bn(),u=kn(),c=a.data||{},v=i.data||{},d=Cr(i,u.pending);return K`
    <${r.Stack} gap="sm">
      <${r.Row} justify="between" align="center">
        <span className="hui-t-micro">${e?"":"WORKER BACKEND"}</span>
        <${r.Row} gap="sm" align="center">
          <span className="hui-t-micro">${Rr(i,d)}</span>
          <${Nr} mobile=${e} refreshing=${d==="refreshing"}
            onClick=${function(){u.run(),n.log("credits","Checked subscription credits","manual refresh \xB7 not polled","info")}} />
        <//>
      <//>
      ${xr(c,v).map(function(h){return K`<${Ar} key=${h} id=${h} backends=${c} credits=${v} phase=${d}
          selectBackend=${s} act=${n} mobile=${e} onPicked=${t.onPicked} />`})}
      <div className="hui-t-micro" style=${{lineHeight:1.5}}>${Er}</div>
    <//>`}function _n(t){var e=t.act,n=ut(),a=Oe(),i=n.data||{},s=a.data||{},u=i.active||"local",c=At(u),v=Nt(s,u),d=v&&v.tier||c.tier,h=!i.available||i.available[u]!==!1;return K`
    <${r.Popover} placement="bottom" align="end" panelClassName="jv-backend-pop"
      trigger=${K`
        <button type="button" className="hui-btn hui-btn--secondary hui-btn--sm" aria-label="Choose worker backend">
          <${r.StatusDot} tone=${h?"accent":"danger"} />
          <span style=${{display:"flex",flexDirection:"column",alignItems:"flex-start",lineHeight:1.15}}>
            <span className="hui-t-micro">BACKEND</span>
            <span style=${{fontWeight:600}}>${c.name}</span>
          </span>
          ${It(d)}
        </button>`}>
      ${function(k){return K`<div style=${{width:380}}><${Rn} act=${e} onPicked=${k.close} /></div>`}}
    <//>`}function An(t){var e=ut(),n=Oe(),a=e.data||{},i=a.active||"local",s=At(i),u=Nt(n.data,i),c=u&&u.tier||s.tier;return K`
    <button type="button" onClick=${t.onClick} aria-label="Worker backend and credits"
      className="hui-btn hui-btn--secondary hui-btn--sm"
      style=${t.attention?{borderColor:"var(--hui-warn)"}:void 0}>
      <${r.StatusDot} tone="accent" />
      <span style=${{fontWeight:600}}>${s.name}</span>
      ${It(c)}
    </button>`}function Nn(t){return K`<${Rn} act=${t.act} mobile />`}var G=r.html;function Ir(t){var e=t.s,n=He(t.tasks,e.dismissedTasks),a=n.filter(function(u){return u.status==="running"})[0]||n.filter(function(u){return u.status==="needs_review"})[0];if(!a)return null;var i=rt(a.status),s=at(a.kind);return G`
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
      ${a.map(function(s){return G`<${xt} key=${s.id} turn=${s} />`})}
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
        ${i.length===0&&!We(e).count?G`<${r.EmptyState} compact title="No tasks yet" />`:i.map(function(s){return G`<${xn} key=${s.id} task=${s} act=${n} />`})}
      <//>`:e.sheet==="backend"?G`<${Nn} act=${n} />`:e.sheet==="memory"?G`<${Tn} store=${a} />`:e.sheet==="activity"?e.timeline.length===0?G`<${r.EmptyState} compact title="Nothing yet this session" />`:G`<${_t} items=${e.timeline} verbose=${!1} />`:null}var Or={tasks:"Tasks & notifications",memory:"Memory",backend:"Worker backend",activity:"Activity"};function In(t){var e=t.store,n=t.act,a=t.refs,i=Q(e),s=st(),u=r.useState(""),c=u[0],v=u[1],d=i.fsmState==="speaking"&&i.connection==="open",h=We(i);function k(){var $=c.trim();$&&(n.submitText($),v(""))}function E(){e.set({sheet:null})}var L=[{id:"tasks",label:"Tasks",count:pn(s.tasks,i.dismissedTasks),tone:h.tone},{id:"memory",label:"Memory",count:(i.memoryHits||[]).length},{id:"activity",label:"Activity",count:i.timeline.length}];return G`
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
        <${Et} s=${i} />
      <//>
      <${Ir} s=${i} tasks=${s.tasks} />
      <${Pr} s=${i} refs=${a} />
      <div style=${{flex:"none",padding:"8px 12px calc(12px + env(safe-area-inset-bottom))",borderTop:"1px solid var(--hui-line)"}}>
        <${r.Row} gap="sm" wrap=${!1}>
          ${L.map(function($){return G`
              <${r.Button} key=${$.id} variant="secondary" size="md" block onClick=${function(){e.set({sheet:$.id})}}>
                ${$.tone?G`<${dt} tone=${$.tone} />`:null} ${$.label}${$.count?" "+$.count:""}
              <//>`})}
        <//>
        <${r.Row} align="end" gap="sm" style=${{marginTop:10}} wrap=${!1}>
          <div style=${{flex:1,minWidth:0}}>
            <${r.Textarea} value=${c} onChange=${v} minRows=${1} maxRows=${3} placeholder="Message Jarvis…"
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
      <${r.Sheet} open=${!!i.sheet} onClose=${E} title=${Or[i.sheet]||""} snapPoints=${[.62,.92]}>
        <${Dr} s=${i} act=${n} store=${e} tasks=${s.tasks} />
      <//>
    </div>`}var Z=r.html,Lr=200,Br=40,Fr=15e3,jr=860,Hr=1280,Ur=20,Pn="jarvis-voice:dismissedNotices",Dn=100,zr={failed:{tone:"error",title:"Task failed"},needs_review:{tone:"attention",title:"Needs review"}};function On(t){var e=zr[t.status];return e?{id:"task:"+t.id+":"+t.status,tone:e.tone,title:e.title+" \xB7 "+(t.title||t.goal||t.id),body:t.result_summary||t.progress_note||(t.status==="needs_review"?"Waiting for your review \u2014 approve to re-delegate, or decline.":""),ts:Date.now(),taskId:t.id,approve:t.status==="needs_review"}:null}function Wr(t,e){try{var n=window.localStorage.getItem(t);return n===null?e:n==="1"}catch{return e}}function Kr(t,e){try{window.localStorage.setItem(t,e?"1":"0")}catch{}}function Gr(t,e){try{var n=window.localStorage.getItem(t);return n===null?e:parseFloat(n)}catch{return e}}var Pt="jarvis-voice:dismissedTasks";function Ln(t,e){try{var n=window.localStorage.getItem(t);if(n===null)return e;var a=JSON.parse(n);return a&&typeof a=="object"?a:e}catch{return e}}function Dt(t,e){try{window.localStorage.setItem(t,JSON.stringify(e))}catch{}}function Bn(t){if(!t)return!1;var e=t.tagName;return e==="INPUT"||e==="TEXTAREA"||t.isContentEditable}function Jr(t){return String(t).replace(/_/g," ").replace(/^./,function(e){return e.toUpperCase()})}function ke(t){if(t==null)return"";if(typeof t=="string")return t;try{return JSON.stringify(t,null,2)}catch{return String(t)}}function qr(t){return Math.min(1e3*Math.pow(2,Math.max(0,t-1)),1e4)}function jn(){return!!(document.fullscreenElement||document.webkitFullscreenElement)}function Vr(t){return!!(t&&(t.requestFullscreen||t.webkitRequestFullscreen))}function Fn(t){var e=t&&t.get();if(jn()){document.exitFullscreen?document.exitFullscreen():document.webkitExitFullscreen&&document.webkitExitFullscreen();return}if(e&&e.pseudoFullscreen){t.set({pseudoFullscreen:!1});return}var n=document.getElementById("jarvis-voice-root");if(n){if(Vr(n)){var a=n.requestFullscreen?n.requestFullscreen():n.webkitRequestFullscreen();a&&typeof a.catch=="function"&&a.catch(function(){console.info("[jarvis-voice] requestFullscreen() was rejected \u2014 falling back to pseudo-fullscreen."),t&&t.set({pseudoFullscreen:!0})});return}console.info("[jarvis-voice] Fullscreen API unavailable on this browser (likely iOS Safari) \u2014 using pseudo-fullscreen instead."),t&&t.set({pseudoFullscreen:!0})}}var Yr={position:"fixed",inset:0,top:0,left:0,margin:0,width:"100vw",height:"100dvh",zIndex:2147483647},Xr="radial-gradient(120% 90% at 50% 0%, var(--hui-surface-2) 0%, var(--hui-bg) 55%, var(--hui-bg) 100%)";function Ot(){var t=r.useRef(null);t.current||(t.current=nn({connection:"connecting",offline:!1,fsmState:"idle",fsmDetail:null,sttPartial:"",sttFinal:"",mediatorText:"",ttsPlaying:!1,micActive:!1,micMode:"ptt",reducedMotion:Wr("jarvis-voice:reducedMotion",!!(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches)),volume:Gr("jarvis-voice:volume",1),timeline:[],dismissedTasks:Ln(Pt,{}),memoryHits:[],health:null,latency:{},micError:null,micHint:null,notices:[],dismissedNotices:Ln(Pn,{}),tab:"work",sheet:null,verbose:!1,w:typeof window<"u"?window.innerWidth:1440,turns:[],speakingText:"",toolChip:null,turnId:null,turnLatency:{},memQuery:"",bargeIns:0,errCount:0,retryAttempt:0,retryAt:0,lastEventTs:0,offlineDismissed:!1,fullscreen:typeof document<"u"&&!!(document.fullscreenElement||document.webkitFullscreenElement),pseudoFullscreen:!1,noSpeechHint:null}));var e=t.current,n=Q(e),a=r.useRef(null);a.current||(a.current={canvasRef:{current:null},logRef:{current:null},levelRef:{current:null},micRingRef:{current:null},micRingMobileRef:{current:null},composerInputRef:{current:null}});var i=a.current,s=r.useRef(null),u=r.useRef(null),c=r.useRef(null),v=r.useRef(null);v.current||(v.current=rn(20));var d=r.useRef({start:function(){},stop:function(){}}),h=r.useRef([]),k=r.useRef(""),E=r.useRef(0),L=r.useRef(0),$=r.useRef(null);function A(p,g,y,C){e.set(function(D){return{timeline:Tt(D.timeline,{id:p+":"+Date.now()+":"+Math.random(),ts:Date.now(),type:p,label:g,detail:ke(y),tone:C||"neutral"},Lr)}})}function w(p,g,y,C){e.set(function(D){return{turns:Tt(D.turns,{id:p+":"+Date.now()+":"+Math.random(),role:p,text:g,time:r.format.clockTime(Date.now()),meta:y||[],dim:!!(C&&C.dim),tone:C&&C.tone||null},Br)}})}function T(p){p&&e.set(function(g){if(g.dismissedNotices&&Object.prototype.hasOwnProperty.call(g.dismissedNotices,p.id))return{};var y=(g.notices||[]).filter(function(C){return C.id!==p.id});return{notices:[p].concat(y).slice(0,Ur)}})}function F(p){e.set(function(g){var y=Object.assign({},g.dismissedNotices);y[p]=Date.now();var C=Object.keys(y);return C.length>Dn&&C.sort(function(D,J){return y[D]-y[J]}).slice(0,C.length-Dn).forEach(function(D){delete y[D]}),Dt(Pn,y),{dismissedNotices:y,notices:(g.notices||[]).filter(function(D){return D.id!==p})}})}function R(p){var g=e.get(),y=(g.mediatorText||"").trim();if(y){var C=h.current.slice();p==="interrupted"&&C.push("interrupted");var D=g.turnLatency&&g.turnLatency.e2e_first_audio;typeof D=="number"&&C.push("e2e "+(D/1e3).toFixed(2)+" s"),w("jarvis",y,C),h.current=[],e.set({mediatorText:"",speakingText:""})}}function P(){h.current=[],e.set({turnLatency:{}})}function B(p,g){typeof g=="number"&&(v.current.record(p,g),e.set(function(y){var C=Object.assign({},y.turnLatency);return C[p]=g,{latency:v.current.summary(),turnLatency:C}}))}function U(p){if(p.length){var g=++E.current,y=k.current||p[0].title||p[0].path||"";y&&Qe("/memory/search?q="+encodeURIComponent(y)+"&k="+Math.max(p.length,3)).then(function(C){if(g===E.current){var D={};(C&&C.hits||[]).forEach(function(H){H&&H.path&&(D[H.path]=H)});var J=p.map(function(H){return Object.assign({},D[H.path]||{},H)});e.set({memoryHits:J})}}).catch(function(){})}}function V(){clearTimeout($.current),e.set({noSpeechHint:"Didn't catch that."}),$.current=setTimeout(function(){e.set({noSpeechHint:null})},3e3)}function Re(p){r.fetchJSON(De).then(function(g){r.mutate(De,g);var y=ze(g);if(Object.values(y).forEach(function(D){D.status==="needs_review"&&T(On(D))}),p){var C=ot(y);w("system","Session resumed \xB7 "+C+" open task"+(C===1?"":"s")+" replayed from jarvis.db")}}).catch(function(){}),Qe("/health").then(function(g){e.set({health:g})}).catch(function(){}),r.invalidate(Ce),r.invalidate(Ue)}r.useEffect(function(){var p=sn();p.setGain(e.get().volume),c.current=p;var g=0,y=!1,C=null,D=0,J=on({onChunk:function(o){var m=u.current;m&&m.sendBinary(o)},onLevel:function(o){var m=e.get().micActive,b=m?o:0;g=o,s.current&&s.current.onMicLevel(b),D+=(Math.min(1,b)-D)*.35,i.levelRef.current&&(i.levelRef.current.style.width=Math.round(Math.min(1,b)*100)+"%"),[i.micRingRef.current,i.micRingMobileRef.current].forEach(function(N){N&&(N.style.opacity=m?String(.25+D*.7):"0",N.style.transform="scale("+(m?1+D*.16:.9)+")")})},onError:function(o){e.set({micError:o}),A("error",o,null,"danger")}});function H(){clearTimeout(C),y=!1,e.set({micHint:null}),C=setTimeout(function(){e.get().micActive&&J.getChunkCount()>0&&g<.02&&!y&&e.set({micHint:"Mic level is silent \u2014 check input device/permissions."})},2e3)}var le=setTimeout(function(){e.get().connection!=="open"&&e.set({offline:!0})},1500);function ve(o){if(!(!o||!o.t))switch(L.current=Date.now(),o.turn_id!=null&&o.turn_id!==e.get().turnId&&o.t!=="tts.amp"&&e.set({turnId:o.turn_id}),o.t){case"state":e.set({fsmState:o.value,fsmDetail:o.detail||null}),A("state",Jr(o.value)+(o.detail?" \u2014 "+o.detail:""),null,o.value==="error"?"danger":o.value==="blocked"?"warn":"neutral"),o.value==="listening"&&P(),(o.value==="done"||o.value==="idle")&&R(o.value),o.value==="interrupted"&&R("interrupted"),o.detail==="turn timed out"?(w("system","Turn failed: timed out waiting for a reply.",[],{tone:"red"}),h.current=[],e.set({mediatorText:"",speakingText:""})):o.detail==="no speech recognized"&&V(),o.value!=="idle"&&o.value!=="listening"&&(y=!0);break;case"stt.partial":e.set({sttPartial:o.text||""}),y=!0,e.get().micHint&&e.set({micHint:null});break;case"stt.final":e.set({sttPartial:"",sttFinal:o.text||""}),k.current=o.text||"",o.text&&w("user",o.text),A("stt.final","Transcribed: \u201C"+(o.text||"")+"\u201D",typeof o.ms=="number"?"stt.final ms: "+o.ms:null,"neutral"),B("stt",o.ms),y=!0,e.get().micHint&&e.set({micHint:null});break;case"stt.ignored":o.text&&w("user",o.text,["ignored \u2014 "+(o.reason||"echo")],{dim:!0}),A("stt.ignored","Ignored: \u201C"+(o.text||"")+"\u201D ("+(o.reason||"echo")+")",ke(o),"warn"),y=!0;break;case"mediator.delta":e.set(function(N){return{mediatorText:N.mediatorText+(o.text||"")}});break;case"mediator.done":e.set({mediatorText:o.text||""}),A("mediator.done","Mediator replied \xB7 "+(o.text||"").split(/\s+/).length+" words",ke({ms_first_token:o.ms_first_token,ms_total:o.ms_total}),"neutral"),B("mediator_first_token",o.ms_first_token);break;case"meta_tool":o.phase==="start"?e.set({toolChip:{name:o.name,start:Date.now()}}):(e.set({toolChip:null}),h.current.push(o.name+(typeof o.ms=="number"?" \xB7 "+o.ms+" ms":""))),A("meta_tool",o.name+(o.phase==="end"?o.result_summary?" \u2192 "+o.result_summary:" finished":" started"),ke({args:o.args,ms:o.ms}),"accent");break;case"tts.start":e.get().ttsPlaying||A("tts.start","TTS started \xB7 kokoro-onnx",null,"neutral"),e.set({ttsPlaying:!0,speakingText:o.text||""});break;case"tts.chunk_hdr":break;case"tts.amp":s.current&&s.current.onAmp(typeof o.v=="number"?o.v:0);break;case"tts.end":e.set({ttsPlaying:!1,speakingText:""}),B("tts_first_chunk",o.ms_first_chunk);break;case"task.update":{var m=gn(o);e.set(function(N){var I=N.dismissedTasks;return o.status&&I&&Object.prototype.hasOwnProperty.call(I,o.id)&&I[o.id]!==o.status&&(I=Object.assign({},I),delete I[o.id],Dt(Pt,I)),{dismissedTasks:I}}),A("task.update",(o.title||o.id)+" \u2192 "+o.status,ke({progress_note:o.progress_note,result_summary:o.result_summary}),o.status==="failed"?"danger":o.status==="needs_review"?"warn":"accent"),it(o.status)&&T(On(m));break}case"memory.hits":{var b=o.items||[];e.set({memoryHits:b}),s.current&&s.current.onMemoryHits(b),h.current.push("memory_recall \xB7 "+b.length+" hit"+(b.length===1?"":"s")),A("memory.hits","memory_recall \u2192 "+b.length+" hits",ke(b),"accent"),U(b);break}case"latency":B(o.stage,o.ms);break;case"health":e.set({health:o}),A("health","Health changed",ke(o.components),"warn");break;case"error":e.set(function(N){return{errCount:N.errCount+1}}),A("error",o.message||"error",ke(o),"danger"),w("system",o.message||"Turn failed \u2014 no reply.",[],{tone:"red"}),h.current=[],e.set({mediatorText:"",speakingText:""}),T({id:"error:"+Date.now(),tone:"error",title:"Pipeline error",body:o.message||"Turn failed \u2014 see the activity stream.",ts:Date.now(),approve:!1});break;case"pong":break;default:A(o.t,o.t,null,"neutral")}}var se=0,Y=an({onEvent:ve,onBinary:function(o){p.queueChunk(o)},onStatus:function(o){if(e.set({connection:o}),o==="open")clearTimeout(le),se=0,e.set({offline:!1,offlineDismissed:!1,retryAttempt:0,retryAt:0}),Re(!0);else if(o==="reconnecting"){se++;var m=Math.ceil(se/2);e.set({offline:!0,retryAttempt:m,retryAt:se%2===1?Date.now()+qr(m):e.get().retryAt,lastEventTs:L.current})}},onOpen:function(){}});u.current=Y;function l(){e.get().micActive||(e.set({micActive:!0}),e.get().ttsPlaying&&(p.hardStop(),Y.send({t:"barge_in"}),e.set(function(o){return{bargeIns:o.bargeIns+1}})),Y.send({t:"mic.start"}),J.start(),H())}function M(){e.get().micActive&&(e.set({micActive:!1}),J.stop(),Y.send({t:"mic.stop"}),clearTimeout(C),e.set({micHint:null}))}d.current.start=l,d.current.stop=M;function f(){p.hardStop(),Y.send({t:"barge_in"}),e.set(function(o){return{bargeIns:o.bargeIns+1}})}d.current.interrupt=f;function S(o){if((o.metaKey||o.ctrlKey)&&String(o.key).toLowerCase()==="k"){o.preventDefault(),i.composerInputRef.current&&i.composerInputRef.current.focus();return}var m=Bn(document.activeElement);if(o.code==="Space"){if(!document.hasFocus()||m||o.repeat)return;o.preventDefault(),l();return}if(o.key==="Escape"){f();return}if(!m&&!o.metaKey&&!o.ctrlKey&&!o.altKey&&String(o.key).toLowerCase()==="f"){o.preventDefault(),Fn(e);return}!m&&["1","2","3"].indexOf(o.key)>=0&&e.set({tab:["work","activity","system"][+o.key-1]})}function x(o){o.code==="Space"&&(Bn(document.activeElement)||(o.preventDefault(),M()))}window.addEventListener("keydown",S),window.addEventListener("keyup",x);var _=setInterval(function(){Qe("/health").then(function(o){e.set({health:o})}).catch(function(){})},Fr);return function(){clearTimeout(le),clearInterval(_),clearTimeout(C),window.removeEventListener("keydown",S),window.removeEventListener("keyup",x),Y.close(),J.teardown(),s.current&&(s.current.destroy(),s.current=null)}},[]),r.useEffect(function(){function p(){e.set({fullscreen:jn()})}return document.addEventListener("fullscreenchange",p),document.addEventListener("webkitfullscreenchange",p),function(){document.removeEventListener("fullscreenchange",p),document.removeEventListener("webkitfullscreenchange",p)}},[]),r.useEffect(function(){var p=document.getElementById("jarvis-voice-root");if(!p)return;if(!n.pseudoFullscreen){p.style.setProperty("--jv-fs-top-clear","0px");return}function g(){var y=0;document.querySelectorAll("header").forEach(function(C){if(!p.contains(C)){var D=window.getComputedStyle(C);if(!(D.position!=="fixed"&&D.position!=="sticky")){var J=C.getBoundingClientRect();J.top>4||J.bottom>y&&(y=J.bottom)}}}),p.style.setProperty("--jv-fs-top-clear",(y>0?y:0)+"px")}return g(),window.addEventListener("resize",g),function(){window.removeEventListener("resize",g)}},[n.pseudoFullscreen]),r.useEffect(function(){var p=document.getElementById("jarvis-voice-root");if(!p)return;function g(){var C=p.clientWidth||window.innerWidth;Math.abs(C-e.get().w)>4&&e.set({w:C})}g();var y=typeof ResizeObserver<"u"?new ResizeObserver(g):null;return y&&y.observe(p),window.addEventListener("resize",g),function(){y&&y.disconnect(),window.removeEventListener("resize",g)}},[]),r.useEffect(function(){var p=document.getElementById("jarvis-voice-root");if(!p)return;var g=!1;function y(){if(!g){g=!0;var ve=p.getBoundingClientRect().top,se=Math.max(320,window.innerHeight-ve);p.style.height=se+"px";var Y=document.documentElement.scrollHeight-window.innerHeight;Y>1&&(p.style.height=Math.max(320,se-Y)+"px"),g=!1}}y(),window.addEventListener("resize",y);var C=typeof ResizeObserver<"u"?new ResizeObserver(y):null;C&&C.observe(document.body);var D=setTimeout(y,500),J=setTimeout(y,1500),H=p.parentElement,le=H?H.getAttribute("style"):null;return H&&(H.style.padding="0"),function(){window.removeEventListener("resize",y),C&&C.disconnect(),clearTimeout(D),clearTimeout(J),H&&(le==null?H.removeAttribute("style"):H.setAttribute("style",le))}},[]);var we=n.w<jr;r.useEffect(function(){var p=i.canvasRef.current;if(p){var g=et(p);return s.current=g,c.current&&g.setAudioSource(c.current.getLevels),g.setReducedMotion(e.get().reducedMotion),g.setState(Pe(e.get())),g.onMemoryHits(e.get().memoryHits),function(){g.destroy(),s.current===g&&(s.current=null)}}},[we]),r.useEffect(function(){s.current&&s.current.setState(Pe(n))},[n.fsmState,n.connection]),r.useEffect(function(){s.current&&s.current.setReducedMotion(n.reducedMotion),Kr("jarvis-voice:reducedMotion",n.reducedMotion),r.motion.set(n.reducedMotion?"off":"system")},[n.reducedMotion]),r.useEffect(function(){c.current&&c.current.setGain(n.volume)},[n.volume]);var _e=r.useRef(null);_e.current||(_e.current={onMicClick:function(p){p&&p.preventDefault(),e.get().micActive?d.current.stop():d.current.start()},interrupt:function(){d.current.interrupt()},submitText:function(p){k.current=p,P(),w("user",p),u.current&&u.current.send({t:"turn.text",text:p}),A("turn.text","Typed turn: "+p,null,"neutral")},setMicMode:function(p){e.set({micMode:p}),u.current&&u.current.send({t:"mode.set",mode:p})},dismissTask:function(p){e.set(function(g){var y=Object.assign({},g.dismissedTasks);return y[p]=!0,Dt(Pt,y),{dismissedTasks:y}})},dismissNotice:F,resolveNotice:function(p){F(p)},getSeries:function(p){return v.current.series(p)},toggleReduced:function(){e.set(function(p){return{reducedMotion:!p.reducedMotion}})},toggleFullscreen:function(){Fn(e)},log:A});var Ae=_e.current,ne=n.w>=Hr,fe=Object.assign({background:Xr},n.pseudoFullscreen?Yr:null);return Z`
    <${r.Root} id="jarvis-voice-root" fill style=${fe}>
      ${we?Z`<${In} store=${e} act=${Ae} refs=${i} />`:Z`
          <div style=${{position:"absolute",inset:0,display:"flex",flexDirection:"column",paddingTop:"var(--jv-fs-top-clear, 0px)"}}>
            <${Qr} s=${n} act=${Ae} />
            <div style=${{flex:"1 1 0%",minHeight:0,display:"grid",gridTemplateColumns:ne?"304px minmax(0,1fr) 372px":"minmax(0,1fr) 344px"}}>
              ${ne?Z`<${Sn} store=${e} />`:null}
              <${vn} store=${e} act=${Ae} refs=${i} />
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
        ${e.w>=1280?Z`<${r.Stat} size="sm" variant="plain" label="Mediator" value=${s.mediator&&s.mediator.name||"\u2014"} />`:null}
        ${e.w>=1280?Z`<${r.Stat} size="sm" variant="plain" label="Worker" value=${s.worker&&s.worker.name||"\u2014"} />`:null}
        ${e.w>=1024?Z`<${r.Stat} size="sm" variant="plain" label="E2E first audio"
              value=${e.latency.e2e_first_audio&&e.latency.e2e_first_audio.p50}
              format=${function(c){return(c/1e3).toFixed(2)+" s"}} />`:null}
        <${r.Stat} size="sm" variant="plain" label="RAM free" value=${e.health&&e.health.ram&&e.health.ram.free_gb}
          format=${function(c){return c.toFixed(1)+" GB"}} />
      <//>
      <div style=${{flex:1}} />
      ${e.w>=1180&&i.backends?Z`
          <${r.Row} gap="sm" wrap=${!1}>
            ${Object.keys(Ke).filter(function(c){var v=i.backends[c];return v&&v.tier!=="free"}).map(function(c){var v=i.backends[c],d=(v.gauges||[])[0],h=d&&typeof d.remaining_pct=="number"?d.remaining_pct*100:0;return Z`<div key=${c} style=${{width:84}}>
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

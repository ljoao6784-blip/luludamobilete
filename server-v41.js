const http = require("http");
const crypto = require("crypto");
const { WebSocketServer, WebSocket } = require("ws");

// V4.1 wrapper: keeps the deployed V4 server intact on an internal port,
// adds a persistent Radio EVO window, navigation dock, and auto-starts
// the first requested song using the server's existing admin controls.
const PUBLIC_PORT = Number(process.env.PORT || 3000);
const INTERNAL_PORT = 3101;
const INTERNAL_ADMIN = process.env.ADMIN_TOKEN || ("evo-"+crypto.randomBytes(18).toString("hex"));

process.env.PORT = String(INTERNAL_PORT);
process.env.ADMIN_TOKEN = INTERNAL_ADMIN;
require("./server.js");
process.env.PORT = String(PUBLIC_PORT);

let musicState = {current:null, queue:[], config:{}};
let adminSocket = null;
let adminReady = false;

function connectAdmin(){
  if(adminSocket && [WebSocket.OPEN,WebSocket.CONNECTING].includes(adminSocket.readyState)) return;
  adminSocket = new WebSocket(`ws://127.0.0.1:${INTERNAL_PORT}/ws`);
  adminSocket.on("open",()=>{
    adminReady=false;
    adminSocket.send(JSON.stringify({type:"admin_auth",token:INTERNAL_ADMIN}));
  });
  adminSocket.on("message",raw=>{
    try{
      const d=JSON.parse(raw.toString());
      if(d.type==="admin_status") adminReady=!!d.ok;
      if(d.type==="hello" && d.music) musicState=d.music;
      if(d.type==="music_state" && d.music) musicState=d.music;
    }catch(e){}
  });
  adminSocket.on("close",()=>{adminReady=false;setTimeout(connectAdmin,1200)});
  adminSocket.on("error",()=>{});
}
setTimeout(connectAdmin,600);

function adminAction(action,id=""){
  if(adminSocket?.readyState===WebSocket.OPEN && adminReady){
    adminSocket.send(JSON.stringify({type:"music_admin",action,id}));
    return true;
  }
  connectAdmin(); return false;
}

const dockStyle = `<style>
#evoRadioDock{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:9999;width:min(760px,calc(100vw - 26px));display:grid;grid-template-columns:auto 1fr auto;gap:11px;align-items:center;padding:10px 12px;border:1px solid rgba(0,217,255,.42);border-radius:17px;background:rgba(3,10,25,.94);backdrop-filter:blur(18px);box-shadow:0 12px 50px rgba(0,0,0,.5),0 0 28px rgba(0,217,255,.12);color:#f7fbff;font-family:Segoe UI,Arial,sans-serif}
#evoRadioDock .ico{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;background:linear-gradient(135deg,#087cff,#7d42ff);font-size:20px;box-shadow:0 0 18px rgba(0,217,255,.28)}
#evoRadioDock .txt{min-width:0}#evoRadioDock .txt b,#evoRadioDock .txt small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#evoRadioDock .txt small{color:#8fa9d4;margin-top:2px}
#evoRadioDock button{border:0;color:white;background:linear-gradient(135deg,#0f69ff,#00cfff);padding:10px 13px;border-radius:11px;font-weight:900;cursor:pointer}
body{padding-bottom:82px!important}@media(max-width:620px){#evoRadioDock{grid-template-columns:auto 1fr}#evoRadioDock button{grid-column:1/-1;width:100%}}
</style>`;

const dockHtml = `<div id="evoRadioDock"><div class="ico">♫</div><div class="txt"><b id="evoDockTitle">Rádio EVO</b><small id="evoDockMeta">Ative uma vez e a música continua enquanto você navega.</small></div><button id="evoDockBtn" type="button">▶ Ativar Rádio</button></div>
<script src="/community.js"></script>
<script>
(()=>{const b=document.getElementById("evoDockBtn"),t=document.getElementById("evoDockTitle"),m=document.getElementById("evoDockMeta");
function openRadio(){const w=window.open("/radio-player.html","luludamobilete_radio","popup=yes,width=440,height=690,resizable=yes,scrollbars=yes");if(w){try{w.focus()}catch(e){};b.textContent="♫ Player aberto";m.textContent="A janela da Rádio EVO continua tocando durante a navegação."}}
b.addEventListener("click",openRadio);
if(window.LuluCommunity){LuluCommunity.subscribe(st=>{const c=st.music&&st.music.current;if(c){t.textContent="♫ "+c.title;m.textContent="Pedido de "+c.requestedBy+" • "+((st.music.queue||[]).length)+" na fila";b.textContent="Abrir Rádio"}else{t.textContent="Rádio EVO";m.textContent="A primeira música pedida começa automaticamente.";b.textContent="▶ Ativar Rádio"}});LuluCommunity.connect(localStorage.getItem("luluUserName")||"Ouvinte")}
})();
</script>`;

const playerHtml = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rádio EVO — LULUDAMOBILETE</title>
<style>
:root{--cyan:#00d9ff;--blue:#087cff;--violet:#7d42ff;--line:rgba(55,154,255,.28);--muted:#8fa9d4}*{box-sizing:border-box}body{margin:0;min-height:100vh;color:#f7fbff;font-family:Segoe UI,Arial,sans-serif;background:radial-gradient(circle at 50% 18%,rgba(0,217,255,.18),transparent 22rem),linear-gradient(180deg,#020715,#061630);padding:18px}.shell{width:min(410px,100%);margin:auto}.card{background:linear-gradient(180deg,rgba(9,25,54,.96),rgba(4,14,33,.97));border:1px solid var(--line);border-radius:18px;box-shadow:0 18px 60px rgba(0,0,0,.45);padding:16px}.brand{text-align:center;font-weight:1000;font-style:italic;font-size:22px}.brand b{color:var(--cyan)}h1{text-align:center;margin:14px 0 4px;font-size:31px}p{color:var(--muted);text-align:center;margin:0}.video{aspect-ratio:16/9;border:1px solid var(--line);border-radius:14px;background:#01040b;overflow:hidden;margin-top:14px;display:grid;place-items:center}.video iframe{width:100%;height:100%;border:0}.vinyl{width:120px;height:120px;border-radius:50%;background:repeating-radial-gradient(circle,#10192a 0 8px,#02060c 9px 14px);display:grid;place-items:center}.vinyl:after{content:"♕";width:42px;height:42px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,var(--blue),var(--cyan));color:#031020;font-weight:1000}.status{margin-top:11px;padding:11px;border:1px solid var(--line);border-radius:12px;background:#061329}.status b,.status small{display:block}.status small{color:var(--muted);margin-top:3px}.actions{display:flex;gap:8px;margin-top:10px}.btn{flex:1;border:1px solid var(--line);background:#071934;color:white;padding:10px;border-radius:10px;font-weight:900;cursor:pointer;text-decoration:none;text-align:center}.primary{border:0;background:linear-gradient(135deg,var(--blue),var(--cyan))}.queue{display:grid;gap:7px;margin-top:10px;max-height:250px;overflow:auto}.song{padding:9px;border:1px solid var(--line);border-radius:10px;background:#061329}.song b,.song small{display:block}.song small{color:var(--muted);margin-top:2px}.hint{font-size:11px;color:var(--muted);margin-top:9px;text-align:center}
</style><script src="/shared.js"></script><script src="/community.js"></script></head><body><div class="shell"><section class="card"><div class="brand">♕ LULUDA<b>MOBILETE</b></div><h1>♫ Rádio EVO</h1><p>Deixe esta janela aberta. Ela continua tocando enquanto você navega no portal.</p><div id="video" class="video"><div class="vinyl"></div></div><div class="status"><b id="title">Aguardando música...</b><small id="meta">A primeira música pedida começa automaticamente.</small></div><div class="actions"><button id="resume" class="btn primary">▶ Tocar / Retomar</button><a class="btn" href="/community.html#radio" target="_blank">Fila</a></div><div class="hint">Os navegadores exigem um clique do usuário para liberar áudio com som. Depois de abrir/ativar a Rádio EVO, deixe esta janela aberta.</div></section><section class="card" style="margin-top:12px"><b>PRÓXIMAS MÚSICAS</b><div id="queue" class="queue"><div style="color:var(--muted)">Carregando...</div></div></section></div>
<script>
document.addEventListener("DOMContentLoaded",()=>{const $=id=>document.getElementById(id);let player=null,current="",ready=false,pending="";
function loadApi(){if(window.YT&&YT.Player){ready=true;return}const s=document.createElement("script");s.src="https://www.youtube.com/iframe_api";document.head.appendChild(s);window.onYouTubeIframeAPIReady=()=>{ready=true;if(pending)mount(pending,true)}}
function mount(id,auto){if(!id)return;pending=id;if(!ready){loadApi();return}$("video").innerHTML='<div id="yt"></div>';player=new YT.Player("yt",{videoId:id,playerVars:{autoplay:auto?1:0,playsinline:1,rel:0,modestbranding:1},events:{onReady:e=>{if(auto)try{e.target.playVideo()}catch(_){}},onError:()=>{$("meta").textContent="Este vídeo bloqueia reprodução incorporada. Peça outra versão da música no YouTube."}}})}
function render(st){const m=st.music||{current:null,queue:[]},c=m.current;if(c){$("title").textContent=c.title;$("meta").textContent="Pedido de "+c.requestedBy+" • Rádio EVO";const id=c.videoId||(window.ytId?ytId(c.url):"");if(id&&id!==current){current=id;mount(id,true)}}else{current="";$("title").textContent="Aguardando música...";$("meta").textContent="Peça uma música na Sociedade.";$("video").innerHTML='<div class="vinyl"></div>'}$("queue").innerHTML="";(m.queue||[]).slice(0,10).forEach((x,i)=>{const d=document.createElement("div");d.className="song";const b=document.createElement("b");b.textContent=(i+1)+". "+x.title;const sm=document.createElement("small");sm.textContent=x.votes+" voto(s) • "+x.requestedBy;d.append(b,sm);$("queue").appendChild(d)});if(!(m.queue||[]).length)$("queue").innerHTML='<div style="color:var(--muted)">Sem próximas músicas.</div>'}
$("resume").onclick=()=>{if(player&&player.playVideo)try{player.playVideo()}catch(_){}else{const c=LuluCommunity.getState().music?.current,id=c&&(c.videoId||(window.ytId?ytId(c.url):""));if(id)mount(id,true)}};LuluCommunity.subscribe(render);LuluCommunity.connect("Rádio EVO");loadApi()});
</script></body></html>`;

function injectDock(html){
  if(html.includes("id=\"evoRadioDock\"")) return html;
  if(html.includes("</head>")) html=html.replace("</head>",dockStyle+"</head>");
  return html.replace("</body>",dockHtml+"</body>");
}

const proxyServer = http.createServer((req,res)=>{
  if((req.url||"").split("?")[0]==="/radio-player.html"){
    res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-cache"});
    res.end(playerHtml);return;
  }
  const opts={hostname:"127.0.0.1",port:INTERNAL_PORT,path:req.url,method:req.method,headers:{...req.headers,host:`127.0.0.1:${INTERNAL_PORT}`}};
  const pr=http.request(opts,ir=>{
    const ct=String(ir.headers["content-type"]||"");
    if(ct.includes("text/html")){
      const chunks=[];ir.on("data",c=>chunks.push(c));ir.on("end",()=>{
        let body=Buffer.concat(chunks).toString("utf8");
        if(!String(req.url||"").startsWith("/overlay")) body=injectDock(body);
        const headers={...ir.headers};delete headers["content-length"];headers["cache-control"]="no-cache";
        res.writeHead(ir.statusCode||200,headers);res.end(body);
      });
    }else{res.writeHead(ir.statusCode||200,ir.headers);ir.pipe(res)}
  });
  pr.on("error",()=>{res.writeHead(502,{"Content-Type":"text/plain; charset=utf-8"});res.end("LULUDAMOBILETE iniciando... atualize em alguns segundos.")});
  req.pipe(pr);
});

const publicWss = new WebSocketServer({noServer:true});
proxyServer.on("upgrade",(req,socket,head)=>{
  if((req.url||"").split("?")[0]!=="/ws"){socket.destroy();return}
  publicWss.handleUpgrade(req,socket,head,client=>{
    const upstream=new WebSocket(`ws://127.0.0.1:${INTERNAL_PORT}/ws`);
    const pending=[];
    client.on("message",data=>{if(upstream.readyState===WebSocket.OPEN)upstream.send(data);else pending.push(data)});
    upstream.on("open",()=>{pending.splice(0).forEach(x=>upstream.send(x))});
    upstream.on("message",data=>{
      try{
        const d=JSON.parse(data.toString());
        if(d.type==="hello"&&d.music)musicState=d.music;
        if(d.type==="music_state"&&d.music)musicState=d.music;
        if(d.type==="music_added"&&d.song&&!musicState.current){
          setTimeout(()=>adminAction("play",d.song.id),80);
        }
      }catch(e){}
      if(client.readyState===WebSocket.OPEN)client.send(data);
    });
    const close=()=>{try{client.close()}catch(e){}try{upstream.close()}catch(e){}};
    client.on("close",()=>{try{upstream.close()}catch(e){}});
    upstream.on("close",()=>{try{client.close()}catch(e){}});
    client.on("error",()=>{});upstream.on("error",close);
  });
});

proxyServer.listen(PUBLIC_PORT,()=>console.log(`LULUDAMOBILETE V4.1 proxy online na porta ${PUBLIC_PORT}`));

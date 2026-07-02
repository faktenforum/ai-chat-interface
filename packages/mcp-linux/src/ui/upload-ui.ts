/**
 * Upload widget UI.
 *
 * One template serves two variants:
 * - 'embedded': returned by create_upload_session as a ui:// resource, rendered
 *   inline in LibreChat. The iframe has an opaque origin, so it uses the absolute
 *   upload URL for its XHR/fetch calls (CORS is enabled on those routes).
 * - 'standalone': served at GET /upload/:token for a shareable browser link.
 */

import { esc, layout } from './html.ts';

export interface UploadUiConfig {
  token: string;
  /** Absolute URL: `${baseUrl}/upload/${token}` */
  uploadUrl: string;
  workspace: string;
  maxSizeMb: number;
  allowedExtensions: string[];
  /** ISO timestamp */
  expiresAt: string;
}

const EXTRA_CSS = `
.dropzone{border:2px dashed var(--border);border-radius:10px;padding:1.4rem;text-align:center;transition:border-color .15s;}
.dropzone.drag{border-color:var(--accent);}
.bar{height:8px;background:var(--border);border-radius:999px;overflow:hidden;margin:.6rem 0 .3rem;}
.bar>span{display:block;height:100%;width:0;background:var(--accent);transition:width .1s;}
.ok{color:#059669;}
.err{color:var(--danger);}
`;

/** Client-side script; CFG is injected as JSON. Kept dependency-free. */
const UPLOAD_JS = `
(function(){
  var CFG=window.__UPLOAD_CFG__;
  var q=function(id){return document.getElementById(id);};
  var drop=q('drop'),file=q('file'),msg=q('msg'),pw=q('progress-wrap'),bar=q('bar'),pct=q('pct'),cd=q('countdown');
  var done=false;
  function fmt(n){if(!n)return'0 B';var u=['B','KB','MB','GB'],i=Math.min(3,Math.floor(Math.log(n)/Math.log(1024)));return(n/Math.pow(1024,i)).toFixed(i?1:0)+' '+u[i];}
  function setMsg(html){msg.innerHTML=html;}
  function disableForm(){if(file)file.disabled=true;if(drop)drop.classList.add('muted');}
  function success(f){
    done=true;disableForm();pw.hidden=true;
    var extra=CFG.embedded
      ? '<button class="btn primary" style="margin-top:.6rem" onclick="window.__notify()">Notify assistant</button>'
      : '<p class="muted">Return to the chat and tell the assistant you are done.</p>';
    setMsg('<p class="ok"><strong>Uploaded '+esc(f.name)+'</strong> ('+fmt(f.size)+')</p>'
      +'<p class="muted">Saved to <code>'+esc(f.path||('uploads/'+f.name))+'</code></p>'+extra);
    window.__uploaded=f;
  }
  window.__notify=function(){
    var f=window.__uploaded;if(!f||!window.parent||window.parent===window)return;
    uiPrompt('I uploaded the file "'+f.name+'" ('+fmt(f.size)+') to workspace "'+CFG.workspace+'". '
      +'It is at '+(f.path||('uploads/'+f.name))+'. Use list_upload_sessions / read_workspace_file to access it.');
  };
  function upload(f){
    if(done||!f)return;
    if(CFG.allowedExtensions.length){
      var dot=f.name.lastIndexOf('.'),ext=dot>=0?f.name.slice(dot).toLowerCase():'';
      if(CFG.allowedExtensions.indexOf(ext)<0){setMsg('<p class="err">File type '+esc(ext||'(none)')+' is not allowed. Allowed: '+esc(CFG.allowedExtensions.join(', '))+'</p>');return;}
    }
    if(f.size>CFG.maxSizeMb*1024*1024){setMsg('<p class="err">File exceeds the '+CFG.maxSizeMb+' MB limit.</p>');return;}
    setMsg('');pw.hidden=false;bar.style.width='0';pct.textContent='';
    var xhr=new XMLHttpRequest();
    xhr.open('POST',CFG.uploadUrl);
    xhr.upload.onprogress=function(e){if(e.lengthComputable){var p=Math.round(e.loaded/e.total*100);bar.style.width=p+'%';pct.textContent=p+'%';}};
    xhr.onload=function(){
      var r={};try{r=JSON.parse(xhr.responseText);}catch(_){}
      if(xhr.status>=200&&xhr.status<300&&r.success){success({name:r.filename,size:r.size,path:r.path});}
      else{pw.hidden=true;setMsg('<p class="err">'+esc(r.error||('Upload failed ('+xhr.status+')'))+'</p>');}
    };
    xhr.onerror=function(){pw.hidden=true;setMsg('<p class="err">Network error during upload.</p>');};
    var fd=new FormData();fd.append('file',f);xhr.send(fd);
  }
  if(file)file.addEventListener('change',function(){upload(file.files[0]);});
  if(drop){
    ['dragenter','dragover'].forEach(function(ev){drop.addEventListener(ev,function(e){e.preventDefault();drop.classList.add('drag');});});
    ['dragleave','drop'].forEach(function(ev){drop.addEventListener(ev,function(e){e.preventDefault();drop.classList.remove('drag');});});
    drop.addEventListener('drop',function(e){if(e.dataTransfer&&e.dataTransfer.files[0])upload(e.dataTransfer.files[0]);});
  }
  // Expiry countdown
  var exp=Date.parse(CFG.expiresAt);
  function tick(){
    if(done)return;
    var ms=exp-Date.now();
    if(ms<=0){cd.textContent='expired';disableForm();setMsg('<p class="err">This session has expired. Ask the assistant for a new upload link.</p>');clearInterval(t);return;}
    var m=Math.floor(ms/60000),s=Math.floor(ms%60000/1000);cd.textContent=m+'m '+(s<10?'0':'')+s+'s';
  }
  var t=setInterval(tick,1000);tick();
  // Status polling (catches uploads completed elsewhere or server restart)
  var poll=setInterval(function(){
    if(done){clearInterval(poll);return;}
    fetch(CFG.uploadUrl+'/status').then(function(r){
      if(r.status===404){clearInterval(poll);disableForm();setMsg('<p class="err">This session is no longer available (the server may have restarted). Ask the assistant for a new link.</p>');return null;}
      return r.json();
    }).then(function(d){
      if(!d)return;
      if(d.status==='completed'&&d.uploaded_file){success(d.uploaded_file);clearInterval(poll);}
      else if(d.status==='expired'||d.status==='closed'){clearInterval(poll);}
    }).catch(function(){});
  },5000);
})();`;

function escJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/** Renders the upload widget for the given variant. */
export function renderUploadUi(cfg: UploadUiConfig, variant: 'embedded' | 'standalone'): string {
  const cfgJson = escJson({ ...cfg, embedded: variant === 'embedded' });
  const extLabel = cfg.allowedExtensions.length ? cfg.allowedExtensions.join(', ') : 'any type';
  const body = `
    <div class="card" style="max-width:36rem;margin:0 auto">
      <h1>Upload a file</h1>
      <p class="muted">Workspace <code>${esc(cfg.workspace)}</code> · max ${esc(cfg.maxSizeMb)} MB · ${esc(extLabel)} · expires in <span id="countdown"></span></p>
      <div id="drop" class="dropzone">
        <p class="muted">Drag a file here, or choose one:</p>
        <input type="file" id="file">
      </div>
      <div id="progress-wrap" hidden><div class="bar"><span id="bar"></span></div><p id="pct" class="muted"></p></div>
      <div id="msg"></div>
    </div>`;
  const extraJs = `window.__UPLOAD_CFG__=${cfgJson};function esc(s){return String(s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}${UPLOAD_JS}`;
  return layout({ title: 'Upload a file', body, actions: variant === 'embedded', extraCss: EXTRA_CSS, extraJs });
}

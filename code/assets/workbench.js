'use strict';
(() => {
  const $ = (s,root=document) => root.querySelector(s);
  const $$ = (s,root=document) => [...root.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const paths = {
    plus:'M12 5v14M5 12h14', search:'m21 21-4.5-4.5M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0',
    stack:'m12 3 9 5-9 5-9-5 9-5M3 12l9 5 9-5M3 16l9 5 9-5', container:'m12 3 9 5v9l-9 5-9-5V8l9-5M3 8l9 5 9-5M12 13v9',
    host:'M4 4h16v6H4zM4 14h16v6H4zM7 7h.01M7 17h.01M17 7h1M17 17h1',
    refresh:'M20 11a8 8 0 1 0-2.34 6.66M20 4v7h-7',
    collapse:'m8 3 4 4 4-4M12 7V2m-4 19 4-4 4 4M12 17v5M4 12h16', settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M10 2h4l1 3 3 1 3 3-2 3 2 3-3 3-3 1-1 3h-4l-1-3-3-1-3-3 2-3-2-3 3-3 3-1 1-3',
    import:'M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6', theme:'M20.5 13A8.5 8.5 0 0 1 11 3.5a8.5 8.5 0 1 0 9.5 9.5',
    history:'M3 4v5h5M3.7 8A9 9 0 1 1 3 14M12 7v5l3 2', play:'m7 4 13 8-13 8V4', stop:'M5 5h14v14H5z',
    down:'M5 4v12m-4-4 4 4 4-4M19 20V8m-4 4 4-4 4 4', layers:'M4 3h12v14H4zM8 21h12V7',
    image:'M3 3h18v18H3zM3 16l5-5 4 4 4-6 5 8M7 7h.01', network:'M9 3h6v6H9zM2 16h6v6H2zM16 16h6v6h-6zM12 9v3M5 16v-4h14v4',
    volume:'M20 6c0 2-4 4-8 4S4 8 4 6s4-4 8-4 8 2 8 4M4 6v12c0 2 4 4 8 4s8-2 8-4V6M4 12c0 2 4 4 8 4s8-2 8-4',
    maximize:'M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5', close:'m6 6 12 12M6 18 18 6', chevron:'m9 5 7 7-7 7',
    pause:'M7 4h3v16H7zM15 4h3v16h-3z', wrap:'M3 5h18M3 11h14a4 4 0 0 1 0 8h-5m3-3-3 3 3 3M3 17h4',
    download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5', clear:'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',
    copy:'M9 8h11v13H9zM15 8V3H4v13h5', check:'m5 12 4 4L19 6', arrow:'M4 12h16m-6-6 6 6-6 6', terminal:'m4 6 6 6-6 6m9 0h7', lock:'M6 10h12v11H6zM8 10V6a4 4 0 0 1 8 0v4',
  };
  const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]||paths.container}"></path></svg>`;
  function fillIcons(root=document) {$$('[data-icon]',root).forEach(el=>{el.innerHTML=icon(el.dataset.icon);});}
  const hosts = structuredClone(window.WorkbenchFixtures.hosts);
  const state={hostId:hosts[0].id,project:'report',containerId:null,category:'compose',filter:'all',tab:'logs',expanded:new Set([hosts[0].id]),query:'',logQuery:'',level:'all',follow:true,wrap:true,cleared:false,history:[],terminal:[],connectionDraft:null,tested:null,pending:null};
  const currentHost=()=>hosts.find(h=>h.id===state.hostId)||hosts[0];
  const currentProject=()=>currentHost().projects.find(p=>p.name===state.project)||null;
  const currentContainer=()=>currentProject()?.containers.find(c=>c.id===state.containerId)||null;
  const allHostContainers=()=>currentHost().projects.flatMap(p=>p.containers);
  const scopeContainers=()=>currentContainer()?[currentContainer()]:currentProject()?.containers||[];
  let toastTimer;
  function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3500);$('#status-message').textContent=message;}
  function stateBadge(c){return `<span class="running-state ${c.state==='running'?'':'stopped'}"><i class="status-dot"></i>${c.state==='running'?'运行中':'已停止'}</span>`;}
  function chooseProject(hostId,projectName){state.hostId=hostId;state.project=projectName;state.category='compose';state.containerId=null;state.filter='all';state.tab='logs';state.cleared=false;state.logQuery='';state.expanded.add(hostId);state.expanded.add(`${hostId}:${projectName}`);render();$('#sidebar').classList.remove('open');}
  function renderTree(){
    const q=state.query.toLowerCase();let html='';
    hosts.forEach(h=>{
      const matchesHost=[h.name,h.address].join(' ').toLowerCase().includes(q);
      const projects=h.projects.filter(p=>matchesHost||p.name.toLowerCase().includes(q)||p.containers.some(c=>c.name.toLowerCase().includes(q)));
      if(q&&!matchesHost&&!projects.length)return;
      const open=state.expanded.has(h.id)||!!q;
      html+=`<button class="tree-node host ${state.hostId===h.id&&state.category==='host'?'selected':''}" data-action="host" data-host="${esc(h.id)}" title="${esc(h.address)}"><span class="chevron">${open?'⌄':'›'}</span>${icon('host')}<span class="host-label"><strong>${esc(h.name)}</strong><small>${h.type==='local'?'本地 Docker socket':esc(`${h.user}@${h.address}`)}</small></span><span class="state-dot ${h.status==='online'?'':'stopped'}"></span></button>`;
      if(!open)return;
      projects.forEach(p=>{
        const selected=state.hostId===h.id&&state.project===p.name&&state.category==='compose';const po=state.expanded.has(`${h.id}:${p.name}`)||!!q;const running=p.containers.filter(c=>c.state==='running').length;
        html+=`<button class="tree-node project ${selected&&!state.containerId?'selected':''}" data-action="project" data-host="${esc(h.id)}" data-project="${esc(p.name)}"><span class="chevron" data-action="toggle-project" data-host="${esc(h.id)}" data-project="${esc(p.name)}">${po?'⌄':'›'}</span>${icon('stack')}<span class="node-name">${esc(p.name)}</span><span class="node-count">${running}/${p.containers.length}</span></button>`;
        if(po)p.containers.filter(c=>matchesHost||p.name.includes(q)||c.name.toLowerCase().includes(q)).forEach(c=>{
          html+=`<button class="tree-node container ${state.containerId===c.id&&state.hostId===h.id?'selected':''}" data-action="container" data-host="${esc(h.id)}" data-project="${esc(p.name)}" data-id="${esc(c.id)}" title="${esc(c.name)}">${icon('container')}<span class="node-name">${esc(c.name)}</span><span class="state-dot ${c.state==='running'?'':'stopped'}"></span></button>`;
        });
      });
      ['containers','images','networks','volumes'].forEach((category,i)=>{html+=`<button class="tree-node category ${state.hostId===h.id&&state.category===category?'selected':''}" data-action="category" data-host="${esc(h.id)}" data-category="${category}">${icon(['layers','image','network','volume'][i])}<span>${['全部容器','镜像','网络','存储卷'][i]}</span></button>`;});
    });
    $('#resource-tree').innerHTML=html||'<div class="empty-state">没有匹配的资源</div>';$('#connection-count').textContent=hosts.length;
  }
  function renderHeader(){
    const h=currentHost(),p=currentProject(),c=currentContainer();const categoryNames={containers:'全部容器',images:'镜像',networks:'网络',volumes:'存储卷',host:'主机概览'};
    const title=state.category==='compose'?(p?.name||'项目'):(categoryNames[state.category]||'资源');
    $('#workspace-name').textContent=title;$('#resource-title').textContent=title;$('.environment-badge').textContent=h.env;
    $('#resource-subtitle').textContent=state.category==='compose'?'Docker Compose 项目':'Docker 主机资源';
    $('#breadcrumb').innerHTML=`${icon('host')}<span>${esc(h.name)}</span><span class="slash">/</span><span>${state.category==='compose'?'Compose':esc(categoryNames[state.category]||'资源')}</span>${state.category==='compose'?`<span class="slash">/</span><span>${esc(p?.name||'—')}</span>`:''}`;
    const containers=state.category==='compose'?(p?.containers||[]):allHostContainers();const running=containers.filter(x=>x.state==='running').length;
    $('#resource-summary').innerHTML=`<span class="pill"><i class="status-dot"></i>${running} 运行中</span><span class="pill stopped">${containers.length-running} 已停止</span><span class="summary-separator"></span><span class="mono">${esc(h.type==='ssh'?`${h.user}@${h.address}:${h.port}`:h.address)}</span><span class="summary-separator"></span><span>API ${esc(h.api)} · ${h.apiMode==='manual'?'手动指定':'自动协商'}</span><span class="summary-end">${p?(p.source?'已关联 Compose 文件':'已发现项目 · 待关联源文件'):'示例资源'}</span>`;
    $('#object-actions').innerHTML=state.category==='compose'?`<button data-action="operation" data-operation="start">${icon('play')}<span class="action-text">${c?'启动':'启动全部'}</span></button><button data-action="operation" data-operation="restart">${icon('refresh')}<span class="action-text">重启</span></button><button class="danger" data-action="operation" data-operation="stop">${icon('stop')}<span class="action-text">停止</span></button><button class="down-button danger" data-action="operation" data-operation="down" title="需要关联项目的 Compose 源文件">${icon('down')}<span class="action-text">Down</span></button>`:`<button data-action="connections">${icon('settings')}连接设置</button><button data-action="refresh">${icon('refresh')}刷新</button>`;
    $('#status-connection').textContent=`${h.name.replace('Docker · ','')} · 示例会话`;$('#status-api').textContent=`API ${esc(h.api)} · ${h.apiMode==='manual'?'手动指定':'自动协商'}`;
  }
  function renderTable(){
    if(['compose','containers','host'].includes(state.category)){
      const source=state.category==='compose'?(currentProject()?.containers||[]):allHostContainers();
      $('#resource-filters').innerHTML=[['all','全部',source.length],['running','运行中',source.filter(c=>c.state==='running').length],['stopped','已停止',source.filter(c=>c.state==='stopped').length]].map(([key,label,count])=>`<button class="filter-chip ${state.filter===key?'active':''}" data-action="filter" data-filter="${key}">${label} <span>${count}</span></button>`).join('');
      const rows=source.filter(c=>state.filter==='all'||c.state===state.filter);
      $('#resource-table').innerHTML=`<table><thead><tr><th>容器名称</th><th>状态</th><th>CPU</th><th>内存</th><th>端口</th><th></th></tr></thead><tbody>${rows.map(c=>`<tr class="${state.containerId===c.id?'selected':''}" data-action="table-container" data-id="${esc(c.id)}" tabindex="0" aria-label="查看 ${esc(c.name)}"><td><div class="service-name">${icon('container')}${esc(c.name)}</div></td><td>${stateBadge(c)}</td><td class="metric-cell"><span class="metric-bar"><i style="width:${c.state==='running'?Math.min(c.cpu*8,100):0}%"></i></span>${c.state==='running'?c.cpu.toFixed(1):'0.0'}%</td><td class="metric-cell">${c.state==='running'?c.memory:0} MiB</td><td class="metric-cell">${esc(c.port)}</td><td><button class="row-action" data-action="row-operation" data-id="${esc(c.id)}" data-operation="${c.state==='running'?'restart':'start'}" aria-label="${c.state==='running'?'重启':'启动'} ${esc(c.name)}">${icon(c.state==='running'?'refresh':'play')}</button></td></tr>`).join('')}</tbody></table>${rows.length?'':'<div class="empty-state">此范围内没有容器。可以切换其他项目或添加演示连接。</div>'}`;
      $('#selection-caption').textContent=currentContainer()?`已选 ${currentContainer().name}`:'点击容器查看详情';
    }else{
      const category=state.category,h=currentHost(),p=currentProject();$('#resource-filters').innerHTML=`<span class="helper-text">${({images:'镜像',networks:'网络',volumes:'存储卷'})[category]}资源 · 示例</span>`;
      const resources=category==='images'?[...new Set(allHostContainers().map(c=>c.image))].map((v,i)=>[v,'镜像',`${124+i*67} MB`]):category==='networks'?h.projects.map(p=>[`${p.name}_default`,'bridge','项目网络']):h.projects.map(p=>[`${p.name}_data`,'local','持久化卷']);
      $('#resource-table').innerHTML=`<table><thead><tr><th>名称</th><th>类型</th><th>说明</th></tr></thead><tbody>${resources.map(r=>`<tr><td class="mono">${esc(r[0])}</td><td>${esc(r[1])}</td><td class="muted">${esc(r[2])}</td></tr>`).join('')}</tbody></table>${resources.length?'':'<div class="empty-state">此连接下暂无示例资源</div>'}`;
      $('#selection-caption').textContent='只读资源预览';
    }
  }
  const tabLabels={logs:'日志',inspect:'Inspect',stats:'资源监控',terminal:'终端',history:'操作记录'};
  function renderDetails(){
    $('#detail-tabs').innerHTML=Object.entries(tabLabels).map(([id,label])=>`<button class="${state.tab===id?'active':''}" data-action="tab" data-tab="${id}">${label}${id==='history'&&state.history.length?` <span class="count">${state.history.length}</span>`:''}</button>`).join('');
    const c=currentContainer(),p=currentProject();$('#detail-target').textContent=c?.name||`${p?.name||currentHost().name} / 合并日志`;
    if(state.tab==='logs')renderLogs();
    if(state.tab==='inspect')renderInspect();
    if(state.tab==='stats')renderStats();
    if(state.tab==='terminal')renderTerminal();
    if(state.tab==='history')renderHistory();
  }
  function getLogs(){
    const source=state.cleared?[]:window.WorkbenchFixtures.buildLogs(currentProject());
    return source.filter(l=>(!currentContainer()||l.source===currentContainer().name)&&(state.level==='all'||l.level===state.level)&&(!state.logQuery||`${l.source} ${l.message}`.toLowerCase().includes(state.logQuery.toLowerCase())));
  }
  function renderLogs(){
    $('#detail-content').innerHTML=`<div class="console-toolbar"><label class="log-search">${icon('search')}<input id="log-search" value="${esc(state.logQuery)}" placeholder="搜索日志…" aria-label="搜索日志内容"></label><select id="log-level" aria-label="日志级别"><option value="all">全部级别</option>${['INFO','WARN','ERROR'].map(l=>`<option ${state.level===l?'selected':''}>${l}</option>`).join('')}</select><span class="log-counter" id="log-count"></span><span class="spacer"></span><button class="${state.follow?'on':''}" data-action="follow" title="切换模拟跟随状态">${icon(state.follow?'pause':'play')}<span class="label-text">${state.follow?'暂停跟随':'继续跟随'}</span></button><button class="${state.wrap?'on':''}" data-action="wrap" title="自动换行" aria-label="自动换行">${icon('wrap')}</button><button data-action="copy-logs" title="复制可见日志" aria-label="复制可见日志">${icon('copy')}</button><button data-action="download-logs" title="导出可见日志" aria-label="导出可见日志">${icon('download')}</button><button data-action="clear-logs" title="清空本地示例缓冲" aria-label="清空本地示例缓冲">${icon('clear')}</button></div><div class="log-output ${state.wrap?'wrap':''}" id="log-output"></div><div class="console-foot"><span><i class="live-dot"></i><span id="log-follow-label">${state.follow?'跟随已开启':'跟随已暂停'}</span> · 静态示例日志</span><span>UTF-8 &nbsp; 最多保留 50,000 行（设计目标）</span></div>`;renderLogLines();
  }
  function renderLogLines(){
    const logs=getLogs();$('#log-count').textContent=`${logs.length} 行`;
    $('#log-output').innerHTML=logs.map((l,i)=>{
      let message=esc(l.message);if(state.logQuery){const search=esc(state.logQuery).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');message=message.replace(new RegExp(search,'gi'),match=>`<mark>${match}</mark>`);}
      return `<div class="log-line"><span class="log-number">${String(l.id).padStart(2,'0')}</span><span class="log-time">${l.time}</span><span class="log-source c${l.color}" title="${esc(l.source)}">${esc(l.source)}</span><span class="log-level ${l.level.toLowerCase()}">${l.level}</span><span class="log-message">${message}</span></div>`;
    }).join('')||'<div class="empty-state">没有符合条件的日志。修改搜索条件，或刷新恢复示例缓冲。</div>';
  }
  function renderInspect(){
    const c=currentContainer(),p=currentProject(),h=currentHost();
    const payload=c?{Id:c.id,Name:c.name,State:{Status:c.state,RestartCount:c.restarts},Config:{Image:c.image,Labels:{'com.docker.compose.project':p.name,'com.docker.compose.service':c.service}},HostConfig:{RestartPolicy:{Name:'unless-stopped'}},Demo:true}: {Project:p?.name||null,Host:h.address,ApiVersion:h.api,ComposeSource:p?.path||'尚未关联源文件',Containers:p?.containers.map(x=>({Name:x.name,State:x.state}))||[],Demo:true};
    $('#detail-content').innerHTML=`<pre class="code-view">${esc(JSON.stringify(payload,null,2))}</pre>`;
  }
  function renderStats(){
    const cs=scopeContainers().filter(c=>c.state==='running'),cpu=cs.reduce((s,c)=>s+c.cpu,0),mem=cs.reduce((s,c)=>s+c.memory,0);
    $('#detail-content').innerHTML=`<div class="stats-grid">${[['CPU 使用率',`${cpu.toFixed(1)}%`,'blue'],['内存占用',`${(mem/1024).toFixed(2)} GiB`,'green'],['网络流量','12.4 KiB/s','blue']].map(([title,value,color],n)=>`<div class="stat-block"><p>${title}</p><strong>${value}</strong><div class="sparkline">${Array.from({length:26},(_,i)=>`<i style="height:${17+(i*19+n*23)%78}%;${color==='green'?'background:#7bb7a0':''}"></i>`).join('')}</div><small>示例趋势 · 非实时采样</small></div>`).join('')}</div>`;
  }
  function renderTerminal(){
    $('#detail-content').innerHTML=`<div class="terminal-note">终端交互演示 · 支持 <span class="mono">help / pwd / ls / whoami / clear</span> · 不执行任何系统命令</div><pre id="terminal-output" class="terminal-output">${esc(state.terminal.join('\n')||'Docker Workbench demo terminal\n输入 help 查看可用的模拟命令。')}</pre><form class="terminal-form" id="terminal-form"><span class="mono">demo $</span><input id="terminal-input" placeholder="输入模拟命令" autocomplete="off" aria-label="模拟终端输入"><button type="submit">运行示例</button></form>`;
  }
  function renderHistory(){
    $('#detail-content').innerHTML=state.history.length?state.history.map(h=>`<div class="history-row">${icon(h.op==='stop'?'stop':'check')}<time>${esc(h.time)}</time><div class="history-label">${esc(h.label)}<div class="helper-text">${esc(h.host)} · ${esc(h.target)}</div></div><span class="tag">模拟完成</span></div>`).join(''):'<div class="empty-state">还没有操作记录。对示例容器执行启停后，可在这里核对主机、对象与结果。</div>';
  }
  function render(){renderTree();renderHeader();renderTable();renderDetails();$('#history-count').textContent=state.history.length;}
  const defaultDraft=()=>({id:null,name:'Docker · 新连接',address:'192.0.2.11',user:'ops',port:'22',auth:'key',type:'ssh',keyPath:'~/.ssh/id_rsa',password:'',passphrase:'',parseConfig:true,timeout:'15',keepalive:'30',proxy:'none',proxyHost:'',proxyPort:'1080',proxyUser:'',proxyPassword:'',apiMode:'auto',apiVersion:'1.43',tls:true,caPath:'',certPath:'',certKeyPath:'',socketPath:'unix:///var/run/docker.sock'});
  function openConnections(existing=false){
    const h=existing?currentHost():null;state.connectionDraft={...defaultDraft(),...(h?{id:h.id,name:h.name,address:h.address,user:h.user,port:h.port,auth:h.auth,type:h.type}: {})};state.tested=null;renderConnectionDialog();$('#connection-dialog').showModal();
  }
  function renderConnectionDialog(){
    const d=state.connectionDraft;
    $('#connection-dialog').innerHTML=`<div class="dialog-heading"><div><h2 id="connection-title">连接与 SSH 配置</h2><p>先配置连接，再测试 Docker 访问与 API 兼容性</p></div><button class="icon-button" data-action="close-dialog" data-dialog="connection-dialog" aria-label="关闭连接设置">${icon('close')}</button></div><div class="connection-layout"><aside class="connection-list"><h3>已有连接 · 示例</h3>${hosts.map(h=>`<button class="${d.id===h.id?'active':''}" data-action="edit-connection" data-host="${esc(h.id)}">${icon('host')}<span>${esc(h.name.replace('Docker · ',''))}</span></button>`).join('')}<button data-action="new-connection">${icon('plus')}新建连接</button></aside><form class="connection-form" id="connection-form"><label class="field"><span>连接名称</span><input name="name" value="${esc(d.name)}" required></label><div class="connection-tabs">${[['ssh','SSH'],['local','本地 Socket'],['tcp','TCP + TLS']].map(([id,label])=>`<button type="button" class="${d.type===id?'active':''}" data-action="connection-type" data-type="${id}">${label}</button>`).join('')}</div>${renderTransportFields(d)}<details><summary>连接参数与代理</summary><div class="inline-fields"><label class="field"><span>超时（秒）</span><input name="timeout" type="number" min="1" max="120" value="${esc(d.timeout)}"></label><label class="field"><span>Keep-alive（秒）</span><input name="keepalive" type="number" min="5" max="600" value="${esc(d.keepalive)}"></label></div><label class="field"><span>代理类型</span><select name="proxy">${[['none','不使用代理'],['http','HTTP CONNECT'],['socks5','SOCKS5']].map(([id,t])=>`<option value="${id}" ${d.proxy===id?'selected':''}>${t}</option>`).join('')}</select></label>${d.proxy!=='none'?`<div class="inline-fields"><label class="field"><span>代理主机</span><input name="proxyHost" value="${esc(d.proxyHost)}"></label><label class="field"><span>代理端口</span><input name="proxyPort" type="number" min="1" max="65535" value="${esc(d.proxyPort)}"></label><label class="field"><span>代理用户名（可选）</span><input name="proxyUser" value="${esc(d.proxyUser)}"></label><label class="field"><span>代理密码（示例值）</span><input name="proxyPassword" type="password" autocomplete="off" value="${esc(d.proxyPassword)}"></label></div>`:''}<p class="form-hint">正式版首次连接需确认主机指纹；指纹变更会阻止连接。代理与凭据均由本机连接层处理。</p></details><details open><summary>Docker API 兼容性</summary><div class="inline-fields"><label class="field"><span>协商方式</span><select name="apiMode"><option value="auto" ${d.apiMode==='auto'?'selected':''}>自动协商（推荐）</option><option value="manual" ${d.apiMode==='manual'?'selected':''}>按连接指定版本</option></select></label><label class="field"><span>指定 API 版本</span><input name="apiVersion" value="${esc(d.apiVersion)}" placeholder="例如 1.43" ${d.apiMode==='auto'?'disabled':''}></label></div><p class="form-hint">演示样例：客户端最高 1.52，服务端最高 1.43。自动选择共同支持的版本；版本无交集时阻止连接。</p></details><button type="button" data-action="test-connection">${icon('refresh')}模拟测试连接</button><div id="connection-result" aria-live="polite"></div><p class="form-hint">原型不访问网络、不读取私钥、不保存密码。请使用示例值。</p></form></div><div class="dialog-footer"><span class="helper-text">配置仅在页面内存中保留，刷新后恢复</span><button data-action="close-dialog" data-dialog="connection-dialog">取消</button><button class="primary" id="save-connection" data-action="save-connection" disabled>保存示例连接</button></div>`;
  }
  function renderTransportFields(d){
    if(d.type==='local')return `<label class="field"><span>Docker Socket / Windows Named Pipe</span><input name="socketPath" value="${esc(d.socketPath)}" placeholder="unix:///var/run/docker.sock"></label><p class="form-hint">macOS / Linux 使用 Unix Socket；Windows 使用 npipe:////./pipe/docker_engine。正式版支持发现 Docker Desktop、OrbStack、Colima 的端点。</p>`;
    if(d.type==='tcp')return `<label class="field"><span>Engine 地址</span><input name="address" value="${esc(d.address)}" placeholder="https://docker.example.com:2376"></label><label class="checkline"><input name="tls" type="checkbox" checked disabled>TLS 与证书校验（默认开启）</label><label class="field"><span>CA 证书路径</span><input name="caPath" value="${esc(d.caPath)}" placeholder="/path/to/ca.pem"></label><label class="field"><span>客户端证书路径</span><input name="certPath" value="${esc(d.certPath)}" placeholder="/path/to/cert.pem"></label><label class="field"><span>客户端私钥路径</span><input name="certKeyPath" value="${esc(d.certKeyPath)}" placeholder="/path/to/key.pem"></label><p class="form-hint">证书路径仅作交互示例；此原型不会打开文件或请求 Docker API。</p>`;
    return `<div class="form-grid"><label class="field"><span>主机</span><input name="address" value="${esc(d.address)}" required></label><label class="field"><span>端口</span><input name="port" type="number" min="1" max="65535" value="${esc(d.port)}" required></label></div><label class="field"><span>用户名</span><input name="user" value="${esc(d.user)}" required></label><label class="field"><span>认证方式</span><select name="auth">${[['key','私钥文件（OpenSSH）'],['password','密码'],['agent','SSH Agent']].map(([id,t])=>`<option value="${id}" ${d.auth===id?'selected':''}>${t}</option>`).join('')}</select></label>${d.auth==='key'?`<label class="field"><span>私钥文件路径</span><input name="keyPath" value="${esc(d.keyPath)}" placeholder="~/.ssh/id_rsa"></label><label class="field"><span>私钥口令（仅示例）</span><input name="passphrase" type="password" autocomplete="off" value="${esc(d.passphrase)}" placeholder="无口令可留空"></label>`:d.auth==='password'?`<label class="field"><span>密码（仅填写示例值）</span><input name="password" type="password" autocomplete="off" value="${esc(d.password)}" placeholder="原型无需真实密码"></label>`:'<p class="form-hint">使用操作系统现有 SSH Agent；原型仅演示该选择，不访问真实 Agent。</p>'}<label class="checkline"><input name="parseConfig" type="checkbox" ${d.parseConfig?'checked':''}>解析 ~/.ssh/config（正式版能力）</label>`;
  }
  function collectDraft(){const form=$('#connection-form');if(!form)return;new FormData(form).forEach((value,key)=>{state.connectionDraft[key]=String(value);});state.connectionDraft.parseConfig=!!$('input[name="parseConfig"]',form)?.checked;}
  function invalidateTest(){state.tested=null;const result=$('#connection-result');if(result)result.innerHTML='';const button=$('#save-connection');if(button)button.disabled=true;}
  function testConnection(){
    collectDraft();const d=state.connectionDraft;const form=$('#connection-form');if(!form.reportValidity())return;
    let error='';if(!d.name.trim())error='请填写连接名称。';
    if(d.type==='ssh'&&(!d.address.trim()||!d.user.trim()||Number(d.port)<1||Number(d.port)>65535))error='请填写主机、用户名和有效端口。';
    if(d.type==='ssh'&&/[\s/]/.test(d.address))error='SSH 主机请填写 IP 或主机名，不包含协议和路径。';
    if(d.type==='ssh'&&d.auth==='key'&&!d.keyPath.trim())error='请选择私钥路径（使用示例路径即可）。';
    if(d.type==='tcp'&&!/^https:\/\//.test(d.address))error='TCP + TLS 演示请填写 https:// 开头的 Engine 地址。';
    if(d.type==='local'&&!/^(unix:\/\/|npipe:\/\/)/.test(d.socketPath))error='Socket 路径需使用 unix:// 或 npipe://。';
    const [major,minor]=String(d.apiVersion).split('.').map(Number);const manualInvalid=d.apiMode==='manual'&&(!/^1\.\d+$/.test(d.apiVersion)||major!==1||minor<24||minor>43);
    if(manualInvalid)error=`指定 API ${d.apiVersion} 与演示服务端 1.24–1.43 不兼容。请选择“自动协商”，或指定 1.43。`;
    const result=$('#connection-result');result.innerHTML=error?`<div class="connection-result error"><strong>模拟测试未通过</strong><div>${esc(error)}</div><small>这是预设兼容性案例，不代表实际服务器状态。</small></div>`:`<div class="connection-result"><strong>模拟连接测试通过</strong><div class="test-step">${icon('check')}连接参数格式有效</div><div class="test-step">${icon('check')}演示 Docker 访问权限通过</div><div class="test-step">${icon('check')}API 1.52 → ${esc(d.apiMode==='auto'?'1.43':d.apiVersion)} · ${d.apiMode==='auto'?'已自动协商':'指定版本在演示范围内'}</div><small>未发出 SSH / Docker 请求，未读取任何证书或私钥。</small></div>`;
    state.tested=error?null:JSON.stringify(d);$('#save-connection').disabled=!!error;
  }
  function saveConnection(){
    collectDraft();const d=state.connectionDraft;if(state.tested!==JSON.stringify(d)){toast('配置已变化，请重新进行模拟测试。');invalidateTest();return;}
    const h={id:d.id||`demo-host-${Date.now()}`,name:d.name,address:d.type==='local'?d.socketPath:d.address,user:d.user,port:d.port,auth:d.auth,type:d.type,status:'online',api:d.apiMode==='auto'?'1.43':d.apiVersion,apiMode:d.apiMode,env:'示例',projects:[]};
    const old=hosts.find(x=>x.id===d.id);if(old)Object.assign(old,{...h,projects:old.projects});else hosts.push(h);
    closeDialog('connection-dialog');render();toast('示例连接已保存在页面内存中；未建立真实连接。');
  }
  function closeDialog(id){$('#'+id).close();if(id==='connection-dialog'){state.connectionDraft=null;state.tested=null;}}
  const operationLabels={start:'启动',stop:'停止',restart:'重启',down:'Compose Down'};
  function openOperation(op,containerId=null){
    const p=currentProject();if(!p){toast('请选择一个 Compose 项目或容器。');return;}
    const c=containerId?p.containers.find(x=>x.id===containerId):currentContainer();const scope=c?[c]:p.containers;
    const affected=scope.filter(x=>op==='start'?x.state!=='running':op==='stop'?x.state==='running':true);
    if(op!=='down'&&!affected.length){toast(op==='start'?'此范围内的容器已全部运行。':'此范围内的容器已全部停止。');return;}
    state.pending={op,ids:affected.map(x=>x.id),project:p.name,hostId:currentHost().id};
    const down=op==='down';$('#action-dialog').innerHTML=`<div class="dialog-heading"><div><h2 id="action-title">${down?'Compose 源文件尚未关联':`${operationLabels[op]}${affected.length>1?'这些容器':'容器'}？`}</h2><p>请核对目标与影响范围 · 本轮为模拟操作</p></div><button class="icon-button" data-action="close-dialog" data-dialog="action-dialog" aria-label="关闭操作预览">${icon('close')}</button></div><div class="action-body"><div class="impact-host">${icon('host')} <strong>${esc(currentHost().name)}</strong><div class="helper-text">${esc(currentHost().address)} / ${esc(p.name)}</div></div>${down?'<p class="danger-note">通过标签识别到项目，不代表拥有完整 Compose 配置。正式版需先绑定源文件及执行目录，才能运行 Down。</p><p>Down 会移除项目容器及相关网络，与“停止容器”不同。默认不删除卷，执行前必须单独核对。</p>':`<p style="margin-top:15px">${op==='restart'?'所选服务会短暂中断；按原配置重新启动。':op==='stop'?'停止后服务将不可用；容器与数据卷保留。':'将启动以下已停止的容器。'}页面会记录每个目标的模拟结果。</p>`}<div class="impact-list">${(down?p.containers:affected).map(x=>`<div><span>${esc(x.name)}</span><span class="muted">${x.state==='running'?'运行中':'已停止'}</span></div>`).join('')}</div><p class="form-hint">没有连接真实服务器；此操作只修改当前页面内的示例状态。</p></div><div class="dialog-footer"><button data-action="close-dialog" data-dialog="action-dialog">${down?'关闭':'取消'}</button>${down?'':`<button class="${op==='stop'?'danger ':''}primary" data-action="confirm-operation">模拟${operationLabels[op]} ${affected.length} 个容器</button>`}</div>`;$('#action-dialog').showModal();
  }
  function confirmOperation(){
    const pending=state.pending;if(!pending)return;const h=hosts.find(x=>x.id===pending.hostId),p=h?.projects.find(x=>x.name===pending.project);if(!p)return;
    p.containers.filter(c=>pending.ids.includes(c.id)).forEach(c=>{c.state=pending.op==='stop'?'stopped':'running';if(pending.op==='restart')c.restarts++;});
    state.history.unshift({op:pending.op,label:`${operationLabels[pending.op]} ${pending.ids.length} 个容器`,host:h.address,target:p.containers.filter(c=>pending.ids.includes(c.id)).map(c=>c.name).join(', '),time:new Date().toLocaleTimeString('zh-CN',{hour12:false})});state.pending=null;closeDialog('action-dialog');render();toast('模拟操作完成，资源状态和操作记录已更新。');
  }
  function openCommand(initial=''){const dialog=$('#command-dialog');dialog.innerHTML=`<div class="command-search">${icon('search')}<input id="command-input" placeholder="搜索主机、项目、容器或操作…" value="${esc(initial)}" autocomplete="off" aria-label="全局资源搜索"><kbd>Esc</kbd></div><div class="command-results" id="command-results"></div><div class="command-footer">名称与 IP 均可搜索 · 点击定位资源</div>`;dialog.showModal();renderCommand(initial);$('#command-input').focus();}
  function renderCommand(query){
    const q=query.toLowerCase();const results=[];hosts.forEach(h=>h.projects.forEach(p=>{if(`${h.address} ${h.name} ${p.name}`.toLowerCase().includes(q))results.push({name:p.name,meta:h.address,type:'project',host:h.id,project:p.name});p.containers.forEach(c=>{if(`${c.name} ${h.address}`.toLowerCase().includes(q))results.push({name:c.name,meta:`${p.name} / ${h.address}`,type:'container',host:h.id,project:p.name,id:c.id});});}));
    $('#command-results').innerHTML=results.slice(0,24).map(r=>`<button data-action="command-select" data-host="${esc(r.host)}" data-project="${esc(r.project)}" data-id="${esc(r.id||'')}">${icon(r.type==='project'?'stack':'container')}<span>${esc(r.name)}</span><span class="result-meta">${esc(r.meta)}</span></button>`).join('')||'<div class="empty-state">没有匹配的主机、项目或容器</div>';
  }
  function openHelp(mode='overview'){
    const imported=mode==='import';$('#help-dialog').innerHTML=`<div class="dialog-heading"><div><h2>${imported?'导入现有连接':'Docker Workbench · 方案概览'}</h2><p>独立桌面客户端 · 延续 IDEA 的资源操作习惯</p></div><button class="icon-button" data-action="close-dialog" data-dialog="help-dialog" aria-label="关闭方案">${icon('close')}</button></div><div class="help-body">${imported?`<h3>迁移连接，不迁移 IDEA 内部运行状态</h3><p>正式版优先导入 <code>~/.ssh/config</code>、Docker contexts；IDEA 的主机别名、用户名、认证类型可通过连接清单导入。密码与私钥口令需要重新授权或从系统凭据库引用。</p><p>当前页面的主机和项目名称来自你的截图与 IDEA 窗口，属于手工构建的示例。原型不会扫描配置文件或读取密码保险箱。</p><h3>计划的导入步骤</h3><ol><li>选择配置来源，预览主机与重复项。</li><li>确认主机别名、端口、私钥路径与代理。</li><li>逐台验证 SSH、Docker 权限及 API 范围。</li><li>保存到本机连接管理器。</li></ol>`:`<h3>把熟悉的 Services 窗口独立出来</h3><p>左边选主机和 Compose 项目，右边看服务状态，底部持续查看日志、Inspect、资源和终端。连接明确归属到主机，操作始终显示对象与影响范围。</p><div class="architecture"><div><strong>React + TypeScript</strong><br><small>资源树 / 虚拟日志 / xterm.js</small></div><span>→</span><div><strong>Tauri 2 桌面壳</strong><br><small>受限 IPC / 原生窗口 / 凭据引用</small></div><span>→</span><div><strong>Go 连接核心</strong><br><small>Docker SDK / SSH / API 协商</small></div></div><h3>桌面平台</h3><p>目标为 macOS、Windows、Linux，分别构建与验收安装包。远程管理不要求本机运行 Docker Desktop；Compose 重建等能力需要配置文件与相应执行端。</p><h3>先解决你截图里的兼容性</h3><p>连接时读取服务端 API 范围，选择共同支持的版本；提供每连接覆盖入口。原型可演示指定 <code>1.52</code> 失败、切换自动协商到 <code>1.43</code> 成功。</p><h3>本轮可以体验</h3><p>资源树与分类、容器列表、日志搜索与过滤、详情标签、命令面板、连接表单、API 兼容性反馈、操作影响预览、状态回写、日志导出与明暗主题。</p><h3>原型边界</h3><p>没有真实 SSH / Docker 连接，没有实际安装程序；指标、日志与操作结果均为示例。终端仅支持内置模拟命令。清空日志只清空当前页面的示例缓冲。</p><p><a href="../docs/方案.html" target="_blank" rel="noopener">打开完整技术方案</a></p>`}</div><div class="dialog-footer"><span class="helper-text">2026-10-27 · 工作名与样式均可继续调整</span><button class="primary" data-action="close-dialog" data-dialog="help-dialog">知道了</button></div>`;$('#help-dialog').showModal();
  }
  const logText=()=>getLogs().map(l=>`${l.time} [${l.source}] ${l.level} ${l.message}`).join('\n');
  document.addEventListener('click',async e=>{
    const node=e.target.closest('[data-action]');if(!node)return;const a=node.dataset.action;
    if(a==='toggle-sidebar')$('#sidebar').classList.toggle('open');
    if(a==='host'){state.hostId=node.dataset.host;const h=currentHost();state.expanded.has(h.id)?state.expanded.delete(h.id):state.expanded.add(h.id);state.containerId=null;state.category='host';state.project=h.projects[0]?.name||'';render();}
    if(a==='toggle-project'){const key=`${node.dataset.host}:${node.dataset.project}`;state.expanded.has(key)?state.expanded.delete(key):state.expanded.add(key);renderTree();}
    if(a==='project')chooseProject(node.dataset.host,node.dataset.project);
    if(a==='container'){chooseProject(node.dataset.host,node.dataset.project);state.containerId=node.dataset.id;render();}
    if(a==='category'){state.hostId=node.dataset.host;state.category=node.dataset.category;state.containerId=null;state.project=currentHost().projects[0]?.name||'';state.filter='all';state.tab='inspect';render();}
    if(a==='table-container'){const id=node.dataset.id,p=currentHost().projects.find(x=>x.containers.some(c=>c.id===id));if(p)state.project=p.name;state.containerId=id;state.cleared=false;renderTable();renderTree();renderHeader();renderDetails();}
    if(a==='filter'){state.filter=node.dataset.filter;renderTable();}
    if(a==='tab'){state.tab=node.dataset.tab;renderDetails();}
    if(a==='clear-selection'){state.containerId=null;state.category='compose';render();}
    if(a==='project-home'){state.containerId=null;state.category='compose';render();}
    if(a==='collapse'){state.expanded.clear();renderTree();}
    if(a==='refresh'){state.cleared=false;render();toast('已恢复示例缓冲与资源视图；未请求真实服务器。');}
    if(a==='theme'){document.body.classList.toggle('dark');toast('已切换原型主题。');}
    if(a==='connections')openConnections();
    if(a==='close-dialog')closeDialog(node.dataset.dialog);
    if(a==='new-connection'){state.connectionDraft=defaultDraft();state.tested=null;renderConnectionDialog();}
    if(a==='edit-connection'){const h=hosts.find(x=>x.id===node.dataset.host);state.connectionDraft={...defaultDraft(),id:h.id,name:h.name,address:h.address,user:h.user,port:h.port,auth:h.auth,type:h.type};state.tested=null;renderConnectionDialog();}
    if(a==='connection-type'){collectDraft();state.connectionDraft.type=node.dataset.type;if(node.dataset.type==='tcp')state.connectionDraft.address='https://docker.example.com:2376';if(node.dataset.type==='ssh'&&state.connectionDraft.address.includes('://'))state.connectionDraft.address='192.0.2.11';state.tested=null;renderConnectionDialog();}
    if(a==='test-connection')testConnection();
    if(a==='save-connection')saveConnection();
    if(a==='operation')openOperation(node.dataset.operation);
    if(a==='row-operation')openOperation(node.dataset.operation,node.dataset.id);
    if(a==='confirm-operation')confirmOperation();
    if(a==='follow'){state.follow=!state.follow;renderDetails();toast(state.follow?'已开启模拟跟随；当前仍为静态示例日志。':'已暂停模拟跟随。');}
    if(a==='wrap'){state.wrap=!state.wrap;renderDetails();}
    if(a==='clear-logs'){state.cleared=true;renderLogLines();toast('已清空当前页面的示例日志缓冲。');}
    if(a==='copy-logs'){try{await navigator.clipboard.writeText(logText());toast('可见示例日志已复制。');}catch{toast('浏览器未允许剪贴板写入，可使用导出日志。');}}
    if(a==='download-logs'){const url=URL.createObjectURL(new Blob(['# 示例日志，非生产日志\n'+logText()],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=`${currentProject()?.name||'docker'}-示例日志.log`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已导出当前筛选范围的示例日志。');}
    if(a==='maximize')$('#main').classList.toggle('maximized');
    if(a==='history'){state.tab='history';renderDetails();}
    if(a==='command')openCommand();
    if(a==='command-select'){closeDialog('command-dialog');chooseProject(node.dataset.host,node.dataset.project);state.containerId=node.dataset.id||null;render();}
    if(a==='help')openHelp();
    if(a==='import')openHelp('import');
    if(a==='reset'){location.reload();}
  });
  document.addEventListener('input',e=>{
    const el=e.target;
    if(el.id==='tree-search'){state.query=el.value;renderTree();}
    if(el.id==='log-search'){state.logQuery=el.value;renderLogLines();}
    if(el.id==='command-input')renderCommand(el.value);
    if(el.closest('#connection-form')){collectDraft();invalidateTest();}
  });
  document.addEventListener('change',e=>{
    const el=e.target;if(el.id==='log-level'){state.level=el.value;renderLogLines();}
    if(el.closest('#connection-form')){collectDraft();invalidateTest();if(['auth','apiMode','proxy'].includes(el.name)){const openDetails=$$('details[open]',$('#connection-form')).length;renderConnectionDialog();if(el.name==='proxy')$('details',$('#connection-form')).open=true;}}
  });
  document.addEventListener('submit',e=>{
    e.preventDefault();if(e.target.id!=='terminal-form')return;const input=$('#terminal-input'),cmd=input.value.trim();if(!cmd)return;
    const replies={help:'模拟命令：help, pwd, ls, whoami, clear\n任何输入都不会传给操作系统。',pwd:'/app (demo)',ls:'app.jar  config/  logs/ (demo)',whoami:'demo-user'};
    if(cmd==='clear')state.terminal=[];else state.terminal.push(`demo $ ${cmd}`,replies[cmd]||'这是模拟终端，仅支持 help / pwd / ls / whoami / clear。');renderTerminal();$('#terminal-input').focus();
  });
  document.addEventListener('keydown',e=>{
    const editable=/INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(!$('#command-dialog').open)openCommand();}
    if(e.key==='/'&&!editable&&!$$('dialog[open]').length){e.preventDefault();$('#tree-search').focus();}
    if(e.key==='Enter'&&e.target.matches('tr[data-action]'))e.target.click();
  });
  const splitter=$('.split-handle'), listPanel=$('.resource-panel');
  const resizeList=(height)=>{listPanel.style.height=Math.max(110,Math.min(height,$('#main').clientHeight-210))+'px';listPanel.style.maxHeight='none';};
  splitter.addEventListener('pointerdown',e=>{
    const startY=e.clientY,startHeight=listPanel.offsetHeight;
    e.preventDefault();splitter.setPointerCapture(e.pointerId);
    const move=event=>resizeList(startHeight+event.clientY-startY);
    const done=()=>{splitter.removeEventListener('pointermove',move);splitter.removeEventListener('pointerup',done);splitter.removeEventListener('pointercancel',done);};
    splitter.addEventListener('pointermove',move);splitter.addEventListener('pointerup',done);splitter.addEventListener('pointercancel',done);
  });
  splitter.addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();resizeList(listPanel.offsetHeight+(e.key==='ArrowUp'?-20:20));}});
  $('#connection-dialog').addEventListener('cancel',()=>{state.connectionDraft=null;state.tested=null;});
  if(!/Mac/i.test(navigator.platform))$('.command-button kbd').textContent='Ctrl K';fillIcons();render();
})();

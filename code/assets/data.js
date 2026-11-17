'use strict';
// Fictional hosts use documentation-only addresses. All names, states, metrics and logs are demo fixtures.
window.WorkbenchFixtures = (() => {
  const makeContainer = (name, index, project) => ({
    id: `demo-${project}-${index}`, name, service: name, state: index === 2 && project === 'report' ? 'stopped' : 'running',
    image: name.includes('redis') ? 'redis:7.2' : name.includes('nginx') ? 'nginx:1.26' : name.includes('minio') ? 'minio/minio:demo' : `registry.example.com/${project}/${name.replace('-report', '')}:demo`,
    cpu: [1.2, 4.8, 0, 0.6, 1.7, 0.2, 0.4][index % 7], memory: [248, 1536, 0, 192, 312, 24, 67][index % 7],
    port: name.includes('nginx') ? '443:443' : name.includes('redis') ? '6379:6379' : name.includes('minio') ? '9000:9000' : index === 1 ? '8081:8081' : '—',
    created: '2026-10-20 09:30:00', restarts: 0,
  });
  const project = (name, names, source = false) => ({name, source, path: source ? `/opt/demo/${name}/compose.yaml` : null, containers: names.map((n, i) => makeContainer(n, i, name))});
  const hosts = [
    {id:'report-host',name:'Docker · 报表服务器',address:'192.0.2.11',user:'ops',port:'22',auth:'key',type:'ssh',status:'online',api:'1.43',env:'生产',projects:[
      project('metrics',['metrics-api','metrics-nginx']),
      project('portal',['portal-api','nginx-portal','redis-portal']),
      project('report',['monitor-report','api-primary-report','api-secondary-report','worker-report','minio-report','nginx-report','redis-report']),
    ]},
    {id:'platform-host',name:'Docker · 平台服务',address:'192.0.2.2',user:'root',port:'22',auth:'password',type:'ssh',status:'online',api:'1.43',env:'生产',projects:[
      project('data-jobs',['data-collector','data-worker']),project('demo-agent',['demo-agent']),project('sqlbot',['sqlbot','sqlbot-postgres']),
    ]},
    {id:'business-host',name:'Docker · 业务服务器',address:'192.0.2.15',user:'root',port:'22',auth:'password',type:'ssh',status:'online',api:'1.43',env:'生产',projects:[
      project('shop',['shop-api','shop-nginx']),project('team-app',['team-api','team-nginx']),project('dms',['dms-server']),project('onlyoffice',['onlyoffice']),project('pm',['pm-server']),project('audit-demo',['audit-api']),
    ]},
    {id:'data-host',name:'Docker · 数据服务',address:'192.0.2.16',user:'root',port:'22',auth:'agent',type:'ssh',status:'online',api:'1.43',env:'生产',projects:[]},
    {id:'ai-host',name:'Docker · AI 环境',address:'198.51.100.19',user:'ai',port:'22',auth:'password',type:'ssh',status:'online',api:'1.47',env:'开发',projects:[
      project('docflow',['docflow-api','docflow-worker']),project('kag',['kag-server']),project('redis',['redis']),
    ]},
    {id:'local-host',name:'Docker · 本机',address:'unix:///var/run/docker.sock',user:'',port:'',auth:'agent',type:'local',status:'offline',api:'—',env:'本地',projects:[]},
  ];
  const phrases = [
    ['INFO','Application ready; accepting incoming requests.'],
    ['INFO','HikariPool-1 - Connection acquired in 12ms.'],
    ['INFO','GET /actuator/health 200 8ms'],
    ['INFO','Scheduled task completed successfully; processed=24.'],
    ['WARN','Readiness probe exceeded 2000ms; retry scheduled.'],
    ['INFO','10 changes in 300 seconds. Saving...'],
    ['INFO','Background saving terminated with success.'],
    ['INFO','Configuration refresh complete; active profile=prod.'],
    ['INFO','GET /report/overview 200 36ms'],
    ['INFO','Started application in 18.352 seconds.'],
    ['ERROR','Example upstream request timed out after 3000ms.'],
    ['INFO','Retry completed; upstream connection recovered.'],
  ];
  function buildLogs(p) {
    if (!p) return [];
    return Array.from({length:42},(_,i)=>{
      const c=p.containers[i%p.containers.length]; if (!c) return null;
      const [level,message]=phrases[i%phrases.length];
      return {id:i+1,time:`10:42:${String(i%60).padStart(2,'0')}.${String((i*37)%1000).padStart(3,'0')}`,source:c.name,level,message:c.state==='stopped'?'Shutdown completed. Container exited with code 0.':message,color:i%3};
    }).filter(Boolean);
  }
  return {hosts,buildLogs};
})();

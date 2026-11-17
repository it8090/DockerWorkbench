"""Build the local HTML review document from the Markdown plan."""
from pathlib import Path
import html
import re

root = Path(__file__).resolve().parents[2]
source = (root / 'docs/技术方案.md').read_text()
start = source.index('```mermaid')
end = source.index('```', start + 10) + 3
diagram = '''<div class="architecture"><div><strong>React + TypeScript</strong><small>资源树 / 表格 / 日志 / 终端</small></div><b>→</b><div><strong>Tauri 2</strong><small>窗口 / 受限 IPC / 凭据引用</small></div><b>→</b><div><strong>Go 连接核心</strong><small>Docker SDK / SSH / API 协商</small></div></div><p class="caption">SSH / Unix Socket / Windows Named Pipe / TCP + mTLS</p>'''
source = source[:start] + '__ARCH_DIAGRAM__' + source[end:]

def inline(value):
    value = html.escape(value)
    value = re.sub(r'`([^`]+)`', r'<code>\1</code>', value)
    value = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', value)
    return re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', value)

lines = source.splitlines()
out, toc = [], []
i = 0
while i < len(lines):
    line = lines[i]
    if not line.strip():
        i += 1
        continue
    if line.startswith('```'):
        block = []
        i += 1
        while i < len(lines) and not lines[i].startswith('```'):
            block.append(lines[i])
            i += 1
        out.append('<pre><code>' + html.escape('\n'.join(block)) + '</code></pre>')
        i += 1
        continue
    heading = re.match(r'^(#{1,3}) (.+)$', line)
    if heading:
        level, title = len(heading[1]), heading[2]
        anchor = 'section-' + str(i)
        out.append(f'<h{level} id="{anchor}">{inline(title)}</h{level}>')
        if level > 1:
            toc.append((anchor, title))
        i += 1
        continue
    if line.startswith('|'):
        rows = []
        while i < len(lines) and lines[i].startswith('|'):
            row = lines[i].strip('|').split('|')
            if not all(re.fullmatch(r'[\s:-]+', cell) for cell in row):
                rows.append(row)
            i += 1
        header = '<thead><tr>' + ''.join('<th>' + inline(c.strip()) + '</th>' for c in rows[0]) + '</tr></thead>'
        body = '<tbody>' + ''.join('<tr>' + ''.join('<td>' + inline(c.strip()) + '</td>' for c in row) + '</tr>' for row in rows[1:]) + '</tbody>'
        out.append('<table>' + header + body + '</table>')
        continue
    item = re.match(r'^(- |\d+\. )(.+)$', line)
    if item:
        ordered = item[1] != '- '
        tag = 'ol' if ordered else 'ul'
        items = []
        while i < len(lines):
            match = re.match(r'^(- |\d+\. )(.+)$', lines[i])
            if not match or (match[1] != '- ') != ordered:
                break
            items.append('<li>' + inline(match[2]) + '</li>')
            i += 1
        out.append(f'<{tag}>' + ''.join(items) + f'</{tag}>')
        continue
    paragraph = [line]
    i += 1
    while i < len(lines) and lines[i].strip():
        paragraph.append(lines[i])
        i += 1
    out.append('<p>' + inline(' '.join(paragraph)) + '</p>')
article = '\n'.join(out).replace('<p>__ARCH_DIAGRAM__</p>', diagram)
toc_html = '<div class="toc"><ul>' + ''.join(f'<li><a href="#{anchor}">{html.escape(title)}</a></li>' for anchor, title in toc) + '</ul></div>'
page = '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'"><title>Docker Workbench · 技术方案</title><link rel="icon" href="../code/assets/mark.svg"><style>
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:90px}body{margin:0;background:#f5f7fb;color:#29374c;font:15px/1.85 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}a{color:#285ad6;text-decoration:none}a:hover{text-decoration:underline}header{height:66px;display:flex;align-items:center;justify-content:space-between;padding:0 35px;border-bottom:1px solid #dfe5ef;background:#fff;position:sticky;top:0;z-index:2;gap:20px}.brand{display:flex;align-items:center;gap:10px;color:#25334a;font-weight:650;font-size:15px}.brand img{width:27px;height:27px}.open{padding:7px 15px;color:#fff;background:#285ad6;border-radius:6px;font-size:13px}.layout{max-width:1360px;margin:auto;display:grid;grid-template-columns:220px minmax(0,1fr);gap:35px;padding:36px 35px 70px}aside{position:sticky;top:100px;align-self:start;max-height:calc(100vh - 140px);overflow:auto;font-size:12px}.toc ul{list-style:none;padding-left:0}.toc li{margin:7px 0}.toc ul ul{padding-left:12px;font-size:11px}.toc a{color:#64758e}article{min-width:0;background:#fff;border:1px solid #e0e6ef;border-radius:10px;padding:35px 40px 50px}h1{font-size:29px;line-height:1.4;letter-spacing:-.7px;margin:0 0 12px;color:#203049}h2{font-size:21px;line-height:1.5;margin:42px 0 18px;padding-bottom:11px;border-bottom:1px solid #e1e7ef;color:#243750}h3{font-size:16px;margin:26px 0 10px}p{margin:13px 0}article>p:first-of-type{font-size:12px;color:#6d7d93;margin-bottom:25px}li{margin:7px 0}table{border-collapse:collapse;display:block;overflow:auto;width:100%;font-size:12px;line-height:1.8;margin:18px 0}th,td{padding:11px 13px;border:1px solid #e0e5ed;min-width:100px;vertical-align:top;text-align:left}th{background:#f0f4fa;color:#536987;font-weight:600}tr:nth-child(even){background:#fafbfd}code{font:12px/1.8 ui-monospace,SFMono-Regular,Consolas,monospace;background:#f1f4f9;color:#36516f;padding:2px 4px;border-radius:3px;overflow-wrap:anywhere}pre{background:#182332;color:#cbd9ee;padding:20px;overflow:auto;border-radius:6px}pre code{background:transparent;color:inherit;padding:0;white-space:pre;overflow-wrap:normal}.architecture{display:grid;grid-template-columns:1fr 20px 1fr 20px 1fr;gap:6px;align-items:center;text-align:center;margin:25px 0 10px}.architecture>div{background:#eef3fc;border:1px solid #d7e1f2;padding:17px 7px;border-radius:6px;min-height:86px;display:flex;flex-direction:column;justify-content:center}.architecture strong{font-size:12px}.architecture small{font-size:10px;color:#63758f}.architecture b{color:#8fa5c5}.caption{text-align:center;font-size:11px;color:#6e7e94}footer{text-align:center;font-size:11px;color:#718199;border-top:1px solid #dfe6f0;padding:18px}@media(max-width:1000px){.layout{grid-template-columns:165px minmax(0,1fr);gap:20px;padding:24px}article{padding:25px}h1{font-size:25px}}@media(max-width:760px){.layout{display:block;padding:15px 10px}aside{display:none}article{padding:21px 17px}header{padding:0 13px;height:60px}.brand{font-size:12px}.open{font-size:11px;padding:6px 9px}h1{font-size:23px}h2{font-size:19px}body{font-size:14px}.architecture{grid-template-columns:1fr;gap:5px}.architecture b{transform:rotate(90deg)}.architecture>div{min-height:60px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
</style></head><body><header><a class="brand" href="../code/index.html"><img src="../code/assets/mark.svg" alt="">Docker Workbench · 技术方案</a><a class="open" href="../code/index.html">打开交互原型</a></header><div class="layout"><aside><strong>方案目录</strong>__TOC__</aside><article>__ARTICLE__</article></div><footer>2026-10-27 · 桌面客户端 v0.1 实施方案 · <a href="技术方案.md">Markdown 源文件</a></footer></body></html>'''
(root / 'docs/方案.html').write_text(page.replace('__TOC__', toc_html).replace('__ARTICLE__', article))
print('docs/方案.html 已更新')

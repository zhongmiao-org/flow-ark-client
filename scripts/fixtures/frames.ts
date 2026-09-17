import { createServer, type Server } from 'node:http';

export async function startFrameFixture() {
  const state = { clicks: [] as string[], uploads: [] as Buffer[] };
  const listen = (server: Server) =>
    new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const embedded = createServer((req, res) => {
    const request = new URL(req.url!, 'http://fixture');
    const variant = request.searchParams.get('v') ?? 'first';
    if (request.pathname === '/hit') {
      state.clicks.push(variant);
      res.end('clicked:' + variant);
      return;
    }
    if (request.pathname === '/upload' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        state.uploads.push(Buffer.concat(chunks));
        res.end('frame-upload-confirmed');
      });
      return;
    }
    if (request.pathname === '/download') {
      res.setHeader('Content-Disposition', 'attachment; filename="frame.txt"');
      res.end('frame-download');
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (request.pathname === '/outer') {
      res.end(
        `<!doctype html><p id="value">outer</p><iframe id="inner" src="/inner?v=${variant}"></iframe>`,
      );
      return;
    }
    res.end(`<!doctype html><p id="value">inner:${variant}</p>
      <input id="name" oninput="document.querySelector('#echo').textContent=this.value"><p id="echo"></p>
      <button id="action">local action</button>${variant === 'late' ? '<button id="late">late action</button>' : ''}
      <input id="upload" type="file"><button id="send">local upload</button><p id="receipt"></p>
      <a id="download" href="/download">download</a>
      <script>
        document.querySelector('#action').onclick=async()=>{document.querySelector('#echo').textContent=await fetch('/hit?v=${variant}').then(r=>r.text())};
        document.querySelector('#late')?.addEventListener('click',()=>fetch('/hit?v=late'));
        document.querySelector('#send').onclick=async()=>{document.querySelector('#receipt').textContent=await fetch('/upload',{method:'POST',body:await document.querySelector('#upload').files[0].arrayBuffer()}).then(r=>r.text())};
      </script>`);
  });
  await listen(embedded);
  const origin = `http://127.0.0.1:${(embedded.address() as any).port}`;
  const top = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><title>Local frame scopes</title><p id="value">top</p><p id="echo">top unchanged</p>
      <input id="name" value="top"><button id="action" onclick="document.querySelector('#echo').textContent='wrong top action'">top action</button>
      <iframe id="outer" src="${origin}/outer"></iframe>
      <iframe class="duplicate" src="${origin}/inner"></iframe><iframe class="duplicate" src="${origin}/inner"></iframe>
      <button id="replace">replace frame</button><button id="arm-swap">replace during wait</button><button id="add-delayed">delayed frame</button>
      <script>
        function replace(v){const next=document.createElement('iframe');next.id='outer';next.src='${origin}/outer?v='+v;document.querySelector('#outer').replaceWith(next)}
        document.querySelector('#replace').onclick=()=>replace('second');
        document.querySelector('#arm-swap').onclick=()=>setTimeout(()=>replace('late'),200);
        document.querySelector('#add-delayed').onclick=()=>setTimeout(()=>{const f=document.createElement('iframe');f.id='delayed';f.src='${origin}/outer';document.body.append(f)},180);
      </script>`);
  });
  await listen(top);
  return {
    url: `http://127.0.0.1:${(top.address() as any).port}`,
    state,
    close: async () => {
      await Promise.all(
        [top, embedded].map(
          (s) =>
            new Promise<void>((resolve) => {
              s.close(() => resolve());
              s.closeAllConnections();
            }),
        ),
      );
    },
  };
}

import { createServer } from 'node:http';
/** Minimal platform fixture: lifecycle, picker, layout and side-effect receipt. No demo distribution. */
export async function startFormLab(port = 0) {
  const state = { attempts: 0, accepted: [] as any[], rejected: 0 };
  const server = createServer(async (req, res) => {
    if (req.url?.startsWith('/api/submit')) {
      state.attempts++;
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const fields = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const item = { fields, receipt: state.attempts };
      state.accepted.push(item);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(item));
      return;
    }
    if (req.url === '/fictional.txt') {
      res.setHeader('Content-Disposition', 'attachment; filename="fictional.txt"');
      res.end('fixture');
      return;
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(
      `<!doctype html><title>Platform fixture</title><h1>Platform fixture</h1><form><label>Name<input id="fullName" name="fullName"></label><label>Option A<input type="radio" id="option-a" name="option" value="a"></label><label>Choice<select id="choice"><option value="a">A</option><option value="b">B</option></select></label><button id="submit" type="submit">Submit</button></form><a href="/fictional.txt">Download fixture</a><pre id="receipt"></pre><script>document.querySelector('form').onsubmit=async e=>{e.preventDefault();const fields={fullName:document.querySelector('#fullName').value};document.querySelector('#receipt').textContent=JSON.stringify(await(await fetch('/api/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(fields)})).json())}</script>`,
    );
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  return {
    url: 'http://127.0.0.1:' + (server.address() as any).port,
    state,
    close: () => new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r()))),
  };
}

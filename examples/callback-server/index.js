import http from 'node:http';

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      console.log('\n[event]', req.headers['x-runner-event']);
      console.log('[payload]', body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  })
  .listen(9999, () => console.log('callback server on :9999'));

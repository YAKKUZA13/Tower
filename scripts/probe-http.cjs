const http = require('http');
const probe = (host, port) => {
  const req = http.get({ hostname: host, port, path: '/', timeout: 3000 }, (r) => {
    let d = '';
    r.on('data', (c) => { d += c; });
    r.on('end', () => console.log('OK ', host + ':' + port, '->', r.statusCode, 'len', d.length));
  });
  req.on('timeout', () => { console.log('TIMEOUT', host + ':' + port); req.destroy(); });
  req.on('error', (e) => console.log('ERR', host + ':' + port, '->', e.code || e.message));
};
probe('localhost', 5173);
probe('127.0.0.1', 5173);
probe('::1', 5173);

// Required shims
const base64 = require('base-64');
global.btoa = function(s) { return base64.encode(s); }
global.atob = function(s) { return base64.decode(s); }

global.fetch = require('node-fetch');

// Import Root Certificate Authorities from the Windows certificate store
require('win-ca')

const path = require('path');
const fs = require('fs');
const https = require('https');
const express = require('express');
//const methodOverride = require('method-override');
const config = require('./config.js');
const userApi = require('./api');

function logErrors (err, req, res, next) {
  console.error(err.stack)
  next(err)
}

const app = express();

app.use(express.json());
//app.use(methodOverride());
app.use(express.urlencoded({ extended: true }));
app.use('/api/user', userApi);
app.use(logErrors);

app.use(express.static(path.join(__dirname, '../out/public')));

//app.get('/*', (req, res) => res.redirect('/main'))
//app.get('/main', (req, res) => res.sendFile(path.join(viewsDir, 'index.html')))

const httpsOptions = {
    pfx: fs.readFileSync(config.site.sslCertificate.pfxFilename),
    passphrase: config.site.sslCertificate.passphrase,
};

https
    .createServer(httpsOptions, app)
    .listen(config.site.port, config.site.host);


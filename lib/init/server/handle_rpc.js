"use strict";


/*global nodeca, _*/


// stdlib
var http = require('http');


// 3rd-party
var treeGet = require('nlib').Support.tree.cache.get;


// internal
var env         = require('../../env');
var compression = require('./compression');
var logger      = nodeca.logger.getLogger('rpc');


////////////////////////////////////////////////////////////////////////////////


function log(req, res) {
  var level = 'info';

  if (res.error) {
    level = 400 <= res.error.statusCode ? 'error' : 'fatal';
  }

  logger[level]('%s - %s() - "%s"',
                req.connection.remoteAddress,
                req.payload.method,
                req.headers['user-agent']);
}


// Ends response with given `error`, `response` and nodeca version.
//
function end(req, res, error, response) {
  var payload, compressor;

  //
  // Set some obligatory headers
  //

  res.removeHeader('Accept-Ranges');

  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.setHeader('Server', 'Sansung Calakci');
  res.setHeader('Date',   (new Date).toUTCString());

  //
  // Prepare and stringify payload
  //

  payload = res.payload = JSON.stringify({
    version:  nodeca.runtime.version,
    error:    error,
    response: error ? null : response
  });

  //
  // Status code always OK
  //

  res.error       = error;
  res.statusCode  = 200;

  //
  // Check whenever compression is allowed by client or not
  //

  compressor = compression.is_allowed(req);

  //
  // Mark for proxies, that we can return different content (plain & gzipped),
  // depending on specified (comma-separated) headers
  //

  res.setHeader('Vary', 'Accept-Encoding');

  //
  // Return raw response, if compression is not allowed or body is too small
  //

  if (false === compressor || 500 > Buffer.byteLength(payload)) {
    log(req, res);
    res.end(payload);
    return;
  }

  //
  // Compress body
  //

  compression.process(compressor, payload, function (err, buffer) {
    if (err) {
      // should never happen
      nodeca.logger.fatal('Failed to compress RPC response', err);

      res.error   = err;
      res.payload = JSON.stringify({
        version:  nodeca.runtime.version,
        error:    err,
        response: null
      });

      log(req, res);
      res.end(res.payload);
      return;
    }

    //
    // Compression is allowed and succeed, set Content-Encoding
    //

    res.setHeader('Content-Encoding', compressor);
    log(req, res);
    res.end(buffer);
  });
}


////////////////////////////////////////////////////////////////////////////////


module.exports = function handle_rpc(req, res) {
  var payload = req.params, msg, func;

  // save request payload
  req.payload = payload;

  // invalid request
  if ('POST' !== req.method) {
    end(req, res, { statusCode: 400, body: 'Invalid request method' });
    return;
  }

  // invalid payload
  if (!payload.version || !payload.method) {
    end(req, res, { statusCode: 400, body: 'Invalid payload' });
    return;
  }

  // invalid client version.
  // client will check server version by it's own,
  // so in fact this error is not used by client
  if (payload.version !== nodeca.runtime.version) {
    end(req, res, { statusCode: 400, body: 'Client version mismatch' });
    return;
  }

  func = treeGet(nodeca.server, payload.method);

  // invalid method name
  if (!func) {
    end(req, res, { statusCode: 404, body: 'API path not found' });
    return;
  }

  nodeca.filters.run(payload.method, payload.params || {}, func, function (err) {
    if (err) {
      if (!err.statusCode && 'development' !== nodeca.runtime.env) {
        nodeca.logger.fatal(err);
        err = 'Application error';
      }
    }

    end(req, res, err, this.response, this.request.method);
  }, env({
    rpc:    { req: req, res: res },
    method: payload.method
  }));
};

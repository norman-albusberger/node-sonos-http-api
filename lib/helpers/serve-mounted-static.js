'use strict';

function serveMountedStatic(routePrefix, serve, req, res, next) {
  if (req.url !== routePrefix && !req.url.startsWith(`${routePrefix}/`)) {
    next();
    return;
  }

  const originalUrl = req.url;
  req.url = req.url.slice(routePrefix.length) || '/';

  serve(req, res, (err) => {
    req.url = originalUrl;
    next(err);
  });
}

module.exports = serveMountedStatic;

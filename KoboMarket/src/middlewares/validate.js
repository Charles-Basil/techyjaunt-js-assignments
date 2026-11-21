// Usage in a route:
//   router.post('/products', validate({ body: createProductSchema }), controller.create)
//
// Each schema is optional. Parsed (cleaned, type-coerced) values are stored on
// req.validated.{body,query,params}. In Express 5 req.query is read-only, which
// is why we don't overwrite it. req.body is replaced so unknown fields are dropped.
// A failure throws a ZodError, which errorHandler turns into 400 VALIDATION_ERROR.
function validate(schemas) {
  return (req, res, next) => {
    try {
      req.validated = {};
      if (schemas.body) {
        req.validated.body = schemas.body.parse(req.body);
        req.body = req.validated.body;
      }
      if (schemas.query) req.validated.query = schemas.query.parse(req.query);
      if (schemas.params) req.validated.params = schemas.params.parse(req.params);
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = validate;

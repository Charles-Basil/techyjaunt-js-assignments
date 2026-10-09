// Takes a Joi schema and returns a function that checks req.body against it
module.exports = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, {
    abortEarly: false,   // report ALL problems, not just the first one
    stripUnknown: true,  // silently drop any extra fields the user sent
  });

  if (error) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: error.details.map((d) => d.message),
    });
  }

  req.body = value; // use the cleaned data from here on
  next();           // validation passed, move on to the next step
};
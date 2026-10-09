# EventHorizon API

A RESTful backend API for an event management system, built with Node.js, Express, and MongoDB.

## Features

* User registration with input validation
* Password hashing using bcrypt
* Email verification using Nodemailer
* JWT-based authentication
* Protected user profile endpoint
* Centralized error handling

## Tech Stack

* Node.js
* Express.js
* MongoDB and Mongoose
* Joi
* bcryptjs
* JSON Web Tokens (JWT)
* Nodemailer

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create a `.env` file in the project root and configure the required values:

* `PORT`
* `MONGO_URI`
* `JWT_SECRET`
* `JWT_EXPIRES_IN`
* SMTP configuration for email delivery
* `API_URL`

Never commit your `.env` file or expose your credentials.

### 3. Start the server

```bash
node server.js
```

## API Endpoints

| Method | Endpoint                           | Description                          |
| ------ | ---------------------------------- | ------------------------------------ |
| POST   | `/api/auth/register`               | Register a user                      |
| GET    | `/api/auth/verify-email?token=...` | Verify email address                 |
| POST   | `/api/auth/login`                  | Log in                               |
| GET    | `/api/users/profile`               | Get the authenticated user's profile |

The profile endpoint requires a valid JWT bearer token.

## Security

Passwords are hashed before storage. Protected routes require authentication, and email verification is required before login.

## License

This project was developed as part of a TechyJaunt backend assignment.

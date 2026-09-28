export class AppError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function errorHandler(error, _request, response, _next) {
  const statusCode = error.statusCode ?? 500;
  const body = { error: statusCode === 500 ? 'Internal server error' : error.message };
  if (error.details) body.details = error.details;
  response.status(statusCode).json(body);
}

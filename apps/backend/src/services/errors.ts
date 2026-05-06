// Errores tipados de dominio — US-005
// El setErrorHandler en index.ts ya lee error.statusCode y error.name,
// así que estas clases funcionan out-of-the-box con el handler global.

export class DomainError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'DomainError';
    // Necesario para que instanceof funcione correctamente al transpilar a ES5
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 400 — la entrada no cumple las reglas de dominio */
export class ValidationError extends DomainError {
  constructor(message: string, code: string) {
    super(message, 400, code);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 409 — conflicto con el estado actual del sistema */
export class ConflictError extends DomainError {
  constructor(message: string, code: string) {
    super(message, 409, code);
    this.name = 'ConflictError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 404 — recurso inexistente */
export class NotFoundError extends DomainError {
  constructor(message: string, code: string) {
    super(message, 404, code);
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 400 — required env-var/credential not configured for the requested operation. */
export class ApiKeyMissingError extends DomainError {
  readonly serviceName: string;
  constructor(serviceName: string) {
    super(
      `API key not configured for service '${serviceName}'`,
      400,
      'API_KEY_MISSING',
    );
    this.name = 'ApiKeyMissingError';
    this.serviceName = serviceName;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 502 — upstream third-party API returned an error / timed out / sent bad JSON.
 *  MUST NOT expose the API key in cause or logs. */
export class ExternalApiError extends DomainError {
  readonly serviceName: string;
  readonly upstreamCause: unknown;
  constructor(serviceName: string, cause: unknown) {
    super(
      `Upstream service '${serviceName}' failed`,
      502,
      'EXTERNAL_API_ERROR',
    );
    this.name = 'ExternalApiError';
    this.serviceName = serviceName;
    this.upstreamCause = cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

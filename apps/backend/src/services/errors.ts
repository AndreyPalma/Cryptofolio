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

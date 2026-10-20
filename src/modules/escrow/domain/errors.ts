import { NotFoundError } from '../../../shared/errors/app-error.js';

export class EscrowNotFoundError extends NotFoundError {
  constructor() {
    super('Escrow not found');
  }
}

export class InvalidEscrowStateError extends Error {
  constructor(message = 'Escrow is not in a valid state for this operation') {
    super(message);
    this.name = 'InvalidEscrowStateError';
  }
}

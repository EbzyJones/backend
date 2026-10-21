import { AppError } from '../../../shared/errors/app-error.js';

export class FleetNotFoundError extends AppError {
  constructor(message = 'Fleet not found') {
    super(message, 404, 'FLEET_NOT_FOUND');
  }
}

export class DriverPayoutAddressNotFoundError extends AppError {
  constructor(message = 'Driver payout address not found') {
    super(message, 404, 'DRIVER_NOT_FOUND');
  }
}

export type { UserRecord, UserRole, WalletAddressRecord } from './entities.js';
export type {
  UserReader,
  WalletAddressRepository,
  ChallengeService,
  VerifiedChallenge,
  SignatureVerifier,
} from './ports.js';
export {
  UserNotFoundError,
  WalletAlreadyLinkedError,
  WalletNotFoundError,
  ForbiddenWalletAccessError,
  InvalidWalletChallengeError,
  InvalidWalletSignatureError,
  ChallengeExpiredError,
} from './errors.js';

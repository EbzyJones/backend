import type { DisputeRepository } from '../domain/dispute-repository.js';
import type { EvidenceRepository } from '../domain/evidence-repository.js';
import type { EvidenceStorage } from '../domain/evidence-storage.js';
import type { WalletOwnershipRepository } from '../domain/wallet-ownership-repository.js';
import { DisputeStatus } from '../domain/dispute-status.js';
import { EvidenceNotFoundError, ForbiddenEvidenceAccessError } from '../domain/index.js';

export interface DownloadEvidenceInput {
  evidenceId: string;
  requesterId: string;
  requesterRole: string;
}

export interface DownloadEvidenceResult {
  bytes: Buffer;
  contentType: string;
}

export interface DownloadEvidenceDeps {
  evidenceRepository: EvidenceRepository;
  evidenceStorage: EvidenceStorage;
  disputeRepository: DisputeRepository;
  walletOwnershipRepository: WalletOwnershipRepository;
}

/**
 * Dispute lifecycle states in which evidence remains downloadable by the
 * dispute participants. Once a dispute is resolved, cancelled, or closed,
 * evidence is no longer exposed to participants — only ADMIN retains access.
 */
const PARTICIPANT_ACCESSIBLE_STATUSES: ReadonlySet<DisputeStatus> = new Set([
  DisputeStatus.OPEN,
  DisputeStatus.UNDER_REVIEW,
]);

export function createDownloadEvidenceUseCase(deps: DownloadEvidenceDeps) {
  const { evidenceRepository, evidenceStorage, disputeRepository, walletOwnershipRepository } =
    deps;

  return async function downloadEvidence(
    input: DownloadEvidenceInput,
  ): Promise<DownloadEvidenceResult> {
    const evidence = await evidenceRepository.findById(input.evidenceId);
    if (!evidence) {
      throw new EvidenceNotFoundError(input.evidenceId);
    }

    const dispute = await disputeRepository.findById(evidence.disputeId);
    if (!dispute) {
      throw new EvidenceNotFoundError(input.evidenceId);
    }

    if (input.requesterRole === 'ADMIN') {
      const stored = await evidenceStorage.read(evidence.storageUrl);
      return { bytes: stored, contentType: evidence.contentType };
    }

    // Lifecycle gate: participants may only download evidence while the
    // dispute is still open/under review. Resolved, cancelled, or closed
    // disputes stop exposing evidence to participants.
    if (!PARTICIPANT_ACCESSIBLE_STATUSES.has(dispute.status)) {
      throw new ForbiddenEvidenceAccessError(input.evidenceId, input.requesterId);
    }

    const isRaiser = dispute.raisedByUserId === input.requesterId;
    const isUploader = evidence.uploadedByUserId === input.requesterId;

    let isAuthorized = isRaiser || isUploader;

    if (!isAuthorized) {
      // Legacy evidence rows (no uploadedByUserId captured at upload time)
      // fall back to current wallet ownership of the uploadedBy address.
      if (!evidence.uploadedByUserId) {
        const ownsWallet = await walletOwnershipRepository.isOwnedBy(
          evidence.uploadedBy,
          input.requesterId,
        );
        isAuthorized = ownsWallet;
      }
    }

    if (!isAuthorized) {
      throw new ForbiddenEvidenceAccessError(input.evidenceId, input.requesterId);
    }

    const stored = await evidenceStorage.read(evidence.storageUrl);
    return { bytes: stored, contentType: evidence.contentType };
  };
}

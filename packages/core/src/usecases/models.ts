import type { ModelDescriptor } from "@middleware/contracts";

import { NotFoundError } from "../domain/errors.ts";
import type { Clock } from "../ports/clock.ts";
import type { CredentialRepo } from "../ports/credential-repo.ts";
import type { ModelCache } from "../ports/model-cache.ts";
import type { ModelGateway } from "../ports/model-gateway.ts";
import type { SecretVault } from "../ports/secret-vault.ts";

/** The acceptance for WP-13: one hour. */
export const MODEL_CACHE_TTL_MS = 60 * 60 * 1000;

const TABLE = "provider_credential";

export type ModelServiceDeps = {
  credentialRepo: CredentialRepo;
  secretVault: SecretVault;
  modelGateway: ModelGateway;
  modelCache: ModelCache;
  clock: Clock;
};

export type ModelService = {
  /**
   * The provider's catalogue for one credential. `workspaceId` comes from the
   * session, so a credential of another workspace is a missing one (S4).
   */
  listModels(
    workspaceId: string,
    credentialId: string,
  ): Promise<ModelDescriptor[]>;
};

export function createModelService({
  credentialRepo,
  secretVault,
  modelGateway,
  modelCache,
  clock,
}: ModelServiceDeps): ModelService {
  return {
    async listModels(workspaceId, credentialId) {
      // Authorise first: an archived or foreign credential must not be answered
      // from the cache, even with an entry still inside its hour.
      const stored = await credentialRepo.findSealed(workspaceId, credentialId);
      if (!stored) throw new NotFoundError();

      const key = `${workspaceId}:${credentialId}`;
      const cached = await modelCache.read(key, clock.now());
      if (cached !== null) return cached;

      const apiKey = await secretVault.open(
        workspaceId,
        { table: TABLE, id: stored.id },
        stored.secret,
      );
      // Discovery never follows a user-supplied base URL: that path belongs to
      // the SSRF-safe client (WP-14). Until then an openai-compatible credential
      // simply has no catalogue.
      const models = await modelGateway.listModels({
        providerId: stored.providerId,
        credential: { apiKey },
      });

      await modelCache.write(
        key,
        models,
        new Date(clock.now().getTime() + MODEL_CACHE_TTL_MS),
      );
      return models;
    },
  };
}

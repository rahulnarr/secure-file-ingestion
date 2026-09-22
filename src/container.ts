import type { Pool } from "pg";
import type { AppConfig } from "./config/env.js";
import { UrlSigner } from "./infrastructure/crypto/url-signer.js";
import type { BlobStorage } from "./infrastructure/storage/blob-storage.js";
import { LocalBlobStorage } from "./infrastructure/storage/local-blob-storage.js";
import { ListAuditEventsController } from "./modules/audit/controllers/list-audit-events.controller.js";
import { PgAuditRepository } from "./modules/audit/audit.repository.js";
import { ListAuditEventsService } from "./modules/audit/services/list-audit-events.service.js";
import { RecordAuditEventService } from "./modules/audit/services/record-audit-event.service.js";
import { DownloadFileController } from "./modules/downloads/controllers/download-file.controller.js";
import { DownloadFileService } from "./modules/downloads/services/download-file.service.js";
import { BatchDeleteFilesController } from "./modules/files/controllers/batch-delete-files.controller.js";
import { BatchUploadFilesController } from "./modules/files/controllers/batch-upload-files.controller.js";
import { DeleteFileController } from "./modules/files/controllers/delete-file.controller.js";
import { GetFileController } from "./modules/files/controllers/get-file.controller.js";
import { ListFilesController } from "./modules/files/controllers/list-files.controller.js";
import { UpdateFileController } from "./modules/files/controllers/update-file.controller.js";
import { UploadFileController } from "./modules/files/controllers/upload-file.controller.js";
import { PgFileRepository } from "./modules/files/file.repository.js";
import { BatchDeleteFilesService } from "./modules/files/services/batch-delete-files.service.js";
import { BatchUploadFilesService } from "./modules/files/services/batch-upload-files.service.js";
import { DeleteFileService } from "./modules/files/services/delete-file.service.js";
import { FileAccessService } from "./modules/files/services/file-access.service.js";
import { GetFileService } from "./modules/files/services/get-file.service.js";
import { ListFilesService } from "./modules/files/services/list-files.service.js";
import { UpdateFileService } from "./modules/files/services/update-file.service.js";
import { UploadFileService } from "./modules/files/services/upload-file.service.js";
import { HealthController } from "./modules/health/controllers/health.controller.js";
import { CreateSignedLinkController } from "./modules/signed-links/controllers/create-signed-link.controller.js";
import { ListSignedLinksController } from "./modules/signed-links/controllers/list-signed-links.controller.js";
import { RevokeSignedLinkController } from "./modules/signed-links/controllers/revoke-signed-link.controller.js";
import { PgSignedLinkRepository } from "./modules/signed-links/signed-link.repository.js";
import { CreateSignedLinkService } from "./modules/signed-links/services/create-signed-link.service.js";
import { ListSignedLinksService } from "./modules/signed-links/services/list-signed-links.service.js";
import { RedeemSignedLinkService } from "./modules/signed-links/services/redeem-signed-link.service.js";
import { RevokeSignedLinkService } from "./modules/signed-links/services/revoke-signed-link.service.js";

/** Composition root: the only place that knows concrete implementations. */
export function buildContainer(
  config: AppConfig,
  pool: Pool,
  storage: BlobStorage = new LocalBlobStorage(config.uploadDirAbsolute),
) {
  const signer = new UrlSigner(config.SIGNING_SECRET, config.BASE_URL);

  const fileRepository = new PgFileRepository(pool);
  const signedLinkRepository = new PgSignedLinkRepository(pool);
  const auditRepository = new PgAuditRepository(pool);

  const recordAudit = new RecordAuditEventService(auditRepository);
  const fileAccess = new FileAccessService(fileRepository);

  const uploadFile = new UploadFileService(fileRepository, storage, config.MAX_UPLOAD_BYTES);
  const deleteFile = new DeleteFileService(fileAccess, fileRepository, storage, recordAudit);
  const redeemSignedLink = new RedeemSignedLinkService(signedLinkRepository, recordAudit);

  return {
    health: {
      health: new HealthController(config.MAX_UPLOAD_BYTES),
    },
    files: {
      upload: new UploadFileController(uploadFile),
      batchUpload: new BatchUploadFilesController(
        new BatchUploadFilesService(uploadFile, config.MAX_BATCH_SIZE),
      ),
      list: new ListFilesController(new ListFilesService(fileRepository)),
      get: new GetFileController(new GetFileService(fileAccess)),
      update: new UpdateFileController(
        new UpdateFileService(fileAccess, fileRepository, recordAudit),
      ),
      delete: new DeleteFileController(deleteFile),
      batchDelete: new BatchDeleteFilesController(
        new BatchDeleteFilesService(deleteFile, config.MAX_BATCH_SIZE),
      ),
    },
    signedLinks: {
      create: new CreateSignedLinkController(
        new CreateSignedLinkService(fileAccess, signer, signedLinkRepository, recordAudit),
      ),
      list: new ListSignedLinksController(
        new ListSignedLinksService(fileAccess, signedLinkRepository),
      ),
      revoke: new RevokeSignedLinkController(
        new RevokeSignedLinkService(fileAccess, signedLinkRepository, recordAudit),
      ),
    },
    audit: {
      list: new ListAuditEventsController(
        new ListAuditEventsService(fileRepository, auditRepository),
      ),
    },
    downloads: {
      download: new DownloadFileController(
        new DownloadFileService(signer, fileAccess, redeemSignedLink, storage),
      ),
    },
  };
}

export type Container = ReturnType<typeof buildContainer>;

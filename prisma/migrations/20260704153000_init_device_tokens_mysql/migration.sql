CREATE TABLE `UserDeviceToken` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `role` VARCHAR(191) NOT NULL,
  `token` VARCHAR(512) NOT NULL,
  `platform` VARCHAR(191) NULL,
  `deviceId` VARCHAR(191) NULL,
  `deviceName` VARCHAR(191) NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `lastUsedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `UserDeviceToken_token_key`(`token`),
  INDEX `UserDeviceToken_userId_idx`(`userId`),
  INDEX `UserDeviceToken_email_idx`(`email`),
  INDEX `UserDeviceToken_active_idx`(`active`),
  UNIQUE INDEX `UserDeviceToken_userId_deviceId_key`(`userId`, `deviceId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

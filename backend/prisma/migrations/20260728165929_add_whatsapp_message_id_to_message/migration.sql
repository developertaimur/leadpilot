/*
  Warnings:

  - A unique constraint covering the columns `[whatsappMessageId]` on the table `Message` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `message` ADD COLUMN `whatsappMessageId` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Message_whatsappMessageId_key` ON `Message`(`whatsappMessageId`);

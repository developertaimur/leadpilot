-- AlterTable
ALTER TABLE `lead` ADD COLUMN `aiSuggestedStage` ENUM('NEW', 'CONTACTED', 'INTERESTED', 'QUALIFIED', 'CONVERTED', 'LOST') NULL,
    ADD COLUMN `aiSuggestionReason` TEXT NULL;

-- AlterTable: add title as nullable first so existing rows can be backfilled
ALTER TABLE "transactions" ADD COLUMN     "title" TEXT;

-- Backfill existing rows: reuse memo as the title, fall back to a placeholder
UPDATE "transactions" SET "title" = COALESCE(NULLIF("memo", ''), '제목 없음');

-- Now that every row has a value, enforce NOT NULL
ALTER TABLE "transactions" ALTER COLUMN "title" SET NOT NULL;

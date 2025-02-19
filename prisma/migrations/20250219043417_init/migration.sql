-- DropForeignKey
ALTER TABLE "Game" DROP CONSTRAINT "Game_player2Id_fkey";

-- AlterTable
ALTER TABLE "Game" ALTER COLUMN "player2Id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_player2Id_fkey" FOREIGN KEY ("player2Id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

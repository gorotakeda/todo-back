import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGameDto } from './dto/create-game.dto';
import { SetTrapDto } from './dto/set-trap.dto';
import { SelectSeatDto } from './dto/select-seat.dto';

@Injectable()
export class GamesService {
  constructor(private prisma: PrismaService) {}

  async createGame(createGameDto: CreateGameDto) {
    const availableSeats = Array.from({ length: 12 }, (_, i) => i + 1);
    const isPlayer1First = Math.random() < 0.5;

    return this.prisma.game.create({
      data: {
        player1Id: createGameDto.player1Id,
        player2Id: createGameDto.player2Id,
        status: 'WAITING',
        currentTurn: isPlayer1First
          ? createGameDto.player1Id
          : createGameDto.player2Id,
        availableSeats,
        scores: {
          create: [
            { playerId: createGameDto.player1Id },
            { playerId: createGameDto.player2Id },
          ],
        },
      },
      include: {
        player1: true,
        player2: true,
        scores: true,
      },
    });
  }

  async setTrap(gameId: string, setTrapDto: SetTrapDto) {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: { trap: true },
    });

    if (!game) {
      throw new BadRequestException('Game not found');
    }

    if (game.currentTurn !== setTrapDto.playerId) {
      throw new BadRequestException('Not your turn');
    }

    if (game.trap) {
      throw new BadRequestException('Trap already set');
    }

    if (!game.availableSeats.includes(setTrapDto.seatNumber)) {
      throw new BadRequestException('Invalid seat number');
    }

    if (setTrapDto.seatNumber < 1 || setTrapDto.seatNumber > 12) {
      throw new BadRequestException('Seat number must be between 1 and 12');
    }

    return this.prisma.game.update({
      where: { id: gameId },
      data: {
        status: 'IN_PROGRESS',
        currentTurn:
          game.player1Id === setTrapDto.playerId
            ? game.player2Id
            : game.player1Id,
        trap: {
          create: {
            seatNumber: setTrapDto.seatNumber,
          },
        },
      },
    });
  }

  async selectSeat(gameId: string, selectSeatDto: SelectSeatDto) {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: {
        trap: true,
        scores: true,
        rounds: true,
      },
    });

    if (!game) {
      throw new BadRequestException('Game not found');
    }

    if (game.currentTurn !== selectSeatDto.playerId) {
      throw new BadRequestException('Not your turn');
    }

    const hasTrap = game.trap?.seatNumber === selectSeatDto.seatNumber;
    const playerScore = game.scores.find(
      (s) => s.playerId === selectSeatDto.playerId,
    );
    if (!playerScore) {
      throw new BadRequestException('Player score not found');
    }
    const opponentScore = game.scores.find(
      (s) => s.playerId !== selectSeatDto.playerId,
    );

    const updatedScore = hasTrap
      ? {
          failures: (playerScore.failures ?? 0) + 1,
          score: 0,
          isResetted: true,
        }
      : {
          failures: playerScore.failures ?? 0,
          score: playerScore.score + selectSeatDto.seatNumber,
        };

    const availableSeats = hasTrap
      ? game.availableSeats
      : game.availableSeats.filter((seat) => seat !== selectSeatDto.seatNumber);

    // 勝敗判定ロジック
    let gameStatus = game.status;
    let winnerId: string | null = null;

    if (hasTrap && updatedScore.failures >= 3) {
      // ①失敗が3回の判定
      gameStatus = 'FINISHED';
      winnerId = opponentScore?.playerId ?? null;
    } else if (!hasTrap && playerScore.score + selectSeatDto.seatNumber >= 40) {
      // ②40点到達の判定
      gameStatus = 'FINISHED';
      winnerId = selectSeatDto.playerId;
    } else if (availableSeats.length === 0) {
      // ③全ての席がなくなった時の判定
      gameStatus = 'FINISHED';
      const finalPlayerScore = !hasTrap
        ? playerScore.score + selectSeatDto.seatNumber
        : playerScore.score;
      if (!opponentScore) {
        throw new BadRequestException('Opponent score not found');
      }
      winnerId =
        opponentScore.score > finalPlayerScore
          ? opponentScore.playerId
          : selectSeatDto.playerId;
    }

    return this.prisma.$transaction(async (tx) => {
      // スコアの更新
      await tx.gameScore.update({
        where: { id: playerScore.id },
        data: updatedScore,
      });

      // ラウンドの記録
      await tx.gameRound.create({
        data: {
          gameId,
          turn: game.rounds.length + 1,
          currentPlayerId: selectSeatDto.playerId,
          seatSelected: selectSeatDto.seatNumber,
          hasTrap,
        },
      });

      // ゲームの状態更新
      return tx.game.update({
        where: { id: gameId },
        data: {
          availableSeats,
          status: gameStatus,
          winnerId,
          currentTurn:
            gameStatus === 'FINISHED'
              ? undefined
              : game.player1Id === selectSeatDto.playerId
                ? game.player2Id
                : game.player1Id,
        },
      });
    });
  }

  async getGameStatus(gameId: string) {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: {
        player1: true,
        player2: true,
        scores: true,
        rounds: true,
        trap: {
          select: {
            seatNumber: true,
          },
          where: {
            gameId,
          },
        },
      },
    });

    if (!game) {
      throw new BadRequestException('Game not found');
    }

    const gameWithOptionalTrap = { ...game, trap: game.trap || undefined };
    if (gameWithOptionalTrap.status !== 'FINISHED') {
      delete gameWithOptionalTrap.trap;
    }
    return gameWithOptionalTrap;
  }

  async getGameScores(gameId: string) {
    return this.prisma.gameScore.findMany({
      where: { gameId },
      include: {
        player: true,
      },
    });
  }
}

import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGameDto } from './dto/create-game.dto';
import { SetTrapDto } from './dto/set-trap.dto';
import { SelectSeatDto } from './dto/select-seat.dto';
import { GamesGateway } from './games.gateway';
import { GameStatus } from '@prisma/client';

@Injectable()
export class GamesService {
  constructor(
    private prisma: PrismaService,
    private gamesGateway: GamesGateway,
  ) {}

  async createGame(createGameDto: CreateGameDto) {
    await this.prisma.user.upsert({
      where: { id: createGameDto.player1Id },
      update: {},
      create: {
        id: createGameDto.player1Id,
        name: 'Player 1',
        email: `${createGameDto.player1Id}@example.com`,
        password: 'player-password',
      },
    });

    const availableSeats = Array.from({ length: 12 }, (_, i) => i + 1);

    const game = await this.prisma.game.create({
      data: {
        player1Id: createGameDto.player1Id,
        player2Id: null,
        status: 'WAITING',
        currentTurn: createGameDto.player1Id,
        availableSeats,
        scores: {
          create: [
            { playerId: createGameDto.player1Id }
          ],
        },
      },
      include: {
        player1: true,
        player2: true,
        scores: true,
      },
    });

    return game;
  }

  async getGameStatus(gameId: string) {
    return this.prisma.game.findUnique({
      where: { id: gameId },
      include: {
        player1: true,
        player2: true,
        scores: true,
        trap: true,
        winner: true,
      },
    });
  }

  async getGameScores(gameId: string) {
    return this.prisma.gameScore.findMany({
      where: { gameId },
    });
  }

  async setTrap(gameId: string, setTrapDto: SetTrapDto) {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: { trap: true, player1: true, player2: true },
    });

    if (!game) {
      throw new BadRequestException('Game not found');
    }

    if (game.status !== GameStatus.SETTING_TRAP) {
      throw new BadRequestException('Cannot set trap at this time');
    }

    if (game.currentTurn !== setTrapDto.playerId) {
      throw new BadRequestException('Not your turn');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      if (game.trap) {
        await tx.gameTrap.delete({
          where: { gameId },
        });
      }

      await tx.gameTrap.create({
        data: {
          gameId,
          seatNumber: setTrapDto.seatNumber,
        },
      });

      // 次のプレイヤーのターンに切り替え
      const nextTurn =
        game.currentTurn === game.player1Id
          ? (game.player2Id ?? game.player1Id)
          : game.player1Id;

      return await tx.game.update({
        where: { id: gameId },
        data: {
          status: GameStatus.IN_PROGRESS,
          currentTurn: nextTurn,
        },
        include: {
          player1: true,
          player2: true,
          scores: true,
          trap: true,
        },
      });
    });

    this.gamesGateway.notifyGameUpdate(gameId, result);
    return result;
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

    const updatedScore = {
      failures: hasTrap ? (playerScore.failures ?? 0) + 1 : playerScore.failures ?? 0,
      score: hasTrap ? 0 : playerScore.score + selectSeatDto.seatNumber,
      isResetted: hasTrap,
    };

    // トラップに引っかかっていない場合は、他のプレイヤーのisResettedをfalseにリセット
    if (!hasTrap) {
      await this.prisma.gameScore.updateMany({
        where: { gameId },
        data: { isResetted: false },
      });
    }

    const availableSeats = hasTrap
      ? game.availableSeats
      : game.availableSeats.filter((seat) => seat !== selectSeatDto.seatNumber);

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

    const result = await this.prisma.$transaction(async (tx) => {
      // 全プレイヤーのisResettedをリセット
      await tx.gameScore.updateMany({
        where: { gameId },
        data: { isResetted: false },
      });

      // スコアの更新
      await tx.gameScore.update({
        where: { id: playerScore.id },
        data: updatedScore,
      });

      // トラップに引っかかった場合のみ、isResettedをtrueに設定
      if (hasTrap) {
        await tx.gameScore.update({
          where: { id: playerScore.id },
          data: { isResetted: true },
        });
      }

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
      const updatedGame = await tx.game.update({
        where: { id: gameId },
        data: {
          availableSeats,
          status:
            gameStatus === GameStatus.FINISHED
              ? GameStatus.FINISHED
              : GameStatus.SETTING_TRAP,
          winnerId,
          currentTurn:
            gameStatus === GameStatus.FINISHED
              ? game.player1Id
              : selectSeatDto.playerId,
        },
        include: {
          player1: true,
          player2: true,
          scores: {
            include: {
              player: true
            }
          },
          trap: true,
        },
      });
      return updatedGame;
    });

    // ゲーム状態の更新を通知
    const gameStatusResult = await this.getGameStatus(gameId);
    this.gamesGateway.notifyGameUpdate(gameId, gameStatusResult);

    return result;
  }

  async joinGame(gameId: string, player2Id: string) {
    // まずplayer2のユーザーを作成
    await this.prisma.user.upsert({
      where: { id: player2Id },
      update: {},
      create: {
        id: player2Id,
        name: 'Player 2',
        email: `${player2Id}@example.com`,
        password: 'player-password',
      },
    });

    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: { scores: true },
    });

    if (!game) {
      throw new BadRequestException('Game not found');
    }

    // トランザクションで更新
    const updatedGame = await this.prisma.$transaction(async (tx) => {
      // スコアを作成
      await tx.gameScore.create({
        data: {
          gameId,
          playerId: player2Id,
          score: 0,
          failures: 0,
          isResetted: false,
        },
      });

      // ゲームの更新
      return await tx.game.update({
        where: { id: gameId },
        data: {
          player2Id,
          status: 'SETTING_TRAP',
        },
        include: {
          player1: true,
          player2: true,
          scores: {
            include: {
              player: true,
            },
          },
        },
      });
    });

    this.gamesGateway.notifyGameUpdate(gameId, updatedGame);
    return updatedGame;
  }
}

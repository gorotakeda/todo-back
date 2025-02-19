import { Controller, Post, Body, Param, Get } from '@nestjs/common';
import { GamesService } from './games.service';
import { CreateGameDto } from './dto/create-game.dto';
import { SetTrapDto } from './dto/set-trap.dto';
import { SelectSeatDto } from './dto/select-seat.dto';
import { Game } from '@prisma/client';

@Controller('games')
export class GamesController {
  constructor(private readonly gamesService: GamesService) {}

  @Post()
  createGame(@Body() createGameDto: CreateGameDto) {
    return this.gamesService.createGame(createGameDto);
  }

  @Post(':id/trap')
  setTrap(@Param('id') id: string, @Body() setTrapDto: SetTrapDto) {
    return this.gamesService.setTrap(id, setTrapDto);
  }

  @Post(':id/select')
  selectSeat(@Param('id') id: string, @Body() selectSeatDto: SelectSeatDto) {
    return this.gamesService.selectSeat(id, selectSeatDto);
  }

  @Post(':id/join')
  async joinGame(
    @Param('id') id: string,
    @Body('playerId') playerId: string,
  ): Promise<Game> {
    return await this.gamesService.joinGame(id, playerId);
  }

  @Get(':id')
  async getGameStatus(@Param('id') id: string) {
    return this.gamesService.getGameStatus(id);
  }

  @Get(':id/scores')
  async getGameScores(@Param('id') id: string) {
    return this.gamesService.getGameScores(id);
  }
}
